import {
  endOfDay,
  endOfMonth,
  endOfWeek,
  parseISO,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from 'date-fns'

export type PeriodKey = 'day' | 'week' | 'month' | 'custom'

/**
 * Превращает period-toggle key в [start, end) интервал в UTC ISO-строках.
 * Для `custom` читает дополнительные параметры fromStr/toStr (YYYY-MM-DD).
 *
 * Семантика интервала: start включительно, end эксклюзивно.
 * Все RPC принимают именно так (см. dashboard_kpis).
 */
export function getPeriodRange(
  key: PeriodKey,
  now: Date = new Date(),
  custom?: { fromStr?: string | null; toStr?: string | null },
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
    case 'custom': {
      if (custom?.fromStr && custom?.toStr) {
        const start = startOfDay(parseISO(custom.fromStr))
        const end = endOfDay(parseISO(custom.toStr))
        return { start: start.toISOString(), end: end.toISOString() }
      }
      // fallback на текущий месяц если нет параметров
      return { start: startOfMonth(now).toISOString(), end: endOfMonth(now).toISOString() }
    }
    case 'month':
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
  custom?: { fromStr?: string | null; toStr?: string | null },
): { start: string; end: string } {
  const range = getPeriodRange(key, now, custom)
  return {
    start: range.start.slice(0, 10),
    end: range.end.slice(0, 10),
  }
}

/**
 * Helper: вытащить custom параметры из URLSearchParams для передачи в
 * getPeriodRange. Используется в роутах потребителях.
 */
export function readCustomFromParams(params: URLSearchParams): {
  fromStr?: string | null
  toStr?: string | null
} {
  return { fromStr: params.get('from'), toStr: params.get('to') }
}
