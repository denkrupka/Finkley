import { Award, Clock, Repeat, TrendingDown, Users, Wallet } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { AiInsightsPanel } from '@/components/reports/AiInsightsPanel'
import {
  currentMonthPeriod,
  periodLabel,
  periodToRange,
  type PeriodValue,
} from '@/components/ui/period-picker-utils'
import { PeriodPickerPopover } from '@/components/ui/PeriodPickerPopover'
import { usePayoutsPreview } from '@/hooks/usePayouts'
import { usePayrollAdvances } from '@/hooks/usePayrollAdvances'
import { useSalon } from '@/hooks/useSalons'
import { useStaffPerformanceAdvanced } from '@/hooks/useStaffPerformance'
import { computeRowTotals } from '@/lib/payouts/totals'
import { formatCurrency } from '@/lib/utils/format-currency'

/**
 * Мастер-дашборд — то, что видит роль staff («Мастер») вместо owner-дашборда
 * с финансами салона. Показывает данные ТОЛЬКО по самому мастеру (по его
 * staff_id):
 *   1. Зарплата за период — те же расчёты, что в Отчёты → Зарплаты
 *      (RPC calculate_payouts_for_period), отфильтрованные по этому мастеру.
 *   2. Его показатели — из Отчёты → Мастера (RPC staff_performance_advanced).
 *   3. AI-советы лично мастеру — как подтянуть показатели и стать лучше
 *      (edge ai-report-insights, kind='staff', payload по одному мастеру).
 *
 * Период — собственный пикер (как в отчётах), дефолт = текущий месяц.
 */
export function MasterDashboard({ salonId, staffId }: { salonId: string; staffId: string }) {
  const { t } = useTranslation()
  const { data: salon } = useSalon(salonId)
  const currency = salon?.currency ?? 'PLN'

  const [period, setPeriod] = useState<PeriodValue>(() => currentMonthPeriod())
  const range = periodToRange(period)
  const startIso = range.start.toISOString()
  const endIso = range.end.toISOString()
  // RPC зарплат принимает date-only; performance — ISO timestamptz.
  const startDate = startIso.slice(0, 10)
  const endDate = endIso.slice(0, 10)

  const { data: payouts = [], isLoading: payoutsLoading } = usePayoutsPreview(
    salonId,
    startDate,
    endDate,
  )
  const { data: advancesByStaff } = usePayrollAdvances(salonId, startDate, endDate)
  const { data: perfRows = [], isLoading: perfLoading } = useStaffPerformanceAdvanced(
    salonId,
    startIso,
    endIso,
  )

  const myPayout = payouts.find((r) => r.staff_id === staffId) ?? null
  const myPerf = perfRows.find((r) => r.staff_id === staffId) ?? null
  const advance = advancesByStaff?.get(staffId) ?? 0
  const totals = myPayout ? computeRowTotals(myPayout, advance) : { accrued: 0, remaining: 0 }

  // AI-payload по одному мастеру (та же форма, что в Reports → Мастера,
  // но staff содержит ровно один элемент — этого мастера).
  const aiPayload = useMemo(() => {
    if (!myPerf) return null
    return {
      period: { start: startDate, end: endDate },
      currency,
      total_revenue_cents: myPerf.total_revenue_cents,
      self: true,
      staff: [
        {
          name: myPerf.full_name,
          is_active: myPerf.is_active,
          revenue_cents: myPerf.total_revenue_cents,
          visits_revenue_cents: myPerf.visits_revenue_cents,
          retail_revenue_cents: myPerf.retail_revenue_cents,
          visits: myPerf.visits_count,
          unique_clients: myPerf.unique_clients_count,
          returned_clients: myPerf.returned_clients_count,
          rebook_pct: myPerf.rebook_pct,
          utilization_pct: myPerf.utilization_pct,
          churn_pct: myPerf.churn_pct,
          scoring: myPerf.scoring,
          revenue_6m_cents: myPerf.revenue_6m_cents,
          hire_date: myPerf.hire_date,
          payout_cents: myPayout?.payout_cents ?? 0,
          tips_cents: myPerf.tips_cents,
          share_pct: 100,
        },
      ],
    }
  }, [myPerf, myPayout, startDate, endDate, currency])

  const money = (c: number) => formatCurrency(c, currency)
  const greetName = myPerf?.full_name?.split(/\s+/)[0] ?? salon?.name ?? ''

  return (
    <div className="flex flex-col gap-5 px-5 py-7 sm:px-8 lg:pb-12">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-brand-navy text-2xl font-bold tracking-tight">
            {t('master_dashboard.title', {
              defaultValue: greetName ? `Привет, ${greetName}!` : 'Мой дашборд',
              name: greetName,
            })}
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {t('master_dashboard.subtitle', {
              defaultValue: 'Твоя зарплата и показатели за период',
            })}{' '}
            · {periodLabel(period)}
          </p>
        </div>
        <PeriodPickerPopover value={period} onChange={setPeriod} />
      </div>

      {/* AI-советы лично мастеру */}
      {aiPayload ? <AiInsightsPanel kind="staff" payload={aiPayload} /> : null}

      {/* Зарплата */}
      <section className="border-border bg-card shadow-finsm overflow-hidden rounded-lg border">
        <h2 className="border-border text-muted-foreground border-b px-5 py-3 text-[11px] font-bold uppercase tracking-wider">
          {t('master_dashboard.salary_title', { defaultValue: 'Моя зарплата за период' })}
        </h2>
        {payoutsLoading ? (
          <p className="text-muted-foreground px-5 py-6 text-sm">
            {t('common.loading', { defaultValue: 'Загрузка…' })}
          </p>
        ) : !myPayout ? (
          <p className="text-muted-foreground px-5 py-6 text-sm">
            {t('master_dashboard.salary_empty', {
              defaultValue: 'Нет начислений за этот период.',
            })}
          </p>
        ) : (
          <div className="bg-border/60 grid grid-cols-2 gap-px sm:grid-cols-4">
            <Metric label={t('master_dashboard.visits', { defaultValue: 'Визитов' })}>
              <span className="num">{myPayout.visit_count}</span>
            </Metric>
            <Metric label={t('master_dashboard.revenue', { defaultValue: 'Выручка' })}>
              {money(myPayout.revenue_cents)}
            </Metric>
            <Metric label={t('master_dashboard.tips', { defaultValue: 'Чаевые' })}>
              {money(myPayout.tips_cents)}
            </Metric>
            <Metric label={t('master_dashboard.premium', { defaultValue: 'Премия' })}>
              {money(myPayout.premium_cents)}
            </Metric>
            <Metric label={t('master_dashboard.accrued', { defaultValue: 'Начислено' })}>
              {money(totals.accrued)}
            </Metric>
            <Metric label={t('master_dashboard.advances', { defaultValue: 'Авансы' })}>
              {money(advance)}
            </Metric>
            <Metric
              label={t('master_dashboard.remaining', { defaultValue: 'К выплате' })}
              highlight
            >
              {money(totals.remaining)}
            </Metric>
          </div>
        )}
      </section>

      {/* Показатели (Отчёты → Мастера, по этому мастеру) */}
      <section className="border-border bg-card shadow-finsm overflow-hidden rounded-lg border">
        <h2 className="border-border text-muted-foreground border-b px-5 py-3 text-[11px] font-bold uppercase tracking-wider">
          {t('master_dashboard.perf_title', { defaultValue: 'Мои показатели' })}
        </h2>
        {perfLoading ? (
          <p className="text-muted-foreground px-5 py-6 text-sm">
            {t('common.loading', { defaultValue: 'Загрузка…' })}
          </p>
        ) : !myPerf ? (
          <p className="text-muted-foreground px-5 py-6 text-sm">
            {t('master_dashboard.perf_empty', {
              defaultValue: 'Нет данных за этот период.',
            })}
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-4 px-5 py-4 sm:grid-cols-3 lg:grid-cols-4">
            <PerfStat
              icon={Wallet}
              label={t('master_dashboard.perf_revenue', { defaultValue: 'Выручка (всего)' })}
              value={money(myPerf.total_revenue_cents)}
            />
            <PerfStat
              icon={Users}
              label={t('master_dashboard.perf_visits', { defaultValue: 'Визитов / клиентов' })}
              value={`${myPerf.visits_count} / ${myPerf.unique_clients_count}`}
            />
            <PerfStat
              icon={Repeat}
              label={t('master_dashboard.perf_rebook', { defaultValue: 'Повторные записи' })}
              value={`${Math.round(myPerf.rebook_pct)}%`}
            />
            <PerfStat
              icon={Clock}
              label={t('master_dashboard.perf_utilization', { defaultValue: 'Загрузка' })}
              value={`${Math.round(myPerf.utilization_pct)}%`}
            />
            <PerfStat
              icon={TrendingDown}
              label={t('master_dashboard.perf_churn', { defaultValue: 'Отток клиентов' })}
              value={`${Math.round(myPerf.churn_pct)}%`}
            />
            <PerfStat
              icon={Award}
              label={t('master_dashboard.perf_scoring', { defaultValue: 'Оценка эффективности' })}
              value={myPerf.scoring.toFixed(1)}
            />
            <PerfStat
              icon={Wallet}
              label={t('master_dashboard.perf_tips', { defaultValue: 'Чаевые' })}
              value={money(myPerf.tips_cents)}
            />
            <PerfStat
              icon={Wallet}
              label={t('master_dashboard.perf_revenue_6m', { defaultValue: 'Выручка за 6 мес.' })}
              value={money(myPerf.revenue_6m_cents)}
            />
          </div>
        )}
      </section>
    </div>
  )
}

function Metric({
  label,
  children,
  highlight = false,
}: {
  label: string
  children: React.ReactNode
  highlight?: boolean
}) {
  return (
    <div className="bg-card px-4 py-3">
      <p className="text-muted-foreground text-[11px] font-semibold uppercase tracking-wide">
        {label}
      </p>
      <p
        className={`num mt-1 text-base font-bold ${highlight ? 'text-secondary' : 'text-foreground'}`}
      >
        {children}
      </p>
    </div>
  )
}

function PerfStat({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Wallet
  label: string
  value: React.ReactNode
}) {
  return (
    <div className="flex items-start gap-2.5">
      <span className="bg-muted text-muted-foreground mt-0.5 grid size-8 shrink-0 place-items-center rounded-md">
        <Icon className="size-4" strokeWidth={1.8} />
      </span>
      <div className="min-w-0">
        <p className="text-muted-foreground text-[11px] font-semibold uppercase tracking-wide">
          {label}
        </p>
        <p className="num text-foreground mt-0.5 text-base font-bold">{value}</p>
      </div>
    </div>
  )
}
