import { addMonths, format, startOfMonth } from 'date-fns'
import { ru } from 'date-fns/locale'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { useRevenueByService } from '@/hooks/useAnalytics'
import { useSalon } from '@/hooks/useSalons'
import { formatCurrency } from '@/lib/utils/format-currency'

/**
 * Reports → Услуги. Топ услуг по выручке + visits count + маржа (если в
 * services.cost_cents задана себестоимость).
 */
export function ServicesAnalyticsTab({ salonId }: { salonId: string }) {
  const { t } = useTranslation()
  const { data: salon } = useSalon(salonId)
  const currency = salon?.currency ?? 'PLN'

  const [cursor, setCursor] = useState(() => startOfMonth(new Date()))
  const startIso = startOfMonth(cursor).toISOString()
  const endIso = startOfMonth(addMonths(cursor, 1)).toISOString()
  const { data: rows = [], isLoading } = useRevenueByService(salonId, startIso, endIso)

  const total = rows.reduce((s, r) => s + r.revenue_cents, 0)

  return (
    <div>
      <div className="mb-5 flex items-center justify-between gap-3">
        <h2 className="text-brand-navy text-lg font-bold tracking-tight">
          {t('reports_hub.services.title')}
        </h2>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setCursor((c) => addMonths(c, -1))}>
            <ChevronLeft className="size-4" strokeWidth={2} />
          </Button>
          <span className="text-foreground text-sm font-semibold">
            {format(cursor, 'LLLL yyyy', { locale: ru })}
          </span>
          <Button variant="outline" size="sm" onClick={() => setCursor((c) => addMonths(c, 1))}>
            <ChevronRight className="size-4" strokeWidth={2} />
          </Button>
        </div>
      </div>

      <div className="border-border bg-card shadow-finsm overflow-x-auto rounded-lg border">
        {isLoading ? (
          <p className="text-muted-foreground p-6 text-sm">{t('common.loading')}</p>
        ) : rows.length === 0 ? (
          <p className="text-muted-foreground p-6 text-sm">{t('reports_hub.services.empty')}</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-muted-foreground text-xs uppercase tracking-wider">
              <tr>
                <th className="px-4 py-2 text-left font-semibold">
                  {t('reports_hub.services.col_name')}
                </th>
                <th className="px-4 py-2 text-right font-semibold">
                  {t('reports_hub.services.col_visits')}
                </th>
                <th className="px-4 py-2 text-right font-semibold">
                  {t('reports_hub.services.col_revenue')}
                </th>
                <th className="px-4 py-2 text-right font-semibold">
                  {t('reports_hub.services.col_margin')}
                </th>
                <th className="px-4 py-2 text-right font-semibold">
                  {t('reports_hub.services.col_share')}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const share = total > 0 ? (r.revenue_cents / total) * 100 : 0
                return (
                  <tr key={r.service_id} className="border-border/60 border-t">
                    <td className="text-foreground px-4 py-2">{r.service_name}</td>
                    <td className="num text-muted-foreground px-4 py-2 text-right">
                      {r.visits_count}
                    </td>
                    <td className="num text-foreground px-4 py-2 text-right font-semibold">
                      {formatCurrency(r.revenue_cents, currency)}
                    </td>
                    <td
                      className={`num px-4 py-2 text-right font-semibold ${
                        r.margin_pct == null
                          ? 'text-muted-foreground'
                          : r.margin_pct >= 50
                            ? 'text-brand-sage-deep'
                            : r.margin_pct >= 35
                              ? 'text-amber-700'
                              : 'text-destructive'
                      }`}
                    >
                      {r.margin_pct == null
                        ? '—'
                        : `${formatCurrency(r.margin_cents ?? 0, currency)} (${r.margin_pct.toFixed(0)}%)`}
                    </td>
                    <td className="num text-muted-foreground px-4 py-2 text-right">
                      {share.toFixed(1)}%
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
