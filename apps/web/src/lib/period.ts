import { endOfDay, endOfMonth, endOfWeek, startOfDay, startOfMonth, startOfWeek } from 'date-fns'

export type PeriodKey = 'day' | 'week' | 'month' | 'custom'

/**
 * Превращает period-toggle key в [start, end) интервал в UTC ISO-строках.
 * `custom` пока ведёт себя как «месяц», полноценный date-picker будет в TASK-23.
 *
 * Семантика интервала: start включительно, end эксклюзивно.
 * Все RPC принимают именно так (см. dashboard_kpis).
 */
export function getPeriodRange(
  key: PeriodKey,
  now: Date = new Date(),
): { start: string; end: string } {
  switch (key) {
    case 'day': {
      return { start: startOfDay(now).toISOString(), end: endOfDay(now).toISOString() }
    }
    case 'week': {
      const start = startOfWeek(now, { weekStartsOn: 1 }) // понедельник
      const end = endOfWeek(now, { weekStartsOn: 1 })
      return { start: start.toISOString(), end: end.toISOString() }
    }
    case 'month':
    case 'custom':
    default: {
      return { start: startOfMonth(now).toISOString(), end: endOfMonth(now).toISOString() }
    }
  }
}

/**
 * Для expenses у нас date-only колонка (`expense_at date`), нужно использовать
 * YYYY-MM-DD строки.
 */
export function getDatePeriodRange(
  key: PeriodKey,
  now: Date = new Date(),
): { start: string; end: string } {
  const range = getPeriodRange(key, now)
  return {
    start: range.start.slice(0, 10),
    end: range.end.slice(0, 10),
  }
}
