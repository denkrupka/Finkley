/**
 * Тесты для RPC weekly_digest_kpis (TASK-34).
 *
 * Главная задача — проверить что окно «прошлая полная ISO-неделя» считается
 * корректно в локальной TZ салона. Помимо этого — проверить что выручка
 * считает amount - discount + tip, а не просто amount.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

import { SUPABASE_SERVICE, SUPABASE_URL, shouldSkip } from './_helpers'

let counter = 0
function makeClient(key: string): SupabaseClient {
  return createClient(SUPABASE_URL, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      storageKey: `digest-test-${++counter}`,
    },
  })
}

type Ctx = { userId: string; admin: SupabaseClient; salonId: string }

async function bootstrap(): Promise<Ctx> {
  const admin = makeClient(SUPABASE_SERVICE)
  const ts = Date.now()
  const email = `digest-${ts}@finkley.test`
  const { data: created, error: e1 } = await admin.auth.admin.createUser({
    email,
    password: 'TestPass123!',
    email_confirm: true,
  })
  if (e1 || !created.user) throw e1 ?? new Error('user not created')

  const { data: salon, error: e2 } = await admin
    .from('salons')
    .insert({
      name: 'Digest Test',
      country_code: 'PL',
      currency: 'PLN',
      timezone: 'Europe/Warsaw',
      salon_type: 'hair',
      locale: 'ru',
      created_by: created.user.id,
    })
    .select('id')
    .single()
  if (e2 || !salon) throw e2 ?? new Error('salon not created')

  const { error: e3 } = await admin
    .from('salon_members')
    .insert({ salon_id: salon.id, user_id: created.user.id, role: 'owner' })
  if (e3) throw e3

  return { userId: created.user.id, admin, salonId: salon.id }
}

async function teardown(ctx: Ctx | null): Promise<void> {
  if (!ctx) return
  const admin = makeClient(SUPABASE_SERVICE)
  await admin.from('salons').delete().eq('id', ctx.salonId)
  await admin.auth.admin.deleteUser(ctx.userId)
}

/**
 * Возвращает день недели в формате ISO 8601 (Mon=1..Sun=7) для даты.
 * Postgres extract(isodow) использует тот же формат.
 */
function isoDow(date: Date): number {
  const d = date.getUTCDay() // 0=Sun..6=Sat
  return d === 0 ? 7 : d
}

/**
 * Возвращает понедельник прошлой полной недели в локальной TZ Europe/Warsaw,
 * совпадает с расчётом в weekly_digest_kpis.
 */
function lastWeekMondayLocal(): Date {
  // RPC weekly_digest_kpis считает «сегодня» в Europe/Warsaw (TIMESTAMPTZ AT
  // TIME ZONE 'Europe/Warsaw'). Если просто взять UTC-сегодня, то в окне с
  // 22:00 UTC до 24:00 UTC (полночь — 02:00 в Варшаве летом, 01:00 зимой)
  // даты разойдутся и тест упадёт ровно раз в неделю — на стыке дня.
  const now = new Date()
  const todayWarsaw = now.toLocaleDateString('en-CA', { timeZone: 'Europe/Warsaw' })
  const [y, m, d] = todayWarsaw.split('-').map(Number)
  const today = new Date(Date.UTC(y!, m! - 1, d!))
  const dow = isoDow(today)
  const thisMonday = new Date(today)
  thisMonday.setUTCDate(today.getUTCDate() - (dow - 1))
  const lastMonday = new Date(thisMonday)
  lastMonday.setUTCDate(thisMonday.getUTCDate() - 7)
  return lastMonday
}

describe.skipIf(shouldSkip)('weekly_digest_kpis', () => {
  let ctx: Ctx | null = null

  beforeAll(async () => {
    ctx = await bootstrap()
  }, 30_000)

  afterAll(async () => {
    await teardown(ctx)
  })

  it('окно — понедельник прошлой ISO-недели → воскресенье прошлой', async () => {
    if (!ctx) throw new Error('no ctx')

    const { data, error } = await ctx.admin
      .rpc('weekly_digest_kpis', { p_salon_id: ctx.salonId })
      .single()
    expect(error).toBeNull()

    const k = data as { period_start: string; period_end: string }
    const expectedMonday = lastWeekMondayLocal()
    const expectedSunday = new Date(expectedMonday)
    expectedSunday.setUTCDate(expectedMonday.getUTCDate() + 6)

    expect(k.period_start).toBe(expectedMonday.toISOString().slice(0, 10))
    expect(k.period_end).toBe(expectedSunday.toISOString().slice(0, 10))
  })

  it('revenue = amount - discount + tip (включая чаевые)', async () => {
    if (!ctx) throw new Error('no ctx')
    const lastMon = lastWeekMondayLocal()
    // Среда прошлой недели — точно внутри окна
    const wednesday = new Date(lastMon)
    wednesday.setUTCDate(lastMon.getUTCDate() + 2)
    wednesday.setUTCHours(12, 0, 0, 0)

    await ctx.admin.from('visits').insert({
      salon_id: ctx.salonId,
      visit_at: wednesday.toISOString(),
      amount_cents: 50000, // 500 PLN
      tip_cents: 5000, // 50 PLN чаевые
      discount_cents: 1000, // 10 PLN скидка
      payment_method: 'cash',
      status: 'paid',
    })
    await ctx.admin.from('visits').insert({
      salon_id: ctx.salonId,
      visit_at: wednesday.toISOString(),
      amount_cents: 30000,
      payment_method: 'card',
      status: 'paid',
    })

    const { data, error } = await ctx.admin
      .rpc('weekly_digest_kpis', { p_salon_id: ctx.salonId })
      .single()
    expect(error).toBeNull()
    const k = data as { revenue_cents: number; visits_count: number }

    // 50000 - 1000 + 5000 = 54000, плюс 30000 = 84000
    expect(Number(k.revenue_cents)).toBe(84000)
    expect(Number(k.visits_count)).toBe(2)
  })

  it('исключает visit status=cancelled', async () => {
    if (!ctx) throw new Error('no ctx')
    const lastMon = lastWeekMondayLocal()
    const tuesday = new Date(lastMon)
    tuesday.setUTCDate(lastMon.getUTCDate() + 1)
    tuesday.setUTCHours(15, 0, 0, 0)

    // Получим baseline
    const { data: before } = await ctx.admin
      .rpc('weekly_digest_kpis', { p_salon_id: ctx.salonId })
      .single()
    const baseRev = Number((before as { revenue_cents: number }).revenue_cents)

    await ctx.admin.from('visits').insert({
      salon_id: ctx.salonId,
      visit_at: tuesday.toISOString(),
      amount_cents: 999999,
      payment_method: 'cash',
      status: 'cancelled',
    })

    const { data: after } = await ctx.admin
      .rpc('weekly_digest_kpis', { p_salon_id: ctx.salonId })
      .single()
    expect(Number((after as { revenue_cents: number }).revenue_cents)).toBe(baseRev)
  })

  it('top_staff — мастер с наибольшей выручкой', async () => {
    if (!ctx) throw new Error('no ctx')
    const { data: staff1, error: s1err } = await ctx.admin
      .from('staff')
      .insert({
        salon_id: ctx.salonId,
        full_name: 'Аня (low)',
        payout_scheme: 'percent_revenue',
        payout_percent: 40,
      })
      .select('id, full_name')
      .single()
    if (s1err || !staff1) throw s1err
    const { data: staff2, error: s2err } = await ctx.admin
      .from('staff')
      .insert({
        salon_id: ctx.salonId,
        full_name: 'Боря (top)',
        payout_scheme: 'percent_revenue',
        payout_percent: 40,
      })
      .select('id, full_name')
      .single()
    if (s2err || !staff2) throw s2err

    const lastMon = lastWeekMondayLocal()
    const thursday = new Date(lastMon)
    thursday.setUTCDate(lastMon.getUTCDate() + 3)
    thursday.setUTCHours(10, 0, 0, 0)

    await ctx.admin.from('visits').insert([
      {
        salon_id: ctx.salonId,
        staff_id: staff1.id,
        visit_at: thursday.toISOString(),
        amount_cents: 10000,
        payment_method: 'cash',
        status: 'paid',
      },
      {
        salon_id: ctx.salonId,
        staff_id: staff2.id,
        visit_at: thursday.toISOString(),
        amount_cents: 200000,
        payment_method: 'cash',
        status: 'paid',
      },
    ])

    const { data, error } = await ctx.admin
      .rpc('weekly_digest_kpis', { p_salon_id: ctx.salonId })
      .single()
    expect(error).toBeNull()
    const k = data as { top_staff_name: string | null; top_staff_revenue_cents: number | null }
    expect(k.top_staff_name).toBe('Боря (top)')
    expect(Number(k.top_staff_revenue_cents)).toBeGreaterThanOrEqual(200000)
  })
})
