/**
 * Тесты для analytics RPC (TASK-23): aggregations используемые на странице
 * /reports.
 *
 * Покрывают:
 *   - analytics_revenue_by_payment группирует по способу оплаты
 *   - analytics_visits_heatmap раскладывает по dow × hour в TZ салона
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
      storageKey: `analytics-test-${++counter}`,
    },
  })
}

type Ctx = { userId: string; admin: SupabaseClient; salonId: string }

async function bootstrap(): Promise<Ctx> {
  const admin = makeClient(SUPABASE_SERVICE)
  const ts = Date.now()
  const email = `analytics-${ts}@finkley.test`
  const { data: created, error: e1 } = await admin.auth.admin.createUser({
    email,
    password: 'TestPass123!',
    email_confirm: true,
  })
  if (e1 || !created.user) throw e1 ?? new Error('user not created')

  const { data: salon, error: e2 } = await admin
    .from('salons')
    .insert({
      name: 'Analytics Test',
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

describe.skipIf(shouldSkip)('analytics_revenue_by_payment', () => {
  let ctx: Ctx | null = null
  // Январь 2026 — фиксированное окно в прошлом
  const periodStart = '2026-01-01T00:00:00Z'
  const periodEnd = '2026-02-01T00:00:00Z'

  beforeAll(async () => {
    ctx = await bootstrap()
  }, 30_000)

  afterAll(async () => {
    await teardown(ctx)
  })

  it('группирует визиты по payment_method и считает revenue', async () => {
    if (!ctx) throw new Error('no ctx')
    const visitDay = '2026-01-15T12:00:00Z'
    await ctx.admin.from('visits').insert([
      // 2 cash на 100 + 200 PLN = 300
      {
        salon_id: ctx.salonId,
        visit_at: visitDay,
        amount_cents: 10000,
        payment_method: 'cash',
        status: 'paid',
      },
      {
        salon_id: ctx.salonId,
        visit_at: visitDay,
        amount_cents: 20000,
        payment_method: 'cash',
        status: 'paid',
      },
      // 1 card на 500 PLN
      {
        salon_id: ctx.salonId,
        visit_at: visitDay,
        amount_cents: 50000,
        payment_method: 'card',
        status: 'paid',
      },
      // cancelled — не должен попасть
      {
        salon_id: ctx.salonId,
        visit_at: visitDay,
        amount_cents: 99999,
        payment_method: 'card',
        status: 'cancelled',
      },
    ])

    const { data, error } = await ctx.admin.rpc('analytics_revenue_by_payment', {
      p_salon_id: ctx.salonId,
      p_period_start: periodStart,
      p_period_end: periodEnd,
    })
    expect(error).toBeNull()
    const rows = data as Array<{
      payment_method: string
      visits_count: number
      revenue_cents: number
    }>

    const cash = rows.find((r) => r.payment_method === 'cash')!
    const card = rows.find((r) => r.payment_method === 'card')!
    expect(Number(cash.visits_count)).toBe(2)
    expect(Number(cash.revenue_cents)).toBe(30000)
    expect(Number(card.visits_count)).toBe(1)
    expect(Number(card.revenue_cents)).toBe(50000)

    // Сортировка по revenue desc → card должен быть первым (50000 > 30000)
    expect(rows[0]!.payment_method).toBe('card')
  })
})

describe.skipIf(shouldSkip)('analytics_visits_heatmap', () => {
  let ctx: Ctx | null = null
  const periodStart = '2026-03-01T00:00:00Z'
  const periodEnd = '2026-04-01T00:00:00Z'

  beforeAll(async () => {
    ctx = await bootstrap()
  }, 30_000)

  afterAll(async () => {
    await teardown(ctx)
  })

  it('группирует по dow × hour в локальной TZ салона', async () => {
    if (!ctx) throw new Error('no ctx')
    // Среда 11 марта 2026 в Warsaw — это среда 10:00 локального времени
    // (в марте Warsaw = UTC+1 до DST, но 11 марта — уже после DST? Польша
    // переходит на DST в последнее воскресенье марта, т.е. 29.03.2026.
    // Значит до 29 марта Warsaw = UTC+1)
    // 11.03.2026 09:00 UTC = 10:00 CET (Warsaw)
    const wedAt9UTC = '2026-03-11T09:00:00Z'

    await ctx.admin.from('visits').insert([
      {
        salon_id: ctx.salonId,
        visit_at: wedAt9UTC,
        amount_cents: 10000,
        payment_method: 'cash',
        status: 'paid',
      },
      {
        salon_id: ctx.salonId,
        visit_at: wedAt9UTC, // ещё один визит в тот же час
        amount_cents: 20000,
        payment_method: 'cash',
        status: 'paid',
      },
    ])

    const { data, error } = await ctx.admin.rpc('analytics_visits_heatmap', {
      p_salon_id: ctx.salonId,
      p_period_start: periodStart,
      p_period_end: periodEnd,
      p_timezone: 'Europe/Warsaw',
    })
    expect(error).toBeNull()
    const rows = data as Array<{
      dow: number
      hour_of_day: number
      visits_count: number
      revenue_cents: number
    }>

    // Postgres extract(dow): 0=Sun..6=Sat. 11 марта 2026 — среда → dow=3.
    // Час: 10 (UTC+1).
    const cell = rows.find((r) => Number(r.dow) === 3 && Number(r.hour_of_day) === 10)
    expect(cell).toBeDefined()
    expect(Number(cell!.visits_count)).toBe(2)
    expect(Number(cell!.revenue_cents)).toBe(30000)
  })
})
