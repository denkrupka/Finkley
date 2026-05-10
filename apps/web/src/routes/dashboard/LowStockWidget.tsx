import { AlertTriangle, ShoppingCart } from 'lucide-react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

import { useInventoryItems } from '@/hooks/useInventory'
import { cn } from '@/lib/utils/cn'

type Props = { salonId: string }

/**
 * Виджет «Заканчивается» — показывает топ-5 материалов со statusом «мало»
 * или «нет», отсортированных по дефициту (out-of-stock первыми).
 *
 * Не отображается если всё в порядке (нет low-stock материалов).
 * Клик по строке → /inventory с открытым drawer'ом материала.
 */
export function LowStockWidget({ salonId }: Props) {
  const { t } = useTranslation()
  const { data: items = [] } = useInventoryItems(salonId, { includeArchived: false })

  const lowStock = useMemo(() => {
    return items
      .filter((it) => it.current_stock <= it.min_stock)
      .sort((a, b) => {
        // Out-of-stock первыми, потом по % от мин-остатка
        const aOut = a.current_stock <= 0
        const bOut = b.current_stock <= 0
        if (aOut && !bOut) return -1
        if (!aOut && bOut) return 1
        const aPct = a.min_stock > 0 ? a.current_stock / a.min_stock : 0
        const bPct = b.min_stock > 0 ? b.current_stock / b.min_stock : 0
        return aPct - bPct
      })
      .slice(0, 5)
  }, [items])

  if (lowStock.length === 0) return null

  const outCount = lowStock.filter((it) => it.current_stock <= 0).length

  return (
    <section className="mb-5">
      <Link
        to={`/${salonId}/inventory`}
        className="flex items-start gap-3 rounded-lg border-2 border-amber-300 bg-amber-50 p-4 transition-colors hover:bg-amber-100"
      >
        <div className="grid size-10 shrink-0 place-items-center rounded-lg bg-amber-200 text-amber-900">
          <AlertTriangle className="size-5" strokeWidth={2} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <h3 className="text-sm font-bold text-amber-900">
              {t('dashboard.low_stock.title', { count: lowStock.length })}
            </h3>
            <span className="shrink-0 text-xs font-semibold text-amber-700">
              {outCount > 0
                ? t('dashboard.low_stock.out_count', { count: outCount })
                : t('dashboard.low_stock.go_to')}
            </span>
          </div>
          <ul className="mt-2 flex flex-col gap-1">
            {lowStock.map((it) => {
              const isOut = it.current_stock <= 0
              return (
                <li key={it.id} className="flex items-baseline justify-between gap-3 text-xs">
                  <span className="text-foreground truncate font-semibold">{it.name}</span>
                  <span className="num flex shrink-0 items-center gap-1.5">
                    <span
                      className={cn('font-bold', isOut ? 'text-destructive' : 'text-amber-700')}
                    >
                      {it.current_stock} {it.unit}
                    </span>
                    <span className="text-muted-foreground">/ {it.min_stock}</span>
                  </span>
                </li>
              )
            })}
          </ul>
          <span className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-amber-800">
            <ShoppingCart className="size-3" strokeWidth={2} />
            {t('dashboard.low_stock.cta')}
          </span>
        </div>
      </Link>
    </section>
  )
}
