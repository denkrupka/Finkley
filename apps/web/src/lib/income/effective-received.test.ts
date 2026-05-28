import { describe, expect, it } from 'vitest'

import { effectiveReceivedFromOtherIncome, effectiveReceivedFromVisit } from './effective-received'

describe('effectiveReceivedFromVisit', () => {
  it('paid_amount=null → возвращает net (полная оплата)', () => {
    expect(
      effectiveReceivedFromVisit({
        amount_cents: 10000,
        discount_cents: null,
        tip_cents: null,
        paid_amount_cents: null,
      }),
    ).toBe(10000)
  })

  it('paid_amount ≥ net → возвращает net (не считаем переплату)', () => {
    expect(
      effectiveReceivedFromVisit({
        amount_cents: 10000,
        discount_cents: null,
        tip_cents: null,
        paid_amount_cents: 15000,
      }),
    ).toBe(10000)
  })

  it('paid_amount < net → возвращает paid_amount (частичная оплата)', () => {
    expect(
      effectiveReceivedFromVisit({
        amount_cents: 10000,
        discount_cents: null,
        tip_cents: null,
        paid_amount_cents: 3000,
      }),
    ).toBe(3000)
  })

  it('скидка уменьшает net', () => {
    // amount 10000 - discount 2000 = net 8000, paid=null → 8000
    expect(
      effectiveReceivedFromVisit({
        amount_cents: 10000,
        discount_cents: 2000,
        tip_cents: null,
        paid_amount_cents: null,
      }),
    ).toBe(8000)
  })

  it('чаевые увеличивают net', () => {
    // amount 10000 + tip 1500 = net 11500
    expect(
      effectiveReceivedFromVisit({
        amount_cents: 10000,
        discount_cents: null,
        tip_cents: 1500,
        paid_amount_cents: null,
      }),
    ).toBe(11500)
  })

  it('скидка + чаевые + paid_amount: paid < (amount-discount+tip) → paid', () => {
    // net = 10000 - 1000 + 500 = 9500. paid=4000 → 4000
    expect(
      effectiveReceivedFromVisit({
        amount_cents: 10000,
        discount_cents: 1000,
        tip_cents: 500,
        paid_amount_cents: 4000,
      }),
    ).toBe(4000)
  })

  it('paid_amount=0 → возвращает 0 (явная фиксация неоплаты)', () => {
    expect(
      effectiveReceivedFromVisit({
        amount_cents: 10000,
        discount_cents: null,
        tip_cents: null,
        paid_amount_cents: 0,
      }),
    ).toBe(0)
  })

  it('null discount/tip обрабатывается как 0', () => {
    expect(
      effectiveReceivedFromVisit({
        amount_cents: 5000,
        discount_cents: null,
        tip_cents: null,
        paid_amount_cents: null,
      }),
    ).toBe(5000)
  })

  it('paid_amount = net точно → возвращает net (граница)', () => {
    expect(
      effectiveReceivedFromVisit({
        amount_cents: 10000,
        discount_cents: null,
        tip_cents: null,
        paid_amount_cents: 10000,
      }),
    ).toBe(10000)
  })
})

describe('effectiveReceivedFromOtherIncome', () => {
  it('paid_amount=null → возвращает amount_cents (полное поступление)', () => {
    expect(
      effectiveReceivedFromOtherIncome({
        amount_cents: 50000,
        paid_amount_cents: null,
      }),
    ).toBe(50000)
  })

  it('paid_amount < amount → возвращает paid_amount (частичное)', () => {
    expect(
      effectiveReceivedFromOtherIncome({
        amount_cents: 50000,
        paid_amount_cents: 20000,
      }),
    ).toBe(20000)
  })

  it('paid_amount ≥ amount → возвращает amount (без переплаты)', () => {
    expect(
      effectiveReceivedFromOtherIncome({
        amount_cents: 50000,
        paid_amount_cents: 60000,
      }),
    ).toBe(50000)
  })

  it('paid_amount = amount точно → возвращает amount', () => {
    expect(
      effectiveReceivedFromOtherIncome({
        amount_cents: 50000,
        paid_amount_cents: 50000,
      }),
    ).toBe(50000)
  })

  it('paid_amount=0 → возвращает 0', () => {
    expect(
      effectiveReceivedFromOtherIncome({
        amount_cents: 50000,
        paid_amount_cents: 0,
      }),
    ).toBe(0)
  })

  it('amount_cents=0 → возвращает 0 даже с paid=null', () => {
    expect(
      effectiveReceivedFromOtherIncome({
        amount_cents: 0,
        paid_amount_cents: null,
      }),
    ).toBe(0)
  })
})
