import { addDays, format, isSameDay, parseISO, startOfDay } from 'date-fns'
import { ru } from 'date-fns/locale'
import { CheckCircle2, ChevronLeft, ChevronRight, Clock, UserX } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useClients } from '@/hooks/useClients'
import { useSalon } from '@/hooks/useSalons'
import { useServices } from '@/hooks/useServices'
import { useStaff, type WeeklySchedule } from '@/hooks/useStaff'
import { useVisits, type VisitRow } from '@/hooks/useVisits'
import { cn } from '@/lib/utils/cn'

import { EditVisitModal } from './EditVisitModal'
import { MiniMonthCalendar } from './MiniMonthCalendar'

// =============================================================================
// Конфиг сетки
// =============================================================================
/** Бизнес-окно — какие часы показываем на оси. Если у конкретного мастера
 *  смена выходит за это окно, его working-hours штриховка просто обрежется. */
const HOUR_START = 8
const HOUR_END = 22 // exclusive
const TOTAL_MIN = (HOUR_END - HOUR_START) * 60
/** Высота 1 минуты в px. Подбирал по Booksy — 72px/час даёт читабельные слоты. */
const PX_PER_MIN = 1.2
/** Default длительность визита если у услуги не задано duration_min. 60 мин —
 *  типичная длительность услуги в beauty-салоне (Booksy/wFirma часто не
 *  отдают duration при импорте). */
const DEFAULT_DURATION_MIN = 60
/** Минимальная длительность субслота — 15 мин (как в Booksy/Versum). */
const SUBSLOT_MIN = 15
const COL_WIDTH_PX = 200
const TIME_AXIS_WIDTH_PX = 64

// Палитра пастельных фонов для staff-колонок (как в Booksy).
const STAFF_PALETTE = [
  { bg: 'rgba(196, 224, 232, 0.45)', accent: '#1E6B8A' }, // blue
  { bg: 'rgba(232, 224, 196, 0.45)', accent: '#C9A24B' }, // amber
  { bg: 'rgba(196, 232, 210, 0.45)', accent: '#2E9E6B' }, // sage
  { bg: 'rgba(232, 196, 224, 0.45)', accent: '#A678D9' }, // violet
  { bg: 'rgba(232, 212, 196, 0.45)', accent: '#D97757' }, // peach
  { bg: 'rgba(212, 196, 232, 0.45)', accent: '#7C3AED' }, // lavender
]

const DAY_KEYS: Array<keyof WeeklySchedule> = [
  'sun', // JS getDay() returns 0=Sun..6=Sat — индекс совпадает с этим массивом
  'mon',
  'tue',
  'wed',
  'thu',
  'fri',
  'sat',
]

function minutesFromMidnight(d: Date): number {
  return d.getHours() * 60 + d.getMinutes()
}

function parseHHMM(s: string): number {
  const [h, m] = s.split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}

/** Top-offset в px на time-grid'е для конкретного количества минут от полуночи. */
function pxTopForMinutes(minFromMidnight: number): number {
  return (minFromMidnight - HOUR_START * 60) * PX_PER_MIN
}

// =============================================================================
// Component
// =============================================================================

export function VisitsCalendarView({ salonId }: { salonId: string }) {
  const { t } = useTranslation()
  const [cursor, setCursor] = useState(() => startOfDay(new Date()))
  const dayStart = startOfDay(cursor)
  const dayEnd = addDays(dayStart, 1)
  const range = { start: dayStart.toISOString(), end: dayEnd.toISOString() }

  const { data: salon } = useSalon(salonId)
  const { data: staff = [] } = useStaff(salonId)
  const { data: services = [] } = useServices(salonId)
  const { data: clients = [] } = useClients(salonId)
  const { data: visits = [] } = useVisits(salonId, range)

  const [editingVisit, setEditingVisit] = useState<VisitRow | null>(null)
  // Клик по 15-мин подслоту — открываем popover с 3 действиями.
  const [subslotMenu, setSubslotMenu] = useState<{
    staffId: string
    when: Date
    rect: { top: number; left: number }
  } | null>(null)

  const serviceById = useMemo(() => new Map(services.map((s) => [s.id, s])), [services])
  const clientById = useMemo(() => new Map(clients.map((c) => [c.id, c])), [clients])
  const visitsByStaff = useMemo(() => {
    const m = new Map<string, VisitRow[]>()
    for (const v of visits) {
      const key = v.staff_id ?? 'unassigned'
      const arr = m.get(key) ?? []
      arr.push(v)
      m.set(key, arr)
    }
    return m
  }, [visits])

  const dayKey = DAY_KEYS[cursor.getDay()]!
  const today = isSameDay(cursor, new Date())

  // Текущее время — обновляем раз в минуту для красной линии
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(id)
  }, [])
  const nowMinutes = today ? minutesFromMidnight(now) : null
  const nowInsideGrid =
    nowMinutes != null && nowMinutes >= HOUR_START * 60 && nowMinutes < HOUR_END * 60

  // Auto-scroll to current time (или 9:00 если today вне рабочих часов).
  // Делаем один раз при mount + при смене даты.
  const gridScrollRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!gridScrollRef.current) return
    const targetMin = today && nowInsideGrid ? nowMinutes! - 60 : 9 * 60 - HOUR_START * 60
    const px = Math.max(0, pxTopForMinutes(HOUR_START * 60 + Math.max(0, targetMin)))
    gridScrollRef.current.scrollTop = px
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dayStart.getTime()])

  // Хук-helper: возвращает duration в минутах для конкретного визита
  const durationFor = (v: VisitRow): number => {
    if (!v.service_id) return DEFAULT_DURATION_MIN
    const svc = serviceById.get(v.service_id)
    return svc?.default_duration_min ?? DEFAULT_DURATION_MIN
  }

  const hourLines = Array.from({ length: HOUR_END - HOUR_START + 1 }, (_, i) => HOUR_START + i)

  return (
    <div className="flex flex-1 flex-col">
      {/* Шапка с навигацией по дням */}
      <div className="border-border bg-card flex items-center justify-between gap-3 border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setCursor((c) => addDays(c, -1))}>
            <ChevronLeft className="size-4" strokeWidth={2} />
          </Button>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm">
                {t('visits.calendar.today')}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="center" className="w-auto p-3">
              <MiniMonthCalendar value={cursor} onChange={(d) => setCursor(startOfDay(d))} />
            </PopoverContent>
          </Popover>
          <Button variant="outline" size="sm" onClick={() => setCursor((c) => addDays(c, 1))}>
            <ChevronRight className="size-4" strokeWidth={2} />
          </Button>
        </div>
        <h2 className="text-brand-navy text-base font-bold tracking-tight">
          {format(cursor, 'EEEE, d MMMM yyyy', { locale: ru })}
        </h2>
        <div />
      </div>

      {staff.length === 0 ? (
        <div className="p-6">
          <p className="text-muted-foreground text-sm">{t('visits.calendar.no_staff')}</p>
        </div>
      ) : (
        <div className="flex flex-1 overflow-hidden">
          {/* Time-axis + staff-columns wrapper */}
          <div
            ref={gridScrollRef}
            className="flex-1 overflow-auto"
            style={{ scrollBehavior: 'auto' }}
          >
            <div
              className="relative grid"
              style={{
                gridTemplateColumns: `${TIME_AXIS_WIDTH_PX}px repeat(${staff.length}, ${COL_WIDTH_PX}px)`,
                minHeight: TOTAL_MIN * PX_PER_MIN + 48,
              }}
            >
              {/* Sticky header row с аватарами мастеров */}
              <div
                className="bg-card sticky top-0 z-30"
                style={{ gridColumn: '1 / -1', display: 'contents' }}
              >
                <div
                  className="bg-card border-border sticky top-0 z-30 border-b border-r"
                  style={{ height: 64 }}
                />
                {staff.map((s, i) => {
                  const palette = STAFF_PALETTE[i % STAFF_PALETTE.length]!
                  const sched = s.weekly_schedule?.[dayKey]
                  const initials = s.full_name
                    .split(' ')
                    .map((p) => p[0])
                    .filter(Boolean)
                    .slice(0, 2)
                    .join('')
                    .toUpperCase()
                  return (
                    <div
                      key={s.id}
                      className="border-border bg-card sticky top-0 z-30 flex items-center gap-2 border-b border-r px-3"
                      style={{ height: 64 }}
                    >
                      <div
                        className="grid size-9 shrink-0 place-items-center rounded-full text-xs font-bold"
                        style={{ background: palette.bg, color: palette.accent }}
                      >
                        {initials || '?'}
                      </div>
                      <div className="min-w-0">
                        <p className="text-foreground truncate text-sm font-semibold">
                          {s.full_name}
                        </p>
                        <p className="text-muted-foreground text-xs">
                          {sched && !sched.off
                            ? `${sched.start} – ${sched.end}`
                            : t('visits.calendar.day_off')}
                        </p>
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* Time-axis (левая колонка) — отрисуем как абсолютные метки внутри */}
              <div
                className="border-border relative border-r"
                style={{
                  gridColumn: 1,
                  gridRow: 2,
                  height: TOTAL_MIN * PX_PER_MIN,
                }}
              >
                {hourLines.map((h) => (
                  <div
                    key={h}
                    className="text-muted-foreground absolute -translate-y-1/2 pr-2 text-right text-[11px]"
                    style={{
                      top: pxTopForMinutes(h * 60),
                      width: TIME_AXIS_WIDTH_PX,
                    }}
                  >
                    {String(h).padStart(2, '0')}:00
                  </div>
                ))}
              </div>

              {/* Staff-колонки с событиями */}
              {staff.map((s, i) => {
                const palette = STAFF_PALETTE[i % STAFF_PALETTE.length]!
                const sched = s.weekly_schedule?.[dayKey]
                const staffVisits = visitsByStaff.get(s.id) ?? []
                const workStart = sched && !sched.off ? parseHHMM(sched.start) : null
                const workEnd = sched && !sched.off ? parseHHMM(sched.end) : null
                return (
                  <div
                    key={s.id}
                    className="border-border relative border-r"
                    style={{
                      gridColumn: i + 2,
                      gridRow: 2,
                      height: TOTAL_MIN * PX_PER_MIN,
                    }}
                  >
                    {/* Нерабочее время — diagonal-stripes overlay */}
                    {workStart != null && workEnd != null ? (
                      <>
                        {/* Перед сменой */}
                        {workStart > HOUR_START * 60 ? (
                          <div
                            className="absolute inset-x-0 top-0"
                            style={{
                              height: pxTopForMinutes(workStart),
                              background:
                                'repeating-linear-gradient(45deg, rgba(0,0,0,0.04), rgba(0,0,0,0.04) 6px, transparent 6px, transparent 12px)',
                            }}
                          />
                        ) : null}
                        {/* После смены */}
                        {workEnd < HOUR_END * 60 ? (
                          <div
                            className="absolute inset-x-0"
                            style={{
                              top: pxTopForMinutes(workEnd),
                              bottom: 0,
                              background:
                                'repeating-linear-gradient(45deg, rgba(0,0,0,0.04), rgba(0,0,0,0.04) 6px, transparent 6px, transparent 12px)',
                            }}
                          />
                        ) : null}
                      </>
                    ) : (
                      /* Off — вся колонка штриховкой */
                      <div
                        className="absolute inset-0"
                        style={{
                          background:
                            'repeating-linear-gradient(45deg, rgba(0,0,0,0.04), rgba(0,0,0,0.04) 6px, transparent 6px, transparent 12px)',
                        }}
                      />
                    )}

                    {/* Горизонтальные часовые линии */}
                    {hourLines.map((h) => (
                      <div
                        key={h}
                        className="border-border absolute inset-x-0 border-t"
                        style={{ top: pxTopForMinutes(h * 60) }}
                      />
                    ))}

                    {/* 15-минутные пунктирные линии — визуальный hint для подслотов */}
                    {Array.from(
                      { length: (HOUR_END - HOUR_START) * (60 / SUBSLOT_MIN) },
                      (_, idx) => {
                        if (idx % (60 / SUBSLOT_MIN) === 0) return null // часовая уже отрисована выше
                        const min = HOUR_START * 60 + idx * SUBSLOT_MIN
                        return (
                          <div
                            key={`sub-${idx}`}
                            className="border-border/40 pointer-events-none absolute inset-x-0 border-t border-dashed"
                            style={{ top: pxTopForMinutes(min) }}
                          />
                        )
                      },
                    )}

                    {/* Кликабельный overlay подслотов — каждые 15 минут */}
                    {Array.from(
                      { length: (HOUR_END - HOUR_START) * (60 / SUBSLOT_MIN) },
                      (_, idx) => {
                        const minFromMidnight = HOUR_START * 60 + idx * SUBSLOT_MIN
                        return (
                          <button
                            key={`hit-${idx}`}
                            type="button"
                            aria-label={t('visits.calendar.new_at_time')}
                            onClick={(e) => {
                              const rect = (
                                e.currentTarget as HTMLButtonElement
                              ).getBoundingClientRect()
                              const when = new Date(dayStart)
                              when.setHours(0, 0, 0, 0)
                              when.setMinutes(minFromMidnight)
                              setSubslotMenu({
                                staffId: s.id,
                                when,
                                rect: { top: rect.bottom + window.scrollY, left: rect.left },
                              })
                            }}
                            className="hover:bg-foreground/[0.03] absolute inset-x-0 cursor-pointer transition-colors"
                            style={{
                              top: pxTopForMinutes(minFromMidnight),
                              height: SUBSLOT_MIN * PX_PER_MIN,
                            }}
                          />
                        )
                      },
                    )}

                    {/* Карточки визитов */}
                    {staffVisits.map((v) => {
                      const visitDate = parseISO(v.visit_at)
                      const startMin = minutesFromMidnight(visitDate)
                      const dur = durationFor(v)
                      if (startMin + dur < HOUR_START * 60 || startMin >= HOUR_END * 60) {
                        // Полностью за пределами окна — не рисуем
                        return null
                      }
                      const top = pxTopForMinutes(Math.max(startMin, HOUR_START * 60))
                      const visibleStart = Math.max(startMin, HOUR_START * 60)
                      const visibleEnd = Math.min(startMin + dur, HOUR_END * 60)
                      const height = Math.max(20, (visibleEnd - visibleStart) * PX_PER_MIN)
                      const svc = v.service_id ? serviceById.get(v.service_id) : null
                      return (
                        <button
                          key={v.id}
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            setEditingVisit(v)
                          }}
                          className={cn(
                            'group absolute inset-x-1 z-[5] cursor-pointer overflow-hidden rounded-md border-l-4 px-2 py-1 text-left transition-all hover:z-10 hover:shadow-md',
                            v.status === 'cancelled' && 'opacity-50',
                          )}
                          style={{
                            top,
                            height,
                            background: palette.bg,
                            borderLeftColor: palette.accent,
                          }}
                          title={`${format(visitDate, 'HH:mm')} · ${
                            (v.client_id && clientById.get(v.client_id)?.name) ??
                            t('visits.calendar.walk_in')
                          }`}
                        >
                          {/* $-индикатор оплаченного визита (правый верхний угол) */}
                          {v.status === 'paid' ? (
                            <CheckCircle2
                              className="text-brand-sage-deep absolute right-1 top-1 size-3.5"
                              strokeWidth={2.4}
                              aria-label={t('visits.status_paid')}
                            />
                          ) : null}
                          <p className="num text-foreground/80 truncate text-[11px] font-semibold leading-tight">
                            {format(visitDate, 'HH:mm', { locale: ru })} –{' '}
                            {format(new Date(visitDate.getTime() + dur * 60000), 'HH:mm', {
                              locale: ru,
                            })}
                          </p>
                          <p className="text-foreground truncate text-xs font-semibold">
                            {(v.client_id && clientById.get(v.client_id)?.name) ??
                              t('visits.calendar.walk_in')}
                          </p>
                          <p className="text-muted-foreground truncate text-[11px]">
                            {svc?.name ?? v.service_name_snapshot ?? '—'}
                          </p>
                        </button>
                      )
                    })}

                    {/* Текущее время — красная линия */}
                    {nowInsideGrid ? (
                      <div
                        className="pointer-events-none absolute inset-x-0 z-20"
                        style={{ top: pxTopForMinutes(nowMinutes!) }}
                      >
                        <div className="bg-destructive relative h-px">
                          <span className="bg-destructive absolute -left-1 -top-1 block size-2 rounded-full" />
                        </div>
                      </div>
                    ) : null}
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}

      <EditVisitModal
        visit={editingVisit}
        onClose={() => setEditingVisit(null)}
        salonId={salonId}
        currency={salon?.currency ?? 'PLN'}
      />

      {/* Popover для клика по 15-мин подслоту. Позиционируется абсолютно
          относительно клика (boundingClientRect.bottom). Закрывается на
          клик-вне. */}
      {subslotMenu ? (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setSubslotMenu(null)} aria-hidden />
          <div
            className="border-border bg-card shadow-finxl fixed z-50 w-[240px] rounded-lg border p-2"
            style={{
              top: subslotMenu.rect.top,
              left: subslotMenu.rect.left,
            }}
          >
            <p className="text-muted-foreground border-border mb-1.5 border-b px-2 pb-1.5 text-[11px] uppercase tracking-wider">
              {format(subslotMenu.when, 'd MMM, HH:mm', { locale: ru })} ·{' '}
              {staff.find((s) => s.id === subslotMenu.staffId)?.full_name ?? ''}
            </p>
            <button
              type="button"
              onClick={() => {
                window.dispatchEvent(new CustomEvent('finsalon:open-quick-entry'))
                setSubslotMenu(null)
              }}
              className="text-foreground hover:bg-muted/50 flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm font-semibold"
            >
              <ChevronRight className="text-secondary size-4" strokeWidth={2.2} />
              {t('visits.calendar.subslot.new_visit')}
            </button>
            <button
              type="button"
              onClick={() => {
                toast.info(t('visits.calendar.subslot.coming_soon'))
                setSubslotMenu(null)
              }}
              className="text-foreground hover:bg-muted/50 flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm"
            >
              <Clock className="text-muted-foreground size-4" strokeWidth={2} />
              {t('visits.calendar.subslot.reserve_time')}
            </button>
            <button
              type="button"
              onClick={() => {
                toast.info(t('visits.calendar.subslot.coming_soon'))
                setSubslotMenu(null)
              }}
              className="text-foreground hover:bg-muted/50 flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm"
            >
              <UserX className="text-muted-foreground size-4" strokeWidth={2} />
              {t('visits.calendar.subslot.absence')}
            </button>
          </div>
        </>
      ) : null}
    </div>
  )
}
