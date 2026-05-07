import { useTranslation } from 'react-i18next'

import { ComingSoon } from './ComingSoon'
import { NAV_ITEMS } from './nav-config'

/**
 * Плейсхолдеры salon-scoped роутов на стадии 0->1.
 * Реальные страницы заменят их в TASK-11..18.
 *
 * Структура: один компонент на каждый пункт sidebar. Каждый показывает
 * <ComingSoon> до того, как соответствующий TASK его перепишет.
 */

function pageFor(id: string) {
  const item = NAV_ITEMS.find((n) => n.id === id)!
  return function Page() {
    const { t } = useTranslation()
    return <ComingSoon icon={item.icon} title={t(item.i18nKey)} stage={item.stage} />
  }
}

// Замещены реальными страницами:
// - DashboardPage (TASK-14) → routes/dashboard/DashboardPage.tsx
// - VisitsPage    (TASK-11) → routes/visits/VisitsPage.tsx
// - ExpensesPage  (TASK-13) → routes/expenses/ExpensesPage.tsx
// - StaffPage     (TASK-12) → routes/staff/StaffPage.tsx
// - ClientsPage   (TASK-20) → routes/clients/ClientsPage.tsx
// - PayoutsPage   (TASK-22) → routes/payouts/PayoutsPage.tsx
// - ReportsPage   (TASK-23) → routes/reports/ReportsPage.tsx
//
// AI остаётся ComingSoon до стадии 4.
export const AIPage = pageFor('ai')
