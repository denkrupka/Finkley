/**
 * Годовой биллинг −15% (ADR-035). Цены ВСЕГДА показываются «/мес»:
 * при выборе «Год» — скидочная цена в месяц (полная × 0.85), при «Месяц» —
 * полная месячная цена. Десятичные показываем только когда есть дробь
 * (16,15 — да; 19 — без дробей). Разделитель — по локали через Intl.
 *
 * Чистый helper без React — покрыт unit-тестами.
 */

export type BillingInterval = 'month' | 'year'

/** Множитель годового тарифа: −15% к полной месячной цене. */
export const ANNUAL_DISCOUNT_MULTIPLIER = 0.85

/** Скидка годового тарифа в процентах (для бейджа «−15%»). */
export const ANNUAL_DISCOUNT_PCT = 15

/**
 * Цена /мес для интервала. year → полная × 0.85, ОКРУГЛЁННАЯ ВВЕРХ до целого
 * евро (19 → 17, т.к. 16.15 → 17): показываем «ровные» суммы без копеек.
 * month → полная месячная цена. Реальный годовой платёж — точная −15% сумма
 * (видна на странице оплаты Stripe), здесь — округлённое /мес для витрины.
 */
export function monthlyPriceForInterval(fullMonthlyEur: number, interval: BillingInterval): number {
  if (interval === 'year') {
    return Math.ceil(fullMonthlyEur * ANNUAL_DISCOUNT_MULTIPLIER)
  }
  return fullMonthlyEur
}

/**
 * Форматирует сумму в евро по локали. Десятичные — только при наличии дроби
 * (19 → «19», 16.15 → «16,15» в ru/pl, «16.15» в en). Без символа валюты —
 * символ «€» рисуем в JSX отдельно, чтобы не зависеть от позиции в локали.
 */
export function formatEurAmount(amount: number, locale: string): string {
  const hasFraction = Math.round(amount * 100) % 100 !== 0
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: hasFraction ? 2 : 0,
    maximumFractionDigits: hasFraction ? 2 : 0,
  }).format(amount)
}

/** Цена /мес для интервала, уже отформатированная по локали (без символа €). */
export function formatMonthlyPrice(
  fullMonthlyEur: number,
  interval: BillingInterval,
  locale: string,
): string {
  return formatEurAmount(monthlyPriceForInterval(fullMonthlyEur, interval), locale)
}
