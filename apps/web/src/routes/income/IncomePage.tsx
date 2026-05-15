import { Briefcase, Coins, ShoppingBag } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useParams, useSearchParams } from 'react-router-dom'

import { PageTabsNav, type PageTab } from '@/components/ui/PageTabsNav'
import { VisitsActionsBar } from '@/routes/visits/VisitsActionsBar'
import { VisitsPage } from '@/routes/visits/VisitsPage'

import { OtherIncomeTab } from './OtherIncomeTab'
import { SalesTab } from './SalesTab'

type IncomeTab = 'visits' | 'sales' | 'other'

const TABS: PageTab<IncomeTab>[] = [
  { id: 'visits', labelKey: 'income.tabs.visits', icon: Briefcase },
  { id: 'sales', labelKey: 'income.tabs.sales', icon: ShoppingBag },
  { id: 'other', labelKey: 'income.tabs.other', icon: Coins },
]

function isIncomeTab(v: string | null): v is IncomeTab {
  return v === 'visits' || v === 'sales' || v === 'other'
}

/**
 * Страница «Доходы» — таб-обёртка над тремя источниками выручки.
 * Image #54: убран h1+subtitle (дублировали навигационную хлебную крошку и
 * занимали место). Action-кнопки таба «Визиты» (Импорт CSV / list|calendar)
 * вынесены в rightSlot PageTabsNav.
 */
export function IncomePage() {
  const { t } = useTranslation()
  const { salonId } = useParams<{ salonId: string }>()
  const [params, setParams] = useSearchParams()

  const tabParam = params.get('tab')
  const active: IncomeTab = isIncomeTab(tabParam) ? tabParam : 'visits'

  function setActive(id: IncomeTab) {
    const next = new URLSearchParams(params)
    next.set('tab', id)
    setParams(next, { replace: true })
  }

  if (!salonId) return null

  return (
    <div className="flex flex-1 flex-col px-5 py-7 sm:px-8 lg:pb-12">
      <PageTabsNav
        tabs={TABS}
        active={active}
        onChange={setActive}
        t={t}
        rightSlot={active === 'visits' ? <VisitsActionsBar /> : null}
      />

      {active === 'visits' ? (
        <VisitsPage forcedKind="visit" />
      ) : active === 'sales' ? (
        <SalesTab salonId={salonId} />
      ) : (
        <OtherIncomeTab salonId={salonId} />
      )}
    </div>
  )
}
