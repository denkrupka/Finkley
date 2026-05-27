import { addYears, endOfMonth, endOfYear, format, startOfMonth, startOfYear } from 'date-fns'

import { getDateLocale } from '@/lib/utils/format-date'

/**
 * Универсальный тип для PeriodPickerPopover. Хранится в URL search params
 * или в локальном state, конвертируется в Date-диапазон через periodToRange.
 */
export type PeriodValue =
  | { kind: 'month'; year: number; month: number }
  | { kind: 'year'; year: number }
  | { kind: 'range'; from: string; to: string }
  | { kind: 'recent'; days: number }

export type PeriodRange = { start: Date; end: Date }

export function periodToRange(p: PeriodValue): PeriodRange {
  if (p.kind === 'month') {
    const anchor = new Date(p.year, p.month - 1, 1)
    return { start: startOfMonth(anchor), end: endOfMonth(anchor) }
  }
  if (p.kind === 'year') {
    return { start: startOfYear(new Date(p.year, 0, 1)), end: endOfYear(new Date(p.year, 0, 1)) }
  }
  if (p.kind === 'range') {
    return { start: new Date(`${p.from}T00:00:00`), end: new Date(`${p.to}T23:59:59.999`) }
  }
  const end = new Date()
  const start = new Date(end.getTime() - p.days * 86400_000)
  return { start, end }
}

export function periodLabel(p: PeriodValue): string {
  if (p.kind === 'month') {
    return format(new Date(p.year, p.month - 1, 1), 'LLLL yyyy', { locale: getDateLocale() })
  }
  if (p.kind === 'year') return String(p.year)
  if (p.kind === 'range') {
    return `${format(new Date(p.from), 'd MMM', { locale: getDateLocale() })} — ${format(
      new Date(p.to),
      'd MMM yyyy',
      { locale: getDateLocale() },
    )}`
  }
  return `Последние ${p.days} дн.`
}

export function currentMonthPeriod(): PeriodValue {
  const now = new Date()
  return { kind: 'month', year: now.getFullYear(), month: now.getMonth() + 1 }
}

export type MonthCol = { year: number; monthIdx: number; key: string }

/**
 * Список колонок-месяцев для табличных отчётов (P&L), покрывающих
 * указанный диапазон. Каждая колонка — один календарный месяц.
 *
 * Гарантирует минимум одну колонку (если start > end или диапазон в пределах
 * одного месяца — возвращает один месяц от start). Безопасно ограничивает
 * максимум на 60 месяцев — для «За все время» с from='2000-01-01' иначе
 * вернулись бы сотни колонок и таблица ушла бы в OOM.
 */
export function buildMonthCols(start: Date, end: Date): MonthCol[] {
  const MAX_COLS = 60
  const a = new Date(start.getFullYear(), start.getMonth(), 1)
  const b = new Date(end.getFullYear(), end.getMonth(), 1)
  const cols: MonthCol[] = []
  const cur = new Date(a)
  while (cur.getTime() <= b.getTime() && cols.length < MAX_COLS) {
    const year = cur.getFullYear()
    const monthIdx = cur.getMonth()
    cols.push({ year, monthIdx, key: `${year}-${String(monthIdx + 1).padStart(2, '0')}` })
    cur.setMonth(cur.getMonth() + 1)
  }
  if (cols.length === 0) {
    const year = a.getFullYear()
    const monthIdx = a.getMonth()
    cols.push({ year, monthIdx, key: `${year}-${String(monthIdx + 1).padStart(2, '0')}` })
  }
  // Если упёрлись в MAX_COLS, обрежем «справа» — последние 60 месяцев перед end.
  if (cur.getTime() <= b.getTime()) {
    const toCut = cols.length
    cols.length = 0
    const start2 = new Date(b)
    start2.setMonth(start2.getMonth() - (MAX_COLS - 1))
    const cur2 = new Date(start2)
    while (cur2.getTime() <= b.getTime() && cols.length < MAX_COLS) {
      const year = cur2.getFullYear()
      const monthIdx = cur2.getMonth()
      cols.push({ year, monthIdx, key: `${year}-${String(monthIdx + 1).padStart(2, '0')}` })
      cur2.setMonth(cur2.getMonth() + 1)
    }
    void toCut
  }
  return cols
}

export function shiftPeriod(value: PeriodValue, direction: 1 | -1): PeriodValue {
  if (value.kind === 'month') {
    const anchor = addYears(new Date(value.year, value.month - 1, 1), 0)
    anchor.setMonth(anchor.getMonth() + direction)
    return { kind: 'month', year: anchor.getFullYear(), month: anchor.getMonth() + 1 }
  }
  if (value.kind === 'year') {
    return { kind: 'year', year: value.year + direction }
  }
  if (value.kind === 'range') {
    const fromDate = new Date(value.from)
    const toDate = new Date(value.to)
    const lengthMs = toDate.getTime() - fromDate.getTime()
    const shifted = new Date(fromDate.getTime() + direction * (lengthMs + 86400_000))
    return {
      kind: 'range',
      from: format(shifted, 'yyyy-MM-dd'),
      to: format(new Date(shifted.getTime() + lengthMs), 'yyyy-MM-dd'),
    }
  }
  return value
}
