import { Coins, TrendingDown } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router-dom'

import { PageTabsNav, type PageTab } from '@/components/ui/PageTabsNav'
import { useSalon } from '@/hooks/useSalons'
import { FinancialSectionBudgetsCard } from '@/routes/finance/FinancialSectionBudgetsCard'
import { IncomeBudgetsCard } from '@/routes/finance/IncomeBudgetsCard'

type BudgetSub = 'expenses' | 'incomes'

const SUB_TABS: PageTab<BudgetSub>[] = [
  { id: 'expenses', labelKey: 'finance.budgets.tabs.expenses', icon: TrendingDown },
  { id: 'incomes', labelKey: 'finance.budgets.tabs.incomes', icon: Coins },
]

function isSub(v: string | null): v is BudgetSub {
  return v === 'expenses' || v === 'incomes'
}

/**
 * Финансы → Бюджеты (Image #47).
 * Объединяет два планирования:
 *   - Плановые расходы: бюджеты по категориям расходов (перенесено из
 *     ExpensesPage → BudgetsCard).
 *   - Плановые доходы: financial_settings.other_income (ожидаемые
 *     поступления вне визитов — аренда, кэшбек и т.д.).
 */
export function BudgetsTab({ salonId }: { salonId: string }) {
  const { t } = useTranslation()
  const { data: salon } = useSalon(salonId)
  const [params, setParams] = useSearchParams()
  const subParam = params.get('bud')
  const active: BudgetSub = isSub(subParam) ? subParam : 'expenses'
  const currency = salon?.currency ?? 'PLN'

  function setActive(id: BudgetSub) {
    const next = new URLSearchParams(params)
    next.set('bud', id)
    setParams(next, { replace: true })
  }

  return (
    <div className="flex flex-col gap-4">
      <PageTabsNav tabs={SUB_TABS} active={active} onChange={setActive} t={t} />
      {active === 'expenses' ? (
        <>
          {/* Image #128: список категорий тянется из Справочников
              (financial_settings.fixed/variable). Постоянные — в деньгах,
              переменные — в процентах. */}
          <FinancialSectionBudgetsCard
            salonId={salonId}
            currency={currency}
            section="fixed"
            kind="money"
            title={t('finance.section_budgets.fixed_title')}
            emptyHint={t('finance.section_budgets.fixed_empty')}
            addLabel={t('finance.section_budgets.fixed_add')}
            addPlaceholder={t('finance.section_budgets.fixed_add_placeholder')}
          />
          <FinancialSectionBudgetsCard
            salonId={salonId}
            currency={currency}
            section="variable"
            kind="pct"
            title={t('finance.section_budgets.variable_title')}
            emptyHint={t('finance.section_budgets.variable_empty')}
            addLabel={t('finance.section_budgets.variable_add')}
            addPlaceholder={t('finance.section_budgets.variable_add_placeholder')}
          />
        </>
      ) : (
        <IncomeBudgetsCard salonId={salonId} currency={currency} />
      )}
    </div>
  )
}
