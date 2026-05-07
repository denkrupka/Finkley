import { Coins } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { useCashBalance } from '@/hooks/useExpenseExtras'
import { formatCurrency } from '@/lib/utils/format-currency'

/**
 * Виджет «Налом сейчас» — opening balance + cash visits − cash expenses.
 * Помогает владельцу салона видеть сколько физических денег в кассе должно быть.
 */
export function CashBalanceWidget({ salonId, currency }: { salonId: string; currency: string }) {
  const { t } = useTranslation()
  const { data: balance } = useCashBalance(salonId)
  if (balance == null) return null
  const cents = Number(balance)

  return (
    <div className="border-border bg-card shadow-finsm flex items-center gap-3 rounded-lg border p-4">
      <div
        className={`grid size-10 shrink-0 place-items-center rounded-md ${
          cents < 0 ? 'bg-destructive/10 text-destructive' : 'bg-brand-yellow text-brand-navy'
        }`}
      >
        <Coins className="size-5" strokeWidth={1.8} />
      </div>
      <div className="flex-1">
        <p className="text-muted-foreground text-[11px] font-bold uppercase tracking-wider">
          {t('dashboard.cash.title')}
        </p>
        <p
          className={`num mt-0.5 text-xl font-bold ${
            cents < 0 ? 'text-destructive' : 'text-brand-navy'
          }`}
        >
          {formatCurrency(cents, currency)}
        </p>
      </div>
    </div>
  )
}
