/**
 * Интеграционные тесты для payouts RPC (TASK-21/22).
 *
 * Покрывают:
 *   - calculate_payouts_for_period для каждой из 5 схем выплат
 *   - close_payout_period: создание payouts + auto-expense, защита от double-close
 *
 * Запуск: с локальным `supabase start` либо со staging-credentials в env.
 * На production эти тесты НЕ запускать — создают мусорных юзеров/визиты.
 *
 * Запуск:
 *   pnpm test                          # skip если нет ключей
 *   VITE_SUPABASE_URL_TEST=...
 *   VITE_SUPABASE_ANON_KEY_TEST=...
 *   SUPABASE_SERVICE_ROLE_KEY_TEST=... pnpm test
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

import { SUPABASE_ANON, SUPABASE_SERVICE, SUPABASE_URL, shouldSkip } from './_helpers'

let clientCounter = 0
function makeClient(key: string): SupabaseClient {
  return createClient(SUPABASE_URL, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      storageKey: `payouts-test-${++clientCounter}`,
    },
  })
}

type Ctx = {
  userId: string
  userClient: SupabaseClient
  admin: SupabaseClient
  salonId: string
}

async function bootstrap(emailSuffix: string): Promise<Ctx> {
  const admin = makeClient(SUPABASE_SERVICE)
  const ts = Date.now()
  const email = `payouts-${emailSuffix}-${ts}@finkley.test`

  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password: 'TestPass123!',
    email_confirm: true,
  })
  if (createErr || !created.user) throw createErr ?? new Error('user not created')

  const userClient = makeClient(SUPABASE_ANON)
  const { error: signInErr } = await userClient.auth.signInWithPassword({
    email,
    password: 'TestPass123!',
  })
  if (signInErr) throw signInErr

  const { data: salon, error: salonErr } = await admin
    .from('salons')
    .insert({
      name: `Payouts Test ${emailSuffix}`,
      country_code: 'PL',
      currency: 'PLN',
      timezone: 'Europe/Warsaw',
      salon_type: 'hair',
      locale: 'ru',
      created_by: created.user.id,
    })
    .select('id')
    .single()
  if (salonErr || !salon) throw salonErr ?? new Error('salon not created')

  const { error: memberErr } = await admin.from('salon_members').insert({
    salon_id: salon.id,
    user_id: created.user.id,
    role: 'owner',
  })
  if (memberErr) throw memberErr

  return { userId: created.user.id, userClient, admin, salonId: salon.id }
}

async function teardown(ctx: Ctx | null): Promise<void> {
  if (!ctx) return
  const admin = makeClient(SUPABASE_SERVICE)
  // Каскадно подчистится всё через ON DELETE CASCADE на salon_id
  await admin.from('salons').delete().eq('id', ctx.salonId)
  await admin.auth.admin.deleteUser(ctx.userId)
}

async function createStaff(
  ctx: Ctx,
  fields: {
    full_name: string
    payout_scheme: 'fixed' | 'percent_revenue' | 'percent_service' | 'chair_rent' | 'mixed'
    payout_percent?: number | null
    payout_fixed_cents?: number | null
    chair_rent_cents?: number | null
  },
): Promise<string> {
  const { data, error } = await ctx.admin
    .from('staff')
    .insert({ salon_id: ctx.salonId, ...fields })
    .select('id')
    .single()
  if (error || !data) throw error ?? new Error('staff not created')
  return data.id
}

async function createVisit(
  ctx: Ctx,
  staffId: string,
  amountCents: number,
  visitAt: string,
  serviceId?: string | null,
): Promise<void> {
  const { error } = await ctx.admin.from('visits').insert({
    salon_id: ctx.salonId,
    staff_id: staffId,
    service_id: serviceId ?? null,
    visit_at: visitAt,
    amount_cents: amountCents,
    payment_method: 'cash',
    status: 'paid',
  })
  if (error) throw error
}

describe.skipIf(shouldSkip)('RPC calculate_payouts_for_period', () => {
  let ctx: Ctx | null = null
  // Используем фиксированное окно в прошлом — проще предсказывать дату визитов
  const periodStart = '2026-01-01'
  const periodEnd = '2026-01-31'
  const dayInPeriod = '2026-01-15T12:00:00Z'

  beforeAll(async () => {
    ctx = await bootstrap('calc')
  }, 30_000)

  afterAll(async () => {
    await teardown(ctx)
  })

  it('percent_revenue: 40% от выручки', async () => {
    if (!ctx) throw new Error('no ctx')
    const staffId = await createStaff(ctx, {
      full_name: 'Аня (% revenue)',
      payout_scheme: 'percent_revenue',
      payout_percent: 40,
    })
    await createVisit(ctx, staffId, 10000, dayInPeriod) // 100 PLN
    await createVisit(ctx, staffId, 25000, dayInPeriod) // 250 PLN

    const { data, error } = await ctx.userClient.rpc('calculate_payouts_for_period', {
      p_salon_id: ctx.salonId,
      p_period_start: periodStart,
      p_period_end: periodEnd,
    })
    expect(error).toBeNull()
    const row = (
      data as Array<{ staff_id: string; payout_cents: number; revenue_cents: number }>
    )?.find((r) => r.staff_id === staffId)
    expect(row).toBeDefined()
    // 350 PLN * 40% = 140 PLN = 14000 cents
    expect(Number(row!.revenue_cents)).toBe(35000)
    expect(Number(row!.payout_cents)).toBe(14000)
  })

  it('fixed: ровно payout_fixed_cents независимо от выручки', async () => {
    if (!ctx) throw new Error('no ctx')
    const staffId = await createStaff(ctx, {
      full_name: 'Боря (fixed)',
      payout_scheme: 'fixed',
      payout_fixed_cents: 400000, // 4000 PLN
    })
    await createVisit(ctx, staffId, 99999, dayInPeriod)

    const { data } = await ctx.userClient.rpc('calculate_payouts_for_period', {
      p_salon_id: ctx.salonId,
      p_period_start: periodStart,
      p_period_end: periodEnd,
    })
    const row = (data as Array<{ staff_id: string; payout_cents: number }>)?.find(
      (r) => r.staff_id === staffId,
    )
    expect(Number(row!.payout_cents)).toBe(400000)
  })

  it('chair_rent: отрицательный payout = аренда', async () => {
    if (!ctx) throw new Error('no ctx')
    const staffId = await createStaff(ctx, {
      full_name: 'Вова (chair rent)',
      payout_scheme: 'chair_rent',
      chair_rent_cents: 150000, // 1500 PLN аренды
    })
    await createVisit(ctx, staffId, 50000, dayInPeriod)

    const { data } = await ctx.userClient.rpc('calculate_payouts_for_period', {
      p_salon_id: ctx.salonId,
      p_period_start: periodStart,
      p_period_end: periodEnd,
    })
    const row = (data as Array<{ staff_id: string; payout_cents: number }>)?.find(
      (r) => r.staff_id === staffId,
    )
    expect(Number(row!.payout_cents)).toBe(-150000)
  })

  it('mixed: фикс + % сверху', async () => {
    if (!ctx) throw new Error('no ctx')
    const staffId = await createStaff(ctx, {
      full_name: 'Галя (mixed)',
      payout_scheme: 'mixed',
      payout_fixed_cents: 200000, // 2000 PLN база
      payout_percent: 25, // +25%
    })
    await createVisit(ctx, staffId, 80000, dayInPeriod) // 800 PLN

    const { data } = await ctx.userClient.rpc('calculate_payouts_for_period', {
      p_salon_id: ctx.salonId,
      p_period_start: periodStart,
      p_period_end: periodEnd,
    })
    const row = (data as Array<{ staff_id: string; payout_cents: number }>)?.find(
      (r) => r.staff_id === staffId,
    )
    // 200000 + 80000*0.25 = 200000 + 20000 = 220000
    expect(Number(row!.payout_cents)).toBe(220000)
  })

  it('percent_service: учитывает только услуги с override', async () => {
    if (!ctx) throw new Error('no ctx')
    // Создаём 2 услуги
    const { data: svc1, error: svc1err } = await ctx.admin
      .from('services')
      .insert({ salon_id: ctx.salonId, name: 'Стрижка', default_price_cents: 10000 })
      .select('id')
      .single()
    if (svc1err || !svc1) throw svc1err
    const { data: svc2, error: svc2err } = await ctx.admin
      .from('services')
      .insert({ salon_id: ctx.salonId, name: 'Окрашивание', default_price_cents: 30000 })
      .select('id')
      .single()
    if (svc2err || !svc2) throw svc2err

    const staffId = await createStaff(ctx, {
      full_name: 'Даша (% service)',
      payout_scheme: 'percent_service',
    })

    // Override: 50% за стрижку, окрашивание — без override (не учитывается)
    await ctx.admin
      .from('staff_service_overrides')
      .insert({ staff_id: staffId, service_id: svc1.id, payout_percent: 50 })

    await createVisit(ctx, staffId, 10000, dayInPeriod, svc1.id) // стрижка 100 PLN → 50 PLN
    await createVisit(ctx, staffId, 30000, dayInPeriod, svc2.id) // окрашивание — пропустить
    await createVisit(ctx, staffId, 12000, dayInPeriod, svc1.id) // ещё стрижка 120 → 60

    const { data } = await ctx.userClient.rpc('calculate_payouts_for_period', {
      p_salon_id: ctx.salonId,
      p_period_start: periodStart,
      p_period_end: periodEnd,
    })
    const row = (
      data as Array<{ staff_id: string; payout_cents: number; revenue_cents: number }>
    )?.find((r) => r.staff_id === staffId)
    // revenue считает все 3 визита: 10000+30000+12000=52000
    expect(Number(row!.revenue_cents)).toBe(52000)
    // payout — только стрижки: (10000+12000)*0.5 = 11000
    expect(Number(row!.payout_cents)).toBe(11000)
  })

  it('исключает визиты status=cancelled и удалённые', async () => {
    if (!ctx) throw new Error('no ctx')
    const staffId = await createStaff(ctx, {
      full_name: 'Женя (filters)',
      payout_scheme: 'percent_revenue',
      payout_percent: 100,
    })
    // Один paid визит
    await createVisit(ctx, staffId, 10000, dayInPeriod)
    // Отменённый визит — не должен попасть
    await ctx.admin.from('visits').insert({
      salon_id: ctx.salonId,
      staff_id: staffId,
      visit_at: dayInPeriod,
      amount_cents: 99999,
      payment_method: 'cash',
      status: 'cancelled',
    })

    const { data } = await ctx.userClient.rpc('calculate_payouts_for_period', {
      p_salon_id: ctx.salonId,
      p_period_start: periodStart,
      p_period_end: periodEnd,
    })
    const row = (data as Array<{ staff_id: string; payout_cents: number }>)?.find(
      (r) => r.staff_id === staffId,
    )
    expect(Number(row!.payout_cents)).toBe(10000) // ровно 100 PLN, отменённый не учли
  })
})

describe.skipIf(shouldSkip)('RPC close_payout_period', () => {
  let ctx: Ctx | null = null
  const periodStart = '2026-02-01'
  const periodEnd = '2026-02-28'
  const dayInPeriod = '2026-02-15T12:00:00Z'

  beforeAll(async () => {
    ctx = await bootstrap('close')
  }, 30_000)

  afterAll(async () => {
    await teardown(ctx)
  })

  it('создаёт payouts + auto-expense в категории "Зарплаты"', async () => {
    if (!ctx) throw new Error('no ctx')
    const staffId = await createStaff(ctx, {
      full_name: 'Ваня',
      payout_scheme: 'percent_revenue',
      payout_percent: 50,
    })
    await createVisit(ctx, staffId, 100000, dayInPeriod) // 1000 PLN → 500 PLN payout

    const { data, error } = await ctx.userClient
      .rpc('close_payout_period', {
        p_salon_id: ctx.salonId,
        p_period_start: periodStart,
        p_period_end: periodEnd,
      })
      .single()
    expect(error).toBeNull()
    const result = data as { payouts_created: number; total_expense_cents: number }
    expect(result.payouts_created).toBe(1)
    expect(Number(result.total_expense_cents)).toBe(50000)

    // Проверяем что строка в payouts создалась
    const { data: payouts } = await ctx.userClient
      .from('payouts')
      .select('id, status, total_payout_cents')
      .eq('salon_id', ctx.salonId)
      .eq('period_start', periodStart)
    expect(payouts).toHaveLength(1)
    expect(payouts![0]!.status).toBe('paid')
    expect(Number(payouts![0]!.total_payout_cents)).toBe(50000)

    // И что появилась expense в категории "Зарплаты"
    const { data: cat } = await ctx.userClient
      .from('expense_categories')
      .select('id, name, is_system')
      .eq('salon_id', ctx.salonId)
      .eq('is_system', true)
      .eq('name', 'Зарплаты')
      .single()
    expect(cat).toBeDefined()
    expect(cat!.is_system).toBe(true)

    const { data: expenses } = await ctx.userClient
      .from('expenses')
      .select('amount_cents, source')
      .eq('salon_id', ctx.salonId)
      .eq('category_id', cat!.id)
    expect(expenses).toHaveLength(1)
    expect(Number(expenses![0]!.amount_cents)).toBe(50000)
    expect(expenses![0]!.source).toBe('payout')
  })

  it('повторное закрытие того же периода — ошибка', async () => {
    if (!ctx) throw new Error('no ctx')
    const { error } = await ctx.userClient.rpc('close_payout_period', {
      p_salon_id: ctx.salonId,
      p_period_start: periodStart,
      p_period_end: periodEnd,
    })
    expect(error).not.toBeNull()
    expect(error?.message?.toLowerCase() ?? '').toMatch(/period_already_closed|duplicate/)
  })

  it('закрытие незавершённого периода (>= today) — ошибка', async () => {
    if (!ctx) throw new Error('no ctx')
    const future = '2099-12-31'
    const { error } = await ctx.userClient.rpc('close_payout_period', {
      p_salon_id: ctx.salonId,
      p_period_start: '2099-12-01',
      p_period_end: future,
    })
    expect(error).not.toBeNull()
    expect(error?.message?.toLowerCase() ?? '').toMatch(/period_not_finished/)
  })
})
