import { useQueryClient } from '@tanstack/react-query'
import { format, startOfMonth, subMonths } from 'date-fns'
import { getDateLocale } from '@/lib/utils/format-date'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useParams, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'

import { DASHBOARD_TOUR_STEPS } from '@/components/onboarding-tour/page-tour-steps'
import { PageTour } from '@/components/onboarding-tour/PageTour'
import { PeriodPickerPopover } from '@/components/ui/PeriodPickerPopover'
import {
  currentMonthPeriod,
  periodLabel,
  periodToRange,
  shiftPeriod,
  type PeriodValue,
} from '@/components/ui/period-picker-utils'

import { supabase } from '@/lib/supabase/client'

import { useBankAccountBalances } from '@/hooks/useBanking'
import { useClients } from '@/hooks/useClients'
import { useDashboardKpis, useTopStaff } from '@/hooks/useDashboard'
import { useRegisterBalances } from '@/hooks/useCashTransfers'
import { useExpenseCategories, useExpenses } from '@/hooks/useExpenses'
import { useFinancialSettings } from '@/hooks/useFinancialSettings'
import { useInventoryItems } from '@/hooks/useInventory'
import { usePermissions } from '@/hooks/usePermissions'
import { useReviews } from '@/hooks/useReviews'
import { useSalon, useSalonMembership } from '@/hooks/useSalons'
import { useServiceCategories, useServices } from '@/hooks/useServices'
import { useStaff } from '@/hooks/useStaff'
import { useVisits } from '@/hooks/useVisits'
import { type PeriodKey } from '@/lib/period'
import { effectiveReceivedFromVisit } from '@/hooks/useVisits'

import { CashDetailsModal } from './CashDetailsModal'
import { CollapsibleSection } from './CollapsibleSection'
import {
  computeActiveClients,
  computeAvgRating,
  computeLocalInsights,
  computeMarketingSources,
  computeNeedsReactivation,
  computeNewClientsCount,
  computeNoShowsCount,
  computeOccupancyPct,
  computeOnlineBookingsPct,
  computeRegularClientsCount,
  computeRetentionPct,
  computeRevenueByCategory,
  computeRfm,
  workingDaysInRange,
  type RfmKey,
} from './dashboard-aggregates'
import { SegmentClientsModal } from './SegmentClientsModal'
import { InsightsWidget } from './InsightsWidget'
import { LowStockWidget } from './LowStockWidget'
import { MasterDashboard } from './MasterDashboard'
import {
  ClientsSection,
  ExpensesSection,
  FinancesSection,
  KpiCardsRow,
  MarketingSection,
  MastersSection,
} from './sections'
import { aggregateDailyRevenue } from './sections-utils'

/**
 * Главный дашборд (Image #71-72 — новая структура). Заменяет старый дашборд,
 * который состоял из множества разнородных виджетов. Новая структура:
 *   1. Заголовок (привет + период)
 *   2. Сворачиваемые блоки «Заканчиваются материалы» + «AI-помощник видит»
 *      — единственное, что осталось с предыдущей версии.
 *   3. 5 KPI карточек (Выручка / Прибыль / Заполненность / Возврат / Деньги)
 *   4. Клиенты + Мастера (2 колонки)
 *   5. Расходы + Финансы (2 колонки)
 *   6. Запись и операции (4 metric'а)
 *   7. Маркетинг (источники + RFM)
 *
 * Где есть готовые хуки (DashboardKpis, TopStaff, Expenses, Visits,
 * RegisterBalances) — показываем реальные данные. Где данных нет
 * (Заполненность, Retention, RFM, источники, CAC) — секция получает
 * `null`/`undefined` и показывает «—». Это позволяет наполнять секции
 * постепенно, без переписывания UI.
 */
export function DashboardPage() {
  const { t } = useTranslation()
  const { salonId } = useParams<{ salonId: string }>()
  const [params] = useSearchParams()
  // Bug (баг-трекер): мастер (staff) видел AI-помощника с рекомендациями для
  // собственника. Прячем AI-виджет для staff/external.
  const { role } = usePermissions(salonId)
  const showOwnerInsights = role !== 'staff' && role !== 'external'
  // Мастер-дашборд: роль staff видит свой дашборд (зарплата + показатели +
  // AI-советы) вместо owner-дашборда с финансами салона. Привязка к staff —
  // через salon_members.staff_id.
  const { data: membership } = useSalonMembership(salonId)
  const myStaffId = membership?.staff_id ?? null
  const isMaster = role === 'staff'
  // T114 — динамический период. Дефолт = текущий месяц, но юзер может
  // выбрать любой через плашку справа сверху (PeriodPickerPopover):
  // месяц / год / range / последние N дней.
  const [periodValue, setPeriodValue] = useState<PeriodValue>(() => currentMonthPeriod())
  const periodRangeDates = periodToRange(periodValue)
  const range = {
    start: periodRangeDates.start.toISOString(),
    end: periodRangeDates.end.toISOString(),
  }
  // Для legacy кода с PeriodKey остаётся 'month' (используется только
  // в profitForecast — но он валиден только для month-режима в любом случае).
  const period: PeriodKey = periodValue.kind === 'month' ? 'month' : 'custom'
  const now = new Date()
  const [cashDetailsOpen, setCashDetailsOpen] = useState(false)
  // Открытый RFM-сегмент (клик по плитке в блоке «Маркетинг») → список клиентов.
  const [openSegment, setOpenSegment] = useState<RfmKey | null>(null)

  void periodLabel // PeriodPickerPopover сам рендерит лейбл

  // Предыдущий период — для MoM сравнения KPI. shiftPeriod сдвигает
  // выбранный период на 1 шаг назад (год, месяц, range, recent).
  const prevPeriodValue = shiftPeriod(periodValue, -1)
  const prevRangeDates = periodToRange(prevPeriodValue)
  const prevRange = {
    start: prevRangeDates.start.toISOString(),
    end: prevRangeDates.end.toISOString(),
  }
  void params
  void subMonths
  void startOfMonth

  const { data: salon } = useSalon(salonId)
  const { data: kpis } = useDashboardKpis(salonId, range)
  const { data: prevKpis } = useDashboardKpis(salonId, prevRange)
  const { data: topStaff = [] } = useTopStaff(salonId, range, 5)
  const { data: staff = [] } = useStaff(salonId)
  const { data: visits = [] } = useVisits(salonId, range)
  const { data: prevVisits = [] } = useVisits(salonId, prevRange)
  const { data: expenses = [] } = useExpenses(salonId, {
    start: range.start.slice(0, 10),
    end: range.end.slice(0, 10),
  })
  const { data: expenseCategories = [] } = useExpenseCategories(salonId)
  const { data: registerBalances = [] } = useRegisterBalances(salonId)
  const { data: bankBalances = [] } = useBankAccountBalances(salonId)
  const { data: financialSettings } = useFinancialSettings(salonId)
  const { data: clients = [] } = useClients(salonId)
  const { data: services = [] } = useServices(salonId)
  const { data: serviceCategories = [] } = useServiceCategories(salonId)
  const { data: inventoryItems = [] } = useInventoryItems(salonId)
  const { data: reviews = [] } = useReviews(salonId)

  if (!salon || !salonId) return null
  const currency = salon.currency

  // ─── Деривативные значения ────────────────────────────────────────────────
  const revenueCents = kpis?.revenue_cents ?? 0
  const expenseCents = kpis?.expense_cents ?? 0
  const profitCents = kpis?.profit_cents ?? 0
  const visitsCount = kpis?.visits_count ?? 0

  // План: фиксированные + налоги (для безубыточности) — берём из настроек.
  const fixedPlanCents =
    financialSettings?.fixed.items
      .filter((i) => !i.archived)
      .reduce((acc, i) => acc + (i.amount_cents ?? 0), 0) ?? null
  const taxesPlanCents =
    financialSettings?.taxes.items
      .filter((i) => !i.archived)
      .reduce((acc, i) => acc + (i.amount_cents ?? 0), 0) ?? null
  const breakEvenCents =
    fixedPlanCents != null && taxesPlanCents != null ? fixedPlanCents + taxesPlanCents : null

  // Прогноз прибыли = текущий факт * (дней в месяце / дней прошло).
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
  const daysPassed = Math.max(1, now.getDate())
  const profitForecastCents =
    period === 'month' ? Math.round((profitCents * daysInMonth) / daysPassed) : null

  // Сумма всех касс «сейчас».
  const cashBalanceCents = registerBalances.reduce((acc, b) => acc + b.balance_cents, 0)

  // T90 — «Ожидается к поступлению» = Σ (план − факт) по non-cash кассам
  // со связью к bank_account. Это деньги клиента (картой) которые эквайринг
  // ещё не зачислил на счёт. Только положительная часть (план > факт);
  // отрицательная разница — рассинхрон, в виджет не идёт.
  const bankFactByRegister = new Map<string, number>()
  for (const ba of bankBalances) {
    if (!ba.cash_register_id) continue
    bankFactByRegister.set(
      ba.cash_register_id,
      (bankFactByRegister.get(ba.cash_register_id) ?? 0) + ba.balance_cents,
    )
  }
  let expectedIncomingCents = 0
  for (const r of financialSettings?.cash_registers.items ?? []) {
    if (r.archived || r.cash_kind !== 'non_cash') continue
    const fact = bankFactByRegister.get(r.id)
    if (fact == null) continue
    const plan = registerBalances.find((b) => b.register_id === r.id)?.balance_cents ?? 0
    const diff = plan - fact
    if (diff > 0) expectedIncomingCents += diff
  }

  // MoM% выручки / прибыли.
  const prevRevenueCents = prevKpis?.revenue_cents ?? null
  const prevProfitCents = prevKpis?.profit_cents ?? null

  // Средний чек = выручка / число оплаченных визитов.
  const paidVisits = visits.filter((v) => v.status === 'paid')
  const avgCheckCents =
    paidVisits.length > 0
      ? Math.round(
          paidVisits.reduce((acc, v) => acc + effectiveReceivedFromVisit(v), 0) / paidVisits.length,
        )
      : null

  // Отменённые записи % — visits.status='cancelled' / total.
  const cancelledCount = visits.filter((v) => v.status === 'cancelled').length
  const cancelledPct = visits.length > 0 ? (cancelledCount / visits.length) * 100 : null

  // Расходы по категориям (group by category_id) — top 6.
  const categoryById = new Map(expenseCategories.map((c) => [c.id, c.name]))
  const expBucket = new Map<string, number>()
  for (const e of expenses) {
    const name = e.category_id ? (categoryById.get(e.category_id) ?? '—') : '—'
    expBucket.set(name, (expBucket.get(name) ?? 0) + e.amount_cents)
  }
  const expenseRowColors = [
    'hsl(var(--brand-navy))',
    'hsl(var(--brand-teal))',
    'hsl(var(--brand-sage))',
    'hsl(var(--brand-gold))',
    'hsl(var(--destructive))',
    'hsl(var(--muted-foreground))',
  ]
  const expenseCats = Array.from(expBucket.entries())
    .map(([name, amountCents], i) => ({
      name,
      amountCents,
      color: expenseRowColors[i % expenseRowColors.length]!,
    }))
    .sort((a, b) => b.amountCents - a.amountCents)
    .slice(0, 6)

  // Daily revenue для sparkline.
  const dailyRevenue = aggregateDailyRevenue(visits)

  // Активные мастера.
  const activeStaffCount = staff.filter((s) => s.is_active).length

  // Топ мастеров (id+full_name из useStaff, revenue из top_staff).
  const topStaffRows = topStaff.map((s) => ({
    id: s.staff_id,
    full_name: s.full_name,
    revenueCents: s.revenue_cents,
  }))

  // Маржа.
  const marginPct = revenueCents > 0 ? (profitCents / revenueCents) * 100 : null

  // ─── Аггрегаты для всех секций (см. dashboard-aggregates.ts) ───────────
  const workingDays = workingDaysInRange(new Date(range.start), new Date(range.end))
  const revenueByCategory = computeRevenueByCategory(visits, services, serviceCategories)
  const newClientsCount = computeNewClientsCount(clients, range)
  const regularClientsCount = computeRegularClientsCount(clients)
  const onlineBookingsPct = computeOnlineBookingsPct(visits)
  const occupancyPct = computeOccupancyPct(visits, activeStaffCount, workingDays)
  const prevOccupancyPct = computeOccupancyPct(prevVisits, activeStaffCount, 22)
  const {
    retentionPct,
    returningCount: returningClients,
    churnedCount: churnedClients,
  } = computeRetentionPct(visits, prevVisits)
  const totalClients = clients.length
  const activeClients = computeActiveClients(clients, now)
  const needsReactivation = computeNeedsReactivation(clients, now)
  const rfm = computeRfm(clients, now)
  const marketingSources = computeMarketingSources(clients)
  const noShowsCount = computeNoShowsCount(visits)
  const { avg: avgRating, count: reviewsCount } = computeAvgRating(reviews, range)
  const lowStockCount = inventoryItems.filter(
    (i) => i.min_stock > 0 && i.current_stock <= i.min_stock,
  ).length

  // Local insights — генерим прямо из аггрегатов, если в insights таблице пусто.
  const localInsights = computeLocalInsights({
    revenueCents,
    expenseCents,
    profitCents,
    prevRevenueCents,
    cashBalanceCents,
    needsReactivation,
    lowStockCount,
    occupancyPct,
  })

  // Мастер видит свой дашборд (зарплата/показатели/AI-советы), а не
  // owner-финансы салона. Если мастер не привязан к staff-карточке —
  // показываем общий дашборд как fallback.
  if (isMaster && myStaffId) {
    return <MasterDashboard salonId={salonId!} staffId={myStaffId} />
  }

  return (
    <div className="flex flex-1 flex-col gap-3 px-5 py-7 sm:px-8 lg:pb-12">
      {/* Bug fae81ea6 (Елена 01.06): заголовок «Главная» + название месяца
          в одной строке с PeriodPickerPopover.
          Bug dd6444fc (Елена 06.06): на mobile inline-«Июнь 2026» дублировал
          лейбл PeriodPickerPopover'а — прячем inline на <sm, оставляем только
          таб период-пикера. */}
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex items-baseline gap-2">
          <h1 className="text-foreground text-2xl font-bold">
            {t('dashboard.title', { defaultValue: 'Главная' })}
          </h1>
          <span className="text-muted-foreground hidden text-sm font-semibold capitalize sm:inline">
            {format(new Date(range.start), 'LLLL yyyy', { locale: getDateLocale() })}
          </span>
        </div>
        <PeriodPickerPopover value={periodValue} onChange={setPeriodValue} />
      </div>

      {visitsCount === 0 && expenseCents === 0 ? <DashboardEmpty /> : null}

      <PageTour name="dashboard" steps={DASHBOARD_TOUR_STEPS} force={params.get('tour') === '1'} />

      {/* Bug fae81ea6 (Елена 01.06): low_stock collapsible показывался
          даже когда нет low-stock материалов. Условный рендер по lowStockCount. */}
      {lowStockCount > 0 ? (
        <CollapsibleSection id="lowStock" title={t('dashboard.collapsible.low_stock')} defaultOpen>
          <LowStockWidget salonId={salonId} />
        </CollapsibleSection>
      ) : null}

      {showOwnerInsights ? (
        <div data-tour="dashboard-insights">
          <CollapsibleSection id="insights" title={t('dashboard.collapsible.insights')} defaultOpen>
            <InsightsWidget salonId={salonId} fallback={localInsights} />
          </CollapsibleSection>
        </div>
      ) : null}

      {/* Блок 1 — 5 KPI */}
      <div data-tour="dashboard-kpi">
        <KpiCardsRow
          currency={currency}
          revenueCents={revenueCents}
          profitCents={profitCents}
          expenseCents={expenseCents}
          revenuePlanCents={null}
          profitPlanCents={null}
          breakEvenCents={breakEvenCents}
          prevRevenueCents={prevRevenueCents}
          prevProfitCents={prevProfitCents}
          prevCashCents={null}
          profitForecastCents={profitForecastCents}
          occupancyPct={occupancyPct}
          prevOccupancyPct={prevOccupancyPct}
          retentionPct={retentionPct}
          prevRetentionPct={null}
          newClients={returningClients}
          churnedClients={churnedClients}
          cashBalanceCents={cashBalanceCents}
          cashPlanCents={null}
          expectedIncomingCents={expectedIncomingCents}
          onCashDetailsClick={() => setCashDetailsOpen(true)}
        />
      </div>

      <CashDetailsModal
        open={cashDetailsOpen}
        onClose={() => setCashDetailsOpen(false)}
        salonId={salonId}
        currency={currency}
      />

      {/* Блок 2 — Клиенты + Мастера. Tablet/laptop audit (2026-05-30):
          на 768+ (iPad portrait и шире) включаем 2 колонки — секции узкие
          и хорошо лезут рядом. До 1024 было 1 колонка → пустое место справа
          в landscape. */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <ClientsSection
          currency={currency}
          visitsCount={visitsCount}
          visitsMomPct={
            prevKpis?.visits_count
              ? ((visitsCount - prevKpis.visits_count) / prevKpis.visits_count) * 100
              : null
          }
          newClientsCount={newClientsCount}
          newClientsMomPct={null}
          regularClientsCount={regularClientsCount}
          avgCheckCents={avgCheckCents}
          onlineBookingsPct={onlineBookingsPct}
          cancelledPct={cancelledPct}
          sources={marketingSources}
        />
        <MastersSection
          activeCount={activeStaffCount}
          totalCount={staff.length}
          avgLoadPct={occupancyPct}
          loadPlanPct={75}
          top={topStaffRows}
          currency={currency}
          avgRating={avgRating}
          reviewsCount={reviewsCount}
          noShowsCount={noShowsCount}
        />
      </div>

      {/* Блок 3 — Расходы + Финансы. См. комментарий выше. */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <ExpensesSection
          currency={currency}
          totalCents={expenseCents}
          planCents={fixedPlanCents != null ? fixedPlanCents + (taxesPlanCents ?? 0) : null}
          categories={expenseCats}
        />
        <FinancesSection
          currency={currency}
          revenueCents={revenueCents}
          profitCents={profitCents}
          marginPct={marginPct}
          revenueMomPct={
            prevRevenueCents != null && prevRevenueCents !== 0
              ? ((revenueCents - prevRevenueCents) / Math.abs(prevRevenueCents)) * 100
              : null
          }
          dailyRevenue={dailyRevenue}
          revenueByCategory={revenueByCategory}
        />
      </div>

      {/* Блок 4 — Маркетинг (раньше тут был «Запись и операции», удалён по
          запросу владельца — записи на сегодня и материалы и так видны в
          /reports и в виджете «Заканчиваются материалы» наверху). */}
      <MarketingSection
        currency={currency}
        sources={marketingSources}
        cacByChannel={[]}
        avgCacCents={null}
        rfm={rfm}
        onSegmentClick={setOpenSegment}
        totalClients={totalClients}
        activeClients={activeClients}
        needsReactivation={needsReactivation}
      />

      {salonId ? (
        <SegmentClientsModal
          salonId={salonId}
          currency={currency}
          segmentKey={openSegment}
          segmentName={rfm.find((s) => s.key === openSegment)?.name ?? ''}
          onClose={() => setOpenSegment(null)}
        />
      ) : null}
    </div>
  )
}

// ─── Empty state ───────────────────────────────────────────────────────────

function DashboardEmpty() {
  const { t } = useTranslation()
  const { salonId } = useParams<{ salonId: string }>()
  const qc = useQueryClient()
  const [pending, setPending] = useState(false)

  async function seedDemo() {
    if (!salonId) return
    if (!confirm(t('dashboard.empty.confirm_seed'))) return
    setPending(true)
    try {
      const { data, error } = await supabase.rpc('seed_demo_data', { p_salon_id: salonId })
      if (error) throw error
      const stats = data as {
        staff?: number
        services?: number
        clients?: number
        visits?: number
        expenses?: number
      }
      toast.success(
        t('dashboard.empty.toast_seeded', {
          visits: stats?.visits ?? 0,
          clients: stats?.clients ?? 0,
        }),
      )
      qc.invalidateQueries({ queryKey: ['dashboard', salonId] })
      qc.invalidateQueries({ queryKey: ['visits', salonId] })
      qc.invalidateQueries({ queryKey: ['expenses', salonId] })
      qc.invalidateQueries({ queryKey: ['clients', salonId] })
      qc.invalidateQueries({ queryKey: ['staff', salonId] })
      qc.invalidateQueries({ queryKey: ['services', salonId] })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="border-border bg-card mb-3 rounded-lg border border-dashed px-6 py-10 text-center">
      <h2 className="text-brand-navy text-xl font-bold tracking-tight">
        {t('dashboard.empty.title')}
      </h2>
      <p className="text-muted-foreground mt-1 text-sm">{t('dashboard.empty.subtitle')}</p>
      <div className="mt-4 flex flex-wrap justify-center gap-2">
        <button
          type="button"
          onClick={seedDemo}
          disabled={pending}
          className="bg-secondary/10 text-secondary hover:bg-secondary/20 rounded-md px-4 py-2 text-sm font-semibold transition-colors disabled:opacity-50"
        >
          {pending ? t('common.loading') : t('dashboard.empty.seed_demo')}
        </button>
        {/* Bug 3597e266 (Елена 02.06): ссылки на занесение/импорт реальных данных. */}
        <a
          href={`/${salonId}/income?view=calendar`}
          className="border-border bg-card hover:bg-muted/40 text-foreground rounded-md border px-4 py-2 text-sm font-semibold"
        >
          {t('dashboard.empty.add_visit', { defaultValue: '+ Визит' })}
        </a>
        <a
          href={`/${salonId}/expenses`}
          className="border-border bg-card hover:bg-muted/40 text-foreground rounded-md border px-4 py-2 text-sm font-semibold"
        >
          {t('dashboard.empty.add_expense', { defaultValue: '+ Расход' })}
        </a>
        <a
          href={`/${salonId}/settings/integrations`}
          className="border-border bg-card hover:bg-muted/40 text-foreground rounded-md border px-4 py-2 text-sm font-semibold"
        >
          {t('dashboard.empty.connect_integration', { defaultValue: 'Подключить интеграцию' })}
        </a>
        <a
          href={`/${salonId}/settings/import`}
          className="border-border bg-card hover:bg-muted/40 text-foreground rounded-md border px-4 py-2 text-sm font-semibold"
        >
          {t('dashboard.empty.import_csv', { defaultValue: 'Импорт CSV' })}
        </a>
      </div>
    </div>
  )
}
