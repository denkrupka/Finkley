import { Scissors, Sparkles, Users, Wallet } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useParams, useSearchParams } from 'react-router-dom'

import { PageTabsNav, type PageTab } from '@/components/ui/PageTabsNav'
import { PayoutsPage } from '@/routes/payouts/PayoutsPage'
import { ReportsPage } from '@/routes/reports/ReportsPage'

type ReportsTab = 'services' | 'clients' | 'staff' | 'payouts'

const TABS: PageTab<ReportsTab>[] = [
  { id: 'services', labelKey: 'reports_hub.tabs.services', icon: Sparkles },
  { id: 'clients', labelKey: 'reports_hub.tabs.clients', icon: Users },
  { id: 'staff', labelKey: 'reports_hub.tabs.staff', icon: Scissors },
  { id: 'payouts', labelKey: 'reports_hub.tabs.payouts', icon: Wallet },
]

function isReportsTab(v: string | null): v is ReportsTab {
  return v === 'services' || v === 'clients' || v === 'staff' || v === 'payouts'
}

/**
 * Страница «Отчёты» — аналитика по справочникам (мастера / услуги / клиенты /
 * зарплата). CRUD-страницы этих справочников живут в Настройках → Справочники.
 *
 * Lite-версия (TASK-53): табы Services/Staff показывают полный ReportsPage
 * с проскролленной до нужной секции, Payouts = текущая PayoutsPage, Clients
 * = stub-плейсхолдер с ссылкой на /clients (полный аналитический dashboard
 * клиентов — следующий спринт).
 */
export function ReportsHubPage() {
  const { t } = useTranslation()
  const { salonId } = useParams<{ salonId: string }>()
  const [params, setParams] = useSearchParams()

  const tabParam = params.get('tab')
  const active: ReportsTab = isReportsTab(tabParam) ? tabParam : 'services'

  function setActive(id: ReportsTab) {
    const next = new URLSearchParams(params)
    next.set('tab', id)
    setParams(next, { replace: true })
  }

  if (!salonId) return null

  return (
    <div className="flex flex-1 flex-col px-5 py-7 sm:px-8 lg:pb-12">
      <div className="mb-5">
        <h1 className="text-brand-navy text-2xl font-bold tracking-tight">
          {t('reports_hub.title')}
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">{t('reports_hub.subtitle')}</p>
      </div>

      <PageTabsNav tabs={TABS} active={active} onChange={setActive} t={t} />

      {active === 'services' || active === 'staff' ? (
        <ReportsPage />
      ) : active === 'payouts' ? (
        <PayoutsPage />
      ) : (
        <div className="border-border bg-card shadow-finsm rounded-lg border p-6">
          <p className="text-foreground/80 text-sm leading-snug">
            {t('reports_hub.clients_placeholder')}
          </p>
        </div>
      )}
    </div>
  )
}
