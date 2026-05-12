import { addMonths, endOfMonth, format, startOfMonth } from 'date-fns'
import { ru } from 'date-fns/locale'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
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

  const [cursor, setCursor] = useState(() => startOfMonth(new Date()))
  const from = format(startOfMonth(cursor), 'yyyy-MM-dd')
  const to = format(endOfMonth(cursor), 'yyyy-MM-dd')

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
