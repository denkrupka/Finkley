import {
  addDays,
  addMonths,
  differenceInCalendarDays,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  isWithinInterval,
  startOfMonth,
  startOfWeek,
} from 'date-fns'
import { ru } from 'date-fns/locale'
import {
  AlertTriangle,
  CalendarCheck,
  CalendarClock,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Plus,
  Trash2,
  Wallet,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  useDeleteScheduledPayment,
  useScheduledPayments,
  type ScheduledPaymentRow,
} from '@/hooks/useScheduledPayments'
import { useSalon } from '@/hooks/useSalons'
import { cn } from '@/lib/utils/cn'
import { formatCurrency } from '@/lib/utils/format-currency'
import { ExpenseFormModal, type ExpenseFormMode } from '@/routes/expenses/ExpenseFormModal'

type PaymentTone = 'overdue' | 'today' | 'pending' | 'paid'

function classifyPayment(p: ScheduledPaymentRow, todayStr: string): PaymentTone {
  if (p.status === 'paid') return 'paid'
  if (p.due_date < todayStr) return 'overdue'
  if (p.due_date === todayStr) return 'today'
  return 'pending'
}

const TONE_CHIP: Record<PaymentTone, string> = {
  overdue: 'bg-rose-100 text-rose-800 border-rose-200',
  today: 'bg-amber-100 text-amber-900 border-amber-200',
  pending: 'bg-sky-100 text-sky-800 border-sky-200',
  paid: 'bg-emerald-50 text-emerald-700 border-emerald-200 line-through opacity-70',
}

const TONE_DOT: Record<PaymentTone, string> = {
  overdue: 'bg-rose-500',
  today: 'bg-amber-500',
  pending: 'bg-sky-500',
  paid: 'bg-emerald-500',
}

/**
 * MetricCard — карточка с цветной полоской-акцентом слева. Шапка платёжного
 * календаря (Просрочено / Эта неделя / Этот месяц / Оплачено).
 */
function MetricCard({
  icon,
  label,
  value,
  hint,
  tone,
}: {
  icon: React.ReactNode
  label: string
  value: string
  hint: string
  tone: 'red' | 'amber' | 'blue' | 'sage'
}) {
  const accent: Record<typeof tone, { stripe: string; text: string; iconBg: string }> = {
    red: { stripe: 'bg-rose-400', text: 'text-rose-600', iconBg: 'bg-rose-50 text-rose-500' },
    amber: {
      stripe: 'bg-amber-400',
      text: 'text-amber-700',
      iconBg: 'bg-amber-50 text-amber-600',
    },
    blue: { stripe: 'bg-sky-500', text: 'text-sky-700', iconBg: 'bg-sky-50 text-sky-600' },
    sage: {
      stripe: 'bg-emerald-500',
      text: 'text-emerald-700',
      iconBg: 'bg-emerald-50 text-emerald-600',
    },
  }
  const a = accent[tone]
  return (
    <div className="shadow-finsm flex overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div className={`w-1 shrink-0 ${a.stripe}`} />
      <div className="flex-1 p-3">
        <div className="flex items-center gap-2">
          <span className={`rounded-md p-1.5 ${a.iconBg}`}>{icon}</span>
          <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            {label}
          </span>
        </div>
        <div className={`num mt-2 text-lg font-bold leading-tight ${a.text}`}>{value}</div>
        <p className="mt-1 text-[10px] text-slate-500">{hint}</p>
      </div>
    </div>
  )
}

/** Компактный амаунт для подписи в ячейке календаря (например, «1,2k zł»). */
function compactAmount(cents: number, currency: string): string {
  const abs = Math.abs(cents) / 100
  if (abs >= 10_000) {
    return `${(abs / 1000).toFixed(abs >= 100_000 ? 0 : 1).replace('.', ',')}k ${currency}`
  }
  return formatCurrency(cents, currency).replace(/\s/g, ' ')
}

/**
 * Контент таба «Платёжный календарь» страницы /finance. Месячный grid
 * с платежами по дням + боковая панель с детализацией выбранного дня
 * + 4 метрика-карточки сверху.
 *
 * Создание/оплата платежей — через универсальную `ExpenseFormModal` с
 * пропом `mode`:
 *   - 'planned-new'    — новый платёж (с переключателем Оплачено/Не оплачено)
 *   - 'planned-paying' — оплата существующего pending платежа (префилл из row)
 *
 * MVP: только manual-источник (юзер вручную вводит счёт). Auto-import из
 * wFirma/Fakturownia при sync — отдельный спринт.
 */
export function PaymentsTab({ salonId }: { salonId: string }) {
  const { t } = useTranslation()
  const { data: salon } = useSalon(salonId)
  const currency = salon?.currency ?? 'PLN'

  const { data: payments = [], isLoading } = useScheduledPayments(salonId)
  const deletePmt = useDeleteScheduledPayment(salonId)

  // Состояние модалки расхода: режим + контекст (дата для нового или existing
  // платёж для mark-as-paid). null = модалка закрыта.
  const [modal, setModal] = useState<
    | { mode: 'planned-new'; date: string }
    | { mode: 'planned-paying'; payment: ScheduledPaymentRow }
    | null
  >(null)

  const now = useMemo(() => new Date(), [])
  const todayStr = useMemo(() => format(now, 'yyyy-MM-dd'), [now])
  const weekStart = useMemo(() => startOfWeek(now, { weekStartsOn: 1 }), [now])
  const weekEnd = useMemo(() => endOfWeek(now, { weekStartsOn: 1 }), [now])
  const monthStartNow = useMemo(() => startOfMonth(now), [now])
  const monthEndNow = useMemo(() => endOfMonth(now), [now])

  // Курсор месяца календаря (Date — первое число месяца).
  const [monthCursor, setMonthCursor] = useState<Date>(() => startOfMonth(now))
  // Выбранный день в правой панели. По умолчанию — сегодня.
  const [selectedDate, setSelectedDate] = useState<Date>(() => now)

  const pending = useMemo(() => payments.filter((p) => p.status === 'pending'), [payments])
  const overdue = useMemo(() => pending.filter((p) => p.due_date < todayStr), [pending, todayStr])
  const paidThisMonth = useMemo(
    () =>
      payments.filter(
        (p) =>
          p.status === 'paid' &&
          p.paid_at &&
          isWithinInterval(new Date(p.paid_at), { start: monthStartNow, end: monthEndNow }),
      ),
    [payments, monthStartNow, monthEndNow],
  )
  const dueThisWeek = useMemo(
    () =>
      pending.filter((p) =>
        isWithinInterval(new Date(p.due_date), { start: weekStart, end: weekEnd }),
      ),
    [pending, weekStart, weekEnd],
  )
  const dueThisMonth = useMemo(
    () =>
      pending.filter((p) =>
        isWithinInterval(new Date(p.due_date), { start: monthStartNow, end: monthEndNow }),
      ),
    [pending, monthStartNow, monthEndNow],
  )

  const totalOverdue = overdue.reduce((s, p) => s + p.amount_cents, 0)
  const totalWeek = dueThisWeek.reduce((s, p) => s + p.amount_cents, 0)
  const totalMonth = dueThisMonth.reduce((s, p) => s + p.amount_cents, 0)
  const totalPaidMonth = paidThisMonth.reduce((s, p) => s + p.amount_cents, 0)

  // Платежи, сгруппированные по дате (yyyy-MM-dd → массив). Для cell-renderer'а
  // календаря и для отбора платежей выбранного дня.
  const paymentsByDate = useMemo(() => {
    const map = new Map<string, ScheduledPaymentRow[]>()
    for (const p of payments) {
      const arr = map.get(p.due_date) ?? []
      arr.push(p)
      map.set(p.due_date, arr)
    }
    // Сортировка внутри дня: pending сверху, потом по сумме убывания.
    for (const arr of map.values()) {
      arr.sort((a, b) => {
        if (a.status !== b.status) return a.status === 'pending' ? -1 : 1
        return b.amount_cents - a.amount_cents
      })
    }
    return map
  }, [payments])

  const selectedDateStr = format(selectedDate, 'yyyy-MM-dd')
  const selectedDayPayments = paymentsByDate.get(selectedDateStr) ?? []

  // Сводка по выбранному месяцу календаря (для подписи под навигатором).
  const cursorMonthStart = startOfMonth(monthCursor)
  const cursorMonthEnd = endOfMonth(monthCursor)
  const cursorMonthPending = pending.filter((p) =>
    isWithinInterval(new Date(p.due_date), { start: cursorMonthStart, end: cursorMonthEnd }),
  )
  const cursorMonthTotal = cursorMonthPending.reduce((s, p) => s + p.amount_cents, 0)

  function handleAddForDate(dateStr: string) {
    setModal({ mode: 'planned-new', date: dateStr })
  }

  function handlePay(p: ScheduledPaymentRow) {
    setModal({ mode: 'planned-paying', payment: p })
  }

  function handleDelete(p: ScheduledPaymentRow) {
    if (!confirm(t('finance.payments.confirm_delete'))) return
    deletePmt.mutate(p.id, {
      onSuccess: () => toast.success(t('finance.payments.toast_deleted')),
    })
  }

  return (
    <div>
      <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-brand-navy text-lg font-bold tracking-tight">
            {t('finance.payments.title')}
          </h2>
          <p className="text-muted-foreground mt-1 text-sm">{t('finance.payments.subtitle')}</p>
        </div>
        <Button
          variant="primary"
          size="md"
          onClick={() => setModal({ mode: 'planned-new', date: todayStr })}
        >
          <Plus className="size-4" strokeWidth={2.4} />
          {t('finance.payments.add_button')}
        </Button>
      </div>

      {/* Metric cards: Просрочено / На этой неделе / Этот месяц / Оплачено */}
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <MetricCard
          tone="red"
          icon={<AlertTriangle className="size-4" strokeWidth={1.8} />}
          label={t('finance.payments.metric_overdue')}
          value={formatCurrency(totalOverdue, currency)}
          hint={t('finance.payments.summary_overdue_count', { count: overdue.length })}
        />
        <MetricCard
          tone="amber"
          icon={<CalendarClock className="size-4" strokeWidth={1.8} />}
          label={t('finance.payments.metric_week')}
          value={formatCurrency(totalWeek, currency)}
          hint={t('finance.payments.summary_upcoming_count', { count: dueThisWeek.length })}
        />
        <MetricCard
          tone="blue"
          icon={<CalendarCheck className="size-4" strokeWidth={1.8} />}
          label={t('finance.payments.metric_month')}
          value={formatCurrency(totalMonth, currency)}
          hint={t('finance.payments.summary_upcoming_count', { count: dueThisMonth.length })}
        />
        <MetricCard
          tone="sage"
          icon={<Wallet className="size-4" strokeWidth={1.8} />}
          label={t('finance.payments.metric_paid_month')}
          value={formatCurrency(totalPaidMonth, currency)}
          hint={t('finance.payments.summary_paid_count', { count: paidThisMonth.length })}
        />
      </div>

      {/* Баннер просроченных — виден когда курсор НЕ на месяце с первым овердюем */}
      {overdue.length > 0 ? (
        <button
          type="button"
          onClick={() => {
            const first = overdue[0]!
            const d = new Date(first.due_date)
            setMonthCursor(startOfMonth(d))
            setSelectedDate(d)
          }}
          className="shadow-finsm mb-4 flex w-full items-center justify-between gap-3 rounded-lg border border-rose-200 bg-rose-50 px-4 py-2.5 text-left transition-colors hover:bg-rose-100"
        >
          <span className="flex items-center gap-2.5">
            <AlertTriangle className="size-4 shrink-0 text-rose-600" strokeWidth={2} />
            <span className="text-sm font-semibold text-rose-800">
              {t('finance.payments.banner_overdue', {
                count: overdue.length,
                amount: formatCurrency(totalOverdue, currency),
              })}
            </span>
          </span>
          <span className="text-xs font-semibold text-rose-700 underline-offset-2 hover:underline">
            {t('finance.payments.banner_show')} →
          </span>
        </button>
      ) : null}

      {/* Calendar grid + side panel */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        {/* CALENDAR */}
        <section className="border-border bg-card shadow-finsm overflow-hidden rounded-xl border">
          {/* Header: ‹ Май 2026 › + Сегодня + сводка по месяцу */}
          <header className="border-border flex flex-col gap-2 border-b bg-gradient-to-r from-slate-50 to-white px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setMonthCursor((c) => addMonths(c, -1))}
                className="text-muted-foreground hover:bg-muted hover:text-foreground grid size-8 place-items-center rounded-md transition-colors"
                aria-label={t('common.prev')}
              >
                <ChevronLeft className="size-4" strokeWidth={2} />
              </button>
              <span className="text-brand-navy min-w-[170px] text-center text-base font-bold capitalize tracking-tight">
                {format(monthCursor, 'LLLL yyyy', { locale: ru })}
              </span>
              <button
                type="button"
                onClick={() => setMonthCursor((c) => addMonths(c, 1))}
                className="text-muted-foreground hover:bg-muted hover:text-foreground grid size-8 place-items-center rounded-md transition-colors"
                aria-label={t('common.next')}
              >
                <ChevronRight className="size-4" strokeWidth={2} />
              </button>
              <button
                type="button"
                onClick={() => {
                  setMonthCursor(startOfMonth(now))
                  setSelectedDate(now)
                }}
                className="border-border text-foreground hover:border-brand-teal hover:text-brand-teal-deep ml-1 rounded-md border px-2.5 py-1 text-xs font-semibold transition-colors"
              >
                {t('finance.payments.calendar_today')}
              </button>
            </div>
            <div className="flex items-center gap-3 text-xs">
              <span className="text-muted-foreground">
                {t('finance.payments.calendar_month_total', {
                  count: cursorMonthPending.length,
                })}
              </span>
              <span className="num text-foreground font-bold tabular-nums">
                {formatCurrency(cursorMonthTotal, currency)}
              </span>
            </div>
          </header>

          {/* Weekday header (Пн..Вс) */}
          <div className="border-border grid grid-cols-7 border-b bg-slate-50/60">
            {['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map((w, i) => (
              <div
                key={w}
                className={cn(
                  'py-2 text-center text-[10px] font-bold uppercase tracking-wider',
                  i >= 5 ? 'text-slate-400' : 'text-slate-500',
                )}
              >
                {w}
              </div>
            ))}
          </div>

          {/* Month grid */}
          {isLoading ? (
            <div className="text-muted-foreground p-6 text-sm">{t('common.loading')}</div>
          ) : (
            <MonthGrid
              monthCursor={monthCursor}
              today={now}
              selectedDate={selectedDate}
              onSelectDate={setSelectedDate}
              paymentsByDate={paymentsByDate}
              currency={currency}
              todayStr={todayStr}
            />
          )}
        </section>

        {/* SIDE PANEL: detail of selected day */}
        <aside className="border-border bg-card shadow-finsm flex flex-col overflow-hidden rounded-xl border">
          <header className="border-border flex items-center justify-between border-b bg-gradient-to-r from-slate-50 to-white px-4 py-3">
            <div className="flex flex-col">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                {isSameDay(selectedDate, now)
                  ? t('finance.payments.day_today')
                  : t('finance.payments.day_label')}
              </span>
              <span className="text-brand-navy text-sm font-bold capitalize tracking-tight">
                {format(selectedDate, 'd MMMM yyyy', { locale: ru })}
              </span>
            </div>
            <button
              type="button"
              onClick={() => handleAddForDate(selectedDateStr)}
              className="text-brand-teal-deep hover:bg-brand-teal-soft/40 grid size-8 place-items-center rounded-md transition-colors"
              title={t('finance.payments.add_for_day')}
              aria-label={t('finance.payments.add_for_day')}
            >
              <Plus className="size-4" strokeWidth={2.4} />
            </button>
          </header>

          <div className="flex-1 overflow-y-auto">
            {selectedDayPayments.length === 0 ? (
              <div className="flex flex-col items-center gap-3 px-4 py-10 text-center">
                <CalendarCheck className="text-muted-foreground/60 size-9" strokeWidth={1.4} />
                <p className="text-muted-foreground text-xs">{t('finance.payments.day_empty')}</p>
                <button
                  type="button"
                  onClick={() => handleAddForDate(selectedDateStr)}
                  className="text-brand-teal-deep hover:text-brand-teal text-xs font-semibold underline-offset-2 hover:underline"
                >
                  {t('finance.payments.add_for_day')}
                </button>
              </div>
            ) : (
              <ul className="divide-border divide-y">
                {selectedDayPayments.map((p) => {
                  const tone = classifyPayment(p, todayStr)
                  const daysDelta = differenceInCalendarDays(new Date(p.due_date), now)
                  return (
                    <li key={p.id} className="px-4 py-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span
                              className={cn('size-2 shrink-0 rounded-full', TONE_DOT[tone])}
                              aria-hidden
                            />
                            <span
                              className={cn(
                                'truncate text-sm font-semibold',
                                tone === 'paid'
                                  ? 'text-muted-foreground line-through'
                                  : 'text-foreground',
                              )}
                            >
                              {p.vendor_name ?? '—'}
                            </span>
                          </div>
                          {p.invoice_number || p.comment ? (
                            <p className="text-muted-foreground mt-0.5 line-clamp-2 text-[11px]">
                              {[p.invoice_number, p.comment].filter(Boolean).join(' · ')}
                            </p>
                          ) : null}
                          <p
                            className={cn(
                              'mt-1 text-[11px] font-semibold',
                              tone === 'overdue'
                                ? 'text-rose-600'
                                : tone === 'today'
                                  ? 'text-amber-700'
                                  : tone === 'paid'
                                    ? 'text-emerald-700'
                                    : 'text-sky-700',
                            )}
                          >
                            {tone === 'paid'
                              ? t('finance.payments.tone_paid')
                              : tone === 'overdue'
                                ? t('finance.payments.days_overdue', { n: -daysDelta })
                                : tone === 'today'
                                  ? t('finance.payments.today')
                                  : t('finance.payments.in_days', { n: daysDelta })}
                          </p>
                        </div>
                        <span
                          className={cn(
                            'num shrink-0 text-right text-sm font-bold tabular-nums',
                            tone === 'paid'
                              ? 'text-muted-foreground line-through'
                              : 'text-foreground',
                          )}
                        >
                          {formatCurrency(p.amount_cents, currency)}
                        </span>
                      </div>

                      {/* Actions */}
                      <div className="mt-2 flex items-center justify-end gap-1">
                        {p.status === 'pending' ? (
                          <button
                            type="button"
                            onClick={() => handlePay(p)}
                            className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-700 transition-colors hover:bg-emerald-100"
                          >
                            <CheckCircle2 className="size-3.5" strokeWidth={2} />
                            {t('finance.payments.mark_paid')}
                          </button>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => handleDelete(p)}
                          className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive grid size-7 place-items-center rounded-md transition-colors"
                          aria-label="delete"
                          title={t('common.delete')}
                        >
                          <Trash2 className="size-3.5" strokeWidth={1.7} />
                        </button>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>

          {/* Legend */}
          <footer className="border-border bg-slate-50/60 px-4 py-2.5">
            <p className="mb-1.5 text-[9px] font-bold uppercase tracking-wider text-slate-500">
              {t('finance.payments.legend')}
            </p>
            <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px]">
              <LegendItem dot="bg-rose-500" label={t('finance.payments.legend_overdue')} />
              <LegendItem dot="bg-amber-500" label={t('finance.payments.legend_today')} />
              <LegendItem dot="bg-sky-500" label={t('finance.payments.legend_pending')} />
              <LegendItem dot="bg-emerald-500" label={t('finance.payments.legend_paid')} />
            </div>
          </footer>
        </aside>
      </div>

      {/* Универсальная модалка расхода: для нового запланированного и для
          оплаты существующего pending. mode разруливает поведение. */}
      <ExpenseFormModal
        open={modal !== null}
        onOpenChange={(open) => {
          if (!open) setModal(null)
        }}
        salonId={salonId}
        currency={currency}
        mode={(modal?.mode ?? 'planned-new') as ExpenseFormMode}
        defaultDate={modal?.mode === 'planned-new' ? modal.date : null}
        existingPayment={modal?.mode === 'planned-paying' ? modal.payment : null}
      />
    </div>
  )
}

function LegendItem({ dot, label }: { dot: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-slate-600">
      <span className={cn('size-1.5 rounded-full', dot)} aria-hidden />
      {label}
    </span>
  )
}

/**
 * Месячный grid (6 рядов × 7 колонок). Каждая ячейка показывает день +
 * до 2 chip-карточек платежей + «+N» badge при переполнении. Клик — выбирает
 * день в боковой панели.
 */
function MonthGrid({
  monthCursor,
  today,
  selectedDate,
  onSelectDate,
  paymentsByDate,
  currency,
  todayStr,
}: {
  monthCursor: Date
  today: Date
  selectedDate: Date
  onSelectDate: (d: Date) => void
  paymentsByDate: Map<string, ScheduledPaymentRow[]>
  currency: string
  todayStr: string
}) {
  const gridStart = startOfWeek(startOfMonth(monthCursor), { weekStartsOn: 1 })
  const cells: Date[] = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i))

  return (
    <div className="grid grid-cols-7">
      {cells.map((d) => {
        const dStr = format(d, 'yyyy-MM-dd')
        const inMonth = isSameMonth(d, monthCursor)
        const isToday = isSameDay(d, today)
        const isSelected = isSameDay(d, selectedDate)
        const weekend = d.getDay() === 0 || d.getDay() === 6
        const list = paymentsByDate.get(dStr) ?? []
        const visible = list.slice(0, 2)
        const extra = list.length - visible.length

        return (
          <button
            key={dStr}
            type="button"
            onClick={() => onSelectDate(d)}
            className={cn(
              'border-border group relative flex min-h-[88px] flex-col gap-1 border-b border-r p-1.5 text-left transition-colors sm:min-h-[110px]',
              !inMonth && 'bg-slate-50/50 text-slate-400',
              inMonth && weekend && 'bg-slate-50/40',
              inMonth && !weekend && 'bg-white',
              'hover:bg-brand-teal-soft/20',
              isSelected && 'ring-brand-teal z-10 ring-2 ring-inset',
            )}
          >
            <div className="flex items-center justify-between">
              <span
                className={cn(
                  'num inline-flex size-6 items-center justify-center text-xs font-bold tabular-nums',
                  isToday && 'text-brand-teal-deep bg-brand-teal-soft/60 rounded-full',
                  !isToday && inMonth && 'text-foreground',
                  !inMonth && 'text-slate-400',
                )}
              >
                {d.getDate()}
              </span>
              {list.length > 0 ? (
                <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400">
                  {list.length}
                </span>
              ) : null}
            </div>

            <div className="flex flex-col gap-0.5">
              {visible.map((p) => {
                const tone = classifyPayment(p, todayStr)
                return (
                  <span
                    key={p.id}
                    className={cn(
                      'truncate rounded border px-1 py-0.5 text-[10px] font-semibold leading-tight',
                      TONE_CHIP[tone],
                    )}
                    title={`${p.vendor_name ?? '—'} · ${formatCurrency(p.amount_cents, currency)}`}
                  >
                    <span className="block truncate">{p.vendor_name ?? '—'}</span>
                    <span className="num block text-[9px] font-bold tabular-nums opacity-90">
                      {compactAmount(p.amount_cents, currency)}
                    </span>
                  </span>
                )
              })}
              {extra > 0 ? (
                <span className="text-muted-foreground inline-block rounded border border-slate-200 bg-slate-50 px-1 py-0.5 text-[10px] font-semibold leading-tight">
                  +{extra}
                </span>
              ) : null}
            </div>
          </button>
        )
      })}
    </div>
  )
}
