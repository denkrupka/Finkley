import {
  addMonths,
  addWeeks,
  getISOWeek,
  isSameDay,
  isSameMonth,
  startOfMonth,
  startOfWeek,
  addDays as addD,
  format,
} from 'date-fns'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { cn } from '@/lib/utils/cn'
import { getDateLocale } from '@/lib/utils/format-date'

/**
 * Мини-календарь для popover'а под кнопкой «Сегодня» в VisitsCalendarView.
 * Стилистически — копия booksy date-picker'а: колонка номера недели слева,
 * серые числа из соседних месяцев, розовая подсветка today, prev/next month,
 * ниже — quick-jump кнопки «Перейти к неделе» ±1..±6.
 */
export function MiniMonthCalendar({
  value,
  onChange,
}: {
  value: Date
  onChange: (next: Date) => void
}) {
  const { t } = useTranslation()
  const [monthCursor, setMonthCursor] = useState(() => startOfMonth(value))
  const today = new Date()

  // Mon-first week. ISO weeks (Monday-based). Локали `ru` / `pl` оба Mon-first.
  const monthStart = startOfMonth(monthCursor)
  const gridStart = startOfWeek(monthStart, { weekStartsOn: 1 })
  // Грид всегда 6 рядов × 7 = 42 ячейки — единый layout без скачков высоты.
  const days: Date[] = Array.from({ length: 42 }, (_, i) => addD(gridStart, i))

  // Группировка по неделям (по 7 ячеек)
  const rows: Date[][] = []
  for (let i = 0; i < days.length; i += 7) {
    rows.push(days.slice(i, i + 7))
  }

  const weekDayLabels: string[] = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']

  return (
    <div className="flex w-[300px] flex-col gap-3">
      {/* Header: ‹ Май 2026 › */}
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setMonthCursor((c) => addMonths(c, -1))}
          className="text-muted-foreground hover:text-foreground grid size-7 place-items-center rounded-md"
          aria-label={t('common.prev')}
        >
          <ChevronLeft className="size-4" strokeWidth={2} />
        </button>
        <span className="text-foreground text-sm font-semibold capitalize">
          {format(monthCursor, 'LLLL yyyy', { locale: getDateLocale() })}
        </span>
        <button
          type="button"
          onClick={() => setMonthCursor((c) => addMonths(c, 1))}
          className="text-muted-foreground hover:text-foreground grid size-7 place-items-center rounded-md"
          aria-label={t('common.next')}
        >
          <ChevronRight className="size-4" strokeWidth={2} />
        </button>
      </div>

      {/* Weekday labels row */}
      <div className="grid grid-cols-[28px_repeat(7,1fr)] gap-y-1 text-center text-[11px]">
        <span className="text-muted-foreground/60 text-[10px] uppercase tracking-wider">
          {t('visits.mini_calendar.week_col')}
        </span>
        {weekDayLabels.map((w) => (
          <span key={w} className="text-muted-foreground font-semibold">
            {w}
          </span>
        ))}

        {/* Grid rows */}
        {rows.map((row) => {
          const firstDay = row[0]!
          const weekNum = getISOWeek(firstDay)
          const hasToday = row.some((d) => isSameDay(d, today))
          return (
            <div key={firstDay.toISOString()} className="contents">
              <span
                className={cn(
                  'text-muted-foreground text-[11px]',
                  hasToday && 'text-brand-rose-deep font-bold',
                )}
              >
                {weekNum}
              </span>
              {row.map((d) => {
                const inMonth = isSameMonth(d, monthCursor)
                const isToday = isSameDay(d, today)
                const isSelected = isSameDay(d, value)
                return (
                  <button
                    key={d.toISOString()}
                    type="button"
                    onClick={() => onChange(d)}
                    className={cn(
                      'mx-auto grid size-7 place-items-center rounded-full text-[12px] transition-colors',
                      !inMonth && 'text-muted-foreground/40',
                      inMonth && !isToday && !isSelected && 'text-foreground hover:bg-muted/60',
                      isToday && !isSelected && 'bg-brand-rose-soft text-brand-rose-deep font-bold',
                      isSelected && 'bg-primary text-primary-foreground font-bold',
                    )}
                  >
                    {d.getDate()}
                  </button>
                )
              })}
            </div>
          )
        })}
      </div>

      {/* Quick-jump «Перейти к неделе» */}
      <div className="border-border flex flex-col gap-1.5 border-t pt-3">
        <p className="text-muted-foreground text-center text-[11px] font-semibold uppercase tracking-wider">
          {t('visits.mini_calendar.jump_week')}
        </p>
        <div className="flex justify-center gap-1">
          {[1, 2, 3, 4, 5, 6].map((n) => (
            <button
              key={`+${n}`}
              type="button"
              onClick={() => onChange(addWeeks(value, n))}
              className="border-border text-foreground hover:border-secondary hover:bg-muted/40 grid h-7 min-w-9 place-items-center rounded-md border text-[11px] font-semibold"
            >
              +{n}
            </button>
          ))}
        </div>
        <div className="flex justify-center gap-1">
          {[1, 2, 3, 4, 5, 6].map((n) => (
            <button
              key={`-${n}`}
              type="button"
              onClick={() => onChange(addWeeks(value, -n))}
              className="border-border text-foreground hover:border-secondary hover:bg-muted/40 grid h-7 min-w-9 place-items-center rounded-md border text-[11px] font-semibold"
            >
              -{n}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
