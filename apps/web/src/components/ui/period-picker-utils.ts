import { addYears, endOfMonth, endOfYear, format, startOfMonth, startOfYear } from 'date-fns'
import { ru } from 'date-fns/locale'

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
    return format(new Date(p.year, p.month - 1, 1), 'LLLL yyyy', { locale: ru })
  }
  if (p.kind === 'year') return String(p.year)
  if (p.kind === 'range') {
    return `${format(new Date(p.from), 'd MMM', { locale: ru })} — ${format(
      new Date(p.to),
      'd MMM yyyy',
      { locale: ru },
    )}`
  }
  return `Последние ${p.days} дн.`
}

export function currentMonthPeriod(): PeriodValue {
  const now = new Date()
  return { kind: 'month', year: now.getFullYear(), month: now.getMonth() + 1 }
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
