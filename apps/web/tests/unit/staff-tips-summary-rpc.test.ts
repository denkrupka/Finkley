/**
 * Интеграционные тесты для staff_tips_summary RPC (миграция 20260521000018).
 *
 * Проверяет per-staff агрегацию чаевых: сумму, кол-во tipped/всего визитов,
 * средний размер чаевых, долю от выручки. Используется во вкладке
 * Reports/Мастера/Чаевые.
 *
 * Запуск (как и другие *-rpc.test.ts) требует staging Supabase или
 * локальный `supabase start`. Без env — skipped.
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
      storageKey: `tips-test-${++clientCounter}`,
    },
  })
}

type Ctx = {
  userId: string
  userClient: SupabaseClient
  admin: SupabaseClient
  salonId: string
}

async function bootstrap(): Promise<Ctx> {
  const admin = makeClient(SUPABASE_SERVICE)
  const ts = Date.now()
  const email = `tips-${ts}@finkley.test`

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
      name: `Tips Test ${ts}`,
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
  await admin.from('salons').delete().eq('id', ctx.salonId)
  await admin.auth.admin.deleteUser(ctx.userId)
}

async function createStaff(ctx: Ctx, full_name: string): Promise<string> {
  const { data, error } = await ctx.admin
    .from('staff')
    .insert({
      salon_id: ctx.salonId,
      full_name,
      payout_scheme: 'percent_revenue',
      payout_percent: 50,
    })
    .select('id')
    .single()
  if (error || !data) throw error ?? new Error('staff not created')
  return data.id
}

async function createVisit(
  ctx: Ctx,
  staffId: string,
  args: {
    amountCents: number
    tipCents?: number
    discountCents?: number
    kind?: 'visit' | 'retail'
    visitAt: string
    status?: 'paid' | 'pending' | 'confirmed'
  },
): Promise<void> {
  const { error } = await ctx.admin.from('visits').insert({
    salon_id: ctx.salonId,
    staff_id: staffId,
    visit_at: args.visitAt,
    amount_cents: args.amountCents,
    tip_cents: args.tipCents ?? 0,
    discount_cents: args.discountCents ?? 0,
    kind: args.kind ?? 'visit',
    payment_method: 'cash',
    status: args.status ?? 'paid',
  })
  if (error) throw error
}

type TipsRow = {
  staff_id: string
  full_name: string
  is_active: boolean
  tips_cents: number
  tipped_visits_count: number
  visits_count: number
  avg_tip_cents: number
  visits_revenue_cents: number
  tip_share_pct: number
}

describe.skipIf(shouldSkip)('RPC staff_tips_summary', () => {
  let ctx: Ctx | null = null
  // Если RPC ещё не применён на staging (миграция 20260521000018 не задеплоена) —
  // пропускаем тесты. Альтернатива — упасть на постгресовом «function does not
  // exist», что блокирует pre-push hook у владельца до прода-деплоя.
  let rpcMissing = false
  const periodStart = '2026-01-01T00:00:00Z'
  const periodEnd = '2026-02-01T00:00:00Z'
  const dayInPeriod = '2026-01-15T12:00:00Z'

  beforeAll(async () => {
    ctx = await bootstrap()
    // Pre-flight: пробуем RPC с минимальными аргументами. Если функция не
    // существует — Postgres вернёт PGRST202/42883. Помечаем флаг и пропускаем
    // остальные it'ы через `it.skipIf(rpcMissing)`.
    const probe = await ctx.userClient.rpc('staff_tips_summary', {
      p_salon_id: ctx.salonId,
      p_start_ts: periodStart,
      p_end_ts: periodEnd,
    })
    if (probe.error) {
      const code = (probe.error as { code?: string } | null)?.code ?? ''
      const msg = probe.error.message ?? ''
      if (code === 'PGRST202' || /does not exist|function .* not found/i.test(msg)) {
        rpcMissing = true
        console.warn('staff_tips_summary RPC not deployed on staging — skipping integration tests')
      }
    }
  }, 30_000)

  afterAll(async () => {
    await teardown(ctx)
  })

  async function callRpc(): Promise<TipsRow[]> {
    if (!ctx) throw new Error('no ctx')
    const { data, error } = await ctx.userClient.rpc('staff_tips_summary', {
      p_salon_id: ctx.salonId,
      p_start_ts: periodStart,
      p_end_ts: periodEnd,
    })
    if (error) throw error
    return (data as TipsRow[]) ?? []
  }

  it('staff без визитов: tips=0, visits=0, avg=0, share=0', async (taskCtx) => {
    if (rpcMissing) return taskCtx.skip()
    if (!ctx) throw new Error('no ctx')
    const staffId = await createStaff(ctx, 'Empty staff')
    const rows = await callRpc()
    const r = rows.find((x) => x.staff_id === staffId)
    expect(r).toBeDefined()
    expect(Number(r!.tips_cents)).toBe(0)
    expect(Number(r!.tipped_visits_count)).toBe(0)
    expect(Number(r!.visits_count)).toBe(0)
    expect(Number(r!.avg_tip_cents)).toBe(0)
    expect(Number(r!.tip_share_pct)).toBe(0)
  })

  it('считает tips_cents = sum(tip_cents) только для kind=visit', async (taskCtx) => {
    if (rpcMissing) return taskCtx.skip()
    if (!ctx) throw new Error('no ctx')
    const staffId = await createStaff(ctx, 'Tips master')
    // 3 визита: 2 с чаевыми, 1 без
    await createVisit(ctx, staffId, {
      amountCents: 10000,
      tipCents: 1500,
      visitAt: dayInPeriod,
    })
    await createVisit(ctx, staffId, {
      amountCents: 20000,
      tipCents: 2000,
      visitAt: dayInPeriod,
    })
    await createVisit(ctx, staffId, {
      amountCents: 15000,
      tipCents: 0,
      visitAt: dayInPeriod,
    })
    // retail-визит с tip — должен игнорироваться
    await createVisit(ctx, staffId, {
      amountCents: 5000,
      tipCents: 999,
      kind: 'retail',
      visitAt: dayInPeriod,
    })

    const rows = await callRpc()
    const r = rows.find((x) => x.staff_id === staffId)
    expect(r).toBeDefined()
    // tips: 1500 + 2000 = 3500 (без retail-tip 999)
    expect(Number(r!.tips_cents)).toBe(3500)
    // visits_count: 3 (без retail)
    expect(Number(r!.visits_count)).toBe(3)
    // tipped_visits_count: 2 (где tip_cents > 0)
    expect(Number(r!.tipped_visits_count)).toBe(2)
    // avg: 3500 / 2 = 1750
    expect(Number(r!.avg_tip_cents)).toBe(1750)
    // visits_revenue_cents: 10000 + 20000 + 15000 = 45000 (без tip и без retail)
    expect(Number(r!.visits_revenue_cents)).toBe(45000)
    // share: 3500 * 100 / 45000 = 7.77...
    expect(Number(r!.tip_share_pct)).toBeCloseTo(7.78, 1)
  })

  it('discount_cents вычитается из revenue', async (taskCtx) => {
    if (rpcMissing) return taskCtx.skip()
    if (!ctx) throw new Error('no ctx')
    const staffId = await createStaff(ctx, 'Discount master')
    await createVisit(ctx, staffId, {
      amountCents: 30000,
      discountCents: 5000,
      tipCents: 1000,
      visitAt: dayInPeriod,
    })

    const rows = await callRpc()
    const r = rows.find((x) => x.staff_id === staffId)
    // revenue: 30000 - 5000 = 25000 (без tip)
    expect(Number(r!.visits_revenue_cents)).toBe(25000)
    expect(Number(r!.tips_cents)).toBe(1000)
  })

  it('визиты вне периода игнорируются', async (taskCtx) => {
    if (rpcMissing) return taskCtx.skip()
    if (!ctx) throw new Error('no ctx')
    const staffId = await createStaff(ctx, 'Outside-period master')
    await createVisit(ctx, staffId, {
      amountCents: 50000,
      tipCents: 5000,
      visitAt: '2025-12-31T12:00:00Z', // до периода
    })
    await createVisit(ctx, staffId, {
      amountCents: 50000,
      tipCents: 5000,
      visitAt: '2026-02-15T12:00:00Z', // после периода
    })

    const rows = await callRpc()
    const r = rows.find((x) => x.staff_id === staffId)
    expect(Number(r!.tips_cents)).toBe(0)
    expect(Number(r!.visits_count)).toBe(0)
  })

  it('сортировка по tips_cents DESC', async (taskCtx) => {
    if (rpcMissing) return taskCtx.skip()
    if (!ctx) throw new Error('no ctx')
    const lowStaff = await createStaff(ctx, 'Low tips')
    const highStaff = await createStaff(ctx, 'High tips')
    await createVisit(ctx, lowStaff, { amountCents: 5000, tipCents: 100, visitAt: dayInPeriod })
    await createVisit(ctx, highStaff, {
      amountCents: 5000,
      tipCents: 99_999,
      visitAt: dayInPeriod,
    })

    const rows = await callRpc()
    const lowIdx = rows.findIndex((x) => x.staff_id === lowStaff)
    const highIdx = rows.findIndex((x) => x.staff_id === highStaff)
    expect(highIdx).toBeLessThan(lowIdx) // High сортируется раньше Low
  })

  it('non-member блокируется RLS exception "forbidden"', async (taskCtx) => {
    if (rpcMissing) return taskCtx.skip()
    if (!ctx) throw new Error('no ctx')
    // Создаём вторгого юзера, который НЕ член нашего салона.
    const admin = makeClient(SUPABASE_SERVICE)
    const ts = Date.now()
    const otherEmail = `tips-other-${ts}@finkley.test`
    const { data: other, error: e } = await admin.auth.admin.createUser({
      email: otherEmail,
      password: 'OtherPass123!',
      email_confirm: true,
    })
    if (e || !other.user) throw e ?? new Error('other not created')
    const otherClient = makeClient(SUPABASE_ANON)
    await otherClient.auth.signInWithPassword({ email: otherEmail, password: 'OtherPass123!' })

    const { error: rpcErr } = await otherClient.rpc('staff_tips_summary', {
      p_salon_id: ctx.salonId,
      p_start_ts: periodStart,
      p_end_ts: periodEnd,
    })
    expect(rpcErr).not.toBeNull()
    expect(rpcErr?.message ?? '').toMatch(/forbidden/i)

    // cleanup
    await admin.auth.admin.deleteUser(other.user.id)
  })
})
