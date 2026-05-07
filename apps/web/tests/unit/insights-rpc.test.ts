/**
 * Тесты RPC из TASK-33:
 *   - insights_salon_data(salon_id) — агрегаты для rules-engine
 *
 * Сама rules-логика и Haiku polish тестируются отдельно (rules — TS unit
 * без БД, polish — мокать AI слишком хрупко). Здесь — только что RPC
 * возвращает корректный jsonb со всеми ключами.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { bootstrap, shouldSkip, teardown, type Ctx } from './_helpers'

describe.skipIf(shouldSkip)('insights_salon_data', () => {
  let ctx: Ctx | null = null

  beforeAll(async () => {
    ctx = await bootstrap('insights')
  }, 30_000)
  afterAll(async () => teardown(ctx))

  it('возвращает jsonb со всеми ключами для пустого салона', async () => {
    if (!ctx) throw new Error('no ctx')
    const { data, error } = await ctx.admin.rpc('insights_salon_data', {
      p_salon_id: ctx.salonId,
    })
    expect(error).toBeNull()
    const d = data as Record<string, unknown>
    expect(d.currency).toBe('PLN')
    expect(d.salon_name).toBeTruthy()
    expect(Array.isArray(d.staff)).toBe(true)
    expect(Array.isArray(d.services)).toBe(true)
    expect(Array.isArray(d.expense_categories)).toBe(true)
    expect(Array.isArray(d.lost_vips)).toBe(true)
    expect(typeof d.current_month_revenue).toBe('number')
    expect(typeof d.current_month_expense).toBe('number')
  })

  it('staff_load включает мастера с нулевыми визитами', async () => {
    if (!ctx) throw new Error('no ctx')
    await ctx.admin.from('staff').insert({
      salon_id: ctx.salonId,
      full_name: 'Безработный мастер',
      payout_scheme: 'percent_revenue',
      payout_percent: 40,
      is_active: true,
    })
    const { data } = await ctx.admin.rpc('insights_salon_data', {
      p_salon_id: ctx.salonId,
    })
    const d = data as { staff: { full_name: string; visits_4w: number }[] }
    const found = d.staff.find((s) => s.full_name === 'Безработный мастер')
    expect(found).toBeDefined()
    expect(Number(found!.visits_4w)).toBe(0) // rule low_utilization сработает
  })

  it('current_month_expense считает только текущий месяц', async () => {
    if (!ctx) throw new Error('no ctx')
    const { data: cat } = await ctx.admin
      .from('expense_categories')
      .insert({ salon_id: ctx.salonId, name: 'Расходы для теста' })
      .select('id')
      .single()
    if (!cat) throw new Error('cat')

    const today = new Date().toISOString().slice(0, 10)
    const lastMonth = new Date()
    lastMonth.setMonth(lastMonth.getMonth() - 2) // точно прошлый период
    const lastMonthStr = lastMonth.toISOString().slice(0, 10)

    await ctx.admin.from('expenses').insert([
      {
        salon_id: ctx.salonId,
        category_id: cat.id,
        expense_at: today,
        amount_cents: 50000,
        payment_method: 'cash',
      },
      {
        salon_id: ctx.salonId,
        category_id: cat.id,
        expense_at: lastMonthStr, // должен исключиться
        amount_cents: 99999,
        payment_method: 'cash',
      },
    ])

    const { data } = await ctx.admin.rpc('insights_salon_data', {
      p_salon_id: ctx.salonId,
    })
    expect(Number((data as { current_month_expense: number }).current_month_expense)).toBe(50000)
  })
})
