import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  currentMonthPeriod,
  periodToRange,
  type PeriodValue,
} from '@/components/ui/period-picker-utils'
import { PeriodPickerPopover } from '@/components/ui/PeriodPickerPopover'
import { useRevenueByStaff } from '@/hooks/useAnalytics'
import { useSalon } from '@/hooks/useSalons'
import { useStaff } from '@/hooks/useStaff'
import { formatCurrency } from '@/lib/utils/format-currency'
import { StaffPerformanceSection } from '@/routes/staff/StaffPerformanceSection'

/**
 * Reports → Мастера. Выручка по мастерам за выбранный месяц + доля от
 * общей выручки + horizontal bar для визуального сравнения.
 */
export function StaffAnalyticsTab({ salonId }: { salonId: string }) {
  const { t } = useTranslation()
  const { data: salon } = useSalon(salonId)
  const currency = salon?.currency ?? 'PLN'

  const [period, setPeriod] = useState<PeriodValue>(() => currentMonthPeriod())
  const range = periodToRange(period)
  const startIso = range.start.toISOString()
  const endIso = range.end.toISOString()
  const { data: rows = [], isLoading } = useRevenueByStaff(salonId, startIso, endIso)
  // Полная «Эффективность мастеров» — раньше жила на /staff, перенесена
  // сюда по ТЗ владельца (Image #32): отчёт мастеров логично смотреть в
  // Отчётах, а не в Справочнике. Использует ретеншн-окно из salon (по
  // умолчанию 60 дн), не period-picker.
  const { data: staffList = [] } = useStaff(salonId, { activeOnly: false })

  const total = rows.reduce((s, r) => s + r.revenue_cents, 0)
  const max = rows.reduce((m, r) => Math.max(m, r.revenue_cents), 0)

  return (
    <div>
      <div className="mb-5 flex items-center justify-between gap-3">
        <h2 className="text-brand-navy text-lg font-bold tracking-tight">
          {t('reports_hub.staff.title')}
        </h2>
        <PeriodPickerPopover value={period} onChange={setPeriod} />
      </div>

      <p className="text-muted-foreground mb-3 hidden text-sm print:block">
        {t('common.print_period', {
          start: startIso.slice(0, 10),
          end: endIso.slice(0, 10),
        })}
      </p>

      <div className="border-border bg-card shadow-finsm rounded-lg border p-5">
        {isLoading ? (
          <p className="text-muted-foreground text-sm">{t('common.loading')}</p>
        ) : rows.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t('reports_hub.staff.empty')}</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {rows.map((r) => {
              const share = total > 0 ? (r.revenue_cents / total) * 100 : 0
              const widthPct = max > 0 ? (r.revenue_cents / max) * 100 : 0
              return (
                <li key={r.staff_id} className="flex flex-col gap-1">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-foreground text-sm font-semibold">{r.full_name}</span>
                    <span className="num text-brand-sage-deep text-sm font-bold">
                      {formatCurrency(r.revenue_cents, currency)}
                      <span className="text-muted-foreground ml-2 text-xs font-normal">
                        {share.toFixed(1)}%
                      </span>
                    </span>
                  </div>
                  <div className="bg-muted/40 h-2 rounded-full">
                    <div
                      className="bg-brand-sage h-full rounded-full"
                      style={{ width: `${widthPct}%` }}
                    />
                  </div>
                </li>
              )
            })}
          </ul>
        )}
        {total > 0 ? (
          <div className="border-border mt-5 border-t pt-3">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-muted-foreground text-xs uppercase tracking-wider">
                {t('reports_hub.staff.total')}
              </span>
              <span className="num text-foreground text-base font-bold">
                {formatCurrency(total, currency)}
              </span>
            </div>
          </div>
        ) : null}
      </div>

      <div className="mt-6">
        <StaffPerformanceSection salonId={salonId} staff={staffList} currency={currency} />
      </div>
    </div>
  )
}
