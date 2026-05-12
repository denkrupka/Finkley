import { format } from 'date-fns'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { periodLabel, type PeriodValue } from '@/components/ui/period-picker-utils'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils/cn'

/**
 * Универсальный селектор периода в стиле Booksy. Кнопка-триггер показывает
 * текущий период строкой («Май 2026», «01.05 — 31.05», «Последние 30 дней»).
 * При клике — popover с radio-list режимов слева + контентом справа.
 */

const MONTHS_RU = [
  'Январь',
  'Февраль',
  'Март',
  'Апрель',
  'Май',
  'Июнь',
  'Июль',
  'Август',
  'Сентябрь',
  'Октябрь',
  'Ноябрь',
  'Декабрь',
]

const RECENT_OPTIONS = [7, 30, 90, 365]

type Mode = 'month' | 'year' | 'range' | 'recent'

export function PeriodPickerPopover({
  value,
  onChange,
}: {
  value: PeriodValue
  onChange: (next: PeriodValue) => void
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<Mode>(value.kind)
  const today = new Date()
  const [draftYear, setDraftYear] = useState<number>(() =>
    value.kind === 'month' || value.kind === 'year' ? value.year : today.getFullYear(),
  )
  const [draftMonth, setDraftMonth] = useState<number>(() =>
    value.kind === 'month' ? value.month : today.getMonth() + 1,
  )
  const [draftFrom, setDraftFrom] = useState<string>(
    value.kind === 'range' ? value.from : format(today, 'yyyy-MM-dd'),
  )
  const [draftTo, setDraftTo] = useState<string>(
    value.kind === 'range' ? value.to : format(today, 'yyyy-MM-dd'),
  )
  const [draftDays, setDraftDays] = useState<number>(value.kind === 'recent' ? value.days : 30)

  function apply() {
    if (mode === 'month') onChange({ kind: 'month', year: draftYear, month: draftMonth })
    else if (mode === 'year') onChange({ kind: 'year', year: draftYear })
    else if (mode === 'range') onChange({ kind: 'range', from: draftFrom, to: draftTo })
    else onChange({ kind: 'recent', days: draftDays })
    setOpen(false)
  }

  function clear() {
    onChange({ kind: 'month', year: today.getFullYear(), month: today.getMonth() + 1 })
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="md"
          className="min-w-[160px] justify-center capitalize"
          aria-label={t('period.aria_trigger')}
        >
          {periodLabel(value)}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[480px] p-0">
        <div className="grid grid-cols-[160px_1fr]">
          <ul className="border-border bg-muted/20 flex flex-col gap-1 border-r p-2 text-sm">
            {(['range', 'month', 'year', 'recent'] as const).map((m) => (
              <li key={m}>
                <button
                  type="button"
                  onClick={() => setMode(m)}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-md px-3 py-2 text-left transition-colors',
                    mode === m
                      ? 'bg-card text-foreground font-semibold shadow-sm'
                      : 'text-muted-foreground hover:bg-muted/40 hover:text-foreground',
                  )}
                >
                  <span
                    className={cn(
                      'grid size-3.5 shrink-0 place-items-center rounded-full border',
                      mode === m ? 'border-primary' : 'border-muted-foreground/30',
                    )}
                  >
                    {mode === m ? <span className="bg-primary size-2 rounded-full" /> : null}
                  </span>
                  {t(`period.mode.${m}`)}
                </button>
              </li>
            ))}
          </ul>

          <div className="p-4">
            {mode === 'month' ? (
              <div>
                <div className="mb-3 flex items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => setDraftYear((y) => y - 1)}
                    className="text-muted-foreground hover:text-foreground grid size-7 place-items-center rounded-md"
                  >
                    <ChevronLeft className="size-4" strokeWidth={2} />
                  </button>
                  <span className="text-foreground text-sm font-semibold">{draftYear}</span>
                  <button
                    type="button"
                    onClick={() => setDraftYear((y) => y + 1)}
                    className="text-muted-foreground hover:text-foreground grid size-7 place-items-center rounded-md"
                  >
                    <ChevronRight className="size-4" strokeWidth={2} />
                  </button>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {MONTHS_RU.map((label, i) => {
                    const m = i + 1
                    const isFuture =
                      draftYear > today.getFullYear() ||
                      (draftYear === today.getFullYear() && m > today.getMonth() + 1)
                    return (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setDraftMonth(m)}
                        className={cn(
                          'rounded-md px-2 py-2 text-sm transition-colors',
                          draftMonth === m
                            ? 'bg-primary text-primary-foreground font-bold'
                            : isFuture
                              ? 'text-muted-foreground/40'
                              : 'text-foreground hover:bg-muted/60',
                        )}
                      >
                        {label}
                      </button>
                    )
                  })}
                </div>
              </div>
            ) : mode === 'year' ? (
              <div>
                <div className="mb-3 flex items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => setDraftYear((y) => y - 10)}
                    className="text-muted-foreground hover:text-foreground grid size-7 place-items-center rounded-md"
                  >
                    <ChevronLeft className="size-4" strokeWidth={2} />
                  </button>
                  <span className="text-foreground text-sm font-semibold">
                    {Math.floor(draftYear / 10) * 10}–{Math.floor(draftYear / 10) * 10 + 9}
                  </span>
                  <button
                    type="button"
                    onClick={() => setDraftYear((y) => y + 10)}
                    className="text-muted-foreground hover:text-foreground grid size-7 place-items-center rounded-md"
                  >
                    <ChevronRight className="size-4" strokeWidth={2} />
                  </button>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {Array.from(
                    { length: 12 },
                    (_, i) => Math.floor(draftYear / 10) * 10 - 1 + i,
                  ).map((y) => {
                    const isFuture = y > today.getFullYear()
                    return (
                      <button
                        key={y}
                        type="button"
                        onClick={() => setDraftYear(y)}
                        className={cn(
                          'rounded-md px-2 py-2 text-sm transition-colors',
                          draftYear === y
                            ? 'bg-primary text-primary-foreground font-bold'
                            : isFuture
                              ? 'text-muted-foreground/40'
                              : 'text-foreground hover:bg-muted/60',
                        )}
                      >
                        {y}
                      </button>
                    )
                  })}
                </div>
              </div>
            ) : mode === 'range' ? (
              <div className="flex flex-col gap-2 text-sm">
                <label className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground">{t('period.range.from')}</span>
                  <input
                    type="date"
                    value={draftFrom}
                    onChange={(e) => setDraftFrom(e.target.value)}
                    className="border-input bg-background h-9 rounded-md border px-2"
                  />
                </label>
                <label className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground">{t('period.range.to')}</span>
                  <input
                    type="date"
                    value={draftTo}
                    onChange={(e) => setDraftTo(e.target.value)}
                    className="border-input bg-background h-9 rounded-md border px-2"
                  />
                </label>
              </div>
            ) : (
              <div className="flex flex-col gap-2 text-sm">
                {RECENT_OPTIONS.map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setDraftDays(d)}
                    className={cn(
                      'flex items-center justify-between rounded-md px-3 py-2 transition-colors',
                      draftDays === d
                        ? 'bg-primary text-primary-foreground font-bold'
                        : 'text-foreground hover:bg-muted/60',
                    )}
                  >
                    <span>{t(`period.recent.${d}`)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="border-border flex justify-end gap-2 border-t p-3">
          <Button variant="outline" size="sm" onClick={clear}>
            {t('period.clear')}
          </Button>
          <Button size="sm" onClick={apply}>
            {t('period.ok')}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
