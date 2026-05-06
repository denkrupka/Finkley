import { format, parseISO } from 'date-fns'
import { ru } from 'date-fns/locale'

/**
 * Минимальные хелперы дат с локалью ru.
 * Внутренний формат — ISO; на UI рендерим через эти функции.
 */

export function formatVisitDate(iso: string): string {
  return format(parseISO(iso), 'dd.MM', { locale: ru })
}

export function formatVisitDayHeading(iso: string): string {
  return format(parseISO(iso), 'EEEE, d MMMM', { locale: ru })
}

/**
 * YYYY-MM-DD → 12.05 для display в expenses
 */
export function formatExpenseDate(date: string): string {
  // 'YYYY-MM-DD' → парсим как date-only
  const [, m, d] = date.split('-').map(Number)
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
