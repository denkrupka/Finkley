import { format, parseISO, startOfMonth } from 'date-fns'
import { ChevronDown } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { getDateLocale } from '@/lib/utils/format-date'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils/cn'

export type PeriodKey = 'day' | 'week' | 'month' | 'custom'

const FIXED_OPTIONS: PeriodKey[] = ['day', 'week', 'month']

/**
 * Period-toggle: 4 кнопки (день/неделя/месяц/период). «Период» открывает
 * popover с двумя date-input'ами и быстрыми пресетами. URL хранит:
 *   ?period=day | week | month | custom
 *   ?from=YYYY-MM-DD&to=YYYY-MM-DD  — только для custom
 */
export function PeriodToggle() {
  const { t } = useTranslation()
  const [params, setParams] = useSearchParams()
  const value = (params.get('period') ?? 'month') as PeriodKey
  const [open, setOpen] = useState(false)

  // Инициализация custom range из URL или дефолт = текущий месяц
  const today = format(new Date(), 'yyyy-MM-dd')
  const monthStart = format(startOfMonth(new Date()), 'yyyy-MM-dd')
  const [fromStr, setFromStr] = useState<string>(params.get('from') ?? monthStart)
  const [toStr, setToStr] = useState<string>(params.get('to') ?? today)

  // Sync state когда URL меняется снаружи
  useEffect(() => {
    if (params.get('from')) setFromStr(params.get('from')!)
    if (params.get('to')) setToStr(params.get('to')!)
  }, [params])

  function setFixed(next: PeriodKey) {
    const newParams = new URLSearchParams(params)
    newParams.set('period', next)
    newParams.delete('from')
    newParams.delete('to')
    setParams(newParams, { replace: true })
  }

  function applyCustom() {
    if (!fromStr || !toStr) return
    if (fromStr > toStr) {
      // Свопаем если перепутали порядок
      ;[setFromStr, setToStr].forEach((fn, i) => fn(i === 0 ? toStr : fromStr))
      return
    }
    const newParams = new URLSearchParams(params)
    newParams.set('period', 'custom')
    newParams.set('from', fromStr)
    newParams.set('to', toStr)
    setParams(newParams, { replace: true })
    setOpen(false)
  }

  function setQuickRange(days: number) {
    const end = new Date()
    const start = new Date()
    start.setDate(end.getDate() - days + 1)
    setFromStr(format(start, 'yyyy-MM-dd'))
    setToStr(format(end, 'yyyy-MM-dd'))
  }

  const customLabel =
    value === 'custom' && params.get('from') && params.get('to')
      ? `${format(parseISO(params.get('from')!), 'd MMM', { locale: getDateLocale() })} — ${format(parseISO(params.get('to')!), 'd MMM', { locale: getDateLocale() })}`
      : t('dashboard.period.custom')

  return (
    <div className="border-border bg-background inline-flex rounded-full border p-[3px]">
      {FIXED_OPTIONS.map((id) => {
        const active = value === id
        return (
          <button
            key={id}
            type="button"
            onClick={() => setFixed(id)}
            className={cn(
              'inline-flex h-8 items-center gap-1 rounded-full px-3.5 text-[13px] font-semibold transition-colors',
              active
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
            aria-pressed={active}
          >
            {t(`dashboard.period.${id}`)}
          </button>
        )
      })}

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className={cn(
              'inline-flex h-8 items-center gap-1 rounded-full px-3.5 text-[13px] font-semibold transition-colors',
              value === 'custom'
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {customLabel}
            <ChevronDown
              className={cn('size-3.5 transition-transform', open ? 'rotate-180' : '')}
              strokeWidth={2}
            />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-80" align="end">
          <div className="flex flex-col gap-3">
            <div>
              <p className="text-brand-navy text-sm font-bold">
                {t('dashboard.period_picker.title')}
              </p>
              <p className="text-muted-foreground mt-0.5 text-xs">
                {t('dashboard.period_picker.subtitle')}
              </p>
            </div>

            {/* Quick presets */}
            <div className="grid grid-cols-2 gap-1.5">
              {[
                { label: t('dashboard.period_picker.last_7'), days: 7 },
                { label: t('dashboard.period_picker.last_30'), days: 30 },
                { label: t('dashboard.period_picker.last_90'), days: 90 },
                { label: t('dashboard.period_picker.last_365'), days: 365 },
              ].map((preset) => (
                <button
                  key={preset.days}
                  type="button"
                  onClick={() => setQuickRange(preset.days)}
                  className="border-border bg-card text-foreground hover:bg-accent/50 rounded-md border px-2 py-1.5 text-xs font-medium transition-colors"
                >
                  {preset.label}
                </button>
              ))}
            </div>

            {/* Date inputs */}
            <div className="grid grid-cols-2 gap-2">
              <div className="flex flex-col gap-1">
                <label
                  htmlFor="period-from"
                  className="text-muted-foreground text-[10px] font-bold uppercase tracking-wider"
                >
                  {t('dashboard.period_picker.from')}
                </label>
                <input
                  id="period-from"
                  type="date"
                  value={fromStr}
                  max={toStr || today}
                  onChange={(e) => setFromStr(e.target.value)}
                  className="border-border bg-background h-9 rounded-md border px-2 text-sm"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label
                  htmlFor="period-to"
                  className="text-muted-foreground text-[10px] font-bold uppercase tracking-wider"
                >
                  {t('dashboard.period_picker.to')}
                </label>
                <input
                  id="period-to"
                  type="date"
                  value={toStr}
                  min={fromStr}
                  max={today}
                  onChange={(e) => setToStr(e.target.value)}
                  className="border-border bg-background h-9 rounded-md border px-2 text-sm"
                />
              </div>
            </div>

            <Button onClick={applyCustom} className="w-full" size="md">
              {t('dashboard.period_picker.apply')}
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  )
}
