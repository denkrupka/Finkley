import { TrendingDown, TrendingUp, Users } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { useBenchmarkComparison } from '@/hooks/useBenchmarks'
import { formatCurrency } from '@/lib/utils/format-currency'

/**
 * Виджет «Ты vs средний по нише». Показывается только если в твоём bucket'е
 * (страна × тип салона) ≥10 опт-ин салонов (k-anonymity).
 *
 * 4 метрики: средний чек, выручка/мастер, визитов в неделю, % повторных.
 */
export function BenchmarksWidget({ salonId, currency }: { salonId: string; currency: string }) {
  const { t } = useTranslation()
  const { data } = useBenchmarkComparison(salonId)

  if (!data || !data.available || !data.me || !data.market) return null

  const m = data.me
  const mk = data.market

  return (
    <section className="border-border bg-card shadow-finsm mb-5 rounded-lg border p-4 sm:p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-brand-navy text-sm font-bold uppercase tracking-wider">
          {t('dashboard.benchmarks.title')}
        </h2>
        <span className="text-muted-foreground inline-flex items-center gap-1 text-xs">
          <Users className="size-3.5" strokeWidth={1.7} />
          {t('dashboard.benchmarks.bucket_size', { count: data.salon_count ?? 0 })}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Metric
          label={t('dashboard.benchmarks.metrics.avg_check')}
          mine={formatCurrency(m.avg_check_cents, currency)}
          market={formatCurrency(mk.avg_check_cents, currency)}
          higherIsBetter
          mineRaw={m.avg_check_cents}
          marketRaw={mk.avg_check_cents}
        />
        <Metric
          label={t('dashboard.benchmarks.metrics.revenue_per_master')}
          mine={formatCurrency(m.revenue_per_master_cents, currency)}
          market={formatCurrency(mk.revenue_per_master_cents, currency)}
          higherIsBetter
          mineRaw={m.revenue_per_master_cents}
          marketRaw={mk.revenue_per_master_cents}
        />
        <Metric
          label={t('dashboard.benchmarks.metrics.visits_per_week')}
          mine={Number(m.visits_per_week).toFixed(1)}
          market={Number(mk.visits_per_week).toFixed(1)}
          higherIsBetter
          mineRaw={Number(m.visits_per_week)}
          marketRaw={Number(mk.visits_per_week)}
        />
        <Metric
          label={t('dashboard.benchmarks.metrics.rebooking')}
          mine={`${Number(m.rebooking_rate_pct).toFixed(0)}%`}
          market={`${Number(mk.rebooking_rate_pct).toFixed(0)}%`}
          higherIsBetter
          mineRaw={Number(m.rebooking_rate_pct)}
          marketRaw={Number(mk.rebooking_rate_pct)}
        />
      </div>
    </section>
  )
}

function Metric({
  label,
  mine,
  market,
  mineRaw,
  marketRaw,
  higherIsBetter,
}: {
  label: string
  mine: string
  market: string
  mineRaw: number
  marketRaw: number
  higherIsBetter: boolean
}) {
  const { t } = useTranslation()
  const better = higherIsBetter ? mineRaw >= marketRaw : mineRaw <= marketRaw
  const equal = Math.abs(mineRaw - marketRaw) < 0.01 * Math.max(marketRaw, 1)
  return (
    <div>
      <p className="text-muted-foreground text-[11px] font-bold uppercase tracking-wider">
        {label}
      </p>
      <p className="num text-brand-navy mt-1 text-lg font-bold">{mine}</p>
      <p
        className={`mt-1 inline-flex items-center gap-1 text-[11px] ${
          equal ? 'text-muted-foreground' : better ? 'text-emerald-600' : 'text-amber-600'
        }`}
      >
        {!equal &&
          (better ? <TrendingUp className="size-3" /> : <TrendingDown className="size-3" />)}
        <span>{t('dashboard.benchmarks.market_avg', { value: market })}</span>
      </p>
    </div>
  )
}
