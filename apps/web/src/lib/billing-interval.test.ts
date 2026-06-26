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

  it('applies −15% (×0.85) for year interval, rounded to 2 decimals', () => {
    expect(monthlyPriceForInterval(19, 'year')).toBe(16.15)
    expect(monthlyPriceForInterval(49, 'year')).toBe(41.65)
    expect(monthlyPriceForInterval(69, 'year')).toBe(58.65)
    expect(monthlyPriceForInterval(99, 'year')).toBe(84.15)
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
  it('year shows discounted /mo with fraction', () => {
    expect(formatMonthlyPrice(19, 'year', 'en-US')).toBe('16.15')
    expect(formatMonthlyPrice(19, 'year', 'ru-RU')).toBe('16,15')
  })

  it('month shows full price without fraction', () => {
    expect(formatMonthlyPrice(19, 'month', 'ru-RU')).toBe('19')
  })
})
