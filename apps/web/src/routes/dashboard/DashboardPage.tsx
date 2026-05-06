import { ArrowRight, TrendingUp } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link, useParams, useSearchParams } from 'react-router-dom'

import { useTopServices, useTopStaff, useDashboardKpis } from '@/hooks/useDashboard'
import { useSalon } from '@/hooks/useSalons'
import { useStaff } from '@/hooks/useStaff'
import { useAuth } from '@/hooks/useAuth'
import { useVisits, type PaymentMethod } from '@/hooks/useVisits'
import { getPeriodRange, type PeriodKey } from '@/lib/period'
import { cn } from '@/lib/utils/cn'
import { formatCurrency } from '@/lib/utils/format-currency'
import { formatVisitDate } from '@/lib/utils/format-date'

const STAFF_PALETTE = ['#F4D7C5', '#D7E4C5', '#C5DAE4', '#E4C5DC', '#E8C4B8', '#FBE5C0']

const PAY_PILL: Record<PaymentMethod, { bg: string; fg: string }> = {
  cash: { bg: '#EFEEF5', fg: 'hsl(var(--brand-navy))' },
  card: { bg: 'hsl(var(--brand-teal-soft))', fg: 'hsl(var(--brand-teal-deep))' },
  transfer: { bg: 'hsl(var(--brand-sage-soft))', fg: 'hsl(var(--brand-sage))' },
  online: { bg: '#E5F0F4', fg: 'hsl(var(--brand-teal))' },
  mixed: { bg: '#EEE', fg: 'hsl(var(--brand-navy))' },
}

export function DashboardPage() {
  const { t } = useTranslation()
  const { salonId } = useParams<{ salonId: string }>()
  const [params] = useSearchParams()
  const period = (params.get('period') ?? 'month') as PeriodKey
  const range = getPeriodRange(period)

  const { user } = useAuth()
  const { data: salon } = useSalon(salonId)
  const { data: kpis, isLoading: kpisLoading } = useDashboardKpis(salonId, range)
  const { data: topStaff = [] } = useTopStaff(salonId, range, 4)
  const { data: topServices = [], isLoading: servicesLoading } = useTopServices(salonId, range, 5)
  const { data: visits = [] } = useVisits(salonId, range)
  const { data: staff = [] } = useStaff(salonId)

  if (!salon || !salonId) return null
  const currency = salon.currency

  const firstName = (user?.user_metadata?.full_name ?? '').split(' ')[0]

  // Empty state — нет ни визитов, ни расходов
  const isEmpty =
    !kpisLoading && (kpis?.visits_count ?? 0) === 0 && (kpis?.expense_cents ?? 0) === 0

  // Топ-5 последних визитов для нижней таблицы
  const recentVisits = visits.slice(0, 5)

  // Donut: распределение по payment method (% от revenue)
  const paymentTotals = visits.reduce(
    (acc, v) => {
      acc[v.payment_method] = (acc[v.payment_method] ?? 0) + v.amount_cents
      return acc
    },
    {} as Record<PaymentMethod, number>,
  )
  const donutTotal = Object.values(paymentTotals).reduce((a, b) => a + b, 0)
  const donutData: { name: string; pct: number; value: number; color: string }[] = (
    ['cash', 'card', 'transfer'] as const
  )
    .filter((p) => (paymentTotals[p] ?? 0) > 0)
    .map((p) => ({
      name: t(`payment_methods.${p}`),
      value: paymentTotals[p] ?? 0,
      pct: donutTotal > 0 ? ((paymentTotals[p] ?? 0) / donutTotal) * 100 : 0,
      color:
        p === 'cash'
          ? 'hsl(var(--brand-navy))'
          : p === 'card'
            ? 'hsl(var(--brand-teal))'
            : 'hsl(var(--brand-sage))',
    }))

  // top-services с margin-цветом (sage/gold/red) — пока без реальной margin (TASK-23)
  // используем revenue/visits как proxy «крупности»
  const maxServiceRev = Math.max(1, ...topServices.map((s) => s.revenue_cents))

  return (
    <div className="flex flex-1 flex-col px-5 py-7 sm:px-8 lg:pb-12">
      {/* Greeting */}
      <header className="mb-5">
        <h1 className="text-brand-navy text-2xl font-bold tracking-tight">
          {t('dashboard.greeting', { name: firstName || 'там' })} 👋
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          {t(`dashboard.greeting_subtitle_${period}`, {
            defaultValue: t('dashboard.greeting_subtitle_month'),
          })}
        </p>
      </header>

      {isEmpty ? <DashboardEmpty /> : null}

      {/* KPI row */}
      <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
        {kpisLoading ? (
          <>
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard tall />
          </>
        ) : (
          <>
            <KpiCard
              label={t('dashboard.kpi.revenue_label')}
              valueCents={kpis?.revenue_cents ?? 0}
              currency={currency}
              variant="revenue"
            />
            <KpiCard
              label={t('dashboard.kpi.expense_label')}
              valueCents={kpis?.expense_cents ?? 0}
              currency={currency}
              variant="expense"
            />
            <KpiCard
              label={t('dashboard.kpi.profit_label')}
              valueCents={kpis?.profit_cents ?? 0}
              currency={currency}
              variant="profit"
              sublabel={t('dashboard.kpi.profit_sublabel')}
            />
          </>
        )}
      </div>

      {/* 2-col: master bars + donut */}
      <div className="mb-5 grid grid-cols-1 gap-4 lg:grid-cols-[1.5fr_1fr]">
        <Card>
          <CardHeader
            title={t('dashboard.master_bars.title')}
            action={
              <span className="text-muted-foreground text-xs">
                {t('dashboard.master_bars.active_count', {
                  count: staff.filter((s) => s.is_active).length,
                })}
              </span>
            }
          />
          {topStaff.length === 0 ? (
            <p className="text-muted-foreground text-sm">{t('dashboard.master_bars.empty')}</p>
          ) : (
            <div className="flex flex-col gap-3.5">
              {topStaff.map((s, i) => {
                const max = Math.max(1, ...topStaff.map((x) => x.revenue_cents))
                const pct = (s.revenue_cents / max) * 100
                const color = STAFF_PALETTE[i % STAFF_PALETTE.length]!
                return (
                  <div key={s.staff_id}>
                    <div className="mb-1.5 flex items-baseline justify-between">
                      <span className="flex items-center gap-2.5">
                        <span
                          className="text-brand-navy grid size-7 place-items-center rounded-full text-xs font-bold"
                          style={{ background: color }}
                        >
                          {s.full_name.charAt(0).toUpperCase()}
                        </span>
                        <span className="text-foreground text-sm font-semibold">{s.full_name}</span>
                      </span>
                      <span className="num text-brand-navy text-[15px] font-bold">
                        {formatCurrency(s.revenue_cents, currency)}
                      </span>
                    </div>
                    <div className="bg-background h-2 overflow-hidden rounded-full">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${pct}%`,
                          background:
                            'linear-gradient(90deg, hsl(var(--brand-teal)) 0%, hsl(var(--brand-teal-deep)) 100%)',
                        }}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </Card>

        <Card>
          <CardHeader title={t('dashboard.payment_donut.title')} />
          <PaymentDonut data={donutData} total={donutTotal} currency={currency} />
        </Card>
      </div>

      {/* Top services row */}
      <div className="mb-5">
        <Card>
          <CardHeader
            title={t('dashboard.top_services.title')}
            action={
              <Link
                to={`/${salonId}/reports`}
                className="text-secondary inline-flex items-center gap-1 text-sm font-semibold hover:underline"
              >
                {t('dashboard.top_services.see_all')} <ArrowRight className="size-3.5" />
              </Link>
            }
          />
          {servicesLoading ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              {[0, 1, 2, 3, 4].map((i) => (
                <div key={i} className="bg-muted/60 h-24 animate-pulse rounded-md" />
              ))}
            </div>
          ) : topServices.length === 0 ? (
            <p className="text-muted-foreground text-sm">{t('dashboard.top_services.empty')}</p>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              {topServices.map((s, i) => {
                // Псевдо-маржа по доле от лидера: > 70% → sage, > 40% → gold, иначе red
                const share = (s.revenue_cents / maxServiceRev) * 100
                const dot = share > 70 ? 'sage' : share > 40 ? 'gold' : 'red'
                const dotClass =
                  dot === 'sage'
                    ? 'bg-brand-sage'
                    : dot === 'gold'
                      ? 'bg-brand-gold'
                      : 'bg-destructive'
                return (
                  <div
                    key={s.service_id || i}
                    className="border-border bg-card hover:border-secondary flex flex-col gap-1.5 rounded-md border p-3.5 transition-colors"
                  >
                    <div className="text-muted-foreground flex items-center gap-1.5 text-[11px] font-semibold">
                      <span className={cn('size-1.5 rounded-full', dotClass)} />
                      {t('dashboard.top_services.share', { pct: Math.round(share) })}
                    </div>
                    <div className="text-foreground line-clamp-2 text-[14px] font-semibold">
                      {s.service_name}
                    </div>
                    <div className="mt-auto flex items-baseline justify-between">
                      <span className="num text-brand-navy text-base font-bold">
                        {formatCurrency(s.revenue_cents, currency)}
                      </span>
                      <span className="text-brand-text-faint text-[11px]">
                        {t('dashboard.top_services.visits', { count: s.visits_count })}
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </Card>
      </div>

      {/* Recent visits */}
      <Card noPadding>
        <div className="border-border flex items-baseline justify-between border-b px-5 py-4">
          <h2 className="text-brand-navy text-base font-bold tracking-tight">
            {t('dashboard.recent_visits.title')}
          </h2>
          <Link
            to={`/${salonId}/visits`}
            className="text-secondary text-sm font-semibold hover:underline"
          >
            {t('dashboard.recent_visits.show_all')} →
          </Link>
        </div>
        {recentVisits.length === 0 ? (
          <p className="text-muted-foreground px-5 py-12 text-center text-sm">
            {t('dashboard.recent_visits.empty')}
          </p>
        ) : (
          <ul>
            {recentVisits.map((v) => {
              const stf = staff.find((s) => s.id === v.staff_id)
              const idx = staff.findIndex((s) => s.id === v.staff_id)
              const color = idx >= 0 ? STAFF_PALETTE[idx % STAFF_PALETTE.length]! : '#E8E5DF'
              const pay = PAY_PILL[v.payment_method]
              return (
                <li
                  key={v.id}
                  className="border-border grid grid-cols-[60px_1fr_auto_auto] items-center gap-3 border-t px-5 py-3 first:border-t-0 sm:grid-cols-[80px_1.4fr_2fr_120px_120px]"
                >
                  <span className="num text-muted-foreground text-xs">
                    {formatVisitDate(v.visit_at)}
                  </span>
                  <span className="flex items-center gap-2">
                    <span
                      className="text-brand-navy grid size-6 place-items-center rounded-full text-[10px] font-bold"
                      style={{ background: color }}
                    >
                      {(stf?.full_name ?? '?').charAt(0).toUpperCase()}
                    </span>
                    <span className="text-foreground truncate text-sm">
                      {stf?.full_name ?? '—'}
                    </span>
                  </span>
                  <span className="text-foreground hidden truncate text-sm sm:inline">
                    {v.service_name_snapshot ?? '—'}
                  </span>
                  <span className="num text-brand-sage justify-self-end text-sm font-bold">
                    +{formatCurrency(v.amount_cents, currency)}
                  </span>
                  <span
                    className="hidden rounded-full px-2.5 py-0.5 text-[11px] font-semibold sm:inline"
                    style={{ background: pay.bg, color: pay.fg }}
                  >
                    {t(`payment_methods.${v.payment_method}`)}
                  </span>
                </li>
              )
            })}
          </ul>
        )}
      </Card>
    </div>
  )
}

/* ------------ helpers ------------ */

function Card({ children, noPadding }: { children: React.ReactNode; noPadding?: boolean }) {
  return (
    <div
      className={cn('border-border bg-card shadow-finsm rounded-lg border', noPadding ? '' : 'p-5')}
    >
      {children}
    </div>
  )
}

function CardHeader({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <div className="mb-3 flex items-baseline justify-between gap-3">
      <h2 className="text-brand-navy text-base font-bold tracking-tight">{title}</h2>
      {action ?? null}
    </div>
  )
}

function SkeletonCard({ tall }: { tall?: boolean }) {
  return (
    <div
      className={cn(
        'border-border bg-card animate-pulse rounded-lg border',
        tall ? 'h-[140px]' : 'h-[110px]',
      )}
    />
  )
}

function KpiCard({
  label,
  valueCents,
  currency,
  variant,
  sublabel,
}: {
  label: string
  valueCents: number
  currency: string
  variant: 'revenue' | 'expense' | 'profit'
  sublabel?: string
}) {
  const isProfit = variant === 'profit'
  const isExpense = variant === 'expense'
  const sign = isExpense ? '−' : ''
  return (
    <div
      className={cn(
        'shadow-finsm relative overflow-hidden rounded-lg p-5',
        isProfit ? 'bg-primary text-primary-foreground' : 'border-border bg-card border',
      )}
    >
      {isProfit ? (
        <div
          className="pointer-events-none absolute -right-10 -top-10 size-40 rounded-full"
          style={{
            background: 'radial-gradient(circle, rgba(46,158,107,0.18) 0%, transparent 70%)',
          }}
          aria-hidden
        />
      ) : null}
      <div
        className={cn(
          'text-xs font-semibold',
          isProfit ? 'uppercase tracking-wider text-white/65' : 'text-muted-foreground',
        )}
      >
        {label}
      </div>
      <div
        className={cn(
          'num mt-2 font-bold tracking-tight',
          isProfit ? 'text-[44px] leading-none' : 'text-[34px] leading-none',
          !isProfit && (isExpense ? 'text-destructive' : 'text-brand-sage'),
        )}
      >
        {sign}
        {formatCurrency(Math.abs(valueCents), currency)}
      </div>
      {sublabel ? (
        <div
          className={cn(
            'mt-3 flex items-center gap-2 text-xs',
            isProfit ? 'text-white/70' : 'text-muted-foreground',
          )}
        >
          <span>{sublabel}</span>
          {isProfit && valueCents > 0 ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-[rgba(46,158,107,0.22)] px-2 py-0.5 text-[10px] font-bold text-[#7ED9A8]">
              <TrendingUp className="size-3" strokeWidth={2.5} />+
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

function PaymentDonut({
  data,
  total,
  currency,
}: {
  data: { name: string; pct: number; value: number; color: string }[]
  total: number
  currency: string
}) {
  const { t } = useTranslation()
  if (data.length === 0) {
    return <p className="text-muted-foreground text-sm">{t('dashboard.payment_donut.empty')}</p>
  }
  const R = 70
  const C = 2 * Math.PI * R
  let offset = 0

  return (
    <div className="flex flex-col items-center gap-4">
      <div className="relative">
        <svg width="180" height="180" viewBox="0 0 180 180" style={{ transform: 'rotate(-90deg)' }}>
          <circle
            cx="90"
            cy="90"
            r={R}
            fill="none"
            stroke="hsl(var(--background))"
            strokeWidth={20}
          />
          {data.map((d) => {
            const len = (d.pct / 100) * C
            const dash = `${len} ${C - len}`
            const seg = (
              <circle
                key={d.name}
                cx={90}
                cy={90}
                r={R}
                fill="none"
                stroke={d.color}
                strokeWidth={20}
                strokeDasharray={dash}
                strokeDashoffset={-offset}
              />
            )
            offset += len
            return seg
          })}
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <div className="text-muted-foreground text-[11px] font-semibold">
            {t('dashboard.payment_donut.total')}
          </div>
          <div className="num text-brand-navy text-xl font-bold tracking-tight">
            {formatCurrency(total, currency)}
          </div>
        </div>
      </div>

      <div className="flex w-full flex-col gap-2">
        {data.map((d) => (
          <div key={d.name} className="flex items-center gap-2.5 text-sm">
            <span className="size-2.5 rounded-sm" style={{ background: d.color }} />
            <span className="text-foreground flex-1">{d.name}</span>
            <span className="num text-brand-navy font-bold">{Math.round(d.pct)}%</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function DashboardEmpty() {
  const { t } = useTranslation()
  return (
    <div className="border-border bg-card mb-5 rounded-lg border border-dashed px-6 py-10 text-center">
      <h2 className="text-brand-navy text-xl font-bold tracking-tight">
        {t('dashboard.empty.title')}
      </h2>
      <p className="text-muted-foreground mt-1 text-sm">{t('dashboard.empty.subtitle')}</p>
    </div>
  )
}
