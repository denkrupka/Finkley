/**
 * Тесты для public.process_recurring_expenses() — SQL-функции которая
 * запускается из pg_cron каждые сутки в 03:00 UTC.
 *
 * Эта функция автономна и тихо ломала бы данные при баге — поэтому тесты
 * особенно важны.
 *
 * Покрывает:
 *   - weekly: создаёт инстанс, сдвигает next_occurrence_at на 7 дней
 *   - monthly: создаёт инстанс, сдвигает на 1 месяц
 *   - идемпотентность: повторный вызов в тот же день не создаёт дубль
 *   - не трогает recurrence='none'
 *   - не трогает deleted_at != null
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
      storageKey: `recurring-test-${++counter}`,
    },
  })
}

type Ctx = { userId: string; admin: SupabaseClient; salonId: string }

async function bootstrap(): Promise<Ctx> {
  const admin = makeClient(SUPABASE_SERVICE)
  const ts = Date.now()
  const email = `recurring-${ts}@finkley.test`
  const { data: created, error: e1 } = await admin.auth.admin.createUser({
    email,
    password: 'TestPass123!',
    email_confirm: true,
  })
  if (e1 || !created.user) throw e1 ?? new Error('user not created')

  const { data: salon, error: e2 } = await admin
    .from('salons')
    .insert({
      name: 'Recurring Test',
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

function isoToday(): string {
  return new Date().toISOString().slice(0, 10)
}

function addDays(iso: string, days: number): string {
  const d = new Date(iso + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

describe.skipIf(shouldSkip)('process_recurring_expenses', () => {
  let ctx: Ctx | null = null

  beforeAll(async () => {
    ctx = await bootstrap()
  }, 30_000)

  afterAll(async () => {
    await teardown(ctx)
  })

  it('weekly: создаёт инстанс и сдвигает next_occurrence_at на 7 дней', async () => {
    if (!ctx) throw new Error('no ctx')
    const yesterday = addDays(isoToday(), -1)

    const { data: parent, error: insertErr } = await ctx.admin
      .from('expenses')
      .insert({
        salon_id: ctx.salonId,
        amount_cents: 50000, // 500 PLN
        expense_at: yesterday,
        recurrence: 'weekly',
        next_occurrence_at: yesterday, // due — функция должна обработать
        comment: 'recurring weekly test',
      })
      .select('id, next_occurrence_at')
      .single()
    if (insertErr || !parent) throw insertErr

    // Запускаем функцию (как делает cron)
    const { data, error } = await ctx.admin.rpc('process_recurring_expenses').single()
    expect(error).toBeNull()
    const result = data as { processed: number; created: number }
    expect(Number(result.processed)).toBeGreaterThanOrEqual(1)
    expect(Number(result.created)).toBeGreaterThanOrEqual(1)

    // Должна появиться child-запись с recurrence='none', source='recurring'
    const { data: children } = await ctx.admin
      .from('expenses')
      .select('id, amount_cents, recurrence, source, expense_at')
      .eq('salon_id', ctx.salonId)
      .eq('recurrence_parent_id', parent.id)
    expect(children).toHaveLength(1)
    expect(Number(children![0]!.amount_cents)).toBe(50000)
    expect(children![0]!.recurrence).toBe('none')
    expect(children![0]!.source).toBe('recurring')
    expect(children![0]!.expense_at).toBe(yesterday)

    // Parent next_occurrence_at сдвинулся на 7 дней вперёд
    const { data: updated } = await ctx.admin
      .from('expenses')
      .select('next_occurrence_at')
      .eq('id', parent.id)
      .single()
    expect(updated!.next_occurrence_at).toBe(addDays(yesterday, 7))
  })

  it('monthly: сдвигает next_occurrence_at на 1 месяц', async () => {
    if (!ctx) throw new Error('no ctx')
    // Используем фиксированную дату чтобы тест был детерминирован
    const baseDate = '2025-12-15' // в прошлом

    const { data: parent, error } = await ctx.admin
      .from('expenses')
      .insert({
        salon_id: ctx.salonId,
        amount_cents: 100000,
        expense_at: baseDate,
        recurrence: 'monthly',
        next_occurrence_at: baseDate,
        comment: 'recurring monthly test',
      })
      .select('id')
      .single()
    if (error || !parent) throw error

    await ctx.admin.rpc('process_recurring_expenses')

    const { data: updated } = await ctx.admin
      .from('expenses')
      .select('next_occurrence_at')
      .eq('id', parent.id)
      .single()
    expect(updated!.next_occurrence_at).toBe('2026-01-15')
  })

  it('идемпотентность: второй запуск в тот же день не создаёт дубль', async () => {
    if (!ctx) throw new Error('no ctx')
    const baseDate = addDays(isoToday(), -1)

    const { data: parent, error } = await ctx.admin
      .from('expenses')
      .insert({
        salon_id: ctx.salonId,
        amount_cents: 25000,
        expense_at: baseDate,
        recurrence: 'weekly',
        next_occurrence_at: baseDate,
        comment: 'idempotent test',
      })
      .select('id')
      .single()
    if (error || !parent) throw error

    await ctx.admin.rpc('process_recurring_expenses')
    await ctx.admin.rpc('process_recurring_expenses') // второй вызов

    const { data: children } = await ctx.admin
      .from('expenses')
      .select('id')
      .eq('salon_id', ctx.salonId)
      .eq('recurrence_parent_id', parent.id)
    expect(children).toHaveLength(1) // только один инстанс
  })

  it('не трогает recurrence=none', async () => {
    if (!ctx) throw new Error('no ctx')
    const today = isoToday()

    const { data: parent, error } = await ctx.admin
      .from('expenses')
      .insert({
        salon_id: ctx.salonId,
        amount_cents: 33333,
        expense_at: today,
        recurrence: 'none',
        comment: 'non-recurring',
      })
      .select('id, expense_at')
      .single()
    if (error || !parent) throw error

    await ctx.admin.rpc('process_recurring_expenses')

    // Никаких children с этим parent'ом не появилось
    const { data: children } = await ctx.admin
      .from('expenses')
      .select('id')
      .eq('salon_id', ctx.salonId)
      .eq('recurrence_parent_id', parent.id)
    expect(children).toHaveLength(0)
  })

  it('не трогает soft-deleted parent (deleted_at != null)', async () => {
    if (!ctx) throw new Error('no ctx')
    const baseDate = addDays(isoToday(), -1)

    const { data: parent, error } = await ctx.admin
      .from('expenses')
      .insert({
        salon_id: ctx.salonId,
        amount_cents: 11111,
        expense_at: baseDate,
        recurrence: 'weekly',
        next_occurrence_at: baseDate,
        deleted_at: new Date().toISOString(),
        comment: 'deleted recurring',
      })
      .select('id')
      .single()
    if (error || !parent) throw error

    await ctx.admin.rpc('process_recurring_expenses')

    const { data: children } = await ctx.admin
      .from('expenses')
      .select('id')
      .eq('salon_id', ctx.salonId)
      .eq('recurrence_parent_id', parent.id)
    expect(children).toHaveLength(0)
  })

  it('будущий next_occurrence_at пропускает (не due)', async () => {
    if (!ctx) throw new Error('no ctx')
    const future = addDays(isoToday(), 5)

    const { data: parent, error } = await ctx.admin
      .from('expenses')
      .insert({
        salon_id: ctx.salonId,
        amount_cents: 7777,
        expense_at: isoToday(),
        recurrence: 'weekly',
        next_occurrence_at: future,
        comment: 'future due',
      })
      .select('id')
      .single()
    if (error || !parent) throw error

    await ctx.admin.rpc('process_recurring_expenses')

    const { data: children } = await ctx.admin
      .from('expenses')
      .select('id')
      .eq('salon_id', ctx.salonId)
      .eq('recurrence_parent_id', parent.id)
    expect(children).toHaveLength(0)

    // next_occurrence_at не сдвинулся (всё ещё future)
    const { data: updated } = await ctx.admin
      .from('expenses')
      .select('next_occurrence_at')
      .eq('id', parent.id)
      .single()
    expect(updated!.next_occurrence_at).toBe(future)
  })
})
