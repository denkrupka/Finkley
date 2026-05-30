import { format, endOfMonth, startOfYear } from 'date-fns'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Bar,
  BarChart,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import { useExpenseCategories, useExpenses } from '@/hooks/useExpenses'
import { effectiveReceivedFromOtherIncome, useOtherIncomes } from '@/hooks/useOtherIncomes'
import { effectiveReceivedFromVisit, useVisits } from '@/hooks/useVisits'
import { formatCurrency } from '@/lib/utils/format-currency'

/**
 * bug 4fc86f35 — три графика для P&L (Отчёт по прибыли):
 *   1) Динамика выручки и прибыли за 12 месяцев
 *   2) Динамика расходов за 12 месяцев
 *   3) Donut «структура расходов» + ТОП-10 категорий
 *
 * График «Загрузка по дням/часам» переносится на дашборд (другая задача).
 */

const DONUT_COLORS = [
  '#A678D9',
  '#1E6B8A',
  '#D97757',
  '#2E9E6B',
  '#C9A24B',
  '#9A9A9A',
  '#C0392B',
  '#16A085',
  '#8E44AD',
  '#34495E',
]

export function PnlChartsSection({ salonId, currency }: { salonId: string; currency: string }) {
  const { t } = useTranslation()
  const year = new Date().getFullYear()
  const yearStart = useMemo(() => startOfYear(new Date(year, 0, 1)), [year])
  const yearEnd = useMemo(() => endOfMonth(new Date(year, 11, 31)), [year])
  const visitsRange = useMemo(
    () => ({ start: yearStart.toISOString(), end: yearEnd.toISOString() }),
    [yearStart, yearEnd],
  )
  const expensesRange = useMemo(
    () => ({
      start: format(yearStart, 'yyyy-MM-dd'),
      end: format(yearEnd, 'yyyy-MM-dd'),
    }),
    [yearStart, yearEnd],
  )

  const { data: visits = [] } = useVisits(salonId, visitsRange, { kind: 'visit' })
  const { data: retail = [] } = useVisits(salonId, visitsRange, { kind: 'retail' })
  const { data: otherIncomes = [] } = useOtherIncomes(salonId, {
    start: yearStart,
    end: yearEnd,
  })
  const { data: expenses = [] } = useExpenses(salonId, expensesRange)
  const { data: categories = [] } = useExpenseCategories(salonId)

  const monthNames = useMemo(
    () => [
      t('common.month_abbr.jan', { defaultValue: 'Янв' }),
      t('common.month_abbr.feb', { defaultValue: 'Фев' }),
      t('common.month_abbr.mar', { defaultValue: 'Мар' }),
      t('common.month_abbr.apr', { defaultValue: 'Апр' }),
      t('common.month_abbr.may', { defaultValue: 'Май' }),
      t('common.month_abbr.jun', { defaultValue: 'Июн' }),
      t('common.month_abbr.jul', { defaultValue: 'Июл' }),
      t('common.month_abbr.aug', { defaultValue: 'Авг' }),
      t('common.month_abbr.sep', { defaultValue: 'Сен' }),
      t('common.month_abbr.oct', { defaultValue: 'Окт' }),
      t('common.month_abbr.nov', { defaultValue: 'Ноя' }),
      t('common.month_abbr.dec', { defaultValue: 'Дек' }),
    ],
    [t],
  )

  // Chart 1: revenue + profit per month
  const revenueProfit = useMemo(() => {
    const arr: Array<{ month: string; revenue: number; profit: number }> = []
    for (let m = 0; m < 12; m++) {
      let revenue = 0
      let exp = 0
      for (const v of visits) {
        const d = new Date(v.visit_at)
        if (d.getFullYear() === year && d.getMonth() === m && v.status === 'paid') {
          revenue += effectiveReceivedFromVisit(v)
        }
      }
      for (const v of retail) {
        const d = new Date(v.visit_at)
        if (d.getFullYear() === year && d.getMonth() === m && v.status === 'paid') {
          revenue += effectiveReceivedFromVisit(v)
        }
      }
      for (const oi of otherIncomes) {
        const d = new Date(oi.income_at)
        if (d.getFullYear() === year && d.getMonth() === m) {
          revenue += effectiveReceivedFromOtherIncome(oi)
        }
      }
      for (const e of expenses) {
        const d = new Date(e.expense_at)
        if (d.getFullYear() === year && d.getMonth() === m) {
          exp += e.amount_cents
        }
      }
      arr.push({
        month: monthNames[m]!,
        revenue: revenue / 100,
        profit: (revenue - exp) / 100,
      })
    }
    return arr
  }, [visits, retail, otherIncomes, expenses, year, monthNames])

  // Chart 2: expenses per month
  const expensesByMonth = useMemo(() => {
    const arr: Array<{ month: string; expenses: number }> = []
    for (let m = 0; m < 12; m++) {
      let exp = 0
      for (const e of expenses) {
        const d = new Date(e.expense_at)
        if (d.getFullYear() === year && d.getMonth() === m) {
          exp += e.amount_cents
        }
      }
      arr.push({ month: monthNames[m]!, expenses: exp / 100 })
    }
    return arr
  }, [expenses, year, monthNames])

  // Chart 3: top-10 categories
  const topCategories = useMemo(() => {
    const byCat = new Map<string, number>()
    for (const e of expenses) {
      if (!e.category_id) continue
      byCat.set(e.category_id, (byCat.get(e.category_id) ?? 0) + e.amount_cents)
    }
    const arr = Array.from(byCat.entries())
      .map(([id, amount]) => ({
        name: categories.find((c) => c.id === id)?.name ?? '—',
        value: amount / 100,
      }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 10)
    return arr
  }, [expenses, categories])

  const totalExpenses = topCategories.reduce((s, c) => s + c.value, 0)

  return (
    <div className="space-y-5">
      {/* Chart 1: revenue + profit */}
      <div className="border-border bg-card shadow-finsm rounded-lg border p-4">
        <h3 className="text-brand-navy mb-3 text-sm font-bold tracking-tight">
          {t('reports.pnl_charts.revenue_profit_title', {
            defaultValue: 'Динамика выручки и прибыли за 12 месяцев',
          })}
        </h3>
        <div className="h-[260px]">
          <ResponsiveContainer>
            <LineChart data={revenueProfit}>
              <XAxis dataKey="month" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
              <Tooltip
                formatter={(value: number) => formatCurrency(Math.round(value * 100), currency)}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Line
                type="monotone"
                dataKey="revenue"
                stroke="#2E9E6B"
                strokeWidth={2}
                name={t('reports.pnl_charts.revenue', { defaultValue: 'Выручка' })}
              />
              <Line
                type="monotone"
                dataKey="profit"
                stroke="#1E6B8A"
                strokeWidth={2}
                name={t('reports.pnl_charts.profit', { defaultValue: 'Прибыль' })}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Chart 2: expenses */}
      <div className="border-border bg-card shadow-finsm rounded-lg border p-4">
        <h3 className="text-brand-navy mb-3 text-sm font-bold tracking-tight">
          {t('reports.pnl_charts.expenses_title', {
            defaultValue: 'Динамика расходов за 12 месяцев',
          })}
        </h3>
        <div className="h-[220px]">
          <ResponsiveContainer>
            <BarChart data={expensesByMonth}>
              <XAxis dataKey="month" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
              <Tooltip
                formatter={(value: number) => formatCurrency(Math.round(value * 100), currency)}
              />
              <Bar
                dataKey="expenses"
                fill="#D97757"
                name={t('reports.pnl_charts.expenses', { defaultValue: 'Расходы' })}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Chart 3: donut + top-10 */}
      <div className="border-border bg-card shadow-finsm rounded-lg border p-4">
        <h3 className="text-brand-navy mb-3 text-sm font-bold tracking-tight">
          {t('reports.pnl_charts.structure_title', {
            defaultValue: 'Структура расходов + ТОП-10',
          })}
        </h3>
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          <div className="h-[280px]">
            {topCategories.length === 0 ? (
              <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
                {t('reports.pnl_charts.empty', { defaultValue: 'Нет данных за период' })}
              </div>
            ) : (
              <ResponsiveContainer>
                <PieChart>
                  <Pie
                    data={topCategories}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={100}
                  >
                    {topCategories.map((_, i) => (
                      <Cell key={i} fill={DONUT_COLORS[i % DONUT_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(value: number) => formatCurrency(Math.round(value * 100), currency)}
                  />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
          <div>
            <table className="w-full text-sm">
              <thead className="text-muted-foreground border-border border-b text-[11px] uppercase tracking-wider">
                <tr>
                  <th className="py-2 text-left">#</th>
                  <th className="py-2 text-left">
                    {t('reports.pnl_charts.category', { defaultValue: 'Категория' })}
                  </th>
                  <th className="py-2 text-right">
                    {t('reports.pnl_charts.amount', { defaultValue: 'Сумма' })}
                  </th>
                  <th className="py-2 text-right">%</th>
                </tr>
              </thead>
              <tbody>
                {topCategories.map((cat, i) => (
                  <tr key={i} className="border-border/40 border-b last:border-b-0">
                    <td className="py-1.5">
                      <span
                        className="inline-block size-3 rounded-sm"
                        style={{ background: DONUT_COLORS[i % DONUT_COLORS.length] }}
                      />
                    </td>
                    <td className="py-1.5">{cat.name}</td>
                    <td className="num py-1.5 text-right">
                      {formatCurrency(Math.round(cat.value * 100), currency)}
                    </td>
                    <td className="num text-muted-foreground py-1.5 text-right">
                      {totalExpenses > 0
                        ? `${((cat.value / totalExpenses) * 100).toFixed(1)}%`
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}
