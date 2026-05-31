import { ArrowDown, ArrowUp } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { cn } from '@/lib/utils/cn'
import { formatCurrency } from '@/lib/utils/format-currency'

import { InfoHelpButton } from './InfoHelpButton'

/**
 * Презентационные секции дашборда. Структура / визуальный язык — по
 * образцу finsalon_dashboard.html (5 KPI-карточек, две колонки секций,
 * операции, маркетинг). Цвета адаптированы под нашу палитру Tailwind /
 * brand-токенов (emerald/amber/rose/blue/violet/teal/pink/slate).
 *
 * Где есть готовые хуки — секции принимают типизированные пропы с
 * числовыми значениями. Где данных нет (заполненность, retention, RFM,
 * источники, CAC и т.п.) — секция принимает пропы как опциональные и
 * показывает «—». Это позволяет добавить недостающие данные постепенно,
 * без переписывания UI.
 */

// ─── Базовые карточки ──────────────────────────────────────────────────────

export function Card({
  children,
  className,
  title,
}: {
  children: ReactNode
  className?: string
  /** T113 — описание показателя для кнопки «?» в углу карточки.
   *  Что за показатель, источник данных, формула. Открывается popover'ом
   *  по клику (не hover'у), работает на тач-устройствах. */
  title?: string
}) {
  return (
    <div
      className={cn(
        'border-border bg-card shadow-finsm relative flex flex-col gap-2 rounded-xl border p-4',
        className,
      )}
    >
      {title ? <InfoHelpButton text={title} /> : null}
      {children}
    </div>
  )
}

export function Section({
  title,
  children,
  className,
  tooltip,
}: {
  title?: string
  children: ReactNode
  className?: string
  /** T113 — описание секции для кнопки «?» в углу. Что внутри,
   *  источник данных, как считается. */
  tooltip?: string
}) {
  return (
    <div
      className={cn(
        'border-border bg-card shadow-finsm relative rounded-xl border p-4 sm:p-5',
        className,
      )}
    >
      {tooltip ? <InfoHelpButton text={tooltip} /> : null}
      {title ? (
        <div className="text-muted-foreground mb-3 text-[11px] font-semibold uppercase tracking-wider">
          {title}
        </div>
      ) : null}
      {children}
    </div>
  )
}

function Metric({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="bg-muted/40 rounded-lg p-3">
      <div className="text-muted-foreground text-[11px]">{label}</div>
      <div className="num text-foreground mt-1 text-xl font-semibold leading-none">{value}</div>
      {sub ? <div className="text-muted-foreground mt-1 text-[11px]">{sub}</div> : null}
    </div>
  )
}

function Badge({
  children,
  tone = 'green',
}: {
  children: ReactNode
  tone?: 'green' | 'amber' | 'red' | 'blue'
}) {
  const cls =
    tone === 'green'
      ? 'bg-emerald-50 text-emerald-700'
      : tone === 'amber'
        ? 'bg-amber-50 text-amber-800'
        : tone === 'red'
          ? 'bg-rose-50 text-rose-700'
          : 'bg-blue-50 text-blue-700'
  return (
    <span className={cn('inline-block rounded-md px-2 py-0.5 text-[11px] font-semibold', cls)}>
      {children}
    </span>
  )
}

function DataRow({ label, value }: { label: ReactNode; value: ReactNode }) {
  return (
    <div className="border-border/60 flex items-center justify-between border-t py-1.5 text-[13px] first:border-t-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-foreground font-semibold">{value}</span>
    </div>
  )
}

function ProgressBar({ pct, color }: { pct: number; color: string }) {
  const clamped = Math.max(0, Math.min(100, pct))
  return (
    <div className="bg-muted/60 h-1.5 overflow-hidden rounded-full">
      <div className="h-full rounded-full" style={{ width: `${clamped}%`, background: color }} />
    </div>
  )
}

// ─── Блок 1 — 5 KPI карточек ───────────────────────────────────────────────

export type KpiCardsProps = {
  currency: string
  revenueCents: number
  profitCents: number
  expenseCents: number
  /** План выручки (опц.). Если задан — рендерится progress-bar. */
  revenuePlanCents?: number | null
  /** План прибыли (опц.). */
  profitPlanCents?: number | null
  /** Точка безубыточности (опц.) — план общих расходов. */
  breakEvenCents?: number | null
  /** Выручка предыдущего периода для расчёта Mom%. */
  prevRevenueCents?: number | null
  prevProfitCents?: number | null
  prevCashCents?: number | null
  /** Прогноз прибыли (fact * days_in_month / days_passed). */
  profitForecastCents?: number | null
  /** % загрузки мастеров (если посчитан). */
  occupancyPct?: number | null
  prevOccupancyPct?: number | null
  /** % retention. */
  retentionPct?: number | null
  prevRetentionPct?: number | null
  newClients?: number | null
  churnedClients?: number | null
  /** Сумма всех кассовых балансов на сейчас. */
  cashBalanceCents?: number | null
  /** План остатка кассы (опц.). */
  cashPlanCents?: number | null
  /** T90 — сумма ожидаемых поступлений = Σ (план − факт) по non-cash кассам
   *  со связью к bank_account. Деньги клиента (картой) которые эквайринг
   *  ещё не зачислил на счёт. Заменяет «К плану» в карточке. */
  expectedIncomingCents?: number | null
  /** T73 — открыть модалку «Деньги на счетах — детали». */
  onCashDetailsClick?: () => void
}

export function KpiCardsRow(p: KpiCardsProps) {
  // Tablet/laptop audit (2026-05-30): на 768-1023 (iPad portrait/landscape,
  // маленький ноут) `sm:grid-cols-2 lg:grid-cols-5` оставлял 2 колонки до
  // 1024, а на 1024 разом 5. С учётом sidebar (232px) на 1024 это даёт
  // ~150px на карточку — KPI-числа `text-2xl` ломаются на 2 строки.
  // Промежуточный `md:grid-cols-3` (3 в ряд на 768-1023) и `xl:grid-cols-5`
  // (5 в ряд только на 1280+) даёт читаемые карточки во всех диапазонах.
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-5">
      <RevenueCard {...p} />
      <ProfitCard {...p} />
      <OccupancyCard {...p} />
      <RetentionCard {...p} />
      <CashOnHandCard {...p} />
    </div>
  )
}

function MomFoot({ pct, label }: { pct: number | null | undefined; label: string }) {
  if (pct == null)
    return <Foot label={label} value={<span className="text-muted-foreground">—</span>} />
  const up = pct >= 0
  return (
    <Foot
      label={label}
      value={
        <span
          className={cn(
            'inline-flex items-center gap-0.5',
            up ? 'text-emerald-700' : 'text-rose-600',
          )}
        >
          {up ? (
            <ArrowUp className="size-3" strokeWidth={2.4} />
          ) : (
            <ArrowDown className="size-3" strokeWidth={2.4} />
          )}
          {Math.abs(pct).toFixed(1)}%
        </span>
      }
    />
  )
}

function Foot({ label, value }: { label: ReactNode; value: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-muted-foreground text-[11px]">{label}</span>
      <span className="text-foreground text-[12px] font-semibold">{value}</span>
    </div>
  )
}

function RevenueCard(p: KpiCardsProps) {
  const { t } = useTranslation()
  const planPct =
    p.revenuePlanCents != null && p.revenuePlanCents > 0
      ? Math.round((p.revenueCents / p.revenuePlanCents) * 100)
      : null
  const breakevenDelta = p.breakEvenCents != null ? p.revenueCents - p.breakEvenCents : null
  const momPct =
    p.prevRevenueCents != null && p.prevRevenueCents !== 0
      ? ((p.revenueCents - p.prevRevenueCents) / Math.abs(p.prevRevenueCents)) * 100
      : null
  return (
    <Card title={t('dashboard.sections.revenue.tooltip')}>
      <span className="text-muted-foreground text-[11px] font-semibold uppercase tracking-wider">
        {t('dashboard.sections.revenue.label')}
      </span>
      <span className="num text-foreground text-2xl font-bold leading-none">
        {formatCurrency(p.revenueCents, p.currency)}
      </span>
      {planPct != null ? (
        <div className="flex items-center gap-2">
          <ProgressBar pct={planPct} color="hsl(var(--brand-teal))" />
          <span className="num text-muted-foreground w-9 text-right text-[11px] font-semibold">
            {planPct}%
          </span>
        </div>
      ) : null}
      <hr className="border-border/60" />
      <div className="flex items-end justify-between gap-3">
        <Foot
          label={t('dashboard.sections.revenue.to_breakeven')}
          value={
            breakevenDelta == null ? (
              <span className="text-muted-foreground">—</span>
            ) : (
              <span className={breakevenDelta >= 0 ? 'text-emerald-700' : 'text-rose-600'}>
                {breakevenDelta >= 0 ? '+' : '−'}
                {formatCurrency(Math.abs(breakevenDelta), p.currency)}
              </span>
            )
          }
        />
        <MomFoot pct={momPct} label={t('dashboard.sections.common.prev_month')} />
      </div>
    </Card>
  )
}

function ProfitCard(p: KpiCardsProps) {
  const { t } = useTranslation()
  const planPct =
    p.profitPlanCents != null && p.profitPlanCents > 0
      ? Math.round((p.profitCents / p.profitPlanCents) * 100)
      : null
  const momPct =
    p.prevProfitCents != null && p.prevProfitCents !== 0
      ? ((p.profitCents - p.prevProfitCents) / Math.abs(p.prevProfitCents)) * 100
      : null
  return (
    <Card title={t('dashboard.sections.profit.tooltip')}>
      <span className="text-muted-foreground text-[11px] font-semibold uppercase tracking-wider">
        {t('dashboard.sections.profit.label')}
      </span>
      <span className="num text-foreground text-2xl font-bold leading-none">
        {formatCurrency(p.profitCents, p.currency)}
      </span>
      {planPct != null ? (
        <div className="flex items-center gap-2">
          <ProgressBar pct={planPct} color="hsl(var(--brand-navy))" />
          <span className="num text-muted-foreground w-9 text-right text-[11px] font-semibold">
            {planPct}%
          </span>
        </div>
      ) : null}
      <hr className="border-border/60" />
      <div className="flex items-end justify-between gap-3">
        <Foot
          label={t('dashboard.sections.profit.forecast')}
          value={
            p.profitForecastCents == null ? (
              <span className="text-muted-foreground">—</span>
            ) : (
              <span className="text-emerald-700">
                ≈ {formatCurrency(p.profitForecastCents, p.currency)}
              </span>
            )
          }
        />
        <MomFoot pct={momPct} label={t('dashboard.sections.common.prev_month')} />
      </div>
    </Card>
  )
}

function OccupancyCard(p: KpiCardsProps) {
  const { t } = useTranslation()
  const pct = p.occupancyPct ?? null
  const tone: 'green' | 'amber' | 'red' =
    pct == null ? 'amber' : pct >= 85 ? 'green' : pct >= 70 ? 'amber' : 'red'
  const label =
    tone === 'green'
      ? t('dashboard.sections.tone.good')
      : tone === 'amber'
        ? t('dashboard.sections.tone.below_norm')
        : t('dashboard.sections.tone.low')
  const momPct = pct != null && p.prevOccupancyPct != null ? pct - p.prevOccupancyPct : null
  return (
    <Card title={t('dashboard.sections.occupancy.tooltip')}>
      <span className="text-muted-foreground text-[11px] font-semibold uppercase tracking-wider">
        {t('dashboard.sections.occupancy.label')}
      </span>
      <span className="num text-foreground text-2xl font-bold leading-none">
        {pct == null ? '—' : `${Math.round(pct)}%`}
      </span>
      <div className="flex items-center gap-1.5">
        <span
          className={cn(
            'size-2 rounded-full',
            tone === 'green' ? 'bg-emerald-500' : tone === 'amber' ? 'bg-amber-500' : 'bg-rose-500',
          )}
        />
        <span
          className={cn(
            'text-[11px] font-semibold',
            tone === 'green'
              ? 'text-emerald-700'
              : tone === 'amber'
                ? 'text-amber-700'
                : 'text-rose-700',
          )}
        >
          {label}
        </span>
      </div>
      <hr className="border-border/60" />
      <div className="flex items-end justify-between gap-3">
        <MomFoot pct={momPct} label={t('dashboard.sections.common.prev_month')} />
      </div>
    </Card>
  )
}

function RetentionCard(p: KpiCardsProps) {
  const { t } = useTranslation()
  const pct = p.retentionPct ?? null
  const tone: 'green' | 'amber' | 'red' =
    pct == null ? 'amber' : pct >= 75 ? 'green' : pct >= 60 ? 'amber' : 'red'
  const label =
    tone === 'green'
      ? t('dashboard.sections.tone.good')
      : tone === 'amber'
        ? t('dashboard.sections.tone.below_norm')
        : t('dashboard.sections.tone.low')
  const momPct = pct != null && p.prevRetentionPct != null ? pct - p.prevRetentionPct : null
  return (
    <Card title={t('dashboard.sections.retention.tooltip')}>
      <span className="text-muted-foreground text-[11px] font-semibold uppercase tracking-wider">
        {t('dashboard.sections.retention.label')}
      </span>
      <span className="num text-foreground text-2xl font-bold leading-none">
        {pct == null ? '—' : `${Math.round(pct)}%`}
      </span>
      <div className="flex items-center gap-1.5">
        <span
          className={cn(
            'size-2 rounded-full',
            tone === 'green' ? 'bg-emerald-500' : tone === 'amber' ? 'bg-amber-500' : 'bg-rose-500',
          )}
        />
        <span
          className={cn(
            'text-[11px] font-semibold',
            tone === 'green'
              ? 'text-emerald-700'
              : tone === 'amber'
                ? 'text-amber-700'
                : 'text-rose-700',
          )}
        >
          {label}
        </span>
      </div>
      {(p.newClients != null || p.churnedClients != null) && (
        <div className="flex gap-2.5 text-[11px] font-semibold">
          <span className="text-emerald-700">
            +{p.newClients ?? 0} {t('dashboard.sections.retention.inflow')}
          </span>
          <span className="text-rose-600">
            −{p.churnedClients ?? 0} {t('dashboard.sections.retention.outflow')}
          </span>
        </div>
      )}
      <hr className="border-border/60" />
      <div className="flex items-end justify-between gap-3">
        <MomFoot pct={momPct} label={t('dashboard.sections.common.prev_month')} />
      </div>
    </Card>
  )
}

function CashOnHandCard(p: KpiCardsProps) {
  const { t } = useTranslation()
  const momPct =
    p.cashBalanceCents != null && p.prevCashCents != null && p.prevCashCents !== 0
      ? ((p.cashBalanceCents - p.prevCashCents) / Math.abs(p.prevCashCents)) * 100
      : null
  void p.cashPlanCents // больше не показываем «К плану» — заменено на «Ожидается к поступлению»
  return (
    <Card title={t('dashboard.sections.cash.tooltip')}>
      <div className="flex items-start justify-between gap-2">
        <span className="text-muted-foreground text-[11px] font-semibold uppercase tracking-wider">
          {t('dashboard.sections.cash.label')}
        </span>
        {p.onCashDetailsClick ? (
          <button
            type="button"
            onClick={p.onCashDetailsClick}
            className="text-muted-foreground hover:text-foreground hover:bg-muted/40 -mt-0.5 mr-7 rounded-md px-1.5 py-0.5 text-[11px] font-semibold underline-offset-2 hover:underline"
          >
            {t('dashboard.sections.cash.details')}
          </button>
        ) : null}
      </div>
      <span className="num text-foreground text-2xl font-bold leading-none">
        {p.cashBalanceCents == null ? '—' : formatCurrency(p.cashBalanceCents, p.currency)}
      </span>
      <hr className="border-border/60" />
      <div className="flex items-end justify-between gap-3">
        <Foot
          label={t('dashboard.sections.cash.expected')}
          value={
            p.expectedIncomingCents == null ? (
              <span className="text-muted-foreground">—</span>
            ) : p.expectedIncomingCents > 0 ? (
              <span className="text-amber-700">
                +{formatCurrency(p.expectedIncomingCents, p.currency)}
              </span>
            ) : (
              // Если поступлений не ожидается — показываем «0», не «синхронно»
              // (юзеру важна явная сумма).
              <span className="text-muted-foreground">{formatCurrency(0, p.currency)}</span>
            )
          }
        />
        <MomFoot pct={momPct} label={t('dashboard.sections.common.prev_month')} />
      </div>
    </Card>
  )
}

// ─── Блок 2 — Клиенты + Мастера ───────────────────────────────────────────

export type ClientsSectionProps = {
  visitsCount: number
  visitsMomPct?: number | null
  newClientsCount?: number | null
  newClientsMomPct?: number | null
  regularClientsCount?: number | null
  avgCheckCents?: number | null
  currency: string
  onlineBookingsPct?: number | null
  cancelledPct?: number | null
  sources?: Array<{ name: string; pct: number; color: string }>
}

export function ClientsSection(p: ClientsSectionProps) {
  const { t } = useTranslation()
  return (
    <Section
      title={t('dashboard.sections.clients.title')}
      tooltip={t('dashboard.sections.clients.tooltip')}
    >
      <div className="mb-3 grid grid-cols-2 gap-3">
        <Metric
          label={t('dashboard.sections.clients.visits_in_month')}
          value={p.visitsCount.toLocaleString('ru-RU')}
          sub={
            p.visitsMomPct == null ? (
              <span className="text-muted-foreground">
                — {t('dashboard.sections.common.to_prev_month')}
              </span>
            ) : (
              <span className={p.visitsMomPct >= 0 ? 'text-emerald-700' : 'text-rose-600'}>
                {p.visitsMomPct >= 0 ? '↑' : '↓'} {Math.abs(p.visitsMomPct).toFixed(0)}%{' '}
                {t('dashboard.sections.common.to_prev_month')}
              </span>
            )
          }
        />
        <Metric
          label={t('dashboard.sections.clients.new_clients')}
          value={p.newClientsCount == null ? '—' : p.newClientsCount.toLocaleString('ru-RU')}
          sub={
            p.newClientsMomPct == null ? null : (
              <Badge tone={p.newClientsMomPct >= 0 ? 'green' : 'red'}>
                {p.newClientsMomPct >= 0 ? '+' : ''}
                {p.newClientsMomPct.toFixed(0)}%
              </Badge>
            )
          }
        />
      </div>
      <DataRow
        label={t('dashboard.sections.clients.regular_clients')}
        value={p.regularClientsCount == null ? '—' : p.regularClientsCount.toLocaleString('ru-RU')}
      />
      <DataRow
        label={t('dashboard.sections.clients.avg_check')}
        value={p.avgCheckCents == null ? '—' : formatCurrency(p.avgCheckCents, p.currency)}
      />
      <DataRow
        label={t('dashboard.sections.clients.online_bookings')}
        value={p.onlineBookingsPct == null ? '—' : `${Math.round(p.onlineBookingsPct)}%`}
      />
      {p.sources && p.sources.length > 0 ? (
        <>
          <div className="text-muted-foreground mt-3 text-[11px] font-semibold uppercase tracking-wider">
            {t('dashboard.sections.clients.sources_heading')}
          </div>
          {p.sources.map((s) => (
            <DataRow
              key={s.name}
              label={
                <span className="inline-flex items-center gap-1.5">
                  <span className="size-2 rounded-full" style={{ background: s.color }} />
                  {s.name}
                </span>
              }
              value={`${Math.round(s.pct)}%`}
            />
          ))}
        </>
      ) : null}
    </Section>
  )
}

export type MastersSectionProps = {
  activeCount: number
  totalCount: number
  avgLoadPct?: number | null
  loadPlanPct?: number | null
  top: Array<{ id: string; full_name: string; revenueCents: number }>
  currency: string
  avgRating?: number | null
  reviewsCount?: number | null
  noShowsCount?: number | null
}

export function MastersSection(p: MastersSectionProps) {
  const { t } = useTranslation()
  const max = Math.max(1, ...p.top.map((s) => s.revenueCents))
  return (
    <Section
      title={t('dashboard.sections.masters.title')}
      tooltip={t('dashboard.sections.masters.tooltip')}
    >
      <div className="mb-3 grid grid-cols-2 gap-3">
        <Metric
          label={t('dashboard.sections.masters.active_label')}
          value={`${p.activeCount} / ${p.totalCount}`}
        />
        <Metric
          label={t('dashboard.sections.masters.avg_load')}
          value={p.avgLoadPct == null ? '—' : `${Math.round(p.avgLoadPct)}%`}
          sub={
            p.loadPlanPct == null ? null : (
              <Badge
                tone={
                  p.avgLoadPct == null
                    ? 'amber'
                    : p.avgLoadPct >= p.loadPlanPct
                      ? 'green'
                      : p.avgLoadPct >= p.loadPlanPct - 5
                        ? 'amber'
                        : 'red'
                }
              >
                {t('dashboard.sections.masters.plan_pct', { pct: Math.round(p.loadPlanPct) })}
              </Badge>
            )
          }
        />
      </div>
      <div className="text-muted-foreground mb-2 text-[11px] font-semibold uppercase tracking-wider">
        {t('dashboard.sections.masters.top_revenue_heading')}
      </div>
      {p.top.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t('dashboard.sections.common.no_data')}</p>
      ) : (
        p.top.map((s, i) => {
          const pct = (s.revenueCents / max) * 100
          const main = i < 2
          return (
            <div key={s.id} className="flex items-center gap-2 py-1">
              <span className="text-muted-foreground w-24 shrink-0 truncate text-right text-[12px]">
                {s.full_name}
              </span>
              <div className="bg-muted/60 h-2 flex-1 overflow-hidden rounded">
                <div
                  className="h-full rounded"
                  style={{
                    width: `${pct}%`,
                    background: main ? 'hsl(var(--brand-navy))' : 'hsl(var(--brand-navy) / 0.5)',
                  }}
                />
              </div>
              <span className="num text-foreground w-16 shrink-0 text-right text-[12px] font-semibold">
                {formatCurrency(s.revenueCents, p.currency)}
              </span>
            </div>
          )
        })
      )}
      <div className="mt-2">
        <DataRow
          label={t('dashboard.sections.masters.avg_rating')}
          value={p.avgRating == null ? '—' : `★ ${p.avgRating.toFixed(1)}`}
        />
        <DataRow
          label={t('dashboard.sections.masters.reviews_count')}
          value={p.reviewsCount == null ? '—' : p.reviewsCount.toLocaleString('ru-RU')}
        />
      </div>
    </Section>
  )
}

// ─── Блок 3 — Расходы + Финансы ───────────────────────────────────────────

export type ExpensesSectionProps = {
  currency: string
  totalCents: number
  planCents?: number | null
  categories: Array<{ name: string; amountCents: number; color: string }>
}

export function ExpensesSection(p: ExpensesSectionProps) {
  const { t } = useTranslation()
  const overshootPct =
    p.planCents != null && p.planCents > 0
      ? ((p.totalCents - p.planCents) / p.planCents) * 100
      : null
  const max = Math.max(1, ...p.categories.map((c) => c.amountCents))
  return (
    <Section
      title={t('dashboard.sections.expenses.title')}
      tooltip={t('dashboard.sections.expenses.tooltip')}
    >
      <div className="mb-3">
        <Metric
          label={t('dashboard.sections.expenses.total_in_month')}
          value={formatCurrency(p.totalCents, p.currency)}
          sub={
            overshootPct == null ? null : overshootPct > 10 ? (
              <Badge tone="red">
                {t('dashboard.sections.expenses.overshoot', { pct: Math.round(overshootPct) })}
              </Badge>
            ) : overshootPct > 0 ? (
              <Badge tone="amber">
                {t('dashboard.sections.expenses.plan_overshoot', { pct: Math.round(overshootPct) })}
              </Badge>
            ) : (
              <Badge tone="green">{t('dashboard.sections.expenses.within_plan')}</Badge>
            )
          }
        />
      </div>
      {p.categories.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t('dashboard.sections.expenses.empty')}</p>
      ) : (
        <div className="flex flex-col gap-2.5">
          {p.categories.map((c) => {
            const pct = (c.amountCents / max) * 100
            return (
              <div key={c.name}>
                <div className="mb-1 flex items-baseline justify-between text-[12px]">
                  <span className="text-muted-foreground truncate">{c.name}</span>
                  <span className="num text-foreground font-semibold">
                    {formatCurrency(c.amountCents, p.currency)}
                  </span>
                </div>
                <ProgressBar pct={pct} color={c.color} />
              </div>
            )
          })}
        </div>
      )}
    </Section>
  )
}

export type FinancesSectionProps = {
  currency: string
  revenueCents: number
  profitCents: number
  marginPct?: number | null
  revenueMomPct?: number | null
  dailyRevenue: Array<{ date: string; cents: number }>
  revenueByCategory?: Array<{ name: string; pct: number }>
}

export function FinancesSection(p: FinancesSectionProps) {
  const { t } = useTranslation()
  const max = Math.max(1, ...p.dailyRevenue.map((d) => d.cents))
  return (
    <Section
      title={t('dashboard.sections.finances.title')}
      tooltip={t('dashboard.sections.finances.tooltip')}
    >
      <div className="mb-3 grid grid-cols-2 gap-3">
        <Metric
          label={t('dashboard.sections.finances.revenue')}
          value={formatCurrency(p.revenueCents, p.currency)}
          sub={
            p.revenueMomPct == null ? null : (
              <Badge tone={p.revenueMomPct >= 0 ? 'green' : 'red'}>
                {p.revenueMomPct >= 0 ? '↑' : '↓'} {Math.abs(p.revenueMomPct).toFixed(0)}%
              </Badge>
            )
          }
        />
        <Metric
          label={t('dashboard.sections.finances.profit')}
          value={formatCurrency(p.profitCents, p.currency)}
          sub={
            p.marginPct == null ? null : (
              <span className="text-muted-foreground">
                {t('dashboard.sections.finances.margin', { pct: Math.round(p.marginPct) })}
              </span>
            )
          }
        />
      </div>
      <div className="text-muted-foreground mb-2 text-[11px] font-semibold uppercase tracking-wider">
        {t('dashboard.sections.finances.revenue_dynamics')}
      </div>
      {p.dailyRevenue.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          {t('dashboard.sections.finances.no_visits')}
        </p>
      ) : (
        <div className="flex h-12 items-end gap-[3px]">
          {p.dailyRevenue.map((d) => {
            const h = (d.cents / max) * 100
            const intensity = d.cents / max
            const bg =
              intensity > 0.75
                ? 'hsl(var(--brand-navy))'
                : intensity > 0.5
                  ? 'hsl(var(--brand-navy) / 0.75)'
                  : intensity > 0.25
                    ? 'hsl(var(--brand-navy) / 0.5)'
                    : 'hsl(var(--brand-navy) / 0.25)'
            return (
              <div
                key={d.date}
                className="flex-1 rounded-t"
                style={{ height: `${Math.max(2, h)}%`, background: bg }}
                title={`${d.date}: ${formatCurrency(d.cents, p.currency)}`}
              />
            )
          })}
        </div>
      )}
      {p.revenueByCategory && p.revenueByCategory.length > 0 ? (
        <div className="mt-2">
          {p.revenueByCategory.map((c) => (
            <DataRow key={c.name} label={c.name} value={`${Math.round(c.pct)}%`} />
          ))}
        </div>
      ) : null}
    </Section>
  )
}

// ─── Блок 4 — Запись и операции ───────────────────────────────────────────

export type OperationsSectionProps = {
  todayAppointments?: number | null
  waitlistCount?: number | null
  materialsStockPct?: number | null
  freeSlotsCount?: number | null
  totalSlotsCount?: number | null
}

export function OperationsSection(p: OperationsSectionProps) {
  const { t } = useTranslation()
  return (
    <Section title={t('dashboard.sections.operations.title')}>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Metric
          label={t('dashboard.sections.operations.today_appointments')}
          value={p.todayAppointments == null ? '—' : p.todayAppointments.toLocaleString('ru-RU')}
        />
        <Metric
          label={t('dashboard.sections.operations.waitlist')}
          value={p.waitlistCount == null ? '—' : p.waitlistCount.toLocaleString('ru-RU')}
          sub={
            p.waitlistCount == null ? null : (
              <Badge
                tone={p.waitlistCount === 0 ? 'green' : p.waitlistCount <= 5 ? 'amber' : 'red'}
              >
                {p.waitlistCount === 0
                  ? t('dashboard.sections.operations.no_queue')
                  : t('dashboard.sections.operations.needs_reaction')}
              </Badge>
            )
          }
        />
        <Metric
          label={t('dashboard.sections.operations.materials_stock')}
          value={p.materialsStockPct == null ? '—' : `${Math.round(p.materialsStockPct)}%`}
          sub={
            p.materialsStockPct == null ? null : (
              <Badge
                tone={
                  p.materialsStockPct >= 50 ? 'green' : p.materialsStockPct >= 25 ? 'amber' : 'red'
                }
              >
                {p.materialsStockPct >= 50
                  ? t('dashboard.sections.operations.stock_normal')
                  : p.materialsStockPct >= 25
                    ? t('dashboard.sections.operations.stock_low')
                    : t('dashboard.sections.operations.stock_critical')}
              </Badge>
            )
          }
        />
        <Metric
          label={t('dashboard.sections.operations.free_slots')}
          value={p.freeSlotsCount == null ? '—' : p.freeSlotsCount.toLocaleString('ru-RU')}
          sub={
            p.totalSlotsCount == null ? null : (
              <Badge tone="green">
                {t('dashboard.sections.operations.of_total_slots', { total: p.totalSlotsCount })}
              </Badge>
            )
          }
        />
      </div>
    </Section>
  )
}

// ─── Блок 5 — Маркетинг ───────────────────────────────────────────────────

export type MarketingSectionProps = {
  currency: string
  sources?: Array<{ name: string; pct: number; color: string }>
  cacByChannel?: Array<{ channel: string; cacCents: number | null }>
  avgCacCents?: number | null
  rfm?: Array<{
    name: string
    count: number
    description: string
    fill: string
    text: string
  }>
  totalClients?: number | null
  activeClients?: number | null
  needsReactivation?: number | null
}

export function MarketingSection(p: MarketingSectionProps) {
  const { t } = useTranslation()
  return (
    <Section
      title={t('dashboard.sections.marketing.title')}
      tooltip={t('dashboard.sections.marketing.tooltip')}
    >
      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
        {/* Левая колонка: источники + CAC */}
        <div>
          <div className="text-muted-foreground mb-2 text-[11px] font-semibold uppercase tracking-wider">
            {t('dashboard.sections.marketing.sources_heading')}
          </div>
          {!p.sources || p.sources.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              {t('dashboard.sections.common.no_data')}
            </p>
          ) : (
            p.sources.map((s) => (
              <div key={s.name} className="flex items-center gap-2 py-1">
                <span className="text-muted-foreground w-24 shrink-0 truncate text-right text-[12px]">
                  {s.name}
                </span>
                <div className="bg-muted/60 h-2 flex-1 overflow-hidden rounded">
                  <div
                    className="h-full rounded"
                    style={{ width: `${s.pct}%`, background: s.color }}
                  />
                </div>
                <span className="num text-foreground w-12 shrink-0 text-right text-[12px] font-semibold">
                  {Math.round(s.pct)}%
                </span>
              </div>
            ))
          )}
        </div>

        {/* Правая колонка: RFM */}
        <div>
          <div className="text-muted-foreground mb-2 text-[11px] font-semibold uppercase tracking-wider">
            {t('dashboard.sections.marketing.rfm_heading')}
          </div>
          {!p.rfm || p.rfm.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              {t('dashboard.sections.marketing.no_rfm_data')}
            </p>
          ) : (
            <div className="grid grid-cols-3 gap-1.5">
              {p.rfm.map((s) => (
                <div key={s.name} className="rounded-md p-2.5" style={{ background: s.fill }}>
                  <div className="text-[11px] font-semibold" style={{ color: s.text }}>
                    {s.name}
                  </div>
                  <div
                    className="num mt-0.5 text-xl font-bold leading-none"
                    style={{ color: s.text }}
                  >
                    {s.count}
                  </div>
                  <div className="mt-0.5 text-[11px]" style={{ color: s.text }}>
                    {s.description}
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="mt-3">
            <DataRow
              label={t('dashboard.sections.marketing.total_in_base')}
              value={
                p.totalClients == null
                  ? '—'
                  : t('dashboard.sections.marketing.clients_count', { count: p.totalClients })
              }
            />
            <DataRow
              label={t('dashboard.sections.marketing.active_le_90')}
              value={
                p.activeClients == null ? (
                  '—'
                ) : (
                  <span className="text-emerald-700">
                    {p.activeClients.toLocaleString('ru-RU')}
                  </span>
                )
              }
            />
            <DataRow
              label={t('dashboard.sections.marketing.needs_reactivation')}
              value={
                p.needsReactivation == null ? (
                  '—'
                ) : (
                  <span className="text-rose-600">
                    {p.needsReactivation.toLocaleString('ru-RU')}
                  </span>
                )
              }
            />
          </div>
        </div>
      </div>
    </Section>
  )
}
