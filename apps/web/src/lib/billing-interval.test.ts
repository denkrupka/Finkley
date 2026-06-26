import { describe, expect, it } from 'vitest'

import {
  ANNUAL_DISCOUNT_MULTIPLIER,
  formatEurAmount,
  formatMonthlyPrice,
  monthlyPriceForInterval,
} from './billing-interval'

describe('monthlyPriceForInterval', () => {
  it('returns full price for month interval', () => {
    expect(monthlyPriceForInterval(19, 'month')).toBe(19)
    expect(monthlyPriceForInterval(49, 'month')).toBe(49)
    expect(monthlyPriceForInterval(69, 'month')).toBe(69)
    expect(monthlyPriceForInterval(99, 'month')).toBe(99)
  })

  it('applies −15% (×0.85) for year interval, rounded UP to whole euro', () => {
    expect(monthlyPriceForInterval(19, 'year')).toBe(17) // 16.15 → 17
    expect(monthlyPriceForInterval(49, 'year')).toBe(42) // 41.65 → 42
    expect(monthlyPriceForInterval(69, 'year')).toBe(59) // 58.65 → 59
    expect(monthlyPriceForInterval(99, 'year')).toBe(85) // 84.15 → 85
  })

  it('multiplier is 0.85', () => {
    expect(ANNUAL_DISCOUNT_MULTIPLIER).toBe(0.85)
  })
})

describe('formatEurAmount', () => {
  it('omits decimals for whole numbers', () => {
    expect(formatEurAmount(19, 'en-US')).toBe('19')
    expect(formatEurAmount(99, 'ru-RU')).toBe('99')
  })

  it('shows 2 decimals with locale separator when fractional', () => {
    expect(formatEurAmount(16.15, 'en-US')).toBe('16.15')
    expect(formatEurAmount(16.15, 'ru-RU')).toBe('16,15')
    expect(formatEurAmount(41.65, 'pl-PL')).toBe('41,65')
  })
})

describe('formatMonthlyPrice', () => {
  it('year shows discounted /mo rounded up to whole euro', () => {
    expect(formatMonthlyPrice(19, 'year', 'en-US')).toBe('17')
    expect(formatMonthlyPrice(19, 'year', 'ru-RU')).toBe('17')
  })

  it('month shows full price without fraction', () => {
    expect(formatMonthlyPrice(19, 'month', 'ru-RU')).toBe('19')
  })
})
