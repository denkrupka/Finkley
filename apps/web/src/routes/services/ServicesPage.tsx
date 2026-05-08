import { useTranslation } from 'react-i18next'

import { CategoriesCard } from '@/routes/settings/CategoriesCard'
import { ServicesPricingCard } from '@/routes/settings/ServicesPricingCard'

/**
 * /{salonId}/services — каталог услуг и категории.
 * Перенесено сюда из Settings, чтобы услуги были в основной навигации
 * (sidebar) и редактирование цен/себестоимости/категорий было в одном
 * клике, а не глубоко в настройках.
 */
export function ServicesPage() {
  const { t } = useTranslation()
  return (
    <div className="flex flex-1 flex-col px-5 py-7 sm:px-8 lg:pb-12">
      <header className="mb-6">
        <h1 className="text-brand-navy text-2xl font-bold tracking-tight">
          {t('services_page.title')}
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">{t('services_page.subtitle')}</p>
      </header>

      <div className="mb-6">
        <ServicesPricingCard />
      </div>

      <div className="mb-6">
        <CategoriesCard />
      </div>
    </div>
  )
}
