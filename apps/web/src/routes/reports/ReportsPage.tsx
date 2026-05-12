import { format } from 'date-fns'
import { FileSpreadsheet, Printer, TrendingDown, TrendingUp } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useParams } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import {
  currentMonthPeriod,
  periodToRange,
  type PeriodValue,
} from '@/components/ui/period-picker-utils'
import { PeriodPickerPopover } from '@/components/ui/PeriodPickerPopover'
import {
  useAnalyticsKpis,
  useRevenueByPayment,
  useRevenueByService,
  useRevenueByStaff,
  useVisitsHeatmap,
  type HeatmapCell,
  type PaymentMethodRow,
  type ServiceRevenueRow,
  type StaffRevenueRow,
} from '@/hooks/useAnalytics'
import { useSalon } from '@/hooks/useSalons'
import { formatCurrency } from '@/lib/utils/format-currency'
import { downloadAsXls, type XlsTable } from './export-xls'

const PAYMENT_METHOD_KEY: Record<PaymentMethodRow['payment_method'], string> = {
  cash: 'reports.payment.cash',
  card: 'reports.payment.card',
  transfer: 'reports.payment.transfer',
  online: 'reports.payment.online',
  mixed: 'reports.payment.mixed',
}

// Дни недели в порядке Пн → Вс. Postgres extract(dow) даёт 0=Sun..6=Sat,
// поэтому маппинг: 1,2,3,4,5,6,0
const WEEKDAYS_MON_FIRST: { dow: number; key: string }[] = [
  { dow: 1, key: 'reports.weekday.mon' },
  { dow: 2, key: 'reports.weekday.tue' },
  { dow: 3, key: 'reports.weekday.wed' },
  { dow: 4, key: 'reports.weekday.thu' },
  { dow: 5, key: 'reports.weekday.fri' },
  { dow: 6, key: 'reports.weekday.sat' },
  { dow: 0, key: 'reports.weekday.sun' },
]

// Часы только бизнес-окно 8..21 (можно расширить, но для UX компактнее)
const BUSINESS_HOURS = Array.from({ length: 14 }, (_, i) => i + 8)

export function ReportsPage() {
  const { t } = useTranslation()
  const { salonId } = useParams<{ salonId: string }>()
  const { data: salon } = useSalon(salonId)
  const currency = salon?.currency ?? 'PLN'
  const timezone = salon?.timezone ?? 'Europe/Warsaw'

  // Единый PeriodPickerPopover вместо month/range toggle. Поддерживает
  // месяц, год, range Od-Do, recent N days, + quick chips.
  const [period, setPeriod] = useState<PeriodValue>(() => currentMonthPeriod())
  const range = periodToRange(period)
  const periodStart = range.start
  const periodEnd = range.end
  const periodStartIso = periodStart.toISOString()
  const periodEndIso = new Date(periodEnd.getTime() + 1).toISOString()

  // Предыдущий период — сдвиг назад на ту же длительность.
  const prevDurationMs = periodEnd.getTime() - periodStart.getTime()
  const prevStart = new Date(periodStart.getTime() - prevDurationMs - 1)
  const prevEnd = new Date(periodStart.getTime() - 1)

  const kpis = useAnalyticsKpis(salonId, periodStartIso, periodEndIso)
  const prevKpis = useAnalyticsKpis(salonId, prevStart.toISOString(), prevEnd.toISOString())
  const byStaff = useRevenueByStaff(salonId, periodStartIso, periodEndIso)
  const byService = useRevenueByService(salonId, periodStartIso, periodEndIso)
  const byPayment = useRevenueByPayment(salonId, periodStartIso, periodEndIso)
  const heatmap = useVisitsHeatmap(salonId, periodStartIso, periodEndIso, timezone)

  if (!salonId) return null

  function handleExportXls() {
    const tables: XlsTable[] = []
    tables.push({
      title:
        t('reports.kpi.revenue') +
        ' / ' +
        t('reports.kpi.expense') +
        ' / ' +
        t('reports.kpi.profit'),
      headers: [t('reports.kpi.revenue'), t('reports.kpi.expense'), t('reports.kpi.profit')],
      rows: [
        [
          (kpis.data?.revenue_cents ?? 0) / 100,
          (kpis.data?.expense_cents ?? 0) / 100,
          (kpis.data?.profit_cents ?? 0) / 100,
        ],
      ],
    })
    if ((byStaff.data ?? []).length > 0) {
      tables.push({
        title: t('reports.staff.title'),
        headers: [t('reports.service.name'), t('reports.kpi.revenue')],
        rows: byStaff.data!.map((r) => [r.full_name, r.revenue_cents / 100]),
      })
    }
    if ((byService.data ?? []).length > 0) {
      tables.push({
        title: t('reports.service.title'),
        headers: [
          t('reports.service.name'),
          t('reports.service.visits'),
          t('reports.service.revenue'),
          t('reports.service.margin') + ' (%)',
        ],
        rows: byService.data!.map((r) => [
          r.service_name,
          r.visits_count,
          r.revenue_cents / 100,
          r.margin_pct == null ? '' : r.margin_pct,
        ]),
      })
    }
    if ((byPayment.data ?? []).length > 0) {
      tables.push({
        title: t('reports.payment.title'),
        headers: [t('reports.service.name'), t('reports.kpi.revenue')],
        rows: byPayment.data!.map((r) => [
          t(PAYMENT_METHOD_KEY[r.payment_method] ?? 'reports.payment.unknown'),
          r.revenue_cents / 100,
        ]),
      })
    }
    const filename = `finkley-report-${format(periodStart, 'yyyy-MM-dd')}_${format(periodEnd, 'yyyy-MM-dd')}`
    downloadAsXls(tables, filename)
  }

  return (
    <div className="flex flex-1 flex-col px-5 py-7 sm:px-8 lg:pb-12">
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-brand-navy text-2xl font-bold tracking-tight">
            {t('reports.title')}
          </h1>
          <p className="text-muted-foreground mt-1 text-sm print:hidden">{t('reports.subtitle')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 print:hidden">
          <PeriodPickerPopover value={period} onChange={setPeriod} />
          <Button variant="outline" onClick={handleExportXls}>
            <FileSpreadsheet className="size-4" strokeWidth={2} />
            {t('reports.export_xls')}
          </Button>
          <Button variant="outline" onClick={() => window.print()}>
            <Printer className="size-4" strokeWidth={2} />
            {t('reports.print')}
          </Button>
        </div>
      </div>

      <div className="mb-3 hidden text-sm print:block">
        {t('reports.print_period', {
          start: format(periodStart, 'dd.MM.yyyy'),
          end: format(periodEnd, 'dd.MM.yyyy'),
        })}
      </div>

      {/* P&L summary с дельтой к прошлому месяцу */}
      <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <KpiCard
          label={t('reports.kpi.revenue')}
          value={formatCurrency(kpis.data?.revenue_cents ?? 0, currency)}
          delta={delta(kpis.data?.revenue_cents, prevKpis.data?.revenue_cents)}
          positive
        />
        <KpiCard
          label={t('reports.kpi.expense')}
          value={formatCurrency(kpis.data?.expense_cents ?? 0, currency)}
          delta={delta(kpis.data?.expense_cents, prevKpis.data?.expense_cents)}
          positive={false}
        />
        <KpiCard
          label={t('reports.kpi.profit')}
          value={formatCurrency(kpis.data?.profit_cents ?? 0, currency)}
          delta={delta(kpis.data?.profit_cents, prevKpis.data?.profit_cents)}
          positive
        />
      </section>

      <section className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <RevenueByStaffCard rows={byStaff.data ?? []} currency={currency} />
        <RevenueByPaymentCard rows={byPayment.data ?? []} currency={currency} />
      </section>

      <section className="mt-4">
        <RevenueByServiceCard rows={byService.data ?? []} currency={currency} />
      </section>

      <section className="mt-4">
        <HeatmapCard cells={heatmap.data ?? []} />
      </section>
    </div>
  )
}

function delta(current: number | undefined, previous: number | undefined): number | null {
  if (current == null || previous == null) return null
  if (previous === 0) {
    if (current === 0) return 0
    return null // деление на 0 — не показываем процент
  }
  return ((current - previous) / Math.abs(previous)) * 100
}

function KpiCard({
  label,
  value,
  delta,
  positive,
}: {
  label: string
  value: string
  delta: number | null
  positive: boolean
}) {
  const { t } = useTranslation()
  const goodDirection = positive ? (delta ?? 0) >= 0 : (delta ?? 0) <= 0
  const Icon = (delta ?? 0) >= 0 ? TrendingUp : TrendingDown
  return (
    <div className="border-border bg-card shadow-finsm rounded-lg border p-4">
      <div className="text-muted-foreground text-xs font-bold uppercase tracking-wider">
        {label}
      </div>
      <div className="num text-brand-navy mt-1.5 text-2xl font-bold">{value}</div>
      {delta != null ? (
        <div
          className={`mt-1.5 flex items-center gap-1 text-xs ${
            goodDirection ? 'text-emerald-600' : 'text-destructive'
          }`}
        >
          <Icon className="size-3.5" strokeWidth={2.2} />
          <span className="num font-semibold">
            {delta > 0 ? '+' : ''}
            {delta.toFixed(1)}%
          </span>
          <span className="text-muted-foreground">{t('reports.kpi.vs_prev')}</span>
        </div>
      ) : null}
    </div>
  )
}

function RevenueByStaffCard({ rows, currency }: { rows: StaffRevenueRow[]; currency: string }) {
  const { t } = useTranslation()
  const max = Math.max(1, ...rows.map((r) => r.revenue_cents))
  return (
    <div className="border-border bg-card shadow-finsm rounded-lg border p-4">
      <h2 className="text-brand-navy mb-3 text-sm font-bold uppercase tracking-wider">
        {t('reports.staff.title')}
      </h2>
      {rows.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t('reports.empty')}</p>
      ) : (
        <div className="flex flex-col gap-2">
          {rows.map((r) => (
            <div key={r.staff_id} className="flex flex-col gap-1">
              <div className="flex items-center justify-between text-sm">
                <span className="text-brand-navy truncate font-semibold">{r.full_name}</span>
                <span className="num shrink-0">{formatCurrency(r.revenue_cents, currency)}</span>
              </div>
              <div className="bg-muted h-1.5 overflow-hidden rounded-full">
                <div
                  className="bg-brand-navy h-full"
                  style={{ width: `${(r.revenue_cents / max) * 100}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function RevenueByPaymentCard({ rows, currency }: { rows: PaymentMethodRow[]; currency: string }) {
  const { t } = useTranslation()
  const total = rows.reduce((s, r) => s + r.revenue_cents, 0)
  return (
    <div className="border-border bg-card shadow-finsm rounded-lg border p-4">
      <h2 className="text-brand-navy mb-3 text-sm font-bold uppercase tracking-wider">
        {t('reports.payment.title')}
      </h2>
      {rows.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t('reports.empty')}</p>
      ) : (
        <div className="flex flex-col gap-2.5">
          {rows.map((r) => {
            const share = total > 0 ? (r.revenue_cents / total) * 100 : 0
            return (
              <div key={r.payment_method ?? 'null'} className="flex flex-col gap-1">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-brand-navy font-semibold">
                    {t(PAYMENT_METHOD_KEY[r.payment_method] ?? 'reports.payment.unknown')}
                  </span>
                  <span className="num">
                    {formatCurrency(r.revenue_cents, currency)}{' '}
                    <span className="text-muted-foreground text-xs">({share.toFixed(0)}%)</span>
                  </span>
                </div>
                <div className="bg-muted h-1.5 overflow-hidden rounded-full">
                  <div className="bg-brand-yellow-deep h-full" style={{ width: `${share}%` }} />
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function RevenueByServiceCard({ rows, currency }: { rows: ServiceRevenueRow[]; currency: string }) {
  const { t } = useTranslation()
  const max = Math.max(1, ...rows.map((r) => r.revenue_cents))
  return (
    <div className="border-border bg-card shadow-finsm rounded-lg border p-4">
      <h2 className="text-brand-navy mb-3 text-sm font-bold uppercase tracking-wider">
        {t('reports.service.title')}
      </h2>
      {rows.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t('reports.empty')}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-muted-foreground text-left text-xs font-bold uppercase tracking-wider">
                <th className="py-1.5 pr-2">{t('reports.service.name')}</th>
                <th className="py-1.5 pr-2 text-right">{t('reports.service.visits')}</th>
                <th className="py-1.5 pr-2 text-right">{t('reports.service.revenue')}</th>
                <th className="py-1.5 pr-2 text-right">{t('reports.service.margin')}</th>
                <th className="py-1.5">{t('reports.service.share')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.service_id} className="border-border border-t">
                  <td className="text-brand-navy max-w-[260px] truncate py-2 pr-2 font-semibold">
                    {r.service_name}
                  </td>
                  <td className="num py-2 pr-2 text-right">{r.visits_count}</td>
                  <td className="num py-2 pr-2 text-right">
                    {formatCurrency(r.revenue_cents, currency)}
                  </td>
                  <td className="num py-2 pr-2 text-right">
                    {r.margin_pct == null ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      <span
                        className={
                          r.margin_pct >= 50
                            ? 'text-brand-sage'
                            : r.margin_pct >= 35
                              ? 'text-brand-gold-deep'
                              : 'text-brand-red'
                        }
                      >
                        {r.margin_pct.toFixed(0)}%
                      </span>
                    )}
                  </td>
                  <td className="py-2">
                    <div className="bg-muted h-1.5 w-full overflow-hidden rounded-full">
                      <div
                        className="bg-brand-navy h-full"
                        style={{ width: `${(r.revenue_cents / max) * 100}%` }}
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function HeatmapCard({ cells }: { cells: HeatmapCell[] }) {
  const { t } = useTranslation()
  const cellMap = useMemo(() => {
    const m = new Map<string, number>()
    for (const c of cells) m.set(`${c.dow}:${c.hour_of_day}`, c.visits_count)
    return m
  }, [cells])
  const maxCount = Math.max(1, ...cells.map((c) => c.visits_count))

  return (
    <div className="border-border bg-card shadow-finsm rounded-lg border p-4">
      <h2 className="text-brand-navy mb-3 text-sm font-bold uppercase tracking-wider">
        {t('reports.heatmap.title')}
      </h2>
      {cells.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t('reports.empty')}</p>
      ) : (
        <div className="overflow-x-auto">
          <div
            className="grid gap-0.5"
            style={{
              gridTemplateColumns: `60px repeat(${BUSINESS_HOURS.length}, minmax(22px, 1fr))`,
            }}
          >
            {/* Header — часы */}
            <div />
            {BUSINESS_HOURS.map((h) => (
              <div
                key={`h-${h}`}
                className="text-muted-foreground text-center text-[10px] font-semibold"
              >
                {h}
              </div>
            ))}
            {/* Строки */}
            {WEEKDAYS_MON_FIRST.map((wd) => (
              <Row
                key={wd.dow}
                label={t(wd.key)}
                cells={BUSINESS_HOURS.map((h) => cellMap.get(`${wd.dow}:${h}`) ?? 0)}
                max={maxCount}
              />
            ))}
          </div>
          <p className="text-muted-foreground mt-3 text-xs">{t('reports.heatmap.legend')}</p>
        </div>
      )}
    </div>
  )
}

function Row({ label, cells, max }: { label: string; cells: number[]; max: number }) {
  return (
    <>
      <div className="text-muted-foreground py-1 pr-2 text-right text-[11px] font-semibold">
        {label}
      </div>
      {cells.map((count, i) => {
        const intensity = count / max
        const bg = count === 0 ? 'transparent' : `rgba(28, 30, 79, ${0.15 + intensity * 0.7})` // brand-navy с альфа
        return (
          <div
            key={i}
            className="border-border h-7 rounded-sm border text-center"
            style={{ background: bg }}
            title={count ? `${count}` : ''}
          >
            {count > 0 ? (
              <span
                className={`num text-[10px] font-bold ${intensity > 0.5 ? 'text-white' : 'text-brand-navy'}`}
              >
                {count}
              </span>
            ) : null}
          </div>
        )
      })}
    </>
  )
}
