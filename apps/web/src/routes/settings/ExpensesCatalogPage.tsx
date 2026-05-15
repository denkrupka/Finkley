import { ArrowLeft, Wallet } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link, useParams } from 'react-router-dom'

import { ParametersCard } from './ParametersCard'

/**
 * /{salonId}/settings/expenses-catalog — Справочник «Расходы».
 * Объединяет три секции financial_settings:
 *   - fixed   — постоянные расходы (аренда, ЗП)
 *   - variable — переменные (% от выручки)
 *   - taxes    — налоги
 *
 * Перенесено сюда из /finance?tab=parameters по запросу владельца (Image #45).
 */
export function ExpensesCatalogPage() {
  const { t } = useTranslation()
  const { salonId } = useParams<{ salonId: string }>()
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
              {t('settings.catalogs.items.expenses.title')}
            </h1>
            <p className="text-muted-foreground mt-1 text-sm">
              {t('settings.catalogs.items.expenses.subtitle')}
            </p>
          </div>
        </div>
      </header>

      <ParametersCard sectionKeys={['fixed', 'variable', 'taxes']} urlKey="exp" />
    </div>
  )
}
