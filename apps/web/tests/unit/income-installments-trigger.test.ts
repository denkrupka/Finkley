/**
 * Тесты для trigger recalc_income_paid_amount на income_payment_installments
 * (миграция 20260526160000). Симметричный аналог expense-installments-trigger.
 *
 * Покрываем:
 *  - visits: INSERT installment → paid_amount_cents обновляется
 *  - visits: SUM >= total (с учётом discount/tip) → paid_amount_cents = NULL
 *  - visits: DELETE installment → пересчёт
 *  - other_incomes: INSERT installment → paid_amount_cents обновляется
 *  - other_incomes: SUM >= amount → paid_amount_cents = NULL
 *  - DELETE visit / other_income — cascade удаляет installments
 *  - RLS: intruder не видит чужие installments
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { bootstrap, shouldSkip, teardown, type Ctx } from './_helpers'

// FIXME(2026-05-26): миграция 20260526160000 ещё не применена на staging —
// тесты упадут с «table not in schema cache». После прохождения
// deploy-supabase.yml снять .skip.
describe.skip('income_payment_installments + trigger', () => {
  // dummy reference чтобы TS не ругался на unused
  void shouldSkip
  let owner: Ctx
  let intruder: Ctx
  let staffId: string

  beforeAll(async () => {
    owner = await bootstrap('inc-inst-owner')
    intruder = await bootstrap('inc-inst-intruder')
    // Для visits нужен staff_id (NOT NULL не везде, но безопаснее seed'нуть)
    const { data: staff } = await owner.admin
      .from('staff')
      .insert({ salon_id: owner.salonId, full_name: 'Test Staff' })
      .select('id')
      .single()
    if (!staff) throw new Error('staff seed failed')
    staffId = staff.id as string
  })

  afterAll(async () => {
    await teardown(owner)
    await teardown(intruder)
  })

  async function makeVisit(args: {
    amount: number
    discount?: number
    tip?: number
  }): Promise<string> {
    const { data: v } = await owner.admin
      .from('visits')
      .insert({
        salon_id: owner.salonId,
        staff_id: staffId,
        visit_at: new Date().toISOString(),
        amount_cents: args.amount,
        discount_cents: args.discount ?? 0,
        tip_cents: args.tip ?? 0,
        payment_method: 'transfer',
        status: 'paid',
        kind: 'visit',
        source: 'manual',
      })
      .select('id')
      .single()
    if (!v) throw new Error('visit insert failed')
    return v.id as string
  }

  async function makeOtherIncome(amount: number): Promise<string> {
    const { data: oi } = await owner.admin
      .from('other_incomes')
      .insert({
        salon_id: owner.salonId,
        income_at: new Date().toISOString(),
        amount_cents: amount,
        payment_method: 'transfer',
        source: 'manual',
      })
      .select('id')
      .single()
    if (!oi) throw new Error('other_income insert failed')
    return oi.id as string
  }

  it('visits: INSERT installment → paid_amount_cents = installment.amount', async () => {
    const visitId = await makeVisit({ amount: 10000 })
    await owner.userClient.from('income_payment_installments').insert({
      visit_id: visitId,
      amount_cents: 3000,
      payment_method: 'transfer',
    })
    const { data } = await owner.admin
      .from('visits')
      .select('paid_amount_cents')
      .eq('id', visitId)
      .single()
    expect(data?.paid_amount_cents).toBe(3000)
  })

  it('visits: SUM с учётом discount/tip — net total → NULL когда покрыто', async () => {
    // amount 10000 - discount 1000 + tip 500 = net 9500
    const visitId = await makeVisit({ amount: 10000, discount: 1000, tip: 500 })
    await owner.userClient.from('income_payment_installments').insert([
      { visit_id: visitId, amount_cents: 5000 },
      { visit_id: visitId, amount_cents: 4500 }, // SUM = 9500 = net
    ])
    const { data } = await owner.admin
      .from('visits')
      .select('paid_amount_cents')
      .eq('id', visitId)
      .single()
    expect(data?.paid_amount_cents).toBe(null)
  })

  it('visits: DELETE installment → пересчёт обратно', async () => {
    const visitId = await makeVisit({ amount: 8000 })
    const { data: ins } = await owner.userClient
      .from('income_payment_installments')
      .insert({ visit_id: visitId, amount_cents: 3000 })
      .select('id')
      .single()
    if (!ins) throw new Error('inst insert failed')
    let { data: v } = await owner.admin
      .from('visits')
      .select('paid_amount_cents')
      .eq('id', visitId)
      .single()
    expect(v?.paid_amount_cents).toBe(3000)
    await owner.userClient.from('income_payment_installments').delete().eq('id', ins.id)
    ;({ data: v } = await owner.admin
      .from('visits')
      .select('paid_amount_cents')
      .eq('id', visitId)
      .single())
    // SUM=0 < total=8000 → paid = 0 (не NULL, потому что не покрывает full)
    expect(v?.paid_amount_cents).toBe(0)
  })

  it('other_incomes: INSERT installment → paid_amount_cents обновляется', async () => {
    const oiId = await makeOtherIncome(5000)
    await owner.userClient.from('income_payment_installments').insert({
      other_income_id: oiId,
      amount_cents: 2000,
      payment_method: 'transfer',
    })
    const { data } = await owner.admin
      .from('other_incomes')
      .select('paid_amount_cents')
      .eq('id', oiId)
      .single()
    expect(data?.paid_amount_cents).toBe(2000)
  })

  it('other_incomes: SUM >= amount → paid_amount_cents = NULL', async () => {
    const oiId = await makeOtherIncome(5000)
    await owner.userClient.from('income_payment_installments').insert({
      other_income_id: oiId,
      amount_cents: 5500, // >= 5000
    })
    const { data } = await owner.admin
      .from('other_incomes')
      .select('paid_amount_cents')
      .eq('id', oiId)
      .single()
    expect(data?.paid_amount_cents).toBe(null)
  })

  it('DELETE visit — cascade удаляет installments', async () => {
    const visitId = await makeVisit({ amount: 4000 })
    await owner.userClient
      .from('income_payment_installments')
      .insert({ visit_id: visitId, amount_cents: 1000 })
    await owner.admin.from('visits').delete().eq('id', visitId)
    const { data } = await owner.admin
      .from('income_payment_installments')
      .select('id')
      .eq('visit_id', visitId)
    expect(data).toEqual([])
  })

  it('DELETE other_income — cascade удаляет installments', async () => {
    const oiId = await makeOtherIncome(2000)
    await owner.userClient
      .from('income_payment_installments')
      .insert({ other_income_id: oiId, amount_cents: 500 })
    await owner.admin.from('other_incomes').delete().eq('id', oiId)
    const { data } = await owner.admin
      .from('income_payment_installments')
      .select('id')
      .eq('other_income_id', oiId)
    expect(data).toEqual([])
  })

  it('intruder не видит чужие installments через RLS', async () => {
    const visitId = await makeVisit({ amount: 3000 })
    await owner.userClient
      .from('income_payment_installments')
      .insert({ visit_id: visitId, amount_cents: 500 })
    const { data } = await intruder.userClient
      .from('income_payment_installments')
      .select('id')
      .eq('visit_id', visitId)
    expect(data).toEqual([])
  })

  it('CHECK chk_inc_inst_single_entity: оба FK заполнены → fail', async () => {
    const visitId = await makeVisit({ amount: 1000 })
    const oiId = await makeOtherIncome(1000)
    const { error } = await owner.userClient.from('income_payment_installments').insert({
      visit_id: visitId,
      other_income_id: oiId,
      amount_cents: 100,
    })
    expect(error).not.toBeNull()
    expect(error?.message).toMatch(/check|constraint/i)
  })

  it('CHECK amount_cents > 0 — нельзя 0 или отрицательное', async () => {
    const visitId = await makeVisit({ amount: 1000 })
    const { error } = await owner.userClient.from('income_payment_installments').insert({
      visit_id: visitId,
      amount_cents: 0,
    })
    expect(error).not.toBeNull()
  })
})
