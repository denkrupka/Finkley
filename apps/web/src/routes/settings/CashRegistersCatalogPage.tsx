import { ArrowLeft, CreditCard } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link, useParams } from 'react-router-dom'

import { ParametersCard } from './ParametersCard'

/**
 * /{salonId}/settings/cash-registers — Справочник «Кассы».
 * Содержит секцию financial_settings.cash_registers — стартовые остатки
 * по кассам/счетам. Перенесено из /finance?tab=parameters (Image #45).
 */
export function CashRegistersCatalogPage() {
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
          <span className="bg-brand-teal-soft text-brand-teal-deep grid size-10 place-items-center rounded-md">
            <CreditCard className="size-5" strokeWidth={1.7} />
          </span>
          <div>
            <h1 className="text-brand-navy text-2xl font-bold tracking-tight">
              {t('settings.catalogs.items.cash.title')}
            </h1>
            <p className="text-muted-foreground mt-1 text-sm">
              {t('settings.catalogs.items.cash.subtitle')}
            </p>
          </div>
        </div>
      </header>

      <ParametersCard sectionKeys={['cash_registers']} urlKey="cash" />
    </div>
  )
}
