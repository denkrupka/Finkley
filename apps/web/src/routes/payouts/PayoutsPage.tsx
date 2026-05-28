import { format } from 'date-fns'
import { Printer } from 'lucide-react'
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
import { usePayrollAdvances } from '@/hooks/usePayrollAdvances'
import { useSalon } from '@/hooks/useSalons'
import { usePayoutsHistory, usePayoutsPreview, type PayoutPreviewRow } from '@/hooks/usePayouts'
import { formatCurrency } from '@/lib/utils/format-currency'

import { StaffVisitsModal } from './StaffVisitsModal'

const SCHEME_KEY: Record<PayoutPreviewRow['payout_scheme'], string> = {
  percent_revenue: 'staff.schemes.percent_revenue.title',
  fixed: 'staff.schemes.fixed.title',
  percent_service: 'staff.schemes.percent_service.title',
  chair_rent: 'staff.schemes.chair_rent.title',
  mixed: 'staff.schemes.mixed.title',
}

export function PayoutsPage() {
  const { t } = useTranslation()
  const { salonId } = useParams<{ salonId: string }>()
  const { data: salon } = useSalon(salonId)
  const currency = salon?.currency ?? 'PLN'

  // Период (через PeriodPickerPopover). По умолчанию — ТЕКУЩИЙ месяц.
  // Закрытие периода работает только когда период полностью завершён.
  const [period, setPeriod] = useState<PeriodValue>(() => currentMonthPeriod())
  const range = periodToRange(period)
  const periodStart = format(range.start, 'yyyy-MM-dd')
  const periodEnd = format(range.end, 'yyyy-MM-dd')

  const { data: rows = [], isLoading } = usePayoutsPreview(salonId, periodStart, periodEnd)
  const { data: history = [] } = usePayoutsHistory(salonId)
  const { data: advancesByStaff = new Map<string, number>() } = usePayrollAdvances(
    salonId,
    periodStart,
    periodEnd,
  )
  const [staffModal, setStaffModal] = useState<{ id: string; name: string } | null>(null)

  const totals = useMemo(() => {
    let revenue = 0
    let payout = 0
    let premium = 0
    let advances = 0
    for (const r of rows) {
      revenue += r.revenue_cents
      payout += r.payout_cents
      premium += r.premium_cents
      advances += advancesByStaff.get(r.staff_id) ?? 0
    }
    return {
      revenue,
      payout,
      premium,
      advances,
      accrued: payout + premium,
      remaining: payout + premium - advances,
    }
  }, [rows, advancesByStaff])

  if (!salonId) return null

  return (
    <div className="flex flex-1 flex-col px-5 py-7 sm:px-8 lg:pb-12">
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between print:flex-row">
        <div>
          <h1 className="text-brand-navy text-2xl font-bold tracking-tight">
            {t('payouts.title')}
          </h1>
          <p className="text-muted-foreground mt-1 text-sm print:hidden">{t('payouts.subtitle')}</p>
        </div>

        <div className="flex items-center gap-2 print:hidden">
          <Button variant="outline" onClick={() => window.print()} disabled={rows.length === 0}>
            <Printer className="size-4" strokeWidth={2} />
            {t('payouts.print')}
          </Button>
          <PeriodPickerPopover value={period} onChange={setPeriod} />
        </div>
      </div>

      {/* Период-метка — крупно для печати */}
      <div className="mb-3 hidden text-sm print:block">
        {t('payouts.print_period', {
          start: format(new Date(periodStart), 'dd.MM.yyyy'),
          end: format(new Date(periodEnd), 'dd.MM.yyyy'),
        })}
      </div>

      <div className="border-border bg-card shadow-finsm overflow-x-auto rounded-lg border">
        <div className="text-muted-foreground grid min-w-[960px] grid-cols-[1.3fr_1.1fr_0.9fr_0.7fr_0.7fr_0.9fr_0.9fr_0.9fr] items-center gap-3 px-4 py-2.5 text-xs font-bold uppercase tracking-wider sm:px-5">
          <div>{t('payouts.col.staff')}</div>
          <div>{t('payouts.col.scheme')}</div>
          <div className="text-right">{t('payouts.col.revenue')}</div>
          <div className="text-right">{t('payouts.col.tips')}</div>
          <div className="text-right">{t('payouts.col.premium', { defaultValue: 'Премия' })}</div>
          <div className="text-right">{t('payouts.col.payout')}</div>
          <div className="text-right">{t('payouts.col.advances')}</div>
          <div className="text-right">{t('payouts.col.remaining')}</div>
        </div>
        <div className="divide-border min-w-[760px] divide-y">
          {isLoading ? (
            <div className="text-muted-foreground px-5 py-6 text-sm">{t('common.loading')}</div>
          ) : rows.length === 0 ? (
            <div className="text-muted-foreground px-5 py-6 text-sm">{t('payouts.empty')}</div>
          ) : (
            rows.map((r) => {
              const advance = advancesByStaff.get(r.staff_id) ?? 0
              // T116 — premium приходит из RPC calculate_payouts_for_period
              // как сумма expenses.premium_cents за период по мастеру.
              const premiumCents = r.premium_cents
              const accruedCents = r.payout_cents + premiumCents
              const remaining = accruedCents - advance
              return (
                <div
                  key={r.staff_id}
                  onClick={() => setStaffModal({ id: r.staff_id, name: r.full_name })}
                  className="hover:bg-muted/30 grid min-w-[960px] cursor-pointer grid-cols-[1.3fr_1.1fr_0.9fr_0.7fr_0.7fr_0.9fr_0.9fr_0.9fr] items-center gap-3 px-4 py-3 transition-colors sm:px-5"
                  title={t('payouts.row_click_hint', {
                    defaultValue: 'Открыть детализацию визитов',
                  })}
                >
                  <div className="text-brand-navy truncate text-sm font-bold">{r.full_name}</div>
                  <div className="text-muted-foreground truncate text-xs">
                    {t(SCHEME_KEY[r.payout_scheme])}
                    <span className="ml-1 opacity-70">
                      · {t('payouts.visits_count', { count: r.visit_count })}
                    </span>
                  </div>
                  <div className="num text-right text-sm">
                    {formatCurrency(r.revenue_cents, currency)}
                  </div>
                  <div className="num text-brand-gold-deep text-right text-sm">
                    {r.tips_cents > 0 ? formatCurrency(r.tips_cents, currency) : '—'}
                  </div>
                  <div className="num text-right text-sm text-emerald-700">
                    {premiumCents > 0 ? `+${formatCurrency(premiumCents, currency)}` : '—'}
                  </div>
                  <div
                    className={`num text-right text-sm font-bold ${accruedCents < 0 ? 'text-destructive' : 'text-brand-navy'}`}
                  >
                    {formatCurrency(accruedCents, currency)}
                  </div>
                  <div className="num text-right text-sm text-amber-700">
                    {advance > 0 ? `−${formatCurrency(advance, currency)}` : '—'}
                  </div>
                  <div
                    className={`num text-right text-sm font-bold ${
                      remaining < 0 ? 'text-destructive' : 'text-brand-sage-deep'
                    }`}
                  >
                    {formatCurrency(remaining, currency)}
                  </div>
                </div>
              )
            })
          )}
        </div>
        {rows.length > 0 ? (
          <div className="border-border bg-muted/30 grid min-w-[960px] grid-cols-[1.3fr_1.1fr_0.9fr_0.7fr_0.7fr_0.9fr_0.9fr_0.9fr] items-center gap-3 border-t px-4 py-3 text-sm font-bold sm:px-5">
            <div className="text-brand-navy col-span-2">{t('payouts.total')}</div>
            <div className="num text-right">{formatCurrency(totals.revenue, currency)}</div>
            <div className="num text-brand-gold-deep text-right">—</div>
            <div className="num text-right text-emerald-700">
              {totals.premium > 0 ? `+${formatCurrency(totals.premium, currency)}` : '—'}
            </div>
            <div className="num text-brand-navy text-right">
              {formatCurrency(totals.accrued, currency)}
            </div>
            <div className="num text-right text-amber-700">
              {totals.advances > 0 ? `−${formatCurrency(totals.advances, currency)}` : '—'}
            </div>
            <div
              className={`num text-right ${totals.remaining < 0 ? 'text-destructive' : 'text-brand-sage-deep'}`}
            >
              {formatCurrency(totals.remaining, currency)}
            </div>
          </div>
        ) : null}
      </div>

      {history.length > 0 ? (
        <section className="mt-10 print:hidden">
          <h2 className="text-brand-navy mb-3 text-lg font-bold tracking-tight">
            {t('payouts.history_title')}
          </h2>
          <div className="border-border bg-card shadow-finsm overflow-hidden rounded-lg border">
            <div className="text-muted-foreground grid grid-cols-[1.4fr_1.2fr_1fr_1fr] items-center gap-3 px-4 py-2.5 text-xs font-bold uppercase tracking-wider sm:px-5">
              <div>{t('payouts.col.staff')}</div>
              <div>{t('payouts.col.period')}</div>
              <div className="text-right">{t('payouts.col.revenue')}</div>
              <div className="text-right">{t('payouts.col.payout')}</div>
            </div>
            <div className="divide-border divide-y">
              {history.map((row) => (
                <div
                  key={row.id}
                  className="grid grid-cols-[1.4fr_1.2fr_1fr_1fr] items-center gap-3 px-4 py-2.5 text-sm sm:px-5"
                >
                  <div className="text-brand-navy truncate font-semibold">
                    {row.staff_name ?? '—'}
                  </div>
                  <div className="text-muted-foreground text-xs">
                    {format(new Date(row.period_start), 'dd.MM.yyyy')} —{' '}
                    {format(new Date(row.period_end), 'dd.MM.yyyy')}
                  </div>
                  <div className="num text-right">
                    {formatCurrency(row.total_revenue_cents, currency)}
                  </div>
                  <div className="num text-right font-bold">
                    {formatCurrency(row.total_payout_cents, currency)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      ) : null}

      {salonId && (
        <StaffVisitsModal
          salonId={salonId}
          staffId={staffModal?.id ?? null}
          staffName={staffModal?.name ?? null}
          periodStart={periodStart}
          periodEnd={periodEnd}
          open={staffModal !== null}
          onOpenChange={(v) => !v && setStaffModal(null)}
        />
      )}
    </div>
  )
}
