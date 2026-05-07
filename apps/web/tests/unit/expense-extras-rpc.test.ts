/**
 * Тесты RPC из TASK-25 финал:
 *   - compute_cash_balance(salon_id) — opening + cash visits − cash expenses
 *   - category_budgets_progress(salon_id) — текущий месяц vs monthly_budget_cents
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { bootstrap, shouldSkip, teardown, type Ctx } from './_helpers'

describe.skipIf(shouldSkip)('compute_cash_balance', () => {
  let ctx: Ctx | null = null

  beforeAll(async () => {
    ctx = await bootstrap('cash')
  }, 30_000)
  afterAll(async () => teardown(ctx))

  it('opening + cash visits − cash expenses', async () => {
    if (!ctx) throw new Error('no ctx')
    // Opening = 100 PLN
    await ctx.admin
      .from('salons')
      .update({ opening_cash_balance_cents: 10000 })
      .eq('id', ctx.salonId)

    // 2 cash visits: 50 + 70 = 120 PLN, и 1 card visit (не должен попасть)
    const today = new Date().toISOString()
    await ctx.admin.from('visits').insert([
      {
        salon_id: ctx.salonId,
        visit_at: today,
        amount_cents: 5000,
        payment_method: 'cash',
        status: 'paid',
      },
      {
        salon_id: ctx.salonId,
        visit_at: today,
        amount_cents: 7000,
        payment_method: 'cash',
        status: 'paid',
      },
      {
        salon_id: ctx.salonId,
        visit_at: today,
        amount_cents: 99999,
        payment_method: 'card',
        status: 'paid',
      },
    ])

    // Создаём category для cash расхода
    const { data: cat } = await ctx.admin
      .from('expense_categories')
      .insert({ salon_id: ctx.salonId, name: 'Test cash exp' })
      .select('id')
      .single()
    if (!cat) throw new Error('cat')

    // 30 PLN cash expense (учитывается), 50 PLN card (не учитывается)
    await ctx.admin.from('expenses').insert([
      {
        salon_id: ctx.salonId,
        category_id: cat.id,
        expense_at: today.slice(0, 10),
        amount_cents: 3000,
        payment_method: 'cash',
      },
      {
        salon_id: ctx.salonId,
        category_id: cat.id,
        expense_at: today.slice(0, 10),
        amount_cents: 5000,
        payment_method: 'card',
      },
    ])

    const { data, error } = await ctx.admin.rpc('compute_cash_balance', {
      p_salon_id: ctx.salonId,
    })
    expect(error).toBeNull()
    // 10000 + (5000 + 7000) − 3000 = 19000 копеек = 190 PLN
    expect(Number(data)).toBe(19000)
  })
})

describe.skipIf(shouldSkip)('category_budgets_progress', () => {
  let ctx: Ctx | null = null

  beforeAll(async () => {
    ctx = await bootstrap('budgets')
  }, 30_000)
  afterAll(async () => teardown(ctx))

  it('возвращает прогресс, цвет, null для категорий без бюджета', async () => {
    if (!ctx) throw new Error('no ctx')

    // 2 категории: одна с бюджетом 1000, другая без
    const { data: catWith } = await ctx.admin
      .from('expense_categories')
      .insert({ salon_id: ctx.salonId, name: 'C1', monthly_budget_cents: 100000 })
      .select('id')
      .single()
    const { data: catWithout } = await ctx.admin
      .from('expense_categories')
      .insert({ salon_id: ctx.salonId, name: 'C2' })
      .select('id')
      .single()
    if (!catWith || !catWithout) throw new Error('cat')

    // 75% от бюджета C1
    const today = new Date().toISOString().slice(0, 10)
    await ctx.admin.from('expenses').insert([
      {
        salon_id: ctx.salonId,
        category_id: catWith.id,
        expense_at: today,
        amount_cents: 75000,
        payment_method: 'cash',
      },
      {
        salon_id: ctx.salonId,
        category_id: catWithout.id,
        expense_at: today,
        amount_cents: 50000,
        payment_method: 'cash',
      },
    ])

    const { data } = await ctx.admin.rpc('category_budgets_progress', {
      p_salon_id: ctx.salonId,
    })
    type Row = {
      category_id: string
      monthly_budget_cents: number | null
      current_month_cents: number
      progress_pct: number | null
    }
    const rows = data as Row[]
    const c1 = rows.find((r) => r.category_id === catWith.id)!
    const c2 = rows.find((r) => r.category_id === catWithout.id)!
    expect(Number(c1.current_month_cents)).toBe(75000)
    expect(Number(c1.progress_pct)).toBe(75)
    expect(Number(c2.current_month_cents)).toBe(50000)
    expect(c2.progress_pct).toBeNull()
  })

  it('progress_pct корректно показывает >100%', async () => {
    if (!ctx) throw new Error('no ctx')
    const { data: cat } = await ctx.admin
      .from('expense_categories')
      .insert({ salon_id: ctx.salonId, name: 'Overbudget', monthly_budget_cents: 10000 })
      .select('id')
      .single()
    if (!cat) throw new Error('cat')

    await ctx.admin.from('expenses').insert({
      salon_id: ctx.salonId,
      category_id: cat.id,
      expense_at: new Date().toISOString().slice(0, 10),
      amount_cents: 15000, // 150% от бюджета
      payment_method: 'cash',
    })
    const { data } = await ctx.admin.rpc('category_budgets_progress', {
      p_salon_id: ctx.salonId,
    })
    const row = (data as { category_id: string; progress_pct: number }[]).find(
      (r) => r.category_id === cat.id,
    )!
    expect(Number(row.progress_pct)).toBe(150)
  })
})
