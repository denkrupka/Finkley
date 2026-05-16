import { ArrowLeft, Coins, CreditCard, Wallet } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link, useParams, useSearchParams } from 'react-router-dom'

import { PageTabsNav, type PageTab } from '@/components/ui/PageTabsNav'

import { CategoriesSection } from './IncomeCategoriesPage'
import { ParametersCard } from './ParametersCard'

type FinanceCatalogTab = 'expenses' | 'incomes' | 'cash'

const TABS: PageTab<FinanceCatalogTab>[] = [
  { id: 'expenses', labelKey: 'settings.finance_catalog.tabs.expenses', icon: Wallet },
  { id: 'incomes', labelKey: 'settings.finance_catalog.tabs.incomes', icon: Coins },
  { id: 'cash', labelKey: 'settings.finance_catalog.tabs.cash', icon: CreditCard },
]

function isTab(v: string | null): v is FinanceCatalogTab {
  return v === 'expenses' || v === 'incomes' || v === 'cash'
}

/**
 * /{salonId}/settings/finance-catalog — объединённый справочник «Финансы».
 * Заменил 4 отдельные страницы:
 *   - /settings/expenses-catalog (Расходы)
 *   - /settings/income-categories (Доходы)
 *   - /settings/investments-catalog (Инвестиции)
 *   - /settings/cash-registers (Кассы)
 *
 * По запросу владельца их свели в одну страницу с табами:
 *   - Расходы           — fixed/variable/taxes
 *   - Доходы и Инвестиции — категории прочих доходов + investments
 *   - Кассы             — cash_registers
 */
export function FinanceCatalogPage() {
  const { t } = useTranslation()
  const { salonId } = useParams<{ salonId: string }>()
  const [params, setParams] = useSearchParams()
  const tabParam = params.get('tab')
  const active: FinanceCatalogTab = isTab(tabParam) ? tabParam : 'expenses'

  function setActive(id: FinanceCatalogTab) {
    const next = new URLSearchParams(params)
    next.set('tab', id)
    setParams(next, { replace: true })
  }

  if (!salonId) return null

  return (
    <div className="flex flex-1 flex-col px-5 py-7 sm:px-8 lg:pb-12">
      <header className="mb-6 flex flex-col gap-2">
        <Link
          to={`/${salonId}/settings?tab=catalogs`}
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-xs"
        >
          <ArrowLeft className="size-3.5" strokeWidth={2} />
          {t('income_categories.back_to_catalogs')}
        </Link>
        <div className="flex items-center gap-3">
          <span className="bg-brand-yellow/40 text-brand-navy grid size-10 place-items-center rounded-md">
            <Wallet className="size-5" strokeWidth={1.7} />
          </span>
          <div>
            <h1 className="text-brand-navy text-2xl font-bold tracking-tight">
              {t('settings.finance_catalog.title')}
            </h1>
            <p className="text-muted-foreground mt-1 text-sm">
              {t('settings.finance_catalog.subtitle')}
            </p>
          </div>
        </div>
      </header>

      <PageTabsNav tabs={TABS} active={active} onChange={setActive} t={t} />

      {active === 'expenses' ? (
        <ParametersCard sectionKeys={['fixed', 'variable', 'taxes']} urlKey="exp" />
      ) : active === 'incomes' ? (
        <div className="flex flex-col gap-6">
          <CategoriesSection salonId={salonId} />
          <ParametersCard sectionKeys={['investments']} urlKey="inv" />
        </div>
      ) : (
        <ParametersCard sectionKeys={['cash_registers']} urlKey="cash" />
      )}
    </div>
  )
}
