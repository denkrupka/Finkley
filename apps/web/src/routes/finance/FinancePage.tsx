import {
  ArrowLeftRight,
  Banknote,
  CalendarClock,
  FileBarChart,
  LineChart,
  Target,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useParams, useSearchParams } from 'react-router-dom'

import { PageTabsNav, type PageTab } from '@/components/ui/PageTabsNav'
import { useSalon } from '@/hooks/useSalons'
import { ReportsPage } from '@/routes/reports/ReportsPage'

import { BudgetsTab } from './BudgetsTab'
import { CashTab } from './CashTab'
import { FinancialReportTab } from './FinancialReportTab'
import { PaymentsTab } from './PaymentsTab'
import { TransfersTab } from './TransfersTab'

// bug 1c77b56e — sub-tab 'cashflow' (ДДС) удалён. График динамики потоков
// теперь живёт внутри FinancialReportTab (Отчёт по прибыли). Legacy URL
// с ?tab=cashflow редиректит на report.
type FinanceTab = 'pnl' | 'report' | 'payments' | 'budgets' | 'cash' | 'transfers'

const ALL_TABS: PageTab<FinanceTab>[] = [
  { id: 'pnl', labelKey: 'finance.tabs.pnl', icon: LineChart },
  { id: 'report', labelKey: 'finance.tabs.report', icon: FileBarChart },
  { id: 'payments', labelKey: 'finance.tabs.payments', icon: CalendarClock },
  { id: 'budgets', labelKey: 'finance.tabs.budgets', icon: Target },
  { id: 'cash', labelKey: 'finance.tabs.cash', icon: Banknote },
  { id: 'transfers', labelKey: 'finance.tabs.transfers', icon: ArrowLeftRight },
]

function isFinanceTab(v: string | null): v is FinanceTab {
  return (
    v === 'pnl' ||
    v === 'report' ||
    v === 'payments' ||
    v === 'budgets' ||
    v === 'cash' ||
    v === 'transfers'
  )
}

/**
 * Страница «Финансы» — финансовая картина бизнеса:
 *   - P&L (report)     — финансовый отчёт с план/факт по месяцам
 *   - ДДС (cashflow)   — ежедневный cash flow, paid-only визиты + расходы
 *   - Счета на оплату (payments) — scheduled_payments с календарём
 *   - Бюджеты (budgets) — плановые расходы и доходы
 *   - Касса (cash)     — кассовая дисциплина (если включена)
 *   - Перемещения (transfers) — между кассами
 *
 * Активный таб — в URL `?tab=...`.
 */
export function FinancePage() {
  const { t } = useTranslation()
  const { salonId } = useParams<{ salonId: string }>()
  const [params, setParams] = useSearchParams()
  const { data: salon } = useSalon(salonId)
  // Если кассовая дисциплина выключена — таб «Касса» скрываем целиком.
  const TABS = salon?.cash_discipline_enabled
    ? ALL_TABS
    : ALL_TABS.filter((tab) => tab.id !== 'cash')

  const tabParam = params.get('tab')
  // bug 1c77b56e — legacy URL с ?tab=cashflow редиректим на 'report'
  const requested: FinanceTab =
    tabParam === 'cashflow' ? 'report' : isFinanceTab(tabParam) ? tabParam : 'pnl'
  // Защита от ситуации «приходим по ссылке ?tab=cash, а флаг выключен».
  const active: FinanceTab =
    requested === 'cash' && !salon?.cash_discipline_enabled ? 'pnl' : requested

  function setActive(id: FinanceTab) {
    const next = new URLSearchParams(params)
    next.set('tab', id)
    setParams(next, { replace: true })
  }

  if (!salonId) return null

  return (
    <div className="flex flex-1 flex-col px-5 py-7 sm:px-8 lg:pb-12">
      {/* Image #62: header «P&L, ДДС, счета на оплату» убран — он дублировал
          навигацию sidebar'а и съедал место когда у Финансов 5 табов. */}
      <PageTabsNav tabs={TABS} active={active} onChange={setActive} t={t} />

      {active === 'pnl' ? (
        <ReportsPage />
      ) : active === 'report' ? (
        <FinancialReportTab salonId={salonId} />
      ) : active === 'payments' ? (
        <PaymentsTab salonId={salonId} />
      ) : active === 'cash' ? (
        <CashTab salonId={salonId} />
      ) : active === 'transfers' ? (
        <TransfersTab salonId={salonId} />
      ) : (
        <BudgetsTab salonId={salonId} />
      )}
    </div>
  )
}
