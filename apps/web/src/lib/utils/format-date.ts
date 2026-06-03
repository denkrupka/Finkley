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
 * YYYY-MM-DD → 12.05 для display в expenses.
 *
 * Принимает:
 *  • 'YYYY-MM-DD' (date-only) — берётся как есть (expenses.expense_at).
 *  • ISO timestamp 'YYYY-MM-DDTHH:mm:ss.sssZ' — конвертируется в локальную
 *    дату через new Date(). Это важно для bank_transactions.executed_at: UTC-
 *    timestamp '2026-04-30T22:00:00Z' в Europe/Warsaw = 1 мая 00:00, и должен
 *    показаться как 01.05, а не 30.04 (bug: при slice(0,10) терялся TZ-сдвиг,
 *    из-за чего апрельские в UTC транзакции отображались под маем).
 */
export function formatExpenseDate(date: string): string {
  if (date.length === 10) {
    // date-only, без TZ
    const [, m, d] = date.split('-').map(Number)
    return `${String(d).padStart(2, '0')}.${String(m).padStart(2, '0')}`
  }
  const dt = new Date(date)
  if (Number.isNaN(dt.getTime())) return ''
  const m = dt.getMonth() + 1
  const d = dt.getDate()
  return `${String(d).padStart(2, '0')}.${String(m).padStart(2, '0')}`
}

/**
 * Date → 'YYYY-MM-DD' в локальной таймзоне браузера.
 *
 * Использовать вместо `d.toISOString().slice(0, 10)` для всех фильтров
 * периода: month-period даёт `Date(2026-06-01 00:00 Europe/Warsaw)`,
 * после `.toISOString()` это станет `'2026-05-31T22:00:00Z'` и slice
 * вернёт `'2026-05-31'` — в фильтр май попадает 1 день. См. фикс
 * 2026-06-04 (owner bug: «Июнь 2026» показывал транзакции 31.05).
 */
export function toLocalISODate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
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
