import { format } from 'date-fns'
import { ru } from 'date-fns/locale'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useSalon } from '@/hooks/useSalons'
import { useVisits, type VisitRow } from '@/hooks/useVisits'
import { formatCurrency } from '@/lib/utils/format-currency'
import { VisitDetailModal } from '@/routes/visits/VisitDetailModal'

/**
 * Модалка детализации визитов конкретного мастера за период.
 * Открывается из строки PayoutsPage по клику. Группирует визиты по дням,
 * показывает суммы; клик по визиту → VisitDetailModal (карточка визита).
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

  const visits = useMemo(
    () =>
      staffId ? allVisits.filter((v) => v.staff_id === staffId && v.status !== 'cancelled') : [],
    [allVisits, staffId],
  )

  // Группируем по дате (YYYY-MM-DD в TZ салона ≈ UTC; для UI берём ISO date).
  const byDay = useMemo(() => {
    const map = new Map<string, VisitRow[]>()
    for (const v of visits) {
      const day = v.visit_at.slice(0, 10)
      const arr = map.get(day) ?? []
      arr.push(v)
      map.set(day, arr)
    }
    // sort: descending day
    return [...map.entries()].sort(([a], [b]) => (a < b ? 1 : -1))
  }, [visits])

  const totalRevenue = useMemo(
    () =>
      visits.reduce(
        (s, v) => s + (v.amount_cents ?? 0) - (v.discount_cents ?? 0) + (v.tip_cents ?? 0),
        0,
      ),
    [visits],
  )

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[85vh] sm:!w-[640px] sm:!max-w-[640px]">
          <DialogHeader>
            <DialogTitle>{staffName ?? t('payouts.staff_visits_modal.title_fallback')}</DialogTitle>
            <DialogDescription>
              {t('payouts.staff_visits_modal.subtitle', {
                count: visits.length,
                revenue: formatCurrency(totalRevenue, currency),
              })}
            </DialogDescription>
          </DialogHeader>
          <div className="-mx-5 max-h-[60vh] overflow-y-auto px-5 pb-2">
            {byDay.length === 0 ? (
              <p className="text-muted-foreground py-6 text-center text-sm">
                {t('payouts.staff_visits_modal.empty')}
              </p>
            ) : (
              <div className="flex flex-col gap-4">
                {byDay.map(([day, dayVisits]) => {
                  const daySum = dayVisits.reduce(
                    (s, v) =>
                      s + (v.amount_cents ?? 0) - (v.discount_cents ?? 0) + (v.tip_cents ?? 0),
                    0,
                  )
                  return (
                    <div key={day}>
                      <div className="border-border flex items-center justify-between border-b pb-1.5">
                        <h3 className="text-brand-navy text-sm font-bold tracking-tight">
                          {format(new Date(`${day}T00:00:00Z`), 'd MMMM, EEEE', { locale: ru })}
                        </h3>
                        <span className="num text-brand-sage-deep text-sm font-bold">
                          {formatCurrency(daySum, currency)}
                        </span>
                      </div>
                      <ul className="mt-1 flex flex-col">
                        {dayVisits
                          .sort((a, b) => a.visit_at.localeCompare(b.visit_at))
                          .map((v) => (
                            <li
                              key={v.id}
                              onClick={() => setEditingVisit(v)}
                              className="hover:bg-muted/40 flex cursor-pointer items-center justify-between gap-3 rounded-md px-2 py-2"
                            >
                              <div className="min-w-0 flex-1">
                                <div className="text-foreground truncate text-sm font-medium">
                                  {v.service_name_snapshot ?? '—'}
                                </div>
                                <div className="text-muted-foreground mt-0.5 flex items-center gap-2 text-xs">
                                  <span>{v.visit_at.slice(11, 16)}</span>
                                  {v.status === 'paid' ? (
                                    <span className="bg-brand-sage-soft text-brand-sage-deep rounded-full px-1.5 py-0.5 text-[10px] font-bold">
                                      ✓
                                    </span>
                                  ) : (
                                    <span className="bg-brand-yellow/40 text-brand-navy rounded-full px-1.5 py-0.5 text-[10px] font-bold">
                                      …
                                    </span>
                                  )}
                                </div>
                              </div>
                              <span className="num text-brand-navy shrink-0 text-sm font-bold">
                                {formatCurrency(
                                  (v.amount_cents ?? 0) -
                                    (v.discount_cents ?? 0) +
                                    (v.tip_cents ?? 0),
                                  currency,
                                )}
                              </span>
                            </li>
                          ))}
                      </ul>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <VisitDetailModal
        visit={editingVisit}
        salonId={salonId}
        currency={currency}
        onClose={() => setEditingVisit(null)}
      />
    </>
  )
}
