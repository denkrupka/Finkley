/**
 * Извлечение price/duration из Booksy /service_categories.
 * Дублирует логику supabase/functions/booksy-proxy/index.ts::extractServicePriceDuration.
 *
 * Чистая функция нужна для unit-тестов — Edge Function на Deno нельзя
 * импортировать в Vite-сборку.
 */

type BooksyServiceRaw = {
  price?: { amount?: number | string } | number | string | null
  duration?: number | null
  variants?: Array<{
    duration?: number | null
    service_price?: { amount?: number | string } | null
    price?: number | string | null
  }> | null
}

export function extractServicePriceDuration(s: BooksyServiceRaw): {
  priceCents: number
  durationMin: number | null
} {
  const parsePrice = (v: unknown): number => {
    if (v == null) return 0
    if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v * 100) : 0
    if (typeof v === 'string') {
      const n = Number.parseFloat(v)
      return Number.isFinite(n) ? Math.round(n * 100) : 0
    }
    if (typeof v === 'object' && v !== null && 'amount' in v) {
      return parsePrice((v as { amount?: unknown }).amount)
    }
    return 0
  }

  let priceCents = parsePrice(s.price)
  if (priceCents === 0) {
    const v0 = s.variants?.[0]
    if (v0) {
      priceCents = parsePrice(v0.service_price)
      if (priceCents === 0) priceCents = parsePrice(v0.price)
    }
  }

  let durationMin: number | null = null
  if (typeof s.duration === 'number' && s.duration > 0) {
    durationMin = s.duration
  } else {
    const v0 = s.variants?.[0]
    if (v0 && typeof v0.duration === 'number' && v0.duration > 0) {
      durationMin = v0.duration
    }
  }

  return { priceCents, durationMin }
}
