import i18n from 'i18next'

/**
 * BCP-47 локаль для Intl.NumberFormat на основе текущего i18n языка.
 * RU → ru-RU, PL → pl-PL, EN → en-US. Fallback на ru-RU.
 *
 * Выведено в отдельную функцию чтобы тесты могли проверять без зависимости от
 * i18n init order.
 */
export function getCurrencyLocale(): string {
  const lng = i18n.language?.split('-')[0] ?? 'ru'
  if (lng === 'pl') return 'pl-PL'
  if (lng === 'en') return 'en-US'
  return 'ru-RU'
}

/**
 * Форматирует сумму в копейках/центах в локализованную строку с валютой.
 *
 * @param cents Сумма в копейках (bigint в БД, number в JS до 9 трлн)
 * @param currency ISO 4217 код (PLN, EUR, USD)
 * @param locale BCP 47 locale. Если не передан — берётся из i18n.language
 *   (ru-RU/pl-PL/en-US). Передаётся явно только в тестах.
 * @returns Отформатированная строка ("100,00 zł" / "$100.00" / "100,00 zł")
 *
 * @example
 *   formatCurrency(10000, 'PLN')        // в RU UI: "100,00 zł"
 *   formatCurrency(10000, 'PLN', 'en')  // принудительно en: "PLN 100.00"
 *   formatCurrency(0, 'EUR', 'ru-RU')   // "0,00 €"
 */
export function formatCurrency(cents: number, currency = 'PLN', locale?: string): string {
  return new Intl.NumberFormat(locale ?? getCurrencyLocale(), {
    style: 'currency',
    currency,
  }).format(cents / 100)
}
