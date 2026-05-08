import { TrendingUp } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { useMonthForecast } from '@/hooks/useForecastAndCalendar'
import { cn } from '@/lib/utils/cn'
import { formatCurrency } from '@/lib/utils/format-currency'

/**
 * Прогноз выручки на конец месяца. Линейная экстраполяция:
 * (revenue_so_far / days_passed × days_total) + pending_in_month.
 *
 * Простая модель — без сезонности и трендов. Но интуитивно понятна и
 * пересчитывается каждый день. Если темп упадёт — прогноз сразу
 * отреагирует.
 */
export function ForecastWidget({ salonId, currency }: { salonId: string; currency: string }) {
  const { t } = useTranslation()
  const { data: f, isLoading } = useMonthForecast(salonId)

  if (isLoading || !f) return null

  const grew = f.vs_prev_month_pct !== null && f.vs_prev_month_pct >= 0
  const progressPct = Math.min(100, Math.round((f.days_passed / f.days_total) * 100))

  return (
    <section className="border-border bg-card shadow-finsm rounded-lg border p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-muted-foreground text-[11px] font-bold uppercase tracking-wider">
            {t('dashboard.forecast.label')}
          </p>
          <h3 className="text-brand-navy mt-0.5 text-base font-bold">
            {t('dashboard.forecast.title')}
          </h3>
        </div>
        <span
          className={cn(
            'grid size-8 place-items-center rounded-md',
            grew ? 'bg-brand-sage-soft text-brand-sage' : 'bg-amber-100 text-amber-700',
          )}
          aria-hidden
        >
          <TrendingUp className="size-4" strokeWidth={1.8} />
        </span>
      </div>

      <p className="text-brand-navy num mt-3 text-3xl font-bold tracking-tight">
        {formatCurrency(f.forecast, currency)}
      </p>

      {f.vs_prev_month_pct !== null ? (
        <p
          className={cn(
            'num mt-1 text-xs font-semibold',
            grew ? 'text-brand-sage' : 'text-amber-700',
          )}
        >
          {grew ? '↑' : '↓'} {Math.abs(f.vs_prev_month_pct)}% {t('dashboard.forecast.vs_prev')}
        </p>
      ) : null}

      {/* Progress bar — какая часть месяца прошла */}
      <div className="mt-4">
        <div className="bg-muted relative h-1.5 overflow-hidden rounded-full">
          <div
            className="bg-brand-teal-deep absolute inset-y-0 left-0"
            style={{ width: `${progressPct}%` }}
          />
        </div>
        <div className="text-muted-foreground mt-1 flex items-center justify-between text-[11px]">
          <span>
            {t('dashboard.forecast.so_far', {
              amount: formatCurrency(f.revenue_so_far, currency),
            })}
          </span>
          <span>
            {t('dashboard.forecast.day_n', {
              n: f.days_passed,
              total: f.days_total,
            })}
          </span>
        </div>
      </div>

      {f.pending_in_month > 0 ? (
        <p className="text-muted-foreground mt-3 text-xs">
          {t('dashboard.forecast.pending', {
            amount: formatCurrency(f.pending_in_month, currency),
          })}
        </p>
      ) : null}
    </section>
  )
}
