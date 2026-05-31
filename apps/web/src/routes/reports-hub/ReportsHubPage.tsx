import { Scissors, Sparkles, Star, Target, Users, Wallet } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useParams, useSearchParams } from 'react-router-dom'

import { PageTabsNav, type PageTab } from '@/components/ui/PageTabsNav'
import { PayoutsPage } from '@/routes/payouts/PayoutsPage'

import { ClientsAnalyticsTab } from './ClientsAnalyticsTab'
import { CompetitorsTab } from './CompetitorsTab'
import { ReviewsTab } from './ReviewsTab'
import { ServicesAnalyticsTab } from './ServicesAnalyticsTab'
import { StaffAnalyticsTab } from './StaffAnalyticsTab'

type ReportsTab = 'services' | 'clients' | 'staff' | 'payouts' | 'reviews' | 'competitors'

const TABS: PageTab<ReportsTab>[] = [
  { id: 'services', labelKey: 'reports_hub.tabs.services', icon: Sparkles },
  { id: 'clients', labelKey: 'reports_hub.tabs.clients', icon: Users },
  { id: 'staff', labelKey: 'reports_hub.tabs.staff', icon: Scissors },
  { id: 'payouts', labelKey: 'reports_hub.tabs.payouts', icon: Wallet },
  { id: 'reviews', labelKey: 'reports_hub.tabs.reviews', icon: Star },
  { id: 'competitors', labelKey: 'reports_hub.tabs.competitors', icon: Target },
]

function isReportsTab(v: string | null): v is ReportsTab {
  return (
    v === 'services' ||
    v === 'clients' ||
    v === 'staff' ||
    v === 'payouts' ||
    v === 'reviews' ||
    v === 'competitors'
  )
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
    <div className="flex min-w-0 flex-1 flex-col overflow-x-hidden px-5 py-7 sm:px-8 lg:pb-12">
      {/* Image #61: header «Аналитика по справочникам...» убран — он дублировал
          навигацию и занимал лишнее место. Активный таб уже самодокументируется. */}
      <PageTabsNav tabs={TABS} active={active} onChange={setActive} t={t} />

      {active === 'services' ? (
        <ServicesAnalyticsTab salonId={salonId} />
      ) : active === 'staff' ? (
        <StaffAnalyticsTab salonId={salonId} />
      ) : active === 'clients' ? (
        <ClientsAnalyticsTab salonId={salonId} />
      ) : active === 'reviews' ? (
        <ReviewsTab salonId={salonId} />
      ) : active === 'competitors' ? (
        <CompetitorsTab salonId={salonId} />
      ) : (
        <PayoutsPage />
      )}
    </div>
  )
}
