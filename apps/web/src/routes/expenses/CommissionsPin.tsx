import { Percent, ChevronRight } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { effectivePaidCents, type ExpenseRow } from '@/hooks/useExpenses'
import { formatCurrency } from '@/lib/utils/format-currency'

import { CommissionsModal } from './CommissionsModal'

type Props = {
  salonId: string
  currency: string
  /** Все расходы за выбранный период (рендерящаяся таблица). Фильтр по
   *  source='auto_commission' идёт внутри. Передаём один раз, чтобы не делать
   *  второго запроса к expenses. */
  expenses: ExpenseRow[]
  onOpenSource: (table: 'visits' | 'other_incomes', id: string) => void
}

/**
 * T15 — закреплённая первая позиция «Комиссии» в реестре расходов.
 * Показывает суммарный итог комиссий за выбранный период. По клику —
 * открывает модалку с детализацией транзакций (см. CommissionsModal).
 *
 * Если за период комиссий нет — pin не рендерится (UI остаётся чистым).
 */
export function CommissionsPin({ salonId, currency, expenses, onOpenSource }: Props) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  const commissions = expenses.filter((e) => e.source === 'auto_commission')
  if (commissions.length === 0) return null
  const total = commissions.reduce((s, e) => s + effectivePaidCents(e), 0)

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        data-tour="commissions-pin"
        className="border-border hover:bg-muted/30 group flex w-full items-center justify-between gap-3 border-b px-5 py-3 text-left transition-colors"
      >
        <div className="flex items-center gap-3">
          <span className="grid size-9 place-items-center rounded-md bg-amber-100 text-amber-800">
            <Percent className="size-4" strokeWidth={1.8} />
          </span>
          <div>
            <p className="text-foreground text-sm font-bold">
              {t('expenses.commissions.pin_title', { defaultValue: 'Комиссии' })}
            </p>
            <p className="text-muted-foreground text-[11px]">
              {t('expenses.commissions.pin_subtitle', {
                defaultValue: 'Авто-расходы по методам с комиссией · {{count}} tx',
                count: commissions.length,
              })}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="num text-destructive text-base font-bold">
            −{formatCurrency(total, currency)}
          </span>
          <ChevronRight className="text-muted-foreground size-4" strokeWidth={2} />
        </div>
      </button>

      <CommissionsModal
        open={open}
        onClose={() => setOpen(false)}
        salonId={salonId}
        currency={currency}
        expenses={commissions}
        onOpenSource={(table, id) => {
          setOpen(false)
          onOpenSource(table, id)
        }}
      />
    </>
  )
}
