/**
 * Unit-тесты для helpers effectiveReceivedFromVisit / effectiveReceivedFromOtherIncome
 * (ADR-026). Чисто pure, без БД — проверяем правила:
 *  - paid_amount_cents == null → возвращаем net/amount (legacy «полностью получено»)
 *  - paid_amount_cents < net/amount → возвращаем paid_amount_cents (частично)
 *  - paid_amount_cents >= net/amount → возвращаем net/amount (clamp)
 *
 * Для visits net = amount - discount + tip.
 */
import { describe, expect, it } from 'vitest'

// Импорт из pure-модуля чтобы не подтягивать supabase-client (на CI
// нет VITE_SUPABASE_URL и hooks/useVisits.ts падает при импорте).
import {
  effectiveReceivedFromOtherIncome,
  effectiveReceivedFromVisit,
} from '@/lib/income/effective-received'

describe('effectiveReceivedFromVisit', () => {
  it('paid_amount_cents == null → возвращает net (amount - discount + tip)', () => {
    const v = {
      amount_cents: 10_000,
      discount_cents: 1_000,
      tip_cents: 500,
      paid_amount_cents: null,
    }
    expect(effectiveReceivedFromVisit(v)).toBe(9_500)
  })

  it('paid_amount_cents = 0 → 0 (ничего не получено)', () => {
    const v = { amount_cents: 10_000, discount_cents: 0, tip_cents: 0, paid_amount_cents: 0 }
    expect(effectiveReceivedFromVisit(v)).toBe(0)
  })

  it('paid_amount_cents < net → возвращает paid (частично)', () => {
    const v = { amount_cents: 10_000, discount_cents: 500, tip_cents: 0, paid_amount_cents: 4_000 }
    // net = 10000 - 500 = 9500. paid 4000 < net → 4000.
    expect(effectiveReceivedFromVisit(v)).toBe(4_000)
  })

  it("paid_amount_cents >= net → возвращает net (clamp, NULL ставится trigger'ом но защита есть)", () => {
    const v = { amount_cents: 10_000, discount_cents: 0, tip_cents: 0, paid_amount_cents: 10_500 }
    // Это аномалия — trigger в normal случае поставит NULL. Если ручной UPDATE
    // выставил больше — helper защищает от показа «получено больше total».
    expect(effectiveReceivedFromVisit(v)).toBe(10_000)
  })

  it('default discount/tip = 0 (опциональные поля)', () => {
    const v = {
      amount_cents: 5_000,
      discount_cents: null as unknown as number,
      tip_cents: null as unknown as number,
      paid_amount_cents: null,
    }
    expect(effectiveReceivedFromVisit(v)).toBe(5_000)
  })
})

describe('effectiveReceivedFromOtherIncome', () => {
  it('paid_amount_cents == null → возвращает amount', () => {
    const o = { amount_cents: 5_000, paid_amount_cents: null }
    expect(effectiveReceivedFromOtherIncome(o)).toBe(5_000)
  })

  it('paid_amount_cents = 0 → 0', () => {
    const o = { amount_cents: 5_000, paid_amount_cents: 0 }
    expect(effectiveReceivedFromOtherIncome(o)).toBe(0)
  })

  it('paid_amount_cents < amount → возвращает paid', () => {
    const o = { amount_cents: 5_000, paid_amount_cents: 2_000 }
    expect(effectiveReceivedFromOtherIncome(o)).toBe(2_000)
  })

  it('paid_amount_cents >= amount → возвращает amount (clamp)', () => {
    const o = { amount_cents: 5_000, paid_amount_cents: 6_000 }
    expect(effectiveReceivedFromOtherIncome(o)).toBe(5_000)
  })
})
