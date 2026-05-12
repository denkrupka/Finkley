import { formatDistanceToNowStrict } from 'date-fns'
import { ru } from 'date-fns/locale'
import { ExternalLink } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

import {
  currentMonthPeriod,
  periodToRange,
  type PeriodValue,
} from '@/components/ui/period-picker-utils'
import { PeriodPickerPopover } from '@/components/ui/PeriodPickerPopover'
import { useSalon } from '@/hooks/useSalons'
import { useTopClientsByRevenue } from '@/hooks/useTopClients'
import { formatCurrency } from '@/lib/utils/format-currency'

/**
 * Reports → Клиенты. Топ-20 клиентов за выбранный месяц + ссылка на
 * полную базу клиентов в Настройках → Справочники → Клиенты.
 *
 * Полноценная RFM/retention/LTV аналитика — следующая итерация.
 */
export function ClientsAnalyticsTab({ salonId }: { salonId: string }) {
  const { t } = useTranslation()
  const { data: salon } = useSalon(salonId)
  const currency = salon?.currency ?? 'PLN'

  const [period, setPeriod] = useState<PeriodValue>(() => currentMonthPeriod())
  const range = periodToRange(period)
  const startIso = range.start.toISOString()
  const endIso = range.end.toISOString()
  const { data: rows = [], isLoading } = useTopClientsByRevenue(salonId, startIso, endIso, 20)

  return (
    <div>
      <div className="mb-5 flex items-center justify-between gap-3">
        <h2 className="text-brand-navy text-lg font-bold tracking-tight">
          {t('reports_hub.clients.title')}
        </h2>
        <PeriodPickerPopover value={period} onChange={setPeriod} />
      </div>

      <p className="text-muted-foreground mb-3 hidden text-sm print:block">
        {t('common.print_period', {
          start: startIso.slice(0, 10),
          end: endIso.slice(0, 10),
        })}
      </p>

      <div className="border-border bg-card shadow-finsm overflow-x-auto rounded-lg border">
        {isLoading ? (
          <p className="text-muted-foreground p-6 text-sm">{t('common.loading')}</p>
        ) : rows.length === 0 ? (
          <p className="text-muted-foreground p-6 text-sm">{t('reports_hub.clients.empty')}</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-muted-foreground text-xs uppercase tracking-wider">
              <tr>
                <th className="px-4 py-2 text-left font-semibold">
                  {t('reports_hub.clients.col_name')}
                </th>
                <th className="px-4 py-2 text-right font-semibold">
                  {t('reports_hub.clients.col_visits')}
                </th>
                <th className="px-4 py-2 text-right font-semibold">
                  {t('reports_hub.clients.col_revenue')}
                </th>
                <th className="px-4 py-2 text-right font-semibold">
                  {t('reports_hub.clients.col_avg_check')}
                </th>
                <th className="px-4 py-2 text-right font-semibold">
                  {t('reports_hub.clients.col_last_visit')}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const avg = r.visit_count > 0 ? Math.round(r.revenue_cents / r.visit_count) : 0
                return (
                  <tr key={r.client_id} className="border-border/60 border-t">
                    <td className="text-foreground px-4 py-2">
                      <span className="block font-semibold">{r.full_name}</span>
                      {r.phone ? (
                        <span className="text-muted-foreground block text-xs">{r.phone}</span>
                      ) : null}
                    </td>
                    <td className="num text-muted-foreground px-4 py-2 text-right">
                      {r.visit_count}
                    </td>
                    <td className="num text-brand-sage-deep px-4 py-2 text-right font-bold">
                      {formatCurrency(r.revenue_cents, currency)}
                    </td>
                    <td className="num text-muted-foreground px-4 py-2 text-right">
                      {formatCurrency(avg, currency)}
                    </td>
                    <td className="text-muted-foreground px-4 py-2 text-right text-xs">
                      {r.last_visit_at
                        ? formatDistanceToNowStrict(new Date(r.last_visit_at), {
                            addSuffix: true,
                            locale: ru,
                          })
                        : '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      <Link
        to={`/${salonId}/clients`}
        className="text-secondary mt-4 inline-flex items-center gap-1 text-sm font-semibold hover:underline"
      >
        {t('reports_hub.clients.open_full_list')}
        <ExternalLink className="size-3.5" strokeWidth={2} />
      </Link>
    </div>
  )
}
