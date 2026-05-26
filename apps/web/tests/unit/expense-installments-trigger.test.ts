/**
 * Тесты для trigger recalc_expense_paid_amount на expense_payment_installments
 * (миграция 20260526114212).
 *
 * Проверяем:
 *  - INSERT installment → expenses.paid_amount_cents обновляется
 *  - sum(installments) >= amount → paid_amount_cents = NULL (legacy «full paid»)
 *  - DELETE installment → paid_amount_cents откатывается
 *  - DELETE expense cascade'ит installments
 *  - RLS: intruder не видит чужие installments
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { bootstrap, shouldSkip, teardown, type Ctx } from './_helpers'

describe.skipIf(shouldSkip)('expense_payment_installments + trigger', () => {
  let owner: Ctx
  let intruder: Ctx
  let categoryId: string

  beforeAll(async () => {
    owner = await bootstrap('inst-owner')
    intruder = await bootstrap('inst-intruder')
    const { data: cat } = await owner.admin
      .from('expense_categories')
      .insert({ salon_id: owner.salonId, name: 'Test Inst', sort_order: 100 })
      .select('id')
      .single()
    if (!cat) throw new Error('category seed failed')
    categoryId = cat.id as string
  })

  afterAll(async () => {
    await teardown(owner)
    await teardown(intruder)
  })

  async function makeExpense(amountCents: number): Promise<string> {
    const { data: exp } = await owner.admin
      .from('expenses')
      .insert({
        salon_id: owner.salonId,
        category_id: categoryId,
        expense_at: new Date().toISOString().slice(0, 10),
        amount_cents: amountCents,
        payment_method: 'transfer',
        description: 'Test for inst trigger',
        created_by: owner.userId,
      })
      .select('id')
      .single()
    if (!exp) throw new Error('expense insert failed')
    return exp.id as string
  }

  it('INSERT installment → expenses.paid_amount_cents = installment.amount', async () => {
    const expenseId = await makeExpense(10000)
    await owner.userClient.from('expense_payment_installments').insert({
      expense_id: expenseId,
      amount_cents: 3000,
      payment_method: 'cash',
    })
    const { data: exp } = await owner.admin
      .from('expenses')
      .select('paid_amount_cents')
      .eq('id', expenseId)
      .single()
    expect(exp?.paid_amount_cents).toBe(3000)
  })

  it('SUM(installments) >= amount_cents → paid_amount_cents = NULL (full paid)', async () => {
    const expenseId = await makeExpense(10000)
    await owner.userClient.from('expense_payment_installments').insert([
      { expense_id: expenseId, amount_cents: 4000 },
      { expense_id: expenseId, amount_cents: 6500 }, // SUM = 10500 > 10000
    ])
    const { data: exp } = await owner.admin
      .from('expenses')
      .select('paid_amount_cents')
      .eq('id', expenseId)
      .single()
    expect(exp?.paid_amount_cents).toBe(null)
  })

  it('DELETE installment → paid_amount_cents пересчитывается', async () => {
    const expenseId = await makeExpense(10000)
    const { data: ins } = await owner.userClient
      .from('expense_payment_installments')
      .insert({ expense_id: expenseId, amount_cents: 7000 })
      .select('id')
      .single()
    if (!ins) throw new Error('installment insert failed')
    // После INSERT — paid = 7000
    let { data: exp } = await owner.admin
      .from('expenses')
      .select('paid_amount_cents')
      .eq('id', expenseId)
      .single()
    expect(exp?.paid_amount_cents).toBe(7000)
    // DELETE — paid возвращается в NULL (legacy «не оплачено вообще»).
    await owner.userClient.from('expense_payment_installments').delete().eq('id', ins.id)
    ;({ data: exp } = await owner.admin
      .from('expenses')
      .select('paid_amount_cents')
      .eq('id', expenseId)
      .single())
    expect(exp?.paid_amount_cents).toBe(null)
  })

  it('DELETE expense — cascade удаляет installments', async () => {
    const expenseId = await makeExpense(5000)
    await owner.userClient
      .from('expense_payment_installments')
      .insert({ expense_id: expenseId, amount_cents: 1000 })
    await owner.admin.from('expenses').delete().eq('id', expenseId)
    const { data } = await owner.admin
      .from('expense_payment_installments')
      .select('id')
      .eq('expense_id', expenseId)
    expect(data).toEqual([])
  })

  it('intruder не видит чужие installments через RLS', async () => {
    const expenseId = await makeExpense(2000)
    await owner.userClient
      .from('expense_payment_installments')
      .insert({ expense_id: expenseId, amount_cents: 500 })
    const { data } = await intruder.userClient
      .from('expense_payment_installments')
      .select('id')
      .eq('expense_id', expenseId)
    expect(data).toEqual([])
  })
})
