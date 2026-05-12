import { Briefcase, Coins, ShoppingBag } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useParams, useSearchParams } from 'react-router-dom'

import { PageTabsNav, type PageTab } from '@/components/ui/PageTabsNav'
import { VisitsPage } from '@/routes/visits/VisitsPage'

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
 * Страница «Доходы» — таб-обёртка над тремя источниками выручки:
 *   - Визиты (услуги)   — текущая VisitsPage
 *   - Продажи (товары)  — TODO: фильтр визитов по kind=retail (TASK-54-related)
 *   - Прочие доходы      — TODO: новая таблица other_incomes (TASK-54)
 *
 * Активный таб — в URL `?tab=visits|sales|other`.
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
      <div className="mb-5">
        <h1 className="text-brand-navy text-2xl font-bold tracking-tight">{t('income.title')}</h1>
        <p className="text-muted-foreground mt-1 text-sm">{t('income.subtitle')}</p>
      </div>

      <PageTabsNav tabs={TABS} active={active} onChange={setActive} t={t} />

      {active === 'visits' ? (
        <VisitsPage />
      ) : (
        <div className="border-border bg-card shadow-finsm rounded-lg border p-6">
          <p className="text-foreground/80 text-sm leading-snug">
            {active === 'sales' ? t('income.sales_placeholder') : t('income.other_placeholder')}
          </p>
        </div>
      )}
    </div>
  )
}
