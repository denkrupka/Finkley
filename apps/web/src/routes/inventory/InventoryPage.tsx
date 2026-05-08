import { Package } from 'lucide-react'
import { useTranslation } from 'react-i18next'

/**
 * /{salonId}/inventory — учёт расходных материалов (стадия 5).
 *
 * Idea: владелица заводит товары (краска, лак, шампунь) с current stock +
 * cost-per-unit + min-stock-alert. При сохранении визита можно отметить
 * сколько чего израсходовано — система автоматически уменьшает stock и
 * пересчитывает cost для маржи в reports. Также автоматический алерт
 * когда stock < min_stock.
 *
 * Сейчас — placeholder, ждёт первых юзеров с реальной потребностью.
 */
export function InventoryPage() {
  const { t } = useTranslation()
  return (
    <div className="flex flex-1 items-center justify-center px-5 py-7 sm:px-8">
      <div className="border-border bg-card shadow-finsm w-full max-w-lg rounded-lg border p-8 text-center">
        <div className="bg-brand-teal-soft text-brand-teal-deep mx-auto mb-4 grid size-14 place-items-center rounded-2xl">
          <Package className="size-7" strokeWidth={1.7} />
        </div>
        <h1 className="text-brand-navy mb-2 text-xl font-bold tracking-tight">
          {t('inventory.title')}
        </h1>
        <p className="text-muted-foreground mb-4 text-sm leading-relaxed">
          {t('inventory.subtitle')}
        </p>
        <p className="text-brand-text-faint text-xs">{t('inventory.coming_soon')}</p>
      </div>
    </div>
  )
}
