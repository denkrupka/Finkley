import { describe, expect, it } from 'vitest'

import { extractServicePriceDuration } from './booksy-service-extract'

describe('extractServicePriceDuration', () => {
  describe('legacy v1 schema (top-level price/duration)', () => {
    it('price.amount как number — 100 PLN → 10000 cents', () => {
      const result = extractServicePriceDuration({
        price: { amount: 100 },
        duration: 60,
      })
      expect(result).toEqual({ priceCents: 10000, durationMin: 60 })
    })

    it('price.amount как string', () => {
      expect(
        extractServicePriceDuration({
          price: { amount: '99.99' },
          duration: 30,
        }),
      ).toEqual({ priceCents: 9999, durationMin: 30 })
    })

    it('price как просто number (без обёртки)', () => {
      expect(
        extractServicePriceDuration({
          price: 50,
          duration: 45,
        }),
      ).toEqual({ priceCents: 5000, durationMin: 45 })
    })
  })

  describe('current v2 schema (variants[0])', () => {
    it('variants[0].service_price.amount + duration — главный кейс bug-screenshot', () => {
      const result = extractServicePriceDuration({
        variants: [{ duration: 90, service_price: { amount: '120.00' } }],
      })
      expect(result).toEqual({ priceCents: 12000, durationMin: 90 })
    })

    it('variants[0].price без service_price wrapper', () => {
      expect(
        extractServicePriceDuration({
          variants: [{ duration: 60, price: 80 }],
        }),
      ).toEqual({ priceCents: 8000, durationMin: 60 })
    })

    it('несколько variants — берём первый', () => {
      expect(
        extractServicePriceDuration({
          variants: [
            { duration: 30, service_price: { amount: 50 } },
            { duration: 60, service_price: { amount: 100 } },
          ],
        }),
      ).toEqual({ priceCents: 5000, durationMin: 30 })
    })
  })

  describe('fallbacks и null-safety', () => {
    it('пустой service → {0, null}', () => {
      expect(extractServicePriceDuration({})).toEqual({ priceCents: 0, durationMin: null })
    })

    it('top-level null + variants null → {0, null}', () => {
      expect(extractServicePriceDuration({ price: null, duration: null, variants: null })).toEqual({
        priceCents: 0,
        durationMin: null,
      })
    })

    it('top-level есть, variants тоже — top-level выигрывает', () => {
      expect(
        extractServicePriceDuration({
          price: { amount: 100 },
          duration: 60,
          variants: [{ service_price: { amount: 999 }, duration: 999 }],
        }),
      ).toEqual({ priceCents: 10000, durationMin: 60 })
    })

    it('top-level = 0 → fallback на variants', () => {
      expect(
        extractServicePriceDuration({
          price: { amount: 0 },
          duration: 0,
          variants: [{ service_price: { amount: 50 }, duration: 60 }],
        }),
      ).toEqual({ priceCents: 5000, durationMin: 60 })
    })

    it('негативная длительность → null (не отдаём в БД мусор)', () => {
      expect(
        extractServicePriceDuration({
          duration: -10,
          variants: [{ duration: -5, price: 50 }],
        }),
      ).toEqual({ priceCents: 5000, durationMin: null })
    })

    it('NaN в цене → 0', () => {
      expect(
        extractServicePriceDuration({
          price: { amount: 'abc' },
        }),
      ).toEqual({ priceCents: 0, durationMin: null })
    })
  })
})
