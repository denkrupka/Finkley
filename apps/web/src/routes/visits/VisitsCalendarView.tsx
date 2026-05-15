import { addDays, format, isSameDay, parseISO, startOfDay } from 'date-fns'
import { ru } from 'date-fns/locale'
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Maximize2,
  Minimize2,
  UserX,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useClients } from '@/hooks/useClients'
import { useSalon } from '@/hooks/useSalons'
import { useSalonHolidays } from '@/hooks/useSalonHours'
import { useServices } from '@/hooks/useServices'
import {
  useCreateStaffBlock,
  useDeleteStaffBlock,
  useStaffBlocks,
  type StaffBlockKind,
} from '@/hooks/useStaffBlocks'
import { useStaff, type WeeklySchedule } from '@/hooks/useStaff'
import { useVisits, type VisitRow } from '@/hooks/useVisits'
import { cn } from '@/lib/utils/cn'

import { VisitDetailModal } from './VisitDetailModal'
import { MiniMonthCalendar } from './MiniMonthCalendar'

// =============================================================================
// Конфиг сетки
// =============================================================================
/** Fallback бизнес-окно, если ни у одного мастера нет расписания. */
const FALLBACK_HOUR_START = 9
const FALLBACK_HOUR_END = 20
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
  const { data: holidays = [] } = useSalonHolidays(salonId)
  const { data: blocks = [] } = useStaffBlocks(salonId, range)
  const createBlock = useCreateStaffBlock(salonId)
  const deleteBlock = useDeleteStaffBlock(salonId)

  // Если текущий день — праздник, показываем поверх grid'а полупрозрачную
  // плашку с надписью «Выходной: <name>». Не блокируем создание визитов
  // программно (юзер может всё равно записать клиента) — только визуально.
  const todayIso =
    cursor.getFullYear() +
    '-' +
    String(cursor.getMonth() + 1).padStart(2, '0') +
    '-' +
    String(cursor.getDate()).padStart(2, '0')
  const holidayToday = holidays.find((h) => h.date === todayIso)
  // Календарь — это про услуги (kind='visit'). Retail-продажи у нас в /income → Sales
  // и не имеют времени визита по смыслу — их в календарь рисовать не надо.
  const { data: visits = [] } = useVisits(salonId, range, { kind: 'visit' })

  const [editingVisit, setEditingVisit] = useState<VisitRow | null>(null)
  // Клик по 15-мин подслоту — открываем popover с 3 действиями.
  const [subslotMenu, setSubslotMenu] = useState<{
    staffId: string
    when: Date
    rect: { top: number; left: number }
  } | null>(null)
  /** Fullscreen-overlay: разворачиваем календарь во весь viewport. Сделано через
   *  fixed-positioning + z-index, а не через Fullscreen API — это надёжнее
   *  кросс-браузерно (iOS Safari не поддерживает Fullscreen API на iPhone) и
   *  не запрещает работу остальных оверлеев типа sonner toasts/Radix dialogs. */
  const [isFullscreen, setIsFullscreen] = useState(false)

  // ESC выходит из fullscreen.
  useEffect(() => {
    if (!isFullscreen) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setIsFullscreen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isFullscreen])

  /**
   * Создаёт staff_time_block из текущего subslotMenu. Дефолтная длительность —
   * 30 минут (можно отредактировать руками после создания).
   */
  function createTimeBlock(kind: StaffBlockKind) {
    if (!subslotMenu) return
    const starts = subslotMenu.when
    const ends = new Date(starts.getTime() + 30 * 60 * 1000)
    createBlock.mutate(
      {
        staff_id: subslotMenu.staffId,
        kind,
        starts_at: starts.toISOString(),
        ends_at: ends.toISOString(),
        label: null,
      },
      {
        onSuccess: () =>
          toast.success(
            kind === 'reservation'
              ? t('visits.calendar.subslot.toast_reserved')
              : t('visits.calendar.subslot.toast_absence'),
          ),
        onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
      },
    )
    setSubslotMenu(null)
  }

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

  // Бизнес-окно вычисляется по расписанию мастеров на текущий день,
  // чтобы календарь умещался без вертикального скролла. Pad ±30 мин по краям.
  const { HOUR_START, HOUR_END } = useMemo(() => {
    let minStart = Infinity
    let maxEnd = -Infinity
    for (const s of staff) {
      const sched = s.weekly_schedule?.[dayKey]
      if (!sched || sched.off) continue
      minStart = Math.min(minStart, parseHHMM(sched.start))
      maxEnd = Math.max(maxEnd, parseHHMM(sched.end))
    }
    if (!Number.isFinite(minStart) || !Number.isFinite(maxEnd)) {
      return { HOUR_START: FALLBACK_HOUR_START, HOUR_END: FALLBACK_HOUR_END }
    }
    const hs = Math.max(0, Math.floor((minStart - 30) / 60))
    const he = Math.min(24, Math.ceil((maxEnd + 30) / 60))
    return { HOUR_START: hs, HOUR_END: he }
  }, [staff, dayKey])

  const TOTAL_MIN = (HOUR_END - HOUR_START) * 60

  // PX_PER_MIN адаптируется под доступную высоту, чтобы всё умещалось без
  // вертикального скролла. Резерв 64px на header-row с аватарами + 16px паддинг.
  const gridScrollRef = useRef<HTMLDivElement>(null)
  const [containerHeight, setContainerHeight] = useState(0)
  useEffect(() => {
    const el = gridScrollRef.current
    if (!el) return
    const update = () => setContainerHeight(el.clientHeight)
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const availableH = Math.max(300, containerHeight - 64 - 16)
  // Кламп: не сжимаем слишком тонко (subslot < 12px нечитаемо) и не растягиваем
  // больше 1.4px/мин (выглядит водянисто на больших экранах).
  const PX_PER_MIN = Math.min(1.4, Math.max(0.8, availableH / TOTAL_MIN))

  const pxTopForMinutes = (minFromMidnight: number): number =>
    (minFromMidnight - HOUR_START * 60) * PX_PER_MIN

  // Текущее время — обновляем раз в минуту для красной линии
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(id)
  }, [])
  const nowMinutes = today ? minutesFromMidnight(now) : null
  const nowInsideGrid =
    nowMinutes != null && nowMinutes >= HOUR_START * 60 && nowMinutes < HOUR_END * 60

  // Хук-helper: возвращает duration в минутах для конкретного визита
  const durationFor = (v: VisitRow): number => {
    if (!v.service_id) return DEFAULT_DURATION_MIN
    const svc = serviceById.get(v.service_id)
    return svc?.default_duration_min ?? DEFAULT_DURATION_MIN
  }

  const hourLines = Array.from({ length: HOUR_END - HOUR_START + 1 }, (_, i) => HOUR_START + i)

  return (
    <div
      className={cn(
        'flex flex-col',
        isFullscreen ? 'bg-background fixed inset-0 z-[60] flex-1' : 'flex-1',
      )}
    >
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
        <Button
          variant="outline"
          size="sm"
          onClick={() => setIsFullscreen((v) => !v)}
          title={
            isFullscreen
              ? t('visits.calendar.fullscreen_exit')
              : t('visits.calendar.fullscreen_enter')
          }
          aria-label={
            isFullscreen
              ? t('visits.calendar.fullscreen_exit')
              : t('visits.calendar.fullscreen_enter')
          }
        >
          {isFullscreen ? (
            <Minimize2 className="size-4" strokeWidth={2} />
          ) : (
            <Maximize2 className="size-4" strokeWidth={2} />
          )}
        </Button>
      </div>

      {holidayToday ? (
        <div className="flex items-center gap-2 border-b border-amber-300 bg-amber-50 px-4 py-2 text-amber-900">
          <span className="text-sm font-semibold">
            {t('visits.calendar.holiday_today', { label: holidayToday.label })}
          </span>
        </div>
      ) : null}

      {staff.length === 0 ? (
        <div className="p-6">
          <p className="text-muted-foreground text-sm">{t('visits.calendar.no_staff')}</p>
        </div>
      ) : (
        <div className="flex flex-1 overflow-hidden">
          {/* Time-axis + staff-columns wrapper. По вертикали — НЕ скроллим
              (рассчитываем PX_PER_MIN так, чтобы всё умещалось), по горизонтали
              скролл если мастеров много. */}
          <div
            ref={gridScrollRef}
            className="flex-1 overflow-x-auto overflow-y-hidden"
            style={{ scrollBehavior: 'auto' }}
          >
            <div
              className="relative grid h-full"
              style={{
                gridTemplateColumns: `${TIME_AXIS_WIDTH_PX}px repeat(${staff.length}, ${COL_WIDTH_PX}px)`,
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
                              const POPOVER_W = 240
                              const POPOVER_H = 180
                              const padding = 8
                              // Popover у нас position:fixed → координаты viewport,
                              // window.scrollY НЕ добавляем (иначе уезжает вниз при
                              // любом скролле страницы).
                              const leftClamped = Math.min(
                                rect.left,
                                window.innerWidth - POPOVER_W - padding,
                              )
                              const spaceBelow = window.innerHeight - rect.bottom
                              const topRaw =
                                spaceBelow >= POPOVER_H ? rect.bottom : rect.top - POPOVER_H
                              setSubslotMenu({
                                staffId: s.id,
                                when,
                                rect: { top: topRaw, left: Math.max(padding, leftClamped) },
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

                    {/* Staff-blocks (резервы и отсутствия) — отрисовка поверх
                        ячеек со штриховкой. По клику — удаляются. */}
                    {blocks
                      .filter((b) => b.staff_id === s.id)
                      .map((b) => {
                        const blockStart = parseISO(b.starts_at)
                        const blockEnd = parseISO(b.ends_at)
                        const startMin = minutesFromMidnight(blockStart)
                        const endMin = minutesFromMidnight(blockEnd)
                        if (
                          !isSameDay(blockStart, cursor) ||
                          endMin <= HOUR_START * 60 ||
                          startMin >= HOUR_END * 60
                        )
                          return null
                        const visibleStart = Math.max(startMin, HOUR_START * 60)
                        const visibleEnd = Math.min(endMin, HOUR_END * 60)
                        const top = pxTopForMinutes(visibleStart)
                        const height = Math.max(16, (visibleEnd - visibleStart) * PX_PER_MIN)
                        const isReservation = b.kind === 'reservation'
                        return (
                          <button
                            key={b.id}
                            type="button"
                            onClick={() => {
                              if (
                                !confirm(
                                  t(
                                    isReservation
                                      ? 'visits.calendar.confirm_remove_reservation'
                                      : 'visits.calendar.confirm_remove_absence',
                                  ),
                                )
                              )
                                return
                              deleteBlock.mutate(b.id, {
                                onSuccess: () =>
                                  toast.success(t('visits.calendar.toast_block_removed')),
                              })
                            }}
                            className="absolute inset-x-1 z-10 rounded-md border border-dashed text-left text-[10px] font-semibold"
                            style={{
                              top,
                              height,
                              borderColor: isReservation ? '#94a3b8' : '#f59e0b',
                              background: isReservation
                                ? 'repeating-linear-gradient(45deg, rgba(148,163,184,0.18), rgba(148,163,184,0.18) 6px, rgba(148,163,184,0.05) 6px, rgba(148,163,184,0.05) 12px)'
                                : 'repeating-linear-gradient(45deg, rgba(245,158,11,0.22), rgba(245,158,11,0.22) 6px, rgba(245,158,11,0.06) 6px, rgba(245,158,11,0.06) 12px)',
                              color: isReservation ? '#475569' : '#92400e',
                            }}
                            title={
                              b.label ??
                              t(
                                isReservation
                                  ? 'visits.calendar.subslot.reserve_time'
                                  : 'visits.calendar.subslot.absence',
                              )
                            }
                          >
                            <span className="block truncate px-1 py-0.5">
                              {isReservation
                                ? t('visits.calendar.subslot.reserve_time')
                                : t('visits.calendar.subslot.absence')}
                            </span>
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

      <VisitDetailModal
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
                window.dispatchEvent(
                  new CustomEvent('finsalon:open-quick-entry', {
                    detail: {
                      staffId: subslotMenu.staffId,
                      when: subslotMenu.when.toISOString(),
                    },
                  }),
                )
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
                createTimeBlock('reservation')
              }}
              className="text-foreground hover:bg-muted/50 flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm"
            >
              <Clock className="text-muted-foreground size-4" strokeWidth={2} />
              {t('visits.calendar.subslot.reserve_time')}
            </button>
            <button
              type="button"
              onClick={() => {
                createTimeBlock('absence')
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
