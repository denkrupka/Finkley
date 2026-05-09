import {
  addMonths,
  endOfMonth,
  format,
  isSameDay,
  isSameMonth,
  startOfMonth,
  startOfWeek,
} from 'date-fns'
import { ru } from 'date-fns/locale'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useClients } from '@/hooks/useClients'
import { useServices } from '@/hooks/useServices'
import { useVisits } from '@/hooks/useVisits'
import { cn } from '@/lib/utils/cn'
import { formatCurrency } from '@/lib/utils/format-currency'

type Props = {
  salonId: string
  currency: string
}

/**
 * Маленький календарь-виджет на дашборд (TASK 1d40c533).
 *
 * Показывает текущий месяц 6×7. Дни с визитами помечены цветной точкой;
 * при наведении/клике — popover со списком визитов на этот день
 * (время, клиент, услуга, сумма).
 *
 * Ходит за визитами на видимый месяц целиком (range = весь месяц), чтобы
 * не делать N+1 запросов на каждый день.
 */
export function MiniCalendarWidget({ salonId, currency }: Props) {
  const { t } = useTranslation()
  const [cursor, setCursor] = useState(() => new Date())
  const [openDay, setOpenDay] = useState<string | null>(null) // ISO yyyy-MM-dd

  const monthStart = useMemo(() => startOfMonth(cursor), [cursor])
  const monthEnd = useMemo(() => endOfMonth(cursor), [cursor])
  const range = useMemo(
    () => ({
      start: monthStart.toISOString(),
      end: new Date(monthEnd.getTime() + 24 * 60 * 60 * 1000).toISOString(),
    }),
    [monthStart, monthEnd],
  )

  const { data: visits = [] } = useVisits(salonId, range)
  const { data: clients = [] } = useClients(salonId)
  const { data: services = [] } = useServices(salonId)

  // Группируем визиты по дню (yyyy-MM-dd) для O(1) lookup при отрисовке
  const byDay = useMemo(() => {
    const map = new Map<string, typeof visits>()
    for (const v of visits) {
      const day = format(new Date(v.visit_at), 'yyyy-MM-dd')
      const arr = map.get(day) ?? []
      arr.push(v)
      map.set(day, arr)
    }
    return map
  }, [visits])

  // 6×7 сетка от понедельника начала недели monthStart до конца этой сетки.
  const gridStart = useMemo(() => startOfWeek(monthStart, { weekStartsOn: 1 }), [monthStart])
  const gridDays = useMemo(() => {
    const days: Date[] = []
    for (let i = 0; i < 42; i++) {
      const d = new Date(gridStart)
      d.setDate(gridStart.getDate() + i)
      days.push(d)
    }
    return days
  }, [gridStart])

  const today = new Date()
  const monthLabel =
    format(cursor, 'LLLL yyyy', { locale: ru }).charAt(0).toUpperCase() +
    format(cursor, 'LLLL yyyy', { locale: ru }).slice(1)

  function dayVisits(day: Date) {
    return byDay.get(format(day, 'yyyy-MM-dd')) ?? []
  }

  function clientName(clientId: string | null) {
    if (!clientId) return null
    return clients.find((c) => c.id === clientId)?.name ?? null
  }

  function serviceName(serviceId: string | null, fallback: string | null) {
    if (!serviceId) return fallback
    return services.find((s) => s.id === serviceId)?.name ?? fallback
  }

  return (
    <section className="border-border bg-card shadow-finsm rounded-lg border p-4">
      {/* Header: prev / month / next */}
      <div className="mb-3 flex items-center justify-between">
        <button
          type="button"
          onClick={() => setCursor((c) => addMonths(c, -1))}
          className="text-muted-foreground hover:text-foreground grid size-7 place-items-center rounded-md"
          aria-label={t('dashboard.calendar.prev')}
        >
          <ChevronLeft className="size-4" strokeWidth={1.8} />
        </button>
        <h3 className="text-brand-navy text-sm font-bold tracking-tight">{monthLabel}</h3>
        <button
          type="button"
          onClick={() => setCursor((c) => addMonths(c, 1))}
          className="text-muted-foreground hover:text-foreground grid size-7 place-items-center rounded-md"
          aria-label={t('dashboard.calendar.next')}
        >
          <ChevronRight className="size-4" strokeWidth={1.8} />
        </button>
      </div>

      {/* Weekday headers */}
      <div className="text-muted-foreground mb-1 grid grid-cols-7 gap-1 text-center text-[10px] font-semibold uppercase">
        {['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'].map((d) => (
          <span key={d}>{d}</span>
        ))}
      </div>

      {/* 6×7 grid */}
      <div className="relative grid grid-cols-7 gap-1">
        {gridDays.map((day) => {
          const isOther = !isSameMonth(day, cursor)
          const isToday = isSameDay(day, today)
          const dayKey = format(day, 'yyyy-MM-dd')
          const dvs = dayVisits(day)
          const hasVisits = dvs.length > 0
          const isOpen = openDay === dayKey
          return (
            <div key={dayKey} className="relative">
              <button
                type="button"
                onClick={() => setOpenDay((prev) => (prev === dayKey ? null : dayKey))}
                disabled={!hasVisits}
                aria-label={t('dashboard.calendar.day_aria', {
                  date: format(day, 'd MMMM', { locale: ru }),
                  count: dvs.length,
                })}
                className={cn(
                  'relative grid h-9 w-full place-items-center rounded-md text-xs font-medium transition-colors',
                  isToday
                    ? 'bg-primary text-primary-foreground font-bold'
                    : isOther
                      ? 'text-muted-foreground/60'
                      : 'text-foreground hover:bg-muted/40',
                  hasVisits && !isToday && 'bg-brand-teal-soft/40',
                  !hasVisits && 'cursor-default',
                )}
              >
                <span>{day.getDate()}</span>
                {hasVisits ? (
                  <span
                    className={cn(
                      'absolute bottom-1 left-1/2 size-1 -translate-x-1/2 rounded-full',
                      isToday ? 'bg-primary-foreground' : 'bg-brand-teal',
                    )}
                  />
                ) : null}
              </button>

              {isOpen && hasVisits ? (
                <div
                  className="border-border bg-card shadow-finmd absolute left-1/2 top-full z-20 mt-1 w-64 -translate-x-1/2 rounded-lg border p-3"
                  role="dialog"
                  aria-label={format(day, 'd MMMM yyyy', { locale: ru })}
                >
                  <div className="text-brand-navy mb-2 text-xs font-bold uppercase">
                    {format(day, 'd MMMM, EEEE', { locale: ru })}
                  </div>
                  <ul className="flex flex-col gap-1.5 text-xs">
                    {dvs.slice(0, 6).map((v) => (
                      <li key={v.id} className="flex items-start justify-between gap-2">
                        <span className="min-w-0 flex-1">
                          <span className="num text-muted-foreground mr-1.5">
                            {format(new Date(v.visit_at), 'HH:mm')}
                          </span>
                          <span className="text-foreground">
                            {clientName(v.client_id) ?? t('dashboard.calendar.no_client')}
                          </span>
                          <span className="text-muted-foreground block truncate">
                            {serviceName(v.service_id, v.service_name_snapshot) ?? '—'}
                          </span>
                        </span>
                        <span className="num text-brand-sage shrink-0 text-[11px] font-bold">
                          {formatCurrency(v.amount_cents, currency)}
                        </span>
                      </li>
                    ))}
                  </ul>
                  {dvs.length > 6 ? (
                    <p className="text-muted-foreground mt-2 text-[10px]">
                      {t('dashboard.calendar.more', { count: dvs.length - 6 })}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>
          )
        })}
      </div>
    </section>
  )
}
