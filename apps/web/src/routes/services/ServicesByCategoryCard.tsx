import { useTranslation } from 'react-i18next'
import { useParams } from 'react-router-dom'

import { useSalon } from '@/hooks/useSalons'
import { useServiceCategories, useServices } from '@/hooks/useServices'
import { formatCurrency } from '@/lib/utils/format-currency'

/**
 * Read-only сводка услуг, сгруппированных по категориям. Дополняет
 * ServicesPricingCard (плоский список с inline-edit) — здесь видна
 * структура каталога целиком: категория → услуги в ней.
 *
 * Ред-онли по дизайну: редактирование цен/имён остаётся в верхней
 * карточке, чтобы не дублировать формы.
 */
export function ServicesByCategoryCard() {
  const { t } = useTranslation()
  const { salonId } = useParams<{ salonId: string }>()
  const { data: salon } = useSalon(salonId)
  const { data: services = [] } = useServices(salonId)
  const { data: categories = [] } = useServiceCategories(salonId)

  if (!salonId) return null
  const currency = salon?.currency ?? 'PLN'

  const grouped = categories.map((c) => ({
    category: c,
    items: services.filter((s) => s.category_id === c.id),
  }))
  const uncategorized = services.filter((s) => !s.category_id)

  if (services.length === 0) {
    return (
      <section className="border-border bg-card shadow-finsm rounded-lg border p-5 sm:p-6">
        <h2 className="text-brand-navy text-base font-bold tracking-tight">
          {t('services_page.by_category.title')}
        </h2>
        <p className="text-muted-foreground mt-2 text-sm">{t('services_page.by_category.empty')}</p>
      </section>
    )
  }

  return (
    <section className="border-border bg-card shadow-finsm rounded-lg border p-5 sm:p-6">
      <div className="mb-4">
        <h2 className="text-brand-navy text-base font-bold tracking-tight">
          {t('services_page.by_category.title')}
        </h2>
        <p className="text-muted-foreground mt-1 text-sm">
          {t('services_page.by_category.subtitle')}
        </p>
      </div>

      <div className="flex flex-col gap-5">
        {grouped.map(({ category, items }) =>
          items.length === 0 ? null : (
            <div key={category.id}>
              <h3 className="text-foreground mb-2 text-sm font-bold tracking-tight">
                {category.name}{' '}
                <span className="text-muted-foreground font-medium">({items.length})</span>
              </h3>
              <ul className="border-border divide-border bg-muted/30 divide-y rounded-md border">
                {items.map((s) => (
                  <li
                    key={s.id}
                    className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
                  >
                    <span className="text-foreground truncate">{s.name}</span>
                    <span className="num text-muted-foreground shrink-0 text-xs">
                      {formatCurrency(s.default_price_cents, currency)}
                      {s.default_duration_min
                        ? ` · ${s.default_duration_min} ${t('services_page.by_category.min_short')}`
                        : ''}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ),
        )}

        {uncategorized.length > 0 ? (
          <div>
            <h3 className="text-foreground mb-2 text-sm font-bold tracking-tight">
              {t('services_page.by_category.uncategorized')}{' '}
              <span className="text-muted-foreground font-medium">({uncategorized.length})</span>
            </h3>
            <ul className="border-border divide-border bg-muted/30 divide-y rounded-md border">
              {uncategorized.map((s) => (
                <li
                  key={s.id}
                  className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
                >
                  <span className="text-foreground truncate">{s.name}</span>
                  <span className="num text-muted-foreground shrink-0 text-xs">
                    {formatCurrency(s.default_price_cents, currency)}
                    {s.default_duration_min
                      ? ` · ${s.default_duration_min} ${t('services_page.by_category.min_short')}`
                      : ''}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </section>
  )
}
