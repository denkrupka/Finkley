import { addDays, format, isSameDay, startOfDay } from 'date-fns'
import { ru } from 'date-fns/locale'
import { ChevronDown, ChevronUp, Clock } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useStaff } from '@/hooks/useStaff'
import { useServices } from '@/hooks/useServices'
import { useVisits } from '@/hooks/useVisits'
import { cn } from '@/lib/utils/cn'

type Props = {
  salonId: string
}

const DEFAULT_OPEN_HOUR = 9
const DEFAULT_CLOSE_HOUR = 19
const DEFAULT_VISIT_MIN = 60
const SLOT_GRANULARITY_MIN = 30
const DAYS_AHEAD = 7

/**
 * «Свободные окна» — виджет для /visits, показывает по каждому активному
 * мастеру свободные временные интервалы на ближайшие 7 дней.
 *
 * Алгоритм (MVP):
 *   * Часы работы: hardcoded 09:00-19:00 каждый день. Когда добавится
 *     salon.opening_hours / staff.weekly_schedule — заменим. Сейчас
 *     этой data в схеме нет (см. defer в backlog).
 *   * Длительность визита: service.default_duration_min, если задано,
 *     иначе DEFAULT_VISIT_MIN (60).
 *   * Свободное окно = непрерывный отрезок ≥SLOT_GRANULARITY_MIN внутри
 *     рабочих часов, не пересечённый ни одним booked-визитом.
 *
 * Считается на клиенте — для салона на ~10 мастеров и сотни визитов в
 * неделю это <50ms работы и не требует server-side.
 */
export function FreeSlotsPanel({ salonId }: Props) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [staffFilter, setStaffFilter] = useState<string | null>(null)

  // Range = от начала сегодня + 7 дней
  const range = useMemo(() => {
    const start = startOfDay(new Date())
    const end = addDays(start, DAYS_AHEAD)
    return { start: start.toISOString(), end: end.toISOString() }
  }, [])

  const { data: staff = [] } = useStaff(salonId, { activeOnly: true })
  const { data: services = [] } = useServices(salonId)
  const { data: visits = [], isLoading } = useVisits(salonId, range)

  const serviceDurationById = useMemo(() => {
    const m = new Map<string, number>()
    for (const s of services) m.set(s.id, s.default_duration_min ?? DEFAULT_VISIT_MIN)
    return m
  }, [services])

  // По мастеру → массив busy-интервалов [start, end)
  type Interval = { start: Date; end: Date }
  const busyByStaff = useMemo(() => {
    const map = new Map<string, Interval[]>()
    for (const v of visits) {
      if (!v.staff_id) continue
      // У retail (kind='retail') не считаем busy — это же продажа без приёма.
      if (v.kind === 'retail') continue
      const start = new Date(v.visit_at)
      const dur = (v.service_id && serviceDurationById.get(v.service_id)) || DEFAULT_VISIT_MIN
      const end = new Date(start.getTime() + dur * 60_000)
      const arr = map.get(v.staff_id) ?? []
      arr.push({ start, end })
      map.set(v.staff_id, arr)
    }
    // Sort each list by start
    for (const arr of map.values()) arr.sort((a, b) => a.start.getTime() - b.start.getTime())
    return map
  }, [visits, serviceDurationById])

  /**
   * Свободные слоты для одного мастера в один день:
   * day-window [open, close) минус все busy-интервалы в этом дне.
   */
  function freeSlotsForDay(staffId: string, day: Date): Interval[] {
    const dayStart = new Date(day)
    dayStart.setHours(DEFAULT_OPEN_HOUR, 0, 0, 0)
    const dayEnd = new Date(day)
    dayEnd.setHours(DEFAULT_CLOSE_HOUR, 0, 0, 0)

    const busy = (busyByStaff.get(staffId) ?? []).filter(
      (b) => b.end > dayStart && b.start < dayEnd,
    )

    // Subtract busy from [dayStart, dayEnd)
    const free: Interval[] = []
    let cursor = dayStart
    for (const b of busy) {
      const bStart = b.start < dayStart ? dayStart : b.start
      const bEnd = b.end > dayEnd ? dayEnd : b.end
      if (cursor < bStart) free.push({ start: cursor, end: bStart })
      if (bEnd > cursor) cursor = bEnd
    }
    if (cursor < dayEnd) free.push({ start: cursor, end: dayEnd })

    // Filter out tiny slivers (< granularity)
    return free.filter((s) => s.end.getTime() - s.start.getTime() >= SLOT_GRANULARITY_MIN * 60_000)
  }

  const days = useMemo(() => {
    const start = startOfDay(new Date())
    return Array.from({ length: DAYS_AHEAD }, (_, i) => addDays(start, i))
  }, [])

  const visibleStaff = staffFilter ? staff.filter((s) => s.id === staffFilter) : staff

  function intervalLabel(it: Interval): string {
    const dur = (it.end.getTime() - it.start.getTime()) / 60_000
    const h = Math.floor(dur / 60)
    const m = dur % 60
    const dlabel = h > 0 ? (m > 0 ? `${h}ч ${m}м` : `${h}ч`) : `${m}м`
    return `${format(it.start, 'HH:mm')}–${format(it.end, 'HH:mm')} (${dlabel})`
  }

  return (
    <section className="border-border bg-card shadow-finsm mb-4 rounded-lg border">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="hover:bg-muted/30 flex w-full items-center justify-between gap-3 rounded-t-lg px-5 py-3 transition-colors"
      >
        <span className="flex items-center gap-2">
          <Clock className="text-brand-teal size-4" strokeWidth={1.8} />
          <span className="text-foreground text-sm font-bold">{t('visits.free_slots.title')}</span>
          <span className="text-muted-foreground text-xs">{t('visits.free_slots.subtitle')}</span>
        </span>
        {open ? (
          <ChevronUp className="text-muted-foreground size-4" strokeWidth={1.8} />
        ) : (
          <ChevronDown className="text-muted-foreground size-4" strokeWidth={1.8} />
        )}
      </button>

      {open ? (
        <div className="border-border border-t px-5 py-4">
          {/* staff filter pills */}
          {staff.length > 1 ? (
            <div className="mb-3 flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => setStaffFilter(null)}
                className={cn(
                  'rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors',
                  staffFilter === null
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border bg-card text-muted-foreground hover:bg-muted/40',
                )}
              >
                {t('visits.free_slots.all_staff')}
              </button>
              {staff.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setStaffFilter(s.id === staffFilter ? null : s.id)}
                  className={cn(
                    'rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors',
                    s.id === staffFilter
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-border bg-card text-muted-foreground hover:bg-muted/40',
                  )}
                >
                  {s.full_name}
                </button>
              ))}
            </div>
          ) : null}

          {isLoading ? (
            <div className="bg-muted/40 h-32 animate-pulse rounded-md" />
          ) : visibleStaff.length === 0 ? (
            <p className="text-muted-foreground text-sm">{t('visits.free_slots.no_staff')}</p>
          ) : (
            <div className="grid gap-4">
              {visibleStaff.map((s) => (
                <div key={s.id}>
                  <h4 className="text-foreground mb-2 text-xs font-bold">{s.full_name}</h4>
                  <div className="grid gap-2">
                    {days.map((d) => {
                      const slots = freeSlotsForDay(s.id, d)
                      const isToday = isSameDay(d, new Date())
                      const dLabel = format(d, 'EEEE, d MMMM', { locale: ru })
                      return (
                        <div
                          key={d.toISOString()}
                          className="border-border bg-muted/20 rounded-md border p-2.5"
                        >
                          <div className="text-muted-foreground mb-1.5 text-[10.5px] font-semibold uppercase">
                            {isToday ? `${t('visits.free_slots.today')} · ${dLabel}` : dLabel}
                          </div>
                          {slots.length === 0 ? (
                            <p className="text-muted-foreground text-xs italic">
                              {t('visits.free_slots.fully_booked')}
                            </p>
                          ) : (
                            <ul className="flex flex-wrap gap-1.5">
                              {slots.map((it, i) => (
                                <li
                                  key={i}
                                  className="bg-brand-sage-soft text-brand-sage num rounded-md px-2 py-1 text-[11px] font-semibold"
                                >
                                  {intervalLabel(it)}
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}

          <p className="text-muted-foreground mt-3 text-xs">{t('visits.free_slots.note')}</p>
        </div>
      ) : null}
    </section>
  )
}
