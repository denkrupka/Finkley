import { format } from 'date-fns'
import { Check, Clock, Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { getDateLocale } from '@/lib/utils/format-date'
import { useSalon } from '@/hooks/useSalons'
import { useVisits, type VisitRow } from '@/hooks/useVisits'
import { formatCurrency } from '@/lib/utils/format-currency'
import { QuickEntryModal } from '@/routes/visits/QuickEntryModal'

type StatusFilter = 'all' | 'paid' | 'unpaid'

function netCents(v: VisitRow): number {
  return (v.amount_cents ?? 0) - (v.discount_cents ?? 0) + (v.tip_cents ?? 0)
}

/**
 * Модалка детализации визитов конкретного мастера за период.
 * Открывается из строки PayoutsPage по клику. Группирует визиты по дням,
 * показывает суммы; клик по визиту → VisitDetailModal (карточка визита).
 * Тулбар: поиск по услуге, фильтр по дню (внутри периода) и по статусу оплаты.
 */
export function StaffVisitsModal({
  salonId,
  staffId,
  staffName,
  periodStart,
  periodEnd,
  open,
  onOpenChange,
}: {
  salonId: string
  staffId: string | null
  staffName: string | null
  periodStart: string // yyyy-mm-dd
  periodEnd: string // yyyy-mm-dd
  open: boolean
  onOpenChange: (v: boolean) => void
}) {
  const { t } = useTranslation()
  const { data: salon } = useSalon(salonId)
  const currency = salon?.currency ?? 'PLN'
  const range = useMemo(
    () => ({
      start: new Date(`${periodStart}T00:00:00Z`).toISOString(),
      end: new Date(`${periodEnd}T23:59:59Z`).toISOString(),
    }),
    [periodStart, periodEnd],
  )
  const { data: allVisits = [] } = useVisits(salonId, range)
  const [editingVisit, setEditingVisit] = useState<VisitRow | null>(null)

  // Фильтры тулбара.
  const [search, setSearch] = useState('')
  const [dayFilter, setDayFilter] = useState<string>('all')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')

  // Все визиты мастера за период (до фильтров) — для шапки и списка дней.
  const staffVisits = useMemo(
    () =>
      staffId ? allVisits.filter((v) => v.staff_id === staffId && v.status !== 'cancelled') : [],
    [allVisits, staffId],
  )

  // Дни, в которые были визиты — для селектора дня.
  const availableDays = useMemo(() => {
    const set = new Set<string>()
    for (const v of staffVisits) set.add(v.visit_at.slice(0, 10))
    return [...set].sort((a, b) => (a < b ? 1 : -1))
  }, [staffVisits])

  // Применяем фильтры (поиск по услуге + день + статус).
  const visits = useMemo(() => {
    const q = search.trim().toLowerCase()
    return staffVisits.filter((v) => {
      if (dayFilter !== 'all' && v.visit_at.slice(0, 10) !== dayFilter) return false
      if (statusFilter === 'paid' && v.status !== 'paid') return false
      if (statusFilter === 'unpaid' && v.status === 'paid') return false
      if (q && !(v.service_name_snapshot ?? '').toLowerCase().includes(q)) return false
      return true
    })
  }, [staffVisits, search, dayFilter, statusFilter])

  // Группируем отфильтрованные визиты по дням (desc).
  const byDay = useMemo(() => {
    const map = new Map<string, VisitRow[]>()
    for (const v of visits) {
      const day = v.visit_at.slice(0, 10)
      const arr = map.get(day) ?? []
      arr.push(v)
      map.set(day, arr)
    }
    return [...map.entries()].sort(([a], [b]) => (a < b ? 1 : -1))
  }, [visits])

  // Итог по всему периоду (шапка) — не зависит от фильтров.
  const periodRevenue = useMemo(
    () => staffVisits.reduce((s, v) => s + netCents(v), 0),
    [staffVisits],
  )
  const initials = (staffName ?? '?').trim().slice(0, 2).toUpperCase()
  const filtersActive = dayFilter !== 'all' || statusFilter !== 'all' || search.trim().length > 0

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[88vh] gap-0 sm:!w-[640px] sm:!max-w-[640px]">
          <DialogHeader>
            <div className="flex items-center gap-3">
              <div className="bg-brand-navy grid size-11 shrink-0 place-items-center rounded-full text-sm font-bold text-white">
                {initials}
              </div>
              <div className="min-w-0">
                <DialogTitle className="truncate">
                  {staffName ?? t('payouts.staff_visits_modal.title_fallback')}
                </DialogTitle>
                <DialogDescription className="mt-0.5">
                  {t('payouts.staff_visits_modal.subtitle', {
                    count: staffVisits.length,
                    revenue: formatCurrency(periodRevenue, currency),
                  })}
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          {/* Тулбар: поиск + день + статус */}
          <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <Search
                className="text-muted-foreground pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2"
                strokeWidth={2}
              />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t('payouts.staff_visits_modal.search_placeholder', {
                  defaultValue: 'Поиск по услуге',
                })}
                className="h-9 pl-8"
              />
            </div>
            <Select value={dayFilter} onValueChange={setDayFilter}>
              <SelectTrigger className="h-9 sm:w-[150px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">
                  {t('payouts.staff_visits_modal.all_days', { defaultValue: 'Все дни' })}
                </SelectItem>
                {availableDays.map((d) => (
                  <SelectItem key={d} value={d}>
                    {format(new Date(`${d}T00:00:00Z`), 'd MMM', { locale: getDateLocale() })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
              <SelectTrigger className="h-9 sm:w-[150px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">
                  {t('payouts.staff_visits_modal.status_all', { defaultValue: 'Все статусы' })}
                </SelectItem>
                <SelectItem value="paid">
                  {t('payouts.staff_visits_modal.status_paid', { defaultValue: 'Оплачены' })}
                </SelectItem>
                <SelectItem value="unpaid">
                  {t('payouts.staff_visits_modal.status_unpaid', { defaultValue: 'Не оплачены' })}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="-mx-5 mt-3 max-h-[58vh] overflow-y-auto px-5 pb-2">
            {byDay.length === 0 ? (
              <p className="text-muted-foreground py-10 text-center text-sm">
                {filtersActive
                  ? t('payouts.staff_visits_modal.nothing_found', {
                      defaultValue: 'Ничего не найдено',
                    })
                  : t('payouts.staff_visits_modal.empty')}
              </p>
            ) : (
              <div className="flex flex-col gap-5">
                {byDay.map(([day, dayVisits]) => {
                  const daySum = dayVisits.reduce((s, v) => s + netCents(v), 0)
                  return (
                    <div key={day}>
                      <div className="border-border flex items-center justify-between border-b pb-1.5">
                        <h3 className="text-brand-navy text-sm font-bold tracking-tight">
                          {format(new Date(`${day}T00:00:00Z`), 'd MMMM, EEEE', {
                            locale: getDateLocale(),
                          })}
                        </h3>
                        <span className="num text-brand-sage-deep text-sm font-bold">
                          {formatCurrency(daySum, currency)}
                        </span>
                      </div>
                      <ul className="mt-1.5 flex flex-col gap-0.5">
                        {dayVisits
                          .sort((a, b) => a.visit_at.localeCompare(b.visit_at))
                          .map((v) => {
                            const paid = v.status === 'paid'
                            return (
                              <li
                                key={v.id}
                                onClick={() => setEditingVisit(v)}
                                className="hover:bg-muted/50 flex cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2 transition-colors"
                              >
                                <span
                                  className={
                                    paid
                                      ? 'bg-brand-sage-soft text-brand-sage-deep grid size-7 shrink-0 place-items-center rounded-full'
                                      : 'bg-brand-yellow/40 text-brand-navy grid size-7 shrink-0 place-items-center rounded-full'
                                  }
                                  title={
                                    paid
                                      ? t('payouts.staff_visits_modal.status_paid', {
                                          defaultValue: 'Оплачены',
                                        })
                                      : t('payouts.staff_visits_modal.status_unpaid', {
                                          defaultValue: 'Не оплачены',
                                        })
                                  }
                                >
                                  {paid ? (
                                    <Check className="size-3.5" strokeWidth={3} />
                                  ) : (
                                    <Clock className="size-3.5" strokeWidth={2.5} />
                                  )}
                                </span>
                                <div className="min-w-0 flex-1">
                                  <div className="text-foreground truncate text-sm font-medium">
                                    {v.service_name_snapshot ?? '—'}
                                  </div>
                                  <div className="text-muted-foreground mt-0.5 text-xs">
                                    {v.visit_at.slice(11, 16)}
                                  </div>
                                </div>
                                <span className="num text-brand-navy shrink-0 text-sm font-bold">
                                  {formatCurrency(netCents(v), currency)}
                                </span>
                              </li>
                            )
                          })}
                      </ul>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <QuickEntryModal
        open={!!editingVisit}
        onOpenChange={(o) => !o && setEditingVisit(null)}
        salonId={salonId}
        currency={currency}
        editVisit={editingVisit}
      />
    </>
  )
}
