/**
 * Форматирует сумму в копейках/центах в локализованную строку с валютой.
 *
 * @param cents Сумма в копейках (bigint в БД, number в JS до 9 трлн)
 * @param currency ISO 4217 код (PLN, EUR, USD)
 * @param locale BCP 47 locale (ru, pl, en)
 * @returns Отформатированная строка ("100,00 zł")
 *
 * @example
 *   formatCurrency(10000, 'PLN', 'ru') // "100,00 zł"
 *   formatCurrency(0, 'EUR', 'ru') // "0,00 €"
 */
export function formatCurrency(cents: number, currency = 'PLN', locale = 'ru'): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
  }).format(cents / 100)
}
