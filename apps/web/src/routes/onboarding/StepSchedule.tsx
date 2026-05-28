import { Clock } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils/cn'

export type OpeningHoursDraft = Record<string, { open?: string; close?: string; closed?: boolean }>

const DAYS: Array<{ id: string; label: string }> = [
  { id: 'mon', label: 'Пн' },
  { id: 'tue', label: 'Вт' },
  { id: 'wed', label: 'Ср' },
  { id: 'thu', label: 'Чт' },
  { id: 'fri', label: 'Пт' },
  { id: 'sat', label: 'Сб' },
  { id: 'sun', label: 'Вс' },
]

const DEFAULT_OPEN = '09:00'
const DEFAULT_CLOSE = '20:00'

type Props = {
  value: OpeningHoursDraft
  onChange: (v: OpeningHoursDraft) => void
}

/**
 * T98 — рабочий график в полной ветке онбординга. Сохраняется в
 * salons.opening_hours jsonb. Используется для:
 *   - расчёта occupancy (доступные часы)
 *   - валидации онлайн-бронирований
 *   - i18n письма клиенту: «мы открыты пн-пт 9:00-20:00».
 *
 * Минималистичный UI — на каждый день своя строка с checkbox «работаем» +
 * 2 time-input'а. Чтобы не загромождать — кнопка «Применить ко всем
 * будням» копирует значения пн → вт-пт.
 */
export function StepSchedule({ value, onChange }: Props) {
  const { t } = useTranslation()

  function patchDay(id: string, partial: { open?: string; close?: string; closed?: boolean }) {
    onChange({
      ...value,
      [id]: { ...(value[id] ?? {}), ...partial },
    })
  }

  function applyToWeekdays() {
    const mon = value.mon ?? { open: DEFAULT_OPEN, close: DEFAULT_CLOSE }
    const next: OpeningHoursDraft = { ...value }
    for (const id of ['tue', 'wed', 'thu', 'fri']) {
      next[id] = { ...mon }
    }
    onChange(next)
  }

  return (
    <div>
      <h1 className="text-brand-navy text-2xl font-bold tracking-tight">
        <Clock className="text-brand-teal-deep mr-2 inline-block size-6" strokeWidth={2} />
        {t('onboarding.schedule.title')}
      </h1>

      <div className="mt-3 flex flex-col gap-1.5">
        {DAYS.map((d) => {
          const cur = value[d.id] ?? {}
          const closed = !!cur.closed
          return (
            <div
              key={d.id}
              className={cn(
                'border-border flex items-center gap-3 rounded-md border px-3 py-2 transition-colors',
                closed ? 'bg-muted/30' : 'bg-card',
              )}
            >
              <label className="inline-flex w-20 shrink-0 cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  checked={!closed}
                  onChange={(e) => patchDay(d.id, { closed: !e.target.checked })}
                  className="accent-brand-teal-deep size-4 cursor-pointer"
                />
                <span className="text-foreground text-sm font-bold">{d.label}</span>
              </label>
              {!closed ? (
                <>
                  <Input
                    type="time"
                    value={cur.open ?? DEFAULT_OPEN}
                    onChange={(e) => patchDay(d.id, { open: e.target.value })}
                    className="num h-9 flex-1 text-sm"
                  />
                  <span className="text-muted-foreground text-xs">—</span>
                  <Input
                    type="time"
                    value={cur.close ?? DEFAULT_CLOSE}
                    onChange={(e) => patchDay(d.id, { close: e.target.value })}
                    className="num h-9 flex-1 text-sm"
                  />
                </>
              ) : (
                <span className="text-muted-foreground flex-1 text-sm italic">
                  {t('onboarding.schedule.closed')}
                </span>
              )}
            </div>
          )
        })}
      </div>

      <button
        type="button"
        onClick={applyToWeekdays}
        className="text-brand-teal-deep hover:bg-brand-teal-soft/40 mt-2 inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-bold"
      >
        {t('onboarding.schedule.apply_weekdays')}
      </button>
    </div>
  )
}
