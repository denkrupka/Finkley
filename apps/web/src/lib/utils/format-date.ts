import { format, parseISO, type Locale } from 'date-fns'
import { enUS, pl, ru } from 'date-fns/locale'
import i18n from 'i18next'

/**
 * Минимальные хелперы дат с локалью из i18n.
 * Внутренний формат — ISO; на UI рендерим через эти функции.
 *
 * getDateLocale() читает текущий язык из i18next и возвращает соответствующую
 * date-fns локаль. Использовать ВСЕГДА вместо прямого импорта `ru/pl/enUS` —
 * иначе EN/PL юзеры видят русские дни недели.
 */
export function getDateLocale(): Locale {
  const lng = i18n.language?.split('-')[0] ?? 'ru'
  if (lng === 'pl') return pl
  if (lng === 'en') return enUS
  return ru
}

export function formatVisitDate(iso: string): string {
  return format(parseISO(iso), 'dd.MM', { locale: getDateLocale() })
}

export function formatVisitDayHeading(iso: string): string {
  return format(parseISO(iso), 'EEEE, d MMMM', { locale: getDateLocale() })
}

/**
 * YYYY-MM-DD → 12.05 для display в expenses
 */
export function formatExpenseDate(date: string): string {
  // Принимает 'YYYY-MM-DD' (expenses.expense_at — date-only) ИЛИ ISO
  // timestamp 'YYYY-MM-DDTHH:mm:ss.sssZ' (bank_transactions.executed_at —
  // timestamptz). Без slice(0,10) split('-') на остатке "DDT..." даёт NaN
  // в позиции [2] и в UI появляется «NaN.05».
  const dateOnly = date.length > 10 ? date.slice(0, 10) : date
  const [, m, d] = dateOnly.split('-').map(Number)
  return `${String(d).padStart(2, '0')}.${String(m).padStart(2, '0')}`
}

/**
 * Группировка ISO-дат по дню для рендеринга в списке.
 */
export function groupByDay<T extends { visit_at: string }>(items: T[]): Map<string, T[]> {
  const map = new Map<string, T[]>()
  for (const item of items) {
    const day = item.visit_at.slice(0, 10)
    const list = map.get(day) ?? []
    list.push(item)
    map.set(day, list)
  }
  return map
}
