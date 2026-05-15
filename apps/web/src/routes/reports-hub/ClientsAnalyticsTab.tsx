import { formatDistanceToNowStrict } from 'date-fns'
import { ru } from 'date-fns/locale'
import { BarChart3, ExternalLink, SlidersHorizontal } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useSearchParams } from 'react-router-dom'

import { AiInsightsPanel } from '@/components/reports/AiInsightsPanel'
import { PageTabsNav, type PageTab } from '@/components/ui/PageTabsNav'
import {
  currentMonthPeriod,
  periodToRange,
  type PeriodValue,
} from '@/components/ui/period-picker-utils'
import { PeriodPickerPopover } from '@/components/ui/PeriodPickerPopover'
import { useSalon } from '@/hooks/useSalons'
import { useTopClientsByRevenue } from '@/hooks/useTopClients'
import { formatCurrency } from '@/lib/utils/format-currency'
import { SegmentationCard } from '@/routes/settings/SegmentationCard'

type ClientsSubTab = 'top' | 'params'

const SUB_TABS: PageTab<ClientsSubTab>[] = [
  { id: 'top', labelKey: 'reports_hub.clients.tabs.top', icon: BarChart3 },
  { id: 'params', labelKey: 'reports_hub.clients.tabs.params', icon: SlidersHorizontal },
]

function isClientsSubTab(v: string | null): v is ClientsSubTab {
  return v === 'top' || v === 'params'
}

/**
 * Reports → Клиенты. Два sub-tab'а:
 *   - Топ клиентов  — Топ-20 за выбранный период (revenue/visits/last_visit)
 *   - Параметры    — SegmentationCard (retention/churn windows). Раньше
 *                     этот блок жил в /staff → Сегментация клиентов; по ТЗ
 *                     владельца перенесён сюда — параметры клиентской
 *                     сегментации логичнее в отчётах по клиентам.
 *
 * Активный sub-tab сохраняется в URL через `?client=top|params`, чтобы
 * не конфликтовать с родительским `?tab=clients`.
 */
export function ClientsAnalyticsTab({ salonId }: { salonId: string }) {
  const { t } = useTranslation()
  const { data: salon } = useSalon(salonId)
  const currency = salon?.currency ?? 'PLN'

  const [params, setParams] = useSearchParams()
  const subParam = params.get('client')
  const activeSub: ClientsSubTab = isClientsSubTab(subParam) ? subParam : 'top'

  function setActiveSub(id: ClientsSubTab) {
    const next = new URLSearchParams(params)
    next.set('client', id)
    setParams(next, { replace: true })
  }

  return (
    <div>
      <PageTabsNav tabs={SUB_TABS} active={activeSub} onChange={setActiveSub} t={t} />
      {activeSub === 'top' ? (
        <TopClientsTab salonId={salonId} currency={currency} t={t} />
      ) : (
        <div>{salon ? <SegmentationCard salon={salon} /> : null}</div>
      )}
    </div>
  )
}

function TopClientsTab({
  salonId,
  currency,
  t,
}: {
  salonId: string
  currency: string
  t: (key: string, opts?: Record<string, unknown>) => string
}) {
  const [period, setPeriod] = useState<PeriodValue>(() => currentMonthPeriod())
  const range = periodToRange(period)
  const startIso = range.start.toISOString()
  const endIso = range.end.toISOString()
  const { data: rows = [], isLoading } = useTopClientsByRevenue(salonId, startIso, endIso, 20)

  const aiPayload = useMemo(() => {
    if (rows.length === 0) return null
    const totalRevenue = rows.reduce((s, r) => s + r.revenue_cents, 0)
    return {
      period: { start: startIso.slice(0, 10), end: endIso.slice(0, 10) },
      currency,
      total_revenue_cents: totalRevenue,
      top_clients: rows.slice(0, 20).map((r) => ({
        name: r.full_name,
        visits: r.visit_count,
        revenue_cents: r.revenue_cents,
        avg_check_cents: r.visit_count > 0 ? Math.round(r.revenue_cents / r.visit_count) : 0,
        last_visit_at: r.last_visit_at,
      })),
    }
  }, [rows, startIso, endIso, currency])

  return (
    <div>
      <div className="mb-5 flex items-center justify-between gap-3">
        <h2 className="text-brand-navy text-lg font-bold tracking-tight">
          {t('reports_hub.clients.title')}
        </h2>
        <PeriodPickerPopover value={period} onChange={setPeriod} />
      </div>

      {aiPayload ? <AiInsightsPanel kind="clients" payload={aiPayload} /> : null}

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
