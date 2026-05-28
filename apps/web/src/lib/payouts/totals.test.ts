import { describe, expect, it } from 'vitest'

import { computePayoutTotals, computeRowTotals, type PayoutRow } from './totals'

describe('computePayoutTotals (T116)', () => {
  it('пустой массив → нули', () => {
    const totals = computePayoutTotals([], new Map())
    expect(totals).toEqual({
      payout: 0,
      premium: 0,
      advances: 0,
      accrued: 0,
      remaining: 0,
    })
  })

  it('одна строка без премии и авансов → accrued=payout, remaining=accrued', () => {
    const rows: PayoutRow[] = [{ staff_id: 's1', payout_cents: 50000, premium_cents: 0 }]
    const totals = computePayoutTotals(rows, new Map())
    expect(totals.payout).toBe(50000)
    expect(totals.premium).toBe(0)
    expect(totals.accrued).toBe(50000)
    expect(totals.remaining).toBe(50000)
  })

  it('премия суммируется отдельно от payout и входит в accrued', () => {
    const rows: PayoutRow[] = [
      { staff_id: 's1', payout_cents: 100000, premium_cents: 20000 },
      { staff_id: 's2', payout_cents: 80000, premium_cents: 10000 },
    ]
    const totals = computePayoutTotals(rows, new Map())
    expect(totals.payout).toBe(180000)
    expect(totals.premium).toBe(30000)
    expect(totals.accrued).toBe(210000)
    expect(totals.remaining).toBe(210000)
  })

  it('авансы вычитаются из accrued по staff_id', () => {
    const rows: PayoutRow[] = [
      { staff_id: 's1', payout_cents: 100000, premium_cents: 20000 },
      { staff_id: 's2', payout_cents: 80000, premium_cents: 10000 },
    ]
    const advances = new Map([
      ['s1', 50000],
      ['s2', 30000],
    ])
    const totals = computePayoutTotals(rows, advances)
    expect(totals.advances).toBe(80000)
    expect(totals.accrued).toBe(210000)
    expect(totals.remaining).toBe(130000)
  })

  it('аванс для несуществующего staff_id игнорируется', () => {
    const rows: PayoutRow[] = [{ staff_id: 's1', payout_cents: 100000, premium_cents: 0 }]
    const advances = new Map([
      ['s1', 30000],
      ['stranger', 999999],
    ])
    const totals = computePayoutTotals(rows, advances)
    expect(totals.advances).toBe(30000)
    expect(totals.remaining).toBe(70000)
  })

  it('переплата авансов → отрицательный remaining', () => {
    const rows: PayoutRow[] = [{ staff_id: 's1', payout_cents: 50000, premium_cents: 5000 }]
    const advances = new Map([['s1', 100000]])
    const totals = computePayoutTotals(rows, advances)
    expect(totals.accrued).toBe(55000)
    expect(totals.advances).toBe(100000)
    expect(totals.remaining).toBe(-45000)
  })

  it('chair_rent (отрицательный payout) + премия → корректный accrued', () => {
    // По схеме chair_rent мастер платит салону аренду кресла,
    // payout_cents = -chair_rent_cents. Премия не должна затирать минус.
    const rows: PayoutRow[] = [{ staff_id: 's1', payout_cents: -20000, premium_cents: 5000 }]
    const totals = computePayoutTotals(rows, new Map())
    expect(totals.payout).toBe(-20000)
    expect(totals.premium).toBe(5000)
    expect(totals.accrued).toBe(-15000)
  })
})

describe('computeRowTotals (T116)', () => {
  it('базовый payout без премии и авансов', () => {
    expect(computeRowTotals({ staff_id: 's1', payout_cents: 70000, premium_cents: 0 }, 0)).toEqual({
      accrued: 70000,
      remaining: 70000,
    })
  })

  it('payout + premium + advance считаются вместе', () => {
    expect(
      computeRowTotals({ staff_id: 's1', payout_cents: 100000, premium_cents: 15000 }, 40000),
    ).toEqual({ accrued: 115000, remaining: 75000 })
  })

  it('премия > 0, advance > accrued → отрицательный остаток', () => {
    expect(
      computeRowTotals({ staff_id: 's1', payout_cents: 50000, premium_cents: 10000 }, 80000),
    ).toEqual({ accrued: 60000, remaining: -20000 })
  })
})
