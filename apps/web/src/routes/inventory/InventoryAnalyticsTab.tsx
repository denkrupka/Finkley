import { ArrowDown, ArrowUp, BarChart3, Users } from 'lucide-react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import {
  useInventoryPlanVsFact,
  useStaffMaterialConsumption,
  type StaffConsumptionRow,
} from '@/hooks/useInventory'
import { cn } from '@/lib/utils/cn'
import { formatCurrency } from '@/lib/utils/format-currency'

type Props = {
  salonId: string
  currency: string
}

/**
 * Аналитика расхода материалов:
 *   - Plan vs Fact: ожидаемое потребление по рецепту услуг vs реальное
 *     списание из журнала. Перерасход подсвечен красным, недоиспользование
 *     зелёным (либо мастер экономит, либо не списываем правильно).
 *   - Per-master: сколько каждый мастер израсходовал каких материалов
 *     за период. Avg per visit сравнивается с expected (по рецепту) —
 *     если мастер тратит сильно больше нормы → флаг.
 *
 * Период — последние 30 дней (для согласованности со StaffPerformance).
 * Когда нужен switcher — вынесем в URL params или общий PeriodToggle.
 */
export function InventoryAnalyticsTab({ salonId, currency }: Props) {
  const { t } = useTranslation()

  const period = useMemo(() => {
    const end = new Date()
    const start = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    return { start: start.toISOString(), end: end.toISOString() }
  }, [])

  const { data: planFact = [], isLoading: pfLoading } = useInventoryPlanVsFact(salonId, period)
  const { data: byStaff = [], isLoading: bsLoading } = useStaffMaterialConsumption(salonId, period)

  // Группируем by-staff data по мастеру
  const groupedByStaff = useMemo(() => {
    const map = new Map<string, { name: string; rows: StaffConsumptionRow[]; totalCost: number }>()
    for (const r of byStaff) {
      let entry = map.get(r.staff_id)
      if (!entry) {
        entry = { name: r.staff_full_name, rows: [], totalCost: 0 }
        map.set(r.staff_id, entry)
      }
      entry.rows.push(r)
      entry.totalCost += r.total_cost_cents
    }
    return Array.from(map.entries()).sort((a, b) => b[1].totalCost - a[1].totalCost)
  }, [byStaff])

  const totalPlanned = planFact.reduce((acc, r) => acc + r.planned, 0)
  const totalActual = planFact.reduce((acc, r) => acc + r.actual, 0)
  const totalVarianceValue = planFact.reduce((acc, r) => acc + r.variance_value_cents, 0)

  return (
    <div className="flex flex-col gap-5">
      {/* Plan vs Fact section */}
      <section className="border-border bg-card shadow-finsm rounded-lg border p-5 sm:p-6">
        <div className="mb-4 flex items-start gap-3">
          <div className="bg-brand-teal-soft text-brand-teal-deep grid size-10 shrink-0 place-items-center rounded-lg">
            <BarChart3 className="size-5" strokeWidth={1.8} />
          </div>
          <div>
            <h2 className="text-brand-navy text-base font-bold tracking-tight">
              {t('inventory.analytics.plan_fact_title')}
            </h2>
            <p className="text-muted-foreground mt-0.5 text-sm">
              {t('inventory.analytics.plan_fact_subtitle')}
            </p>
          </div>
        </div>

        {pfLoading ? (
          <div className="bg-muted/40 h-32 animate-pulse rounded-md" />
        ) : planFact.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t('inventory.analytics.empty')}</p>
        ) : (
          <>
            {/* Summary */}
            <div className="text-muted-foreground mb-3 grid grid-cols-3 gap-3 border-b pb-3 text-xs">
              <span>
                {t('inventory.analytics.total_planned')}:{' '}
                <span className="num text-foreground">{totalPlanned.toFixed(2)}</span>
              </span>
              <span>
                {t('inventory.analytics.total_actual')}:{' '}
                <span className="num text-foreground">{totalActual.toFixed(2)}</span>
              </span>
              <span className="text-right">
                {t('inventory.analytics.variance_cost')}:{' '}
                <span
                  className={cn(
                    'num font-bold',
                    totalVarianceValue > 0
                      ? 'text-destructive'
                      : totalVarianceValue < 0
                        ? 'text-brand-sage'
                        : 'text-foreground',
                  )}
                >
                  {totalVarianceValue !== 0
                    ? `${totalVarianceValue > 0 ? '+' : ''}${formatCurrency(totalVarianceValue, currency)}`
                    : '0'}
                </span>
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-muted-foreground border-border border-b text-left text-xs">
                    <th className="py-2 pr-3 font-semibold">
                      {t('inventory.analytics.col_material')}
                    </th>
                    <th className="py-2 pr-3 text-right font-semibold">
                      {t('inventory.analytics.col_plan')}
                    </th>
                    <th className="py-2 pr-3 text-right font-semibold">
                      {t('inventory.analytics.col_fact')}
                    </th>
                    <th className="py-2 pr-3 text-right font-semibold">
                      {t('inventory.analytics.col_diff')}
                    </th>
                    <th className="py-2 pr-3 text-right font-semibold">
                      {t('inventory.analytics.col_cost')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {planFact.map((r) => {
                    const overuse = r.variance > 0
                    const variancePct = r.planned > 0 ? (r.variance / r.planned) * 100 : null
                    return (
                      <tr key={r.material_id} className="border-border border-b last:border-b-0">
                        <td className="py-2.5 pr-3">
                          <span className="text-foreground font-semibold">{r.material_name}</span>
                          <span className="text-muted-foreground ml-1.5 text-xs">{r.unit}</span>
                        </td>
                        <td className="num text-muted-foreground py-2.5 pr-3 text-right">
                          {r.planned.toFixed(2)}
                        </td>
                        <td className="num py-2.5 pr-3 text-right font-semibold">
                          {r.actual.toFixed(2)}
                        </td>
                        <td className="num py-2.5 pr-3 text-right">
                          <span
                            className={cn(
                              'inline-flex items-center gap-0.5 font-bold',
                              overuse
                                ? 'text-destructive'
                                : r.variance < 0
                                  ? 'text-brand-sage'
                                  : 'text-muted-foreground',
                            )}
                          >
                            {overuse ? (
                              <ArrowUp className="size-3" strokeWidth={2.4} />
                            ) : r.variance < 0 ? (
                              <ArrowDown className="size-3" strokeWidth={2.4} />
                            ) : null}
                            {r.variance > 0 ? '+' : ''}
                            {r.variance.toFixed(2)}
                            {variancePct !== null ? (
                              <span className="text-muted-foreground ml-1 text-xs font-medium">
                                ({variancePct > 0 ? '+' : ''}
                                {variancePct.toFixed(0)}%)
                              </span>
                            ) : null}
                          </span>
                        </td>
                        <td className="num py-2.5 pr-3 text-right">
                          {r.variance_value_cents !== 0 ? (
                            <span
                              className={
                                overuse
                                  ? 'text-destructive font-semibold'
                                  : 'text-brand-sage font-semibold'
                              }
                            >
                              {r.variance_value_cents > 0 ? '+' : ''}
                              {formatCurrency(r.variance_value_cents, currency)}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <p className="text-muted-foreground mt-3 text-xs">
              {t('inventory.analytics.plan_fact_note')}
            </p>
          </>
        )}
      </section>

      {/* Per-staff consumption */}
      <section className="border-border bg-card shadow-finsm rounded-lg border p-5 sm:p-6">
        <div className="mb-4 flex items-start gap-3">
          <div className="bg-brand-sage-soft text-brand-sage grid size-10 shrink-0 place-items-center rounded-lg">
            <Users className="size-5" strokeWidth={1.8} />
          </div>
          <div>
            <h2 className="text-brand-navy text-base font-bold tracking-tight">
              {t('inventory.analytics.staff_title')}
            </h2>
            <p className="text-muted-foreground mt-0.5 text-sm">
              {t('inventory.analytics.staff_subtitle')}
            </p>
          </div>
        </div>

        {bsLoading ? (
          <div className="bg-muted/40 h-32 animate-pulse rounded-md" />
        ) : groupedByStaff.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t('inventory.analytics.empty')}</p>
        ) : (
          <div className="flex flex-col gap-4">
            {groupedByStaff.map(([staffId, group]) => (
              <div key={staffId}>
                <div className="mb-2 flex items-baseline justify-between">
                  <h3 className="text-foreground text-sm font-bold">{group.name}</h3>
                  <span className="num text-muted-foreground text-xs">
                    {t('inventory.analytics.total_cost')}:{' '}
                    <span className="text-foreground font-semibold">
                      {formatCurrency(group.totalCost, currency)}
                    </span>
                  </span>
                </div>
                <ul className="border-border divide-border bg-muted/20 divide-y rounded-md border">
                  {group.rows.map((r) => {
                    const overByPercent =
                      r.expected_per_visit && r.expected_per_visit > 0
                        ? (r.avg_per_visit - r.expected_per_visit) / r.expected_per_visit
                        : null
                    const isOverusing = overByPercent !== null && overByPercent > 0.15
                    return (
                      <li
                        key={`${staffId}_${r.material_id}`}
                        className="grid grid-cols-[1.5fr_1fr_1fr_auto] items-center gap-3 px-3 py-2 text-xs"
                      >
                        <span className="text-foreground truncate font-semibold">
                          {r.material_name}
                          {isOverusing ? (
                            <span className="bg-destructive/10 text-destructive ml-1.5 inline-block rounded-full px-1.5 py-0.5 text-[9.5px] font-bold uppercase">
                              {t('inventory.analytics.flag_overuse')}
                            </span>
                          ) : null}
                        </span>
                        <span className="num text-muted-foreground">
                          {r.total_consumed.toFixed(2)} {r.unit}
                          <span className="text-muted-foreground/70 ml-1">({r.visit_count}v)</span>
                        </span>
                        <span className="num text-muted-foreground">
                          {t('inventory.analytics.avg_per_visit')}:{' '}
                          <span
                            className={cn(
                              'font-semibold',
                              isOverusing ? 'text-destructive' : 'text-foreground',
                            )}
                          >
                            {r.avg_per_visit.toFixed(2)}
                          </span>
                          {r.expected_per_visit ? (
                            <span className="text-muted-foreground/70 ml-1">
                              / {r.expected_per_visit.toFixed(2)}
                            </span>
                          ) : null}
                        </span>
                        <span className="num text-foreground text-right font-semibold">
                          {formatCurrency(r.total_cost_cents, currency)}
                        </span>
                      </li>
                    )
                  })}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
