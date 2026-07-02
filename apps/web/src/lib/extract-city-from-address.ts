/**
 * Достаёт город из formatted-адреса Google Places.
 *
 * Google возвращает адрес строкой «улица номер, [индекс ]город, страна»
 * (для короткого места — «город, страна»). address_components API не
 * запрашивается (см. supabase/functions/google-places-search FieldMask),
 * поэтому парсим строку: берём предпоследний компонент и отрезаем ведущий
 * почтовый индекс (PL «61-884», DE/FR «10115», NL «1012 AB», CZ «110 00»,
 * LT «LT-01103» и т.п.).
 *
 * Возвращает null, если город достать не удалось — вызывающий код сам
 * решает, что подставить (обычно оставляет прежнее значение).
 */
const POSTAL_PREFIX = /^(?:[A-Z]{1,3}-)?\d{2,5}(?:[- ]\d{2,3})?(?: ?[A-Z]{2})? +/
const POSTAL_ONLY = /^(?:[A-Z]{1,3}-)?\d{2,5}(?:[- ]\d{2,3})?(?: ?[A-Z]{2})?$/

export function extractCityFromAddress(address: string): string | null {
  const parts = address
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  if (parts.length < 2) return null
  // «улица, [индекс ]город, страна» → предпоследний; «город, страна» → первый.
  const candidate = parts.length >= 3 ? parts[parts.length - 2]! : parts[0]!
  const cleaned = candidate.replace(POSTAL_PREFIX, '').trim()
  if (!cleaned || POSTAL_ONLY.test(cleaned)) return null
  return cleaned
}
