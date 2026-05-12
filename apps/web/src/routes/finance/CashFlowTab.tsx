import { format } from 'date-fns'
import { ru } from 'date-fns/locale'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import {
  currentMonthPeriod,
  periodToRange,
  type PeriodValue,
} from '@/components/ui/period-picker-utils'
import { PeriodPickerPopover } from '@/components/ui/PeriodPickerPopover'
import { useCashFlowDaily } from '@/hooks/useCashFlow'
import { useSalon } from '@/hooks/useSalons'
import { formatCurrency } from '@/lib/utils/format-currency'

/**
 * Контент таба «ДДС» страницы /finance. Показывает приход/расход/нетто по
 * дням за выбранный месяц + накопительный остаток.
 *
 * MVP: только таблица. Графики (line chart) — следующий спринт.
 */
export function CashFlowTab({ salonId }: { salonId: string }) {
  const { t } = useTranslation()
  const { data: salon } = useSalon(salonId)
  const currency = salon?.currency ?? 'PLN'

  const [period, setPeriod] = useState<PeriodValue>(() => currentMonthPeriod())
  const range = periodToRange(period)
  const from = format(range.start, 'yyyy-MM-dd')
  const to = format(range.end, 'yyyy-MM-dd')

  const { data: rows = [], isLoading } = useCashFlowDaily(salonId, from, to)

  const { totalIn, totalOut, totalNet, withRunning } = useMemo(() => {
    let running = 0
    let tIn = 0
    let tOut = 0
    const wr = rows.map((r) => {
      running += r.net_cents
      tIn += r.inflow_cents
      tOut += r.outflow_cents
      return { ...r, running_cents: running }
    })
    return { totalIn: tIn, totalOut: tOut, totalNet: tIn - tOut, withRunning: wr }
  }, [rows])

  return (
    <div>
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-brand-navy text-lg font-bold tracking-tight">
          {t('finance.cashflow.title')}
        </h2>
        <PeriodPickerPopover value={period} onChange={setPeriod} />
      </div>

      {/* Totals */}
      <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="border-border bg-card shadow-finsm rounded-lg border p-4">
          <p className="text-muted-foreground text-xs uppercase tracking-wider">
            {t('finance.cashflow.total_inflow')}
          </p>
          <p className="num text-brand-sage-deep mt-1 text-2xl font-bold">
            +{formatCurrency(totalIn, currency)}
          </p>
        </div>
        <div className="border-border bg-card shadow-finsm rounded-lg border p-4">
          <p className="text-muted-foreground text-xs uppercase tracking-wider">
            {t('finance.cashflow.total_outflow')}
          </p>
          <p className="num text-destructive mt-1 text-2xl font-bold">
            −{formatCurrency(totalOut, currency)}
          </p>
        </div>
        <div className="border-border bg-card shadow-finsm rounded-lg border p-4">
          <p className="text-muted-foreground text-xs uppercase tracking-wider">
            {t('finance.cashflow.total_net')}
          </p>
          <p
            className={`num mt-1 text-2xl font-bold ${
              totalNet >= 0 ? 'text-brand-sage-deep' : 'text-destructive'
            }`}
          >
            {totalNet >= 0 ? '+' : '−'}
            {formatCurrency(Math.abs(totalNet), currency)}
          </p>
        </div>
      </div>

      {/* Chart */}
      {withRunning.some((r) => r.inflow_cents !== 0 || r.outflow_cents !== 0) ? (
        <div className="border-border bg-card shadow-finsm mb-5 rounded-lg border p-4">
          <ResponsiveContainer width="100%" height={260}>
            <ComposedChart
              data={withRunning.map((r) => ({
                day: format(new Date(r.day), 'd MMM', { locale: ru }),
                inflow: r.inflow_cents / 100,
                outflow: -(r.outflow_cents / 100),
                running: r.running_cents / 100,
              }))}
              margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#E7E5DE" vertical={false} />
              <XAxis dataKey="day" tickLine={false} fontSize={11} stroke="#9A9A9A" />
              <YAxis
                tickLine={false}
                fontSize={11}
                stroke="#9A9A9A"
                width={64}
                tickFormatter={(v: number) => {
                  // Компактный формат для оси: 12345 → "12.3k", 1500000 → "1.5m".
                  // Полное значение остаётся в tooltip + в таблице ниже.
                  const abs = Math.abs(v)
                  if (abs >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}m`
                  if (abs >= 1000) return `${(v / 1000).toFixed(abs >= 10_000 ? 0 : 1)}k`
                  return String(Math.round(v))
                }}
              />
              <Tooltip
                formatter={(v: number) => formatCurrency(Math.abs(v) * 100, currency)}
                contentStyle={{
                  borderRadius: 8,
                  border: '1px solid hsl(var(--border))',
                  fontSize: 12,
                }}
              />
              <Legend
                wrapperStyle={{ fontSize: 11 }}
                formatter={(value: string) => t(`finance.cashflow.legend_${value}`)}
              />
              <Bar
                dataKey="inflow"
                name="inflow"
                fill="hsl(var(--brand-sage))"
                radius={[3, 3, 0, 0]}
              />
              <Bar
                dataKey="outflow"
                name="outflow"
                fill="hsl(var(--destructive))"
                radius={[0, 0, 3, 3]}
              />
              <Line
                type="monotone"
                dataKey="running"
                name="running"
                stroke="hsl(var(--brand-navy))"
                strokeWidth={2}
                dot={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      ) : null}

      {/* Daily table */}
      <div className="border-border bg-card shadow-finsm overflow-x-auto rounded-lg border">
        {isLoading ? (
          <div className="text-muted-foreground p-6 text-sm">{t('common.loading')}</div>
        ) : withRunning.length === 0 ? (
          <div className="text-muted-foreground p-6 text-sm">{t('finance.cashflow.empty')}</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-muted-foreground text-xs uppercase tracking-wider">
              <tr>
                <th className="px-4 py-2 text-left font-semibold">
                  {t('finance.cashflow.col_date')}
                </th>
                <th className="px-4 py-2 text-right font-semibold">
                  {t('finance.cashflow.col_inflow')}
                </th>
                <th className="px-4 py-2 text-right font-semibold">
                  {t('finance.cashflow.col_outflow')}
                </th>
                <th className="px-4 py-2 text-right font-semibold">
                  {t('finance.cashflow.col_net')}
                </th>
                <th className="px-4 py-2 text-right font-semibold">
                  {t('finance.cashflow.col_running')}
                </th>
              </tr>
            </thead>
            <tbody>
              {withRunning
                // Скрываем дни без движений — нет смысла показывать
                .filter((r) => r.inflow_cents !== 0 || r.outflow_cents !== 0)
                .map((r) => (
                  <tr key={r.day} className="border-border/60 border-t">
                    <td className="text-muted-foreground px-4 py-2 text-xs">
                      {format(new Date(r.day), 'd MMM, EEEEEE', { locale: ru })}
                    </td>
                    <td className="num text-brand-sage-deep px-4 py-2 text-right font-semibold">
                      {r.inflow_cents > 0 ? `+${formatCurrency(r.inflow_cents, currency)}` : '—'}
                    </td>
                    <td className="num text-destructive px-4 py-2 text-right font-semibold">
                      {r.outflow_cents > 0 ? `−${formatCurrency(r.outflow_cents, currency)}` : '—'}
                    </td>
                    <td
                      className={`num px-4 py-2 text-right font-semibold ${
                        r.net_cents > 0
                          ? 'text-brand-sage-deep'
                          : r.net_cents < 0
                            ? 'text-destructive'
                            : 'text-muted-foreground'
                      }`}
                    >
                      {r.net_cents > 0 ? '+' : r.net_cents < 0 ? '−' : ''}
                      {formatCurrency(Math.abs(r.net_cents), currency)}
                    </td>
                    <td
                      className={`num px-4 py-2 text-right font-semibold ${
                        r.running_cents >= 0 ? 'text-foreground' : 'text-destructive'
                      }`}
                    >
                      {r.running_cents >= 0 ? '' : '−'}
                      {formatCurrency(Math.abs(r.running_cents), currency)}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
