import { Clock, ShoppingBag, TrendingUp, Users, Wallet } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { AiInsightsPanel } from '@/components/reports/AiInsightsPanel'
import {
  currentMonthPeriod,
  periodToRange,
  type PeriodValue,
} from '@/components/ui/period-picker-utils'
import { PeriodPickerPopover } from '@/components/ui/PeriodPickerPopover'
import { usePayoutsPreview } from '@/hooks/usePayouts'
import { useSalon } from '@/hooks/useSalons'
import { useStaff } from '@/hooks/useStaff'
import { useStaffPerformanceAdvanced } from '@/hooks/useStaffPerformance'
import { cn } from '@/lib/utils/cn'
import { formatCurrency } from '@/lib/utils/format-currency'
import { StaffPerformanceSection } from '@/routes/staff/StaffPerformanceSection'

/**
 * Reports → Мастера. Расширенная аналитика эффективности:
 *   - Выручка (визиты + retail), визитов, уникальных клиентов
 *   - Возвращаемость: сколько клиентов вернулось в retention-window
 *   - Rebook% — доля вернувшихся
 *   - Utilization% — загрузка от графика
 *   - Выручка за 6 мес + стаж работы (дата первого визита)
 *
 * Источник: RPC staff_performance_advanced (migrtion 20260515000013).
 */
export function StaffAnalyticsTab({ salonId }: { salonId: string }) {
  const { t } = useTranslation()
  const { data: salon } = useSalon(salonId)
  const currency = salon?.currency ?? 'PLN'

  const [period, setPeriod] = useState<PeriodValue>(() => currentMonthPeriod())
  const range = periodToRange(period)
  const startIso = range.start.toISOString()
  const endIso = range.end.toISOString()
  const { data: rows = [], isLoading } = useStaffPerformanceAdvanced(salonId, startIso, endIso)
  const { data: staffList = [] } = useStaff(salonId, { activeOnly: false })
  // Заработок мастера за период: usePayoutsPreview считает по тому же
  // RPC, что и страница /payouts (схема commission + revenue × процент).
  // Передаём дату-only (RPC принимает period_start/period_end типа date).
  const startDate = startIso.slice(0, 10)
  const endDate = endIso.slice(0, 10)
  const { data: payouts = [] } = usePayoutsPreview(salonId, startDate, endDate)
  const payoutByStaff = useMemo(() => {
    const m = new Map<string, number>()
    for (const p of payouts) m.set(p.staff_id, p.payout_cents)
    return m
  }, [payouts])

  const totalRevenue = rows.reduce((s, r) => s + r.total_revenue_cents, 0)
  const maxRevenue = rows.reduce((m, r) => Math.max(m, r.total_revenue_cents), 0)

  // AI-payload генерируется даже при пустых данных — плашка «AI-выводы»
  // отрисуется всегда (со «Скрыто/Показать» опт-ином). Если визитов нет,
  // AI просто ответит «мало данных или всё ровно» — это уже даст владельцу
  // понимание, что отчёт пуст, без необходимости отдельных пояснений.
  const aiPayload = useMemo(() => {
    return {
      period: { start: startIso.slice(0, 10), end: endIso.slice(0, 10) },
      currency,
      total_revenue_cents: totalRevenue,
      staff: rows.map((r) => ({
        name: r.full_name,
        is_active: r.is_active,
        revenue_cents: r.total_revenue_cents,
        visits_revenue_cents: r.visits_revenue_cents,
        retail_revenue_cents: r.retail_revenue_cents,
        visits: r.visits_count,
        unique_clients: r.unique_clients_count,
        returned_clients: r.returned_clients_count,
        rebook_pct: r.rebook_pct,
        utilization_pct: r.utilization_pct,
        revenue_6m_cents: r.revenue_6m_cents,
        hire_date: r.hire_date,
        payout_cents: payoutByStaff.get(r.staff_id) ?? 0,
        share_pct:
          totalRevenue > 0 ? Number(((r.total_revenue_cents / totalRevenue) * 100).toFixed(1)) : 0,
      })),
    }
  }, [rows, totalRevenue, startIso, endIso, currency, payoutByStaff])

  return (
    <div>
      {/* Image #64: заголовок «Эффективность мастеров» убран — табы Reports
          уже сообщают, на каком отчёте мы. PeriodPicker переехал под
          AI-плашку (как в Reports → Услуги). */}
      <AiInsightsPanel kind="staff" payload={aiPayload} />

      <div className="mb-4 flex items-center justify-end">
        <PeriodPickerPopover value={period} onChange={setPeriod} />
      </div>

      <p className="text-muted-foreground mb-3 hidden text-sm print:block">
        {t('common.print_period', {
          start: startIso.slice(0, 10),
          end: endIso.slice(0, 10),
        })}
      </p>

      {/* При пустых данных таблицу и плашку «За период визитов не было.»
          не показываем — AI-плашка наверху уже всё объясняет, и второй
          empty-state визуально мусорит. */}
      {!isLoading && rows.length === 0 ? null : (
        <div className="border-border bg-card shadow-finsm overflow-x-auto rounded-lg border">
          {isLoading ? (
            <p className="text-muted-foreground p-6 text-sm">{t('common.loading')}</p>
          ) : (
            <table className="w-full min-w-[820px] text-sm">
              <thead className="bg-muted/40 text-muted-foreground border-b text-[11px] uppercase tracking-wider">
                <tr>
                  <th className="px-4 py-3 text-left font-semibold">
                    {t('reports_hub.staff.col_name')}
                  </th>
                  <th className="px-3 py-3 text-right font-semibold">
                    {t('reports_hub.staff.col_revenue')}
                  </th>
                  <th className="px-3 py-3 text-right font-semibold">
                    {t('reports_hub.staff.col_visits')}
                  </th>
                  <th className="px-3 py-3 text-right font-semibold">
                    {t('reports_hub.staff.col_clients')}
                  </th>
                  <th className="px-3 py-3 text-right font-semibold">
                    {t('reports_hub.staff.col_rebook')}
                  </th>
                  <th className="px-3 py-3 text-right font-semibold">
                    {t('reports_hub.staff.col_utilization')}
                  </th>
                  <th className="px-3 py-3 text-right font-semibold">
                    {t('reports_hub.staff.col_earnings')}
                  </th>
                  <th className="px-3 py-3 text-right font-semibold">
                    {t('reports_hub.staff.col_share')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const share = totalRevenue > 0 ? (r.total_revenue_cents / totalRevenue) * 100 : 0
                  const widthPct = maxRevenue > 0 ? (r.total_revenue_cents / maxRevenue) * 100 : 0
                  const hireYears = r.hire_date
                    ? Math.floor(
                        (Date.now() - new Date(r.hire_date).getTime()) /
                          (365.25 * 24 * 3600 * 1000),
                      )
                    : null
                  return (
                    <tr key={r.staff_id} className="border-border/60 hover:bg-muted/20 border-t">
                      {/* Имя + split visits/retail + 6m + стаж */}
                      <td className="px-4 py-3">
                        <div className="text-foreground text-sm font-semibold">
                          {r.full_name}
                          {!r.is_active ? (
                            <span className="bg-muted text-muted-foreground ml-2 rounded-full px-1.5 py-0.5 text-[10px] font-bold uppercase">
                              архив
                            </span>
                          ) : null}
                        </div>
                        <div className="text-muted-foreground mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10.5px]">
                          <span className="inline-flex items-center gap-1">
                            <TrendingUp className="size-3" strokeWidth={2} />
                            {t('reports_hub.staff.visits_short')}:{' '}
                            {formatCurrency(r.visits_revenue_cents, currency)}
                          </span>
                          <span className="inline-flex items-center gap-1">
                            <ShoppingBag className="size-3" strokeWidth={2} />
                            {t('reports_hub.staff.retail_short')}:{' '}
                            {formatCurrency(r.retail_revenue_cents, currency)}
                          </span>
                          <span>
                            6м:{' '}
                            <span className="num">
                              {formatCurrency(r.revenue_6m_cents, currency)}
                            </span>
                          </span>
                          {hireYears != null ? (
                            <span>{t('reports_hub.staff.tenure', { years: hireYears })}</span>
                          ) : null}
                        </div>
                      </td>
                      {/* Выручка + width bar */}
                      <td className="px-3 py-3 text-right">
                        <div className="num text-brand-sage-deep text-sm font-bold">
                          {formatCurrency(r.total_revenue_cents, currency)}
                        </div>
                        <div className="bg-muted/40 mt-1 h-1.5 w-full overflow-hidden rounded-full">
                          <div
                            className="bg-brand-sage h-full rounded-full"
                            style={{ width: `${widthPct}%` }}
                          />
                        </div>
                      </td>
                      {/* Визитов */}
                      <td className="num text-foreground px-3 py-3 text-right font-semibold">
                        {r.visits_count}
                      </td>
                      {/* Уникальных клиентов / вернулось */}
                      <td className="px-3 py-3 text-right">
                        <div className="num text-foreground text-sm font-semibold">
                          {r.unique_clients_count}
                        </div>
                        <div className="text-muted-foreground inline-flex items-center gap-1 text-[10.5px]">
                          <Users className="size-3" strokeWidth={2} />
                          {t('reports_hub.staff.returned_short')}: {r.returned_clients_count}
                        </div>
                      </td>
                      {/* Rebook% */}
                      <td className="px-3 py-3 text-right">
                        <span
                          className={cn(
                            'num text-sm font-bold',
                            r.rebook_pct >= 50
                              ? 'text-brand-sage-deep'
                              : r.rebook_pct >= 30
                                ? 'text-amber-700'
                                : 'text-destructive',
                          )}
                        >
                          {r.rebook_pct}%
                        </span>
                      </td>
                      {/* Utilization% */}
                      <td className="px-3 py-3 text-right">
                        <div className="inline-flex items-center gap-1.5">
                          <Clock className="text-muted-foreground size-3" strokeWidth={2} />
                          <span
                            className={cn(
                              'num text-sm font-bold',
                              r.utilization_pct >= 70
                                ? 'text-brand-sage-deep'
                                : r.utilization_pct >= 40
                                  ? 'text-amber-700'
                                  : 'text-destructive',
                            )}
                          >
                            {r.utilization_pct}%
                          </span>
                        </div>
                      </td>
                      {/* Заработок мастера за период (commission по схеме). */}
                      <td className="px-3 py-3 text-right">
                        <div className="inline-flex items-center gap-1">
                          <Wallet className="text-muted-foreground size-3" strokeWidth={2} />
                          <span className="num text-foreground text-sm font-semibold">
                            {formatCurrency(payoutByStaff.get(r.staff_id) ?? 0, currency)}
                          </span>
                        </div>
                      </td>
                      {/* Share % */}
                      <td className="num text-muted-foreground px-3 py-3 text-right">
                        {share.toFixed(1)}%
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              {totalRevenue > 0 ? (
                <tfoot className="border-border bg-muted/10 border-t">
                  <tr>
                    <td className="text-muted-foreground px-4 py-2 text-[11px] font-bold uppercase tracking-wider">
                      {t('reports_hub.staff.total')}
                    </td>
                    <td className="num text-foreground px-3 py-2 text-right text-sm font-bold">
                      {formatCurrency(totalRevenue, currency)}
                    </td>
                    <td colSpan={4} />
                    <td className="num text-foreground px-3 py-2 text-right text-sm font-bold">
                      {formatCurrency(
                        payouts.reduce((s, p) => s + p.payout_cents, 0),
                        currency,
                      )}
                    </td>
                    <td />
                  </tr>
                </tfoot>
              ) : null}
            </table>
          )}
        </div>
      )}

      <div className="mt-6">
        <StaffPerformanceSection salonId={salonId} staff={staffList} currency={currency} />
      </div>
    </div>
  )
}
