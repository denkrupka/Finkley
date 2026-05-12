import { CalendarClock, FileBarChart, LineChart, Wallet } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useParams, useSearchParams } from 'react-router-dom'

import { PageTabsNav, type PageTab } from '@/components/ui/PageTabsNav'
import { ReportsPage } from '@/routes/reports/ReportsPage'

import { CashFlowTab } from './CashFlowTab'
import { FinancialReportTab } from './FinancialReportTab'
import { PaymentsTab } from './PaymentsTab'

type FinanceTab = 'pnl' | 'cashflow' | 'report' | 'payments'

const TABS: PageTab<FinanceTab>[] = [
  { id: 'pnl', labelKey: 'finance.tabs.pnl', icon: LineChart },
  { id: 'cashflow', labelKey: 'finance.tabs.cashflow', icon: Wallet },
  { id: 'report', labelKey: 'finance.tabs.report', icon: FileBarChart },
  { id: 'payments', labelKey: 'finance.tabs.payments', icon: CalendarClock },
]

function isFinanceTab(v: string | null): v is FinanceTab {
  return v === 'pnl' || v === 'cashflow' || v === 'report' || v === 'payments'
}

/**
 * Страница «Финансы» — финансовая картина бизнеса:
 *   - P&L              — текущая ReportsPage (KPI + dynamic charts)
 *   - ДДС              — TODO: cash flow daily (TASK-55)
 *   - Счета на оплату  — TODO: scheduled_payments (TASK-56)
 *
 * Активный таб — в URL `?tab=pnl|cashflow|payments`.
 */
export function FinancePage() {
  const { t } = useTranslation()
  const { salonId } = useParams<{ salonId: string }>()
  const [params, setParams] = useSearchParams()

  const tabParam = params.get('tab')
  const active: FinanceTab = isFinanceTab(tabParam) ? tabParam : 'pnl'

  function setActive(id: FinanceTab) {
    const next = new URLSearchParams(params)
    next.set('tab', id)
    setParams(next, { replace: true })
  }

  if (!salonId) return null

  return (
    <div className="flex flex-1 flex-col px-5 py-7 sm:px-8 lg:pb-12">
      <div className="mb-5">
        <h1 className="text-brand-navy text-2xl font-bold tracking-tight">{t('finance.title')}</h1>
        <p className="text-muted-foreground mt-1 text-sm">{t('finance.subtitle')}</p>
      </div>

      <PageTabsNav tabs={TABS} active={active} onChange={setActive} t={t} />

      {active === 'pnl' ? (
        <ReportsPage />
      ) : active === 'cashflow' ? (
        <CashFlowTab salonId={salonId} />
      ) : active === 'report' ? (
        <FinancialReportTab salonId={salonId} />
      ) : (
        <PaymentsTab salonId={salonId} />
      )}
    </div>
  )
}
