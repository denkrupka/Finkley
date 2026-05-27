import { ArrowDown, ArrowUp } from 'lucide-react'
import type { ReactNode } from 'react'

import { cn } from '@/lib/utils/cn'
import { formatCurrency } from '@/lib/utils/format-currency'

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

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'border-border bg-card shadow-finsm flex flex-col gap-2 rounded-xl border p-4',
        className,
      )}
    >
      {children}
    </div>
  )
}

export function Section({
  title,
  children,
  className,
}: {
  title?: string
  children: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn('border-border bg-card shadow-finsm rounded-xl border p-4 sm:p-5', className)}
    >
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
}

export function KpiCardsRow(p: KpiCardsProps) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
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
    <Card>
      <span className="text-muted-foreground text-[11px] font-semibold uppercase tracking-wider">
        Выручка
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
          label="До безубыточности"
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
        <MomFoot pct={momPct} label="Пред. месяц" />
      </div>
    </Card>
  )
}

function ProfitCard(p: KpiCardsProps) {
  const planPct =
    p.profitPlanCents != null && p.profitPlanCents > 0
      ? Math.round((p.profitCents / p.profitPlanCents) * 100)
      : null
  const momPct =
    p.prevProfitCents != null && p.prevProfitCents !== 0
      ? ((p.profitCents - p.prevProfitCents) / Math.abs(p.prevProfitCents)) * 100
      : null
  return (
    <Card>
      <span className="text-muted-foreground text-[11px] font-semibold uppercase tracking-wider">
        Прибыль
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
          label="Прогноз"
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
        <MomFoot pct={momPct} label="Пред. месяц" />
      </div>
    </Card>
  )
}

function OccupancyCard(p: KpiCardsProps) {
  const pct = p.occupancyPct ?? null
  const tone: 'green' | 'amber' | 'red' =
    pct == null ? 'amber' : pct >= 85 ? 'green' : pct >= 70 ? 'amber' : 'red'
  const label = tone === 'green' ? 'Хорошо' : tone === 'amber' ? 'Ниже нормы' : 'Низко'
  const momPct = pct != null && p.prevOccupancyPct != null ? pct - p.prevOccupancyPct : null
  return (
    <Card>
      <span className="text-muted-foreground text-[11px] font-semibold uppercase tracking-wider">
        Заполненность
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
        <MomFoot pct={momPct} label="Пред. месяц" />
      </div>
    </Card>
  )
}

function RetentionCard(p: KpiCardsProps) {
  const pct = p.retentionPct ?? null
  const tone: 'green' | 'amber' | 'red' =
    pct == null ? 'amber' : pct >= 75 ? 'green' : pct >= 60 ? 'amber' : 'red'
  const label = tone === 'green' ? 'Хорошо' : tone === 'amber' ? 'Ниже нормы' : 'Низко'
  const momPct = pct != null && p.prevRetentionPct != null ? pct - p.prevRetentionPct : null
  return (
    <Card>
      <span className="text-muted-foreground text-[11px] font-semibold uppercase tracking-wider">
        Возврат клиентов
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
          <span className="text-emerald-700">+{p.newClients ?? 0} приток</span>
          <span className="text-rose-600">−{p.churnedClients ?? 0} отток</span>
        </div>
      )}
      <hr className="border-border/60" />
      <div className="flex items-end justify-between gap-3">
        <MomFoot pct={momPct} label="Пред. месяц" />
      </div>
    </Card>
  )
}

function CashOnHandCard(p: KpiCardsProps) {
  const momPct =
    p.cashBalanceCents != null && p.prevCashCents != null && p.prevCashCents !== 0
      ? ((p.cashBalanceCents - p.prevCashCents) / Math.abs(p.prevCashCents)) * 100
      : null
  const planDeltaPct =
    p.cashBalanceCents != null && p.cashPlanCents != null && p.cashPlanCents !== 0
      ? ((p.cashBalanceCents - p.cashPlanCents) / Math.abs(p.cashPlanCents)) * 100
      : null
  return (
    <Card>
      <span className="text-muted-foreground text-[11px] font-semibold uppercase tracking-wider">
        Деньги на счетах
      </span>
      <span className="num text-foreground text-2xl font-bold leading-none">
        {p.cashBalanceCents == null ? '—' : formatCurrency(p.cashBalanceCents, p.currency)}
      </span>
      <hr className="border-border/60" />
      <div className="flex items-end justify-between gap-3">
        <MomFoot pct={planDeltaPct} label="К плану" />
        <MomFoot pct={momPct} label="Пред. месяц" />
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
  return (
    <Section title="Клиенты">
      <div className="mb-3 grid grid-cols-2 gap-3">
        <Metric
          label="Визитов за месяц"
          value={p.visitsCount.toLocaleString('ru-RU')}
          sub={
            p.visitsMomPct == null ? (
              <span className="text-muted-foreground">— к пред. мес.</span>
            ) : (
              <span className={p.visitsMomPct >= 0 ? 'text-emerald-700' : 'text-rose-600'}>
                {p.visitsMomPct >= 0 ? '↑' : '↓'} {Math.abs(p.visitsMomPct).toFixed(0)}% к пред.
                мес.
              </span>
            )
          }
        />
        <Metric
          label="Новых клиентов"
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
        label="Постоянных клиентов"
        value={p.regularClientsCount == null ? '—' : p.regularClientsCount.toLocaleString('ru-RU')}
      />
      <DataRow
        label="Средний чек"
        value={p.avgCheckCents == null ? '—' : formatCurrency(p.avgCheckCents, p.currency)}
      />
      <DataRow
        label="Онлайн-записей"
        value={p.onlineBookingsPct == null ? '—' : `${Math.round(p.onlineBookingsPct)}%`}
      />
      <DataRow
        label="Отменённых записей"
        value={
          p.cancelledPct == null ? (
            '—'
          ) : (
            <Badge tone={p.cancelledPct < 8 ? 'green' : p.cancelledPct < 15 ? 'amber' : 'red'}>
              {Math.round(p.cancelledPct)}%
            </Badge>
          )
        }
      />
      {p.sources && p.sources.length > 0 ? (
        <>
          <div className="text-muted-foreground mt-3 text-[11px] font-semibold uppercase tracking-wider">
            Источники записи
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
  const max = Math.max(1, ...p.top.map((s) => s.revenueCents))
  return (
    <Section title="Мастера">
      <div className="mb-3 grid grid-cols-2 gap-3">
        <Metric label="Активных мастеров" value={`${p.activeCount} / ${p.totalCount}`} />
        <Metric
          label="Ср. загрузка"
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
                план {Math.round(p.loadPlanPct)}%
              </Badge>
            )
          }
        />
      </div>
      <div className="text-muted-foreground mb-2 text-[11px] font-semibold uppercase tracking-wider">
        Топ по выручке
      </div>
      {p.top.length === 0 ? (
        <p className="text-muted-foreground text-sm">Нет данных</p>
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
          label="Ср. рейтинг"
          value={p.avgRating == null ? '—' : `★ ${p.avgRating.toFixed(1)}`}
        />
        <DataRow
          label="Отзывов за месяц"
          value={p.reviewsCount == null ? '—' : p.reviewsCount.toLocaleString('ru-RU')}
        />
        <DataRow
          label="Опоздания / пропуски"
          value={
            p.noShowsCount == null ? (
              '—'
            ) : (
              <Badge tone={p.noShowsCount === 0 ? 'green' : p.noShowsCount <= 3 ? 'amber' : 'red'}>
                {p.noShowsCount}
              </Badge>
            )
          }
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
  const overshootPct =
    p.planCents != null && p.planCents > 0
      ? ((p.totalCents - p.planCents) / p.planCents) * 100
      : null
  const max = Math.max(1, ...p.categories.map((c) => c.amountCents))
  return (
    <Section title="Расходы">
      <div className="mb-3">
        <Metric
          label="Итого за месяц"
          value={formatCurrency(p.totalCents, p.currency)}
          sub={
            overshootPct == null ? null : overshootPct > 10 ? (
              <Badge tone="red">Превышение +{Math.round(overshootPct)}%</Badge>
            ) : overshootPct > 0 ? (
              <Badge tone="amber">+{Math.round(overshootPct)}% к плану</Badge>
            ) : (
              <Badge tone="green">В рамках плана</Badge>
            )
          }
        />
      </div>
      {p.categories.length === 0 ? (
        <p className="text-muted-foreground text-sm">Нет расходов за период</p>
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
  const max = Math.max(1, ...p.dailyRevenue.map((d) => d.cents))
  return (
    <Section title="Финансы">
      <div className="mb-3 grid grid-cols-2 gap-3">
        <Metric
          label="Выручка"
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
          label="Прибыль"
          value={formatCurrency(p.profitCents, p.currency)}
          sub={
            p.marginPct == null ? null : (
              <span className="text-muted-foreground">маржа {Math.round(p.marginPct)}%</span>
            )
          }
        />
      </div>
      <div className="text-muted-foreground mb-2 text-[11px] font-semibold uppercase tracking-wider">
        Динамика выручки
      </div>
      {p.dailyRevenue.length === 0 ? (
        <p className="text-muted-foreground text-sm">Нет визитов за период</p>
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
  return (
    <Section title="Запись и операции">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Metric
          label="Записей на сегодня"
          value={p.todayAppointments == null ? '—' : p.todayAppointments.toLocaleString('ru-RU')}
        />
        <Metric
          label="Лист ожидания"
          value={p.waitlistCount == null ? '—' : p.waitlistCount.toLocaleString('ru-RU')}
          sub={
            p.waitlistCount == null ? null : (
              <Badge
                tone={p.waitlistCount === 0 ? 'green' : p.waitlistCount <= 5 ? 'amber' : 'red'}
              >
                {p.waitlistCount === 0 ? 'нет очереди' : 'требуют реакции'}
              </Badge>
            )
          }
        />
        <Metric
          label="Остаток материалов"
          value={p.materialsStockPct == null ? '—' : `${Math.round(p.materialsStockPct)}%`}
          sub={
            p.materialsStockPct == null ? null : (
              <Badge
                tone={
                  p.materialsStockPct >= 50 ? 'green' : p.materialsStockPct >= 25 ? 'amber' : 'red'
                }
              >
                {p.materialsStockPct >= 50
                  ? 'норма'
                  : p.materialsStockPct >= 25
                    ? 'низкий'
                    : 'критично'}
              </Badge>
            )
          }
        />
        <Metric
          label="Свободных окон"
          value={p.freeSlotsCount == null ? '—' : p.freeSlotsCount.toLocaleString('ru-RU')}
          sub={
            p.totalSlotsCount == null ? null : (
              <Badge tone="green">из {p.totalSlotsCount} слотов</Badge>
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
  return (
    <Section title="Маркетинг">
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* Левая колонка: источники + CAC */}
        <div>
          <div className="text-muted-foreground mb-2 text-[11px] font-semibold uppercase tracking-wider">
            Источники клиентов
          </div>
          {!p.sources || p.sources.length === 0 ? (
            <p className="text-muted-foreground text-sm">Нет данных</p>
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

          <div className="text-muted-foreground mb-2 mt-4 text-[11px] font-semibold uppercase tracking-wider">
            Стоимость привлечения (CAC)
          </div>
          {!p.cacByChannel || p.cacByChannel.length === 0 ? (
            <p className="text-muted-foreground text-sm">Нет данных</p>
          ) : (
            <>
              {p.cacByChannel.map((c) => (
                <DataRow
                  key={c.channel}
                  label={c.channel}
                  value={
                    c.cacCents == null ? (
                      '—'
                    ) : c.cacCents === 0 ? (
                      <span className="text-emerald-700">0 {p.currency}</span>
                    ) : (
                      formatCurrency(c.cacCents, p.currency)
                    )
                  }
                />
              ))}
              <DataRow
                label="Ср. по всем каналам"
                value={p.avgCacCents == null ? '—' : formatCurrency(p.avgCacCents, p.currency)}
              />
            </>
          )}
        </div>

        {/* Правая колонка: RFM */}
        <div>
          <div className="text-muted-foreground mb-2 text-[11px] font-semibold uppercase tracking-wider">
            База клиентов — RFM
          </div>
          {!p.rfm || p.rfm.length === 0 ? (
            <p className="text-muted-foreground text-sm">Нет данных для сегментации</p>
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
              label="Всего в базе"
              value={
                p.totalClients == null ? '—' : `${p.totalClients.toLocaleString('ru-RU')} клиентов`
              }
            />
            <DataRow
              label="Активных (≤90 дней)"
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
              label="Требуют реактивации"
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
