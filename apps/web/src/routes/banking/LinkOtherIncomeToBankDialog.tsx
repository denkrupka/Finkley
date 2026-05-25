import { Landmark, Loader2, Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { useBankInflows, useLinkBankTransaction } from '@/hooks/useBanking'
import { cn } from '@/lib/utils/cn'
import { formatCurrency } from '@/lib/utils/format-currency'
import { formatExpenseDate } from '@/lib/utils/format-date'

type Props = {
  open: boolean
  onOpenChange: (v: boolean) => void
  salonId: string
  currency: string
  /** Прочий доход, для которого подыскиваем неpривязанную credit-tx. */
  otherIncome: {
    id: string
    amount_cents: number
    income_at: string
    title: string
  }
  onLinked?: () => void
}

/**
 * Реверс LinkTransactionDialog для прочих доходов: пользователь стоит на
 * карточке other_income и выбирает credit-tx для привязки.
 */
export function LinkOtherIncomeToBankDialog({
  open,
  onOpenChange,
  salonId,
  currency,
  otherIncome,
  onLinked,
}: Props) {
  const { t } = useTranslation()
  const [search, setSearch] = useState('')
  const link = useLinkBankTransaction(salonId)

  const period = useMemo(() => {
    const d = new Date(otherIncome.income_at)
    const start = new Date(d)
    start.setDate(start.getDate() - 90)
    const end = new Date(d)
    end.setDate(end.getDate() + 90)
    return {
      start: start.toISOString().slice(0, 10),
      end: end.toISOString().slice(0, 10),
    }
  }, [otherIncome.income_at])

  const txsQ = useBankInflows(salonId, period)

  const items = useMemo(() => {
    const all = (txsQ.data ?? []).filter(
      (tx) => !tx.expense_id && !tx.linked_visit_id && !tx.linked_other_income_id,
    )
    const q = search.toLowerCase().trim()
    if (!q) return all.slice(0, 100)
    return all
      .filter((tx) => {
        if (tx.counterparty?.toLowerCase().includes(q)) return true
        if (tx.description?.toLowerCase().includes(q)) return true
        const amountStr = (tx.amount_cents / 100).toFixed(2)
        if (amountStr.includes(q)) return true
        return false
      })
      .slice(0, 100)
  }, [txsQ.data, search])

  function handlePick(txId: string) {
    link.mutate(
      { transactionId: txId, otherIncomeId: otherIncome.id, clearNeedsReview: true },
      {
        onSuccess: () => {
          toast.success(t('banking.link_dialog.linked_toast'))
          onLinked?.()
          onOpenChange(false)
        },
        onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
      },
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Landmark className="text-brand-teal-deep size-4" strokeWidth={2} />
            {t('banking.reverse_link.title')}
          </DialogTitle>
          <DialogDescription>
            {otherIncome.title}
            {' · '}
            <span className="text-brand-sage-deep">
              +{formatCurrency(otherIncome.amount_cents, currency)}
            </span>
            {' · '}
            {formatExpenseDate(otherIncome.income_at)}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3 px-5 pb-4 pt-1">
          <div className="relative">
            <Search
              className="text-muted-foreground pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2"
              strokeWidth={1.7}
            />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('banking.reverse_link.search_placeholder')}
              className="pl-8"
              autoFocus
            />
          </div>

          <div className="border-border h-[360px] overflow-y-auto rounded-md border">
            {txsQ.isLoading ? (
              <div className="flex h-full items-center justify-center">
                <Loader2 className="text-muted-foreground size-5 animate-spin" strokeWidth={2} />
              </div>
            ) : items.length === 0 ? (
              <div className="text-muted-foreground flex h-full items-center justify-center px-4 text-center text-sm">
                {t('banking.reverse_link.empty')}
              </div>
            ) : (
              <ul>
                {items.map((tx) => {
                  const exact = tx.amount_cents === otherIncome.amount_cents
                  const close = !exact && Math.abs(tx.amount_cents - otherIncome.amount_cents) < 100
                  return (
                    <li key={tx.id} className="border-border border-b last:border-b-0">
                      <button
                        type="button"
                        onClick={() => handlePick(tx.id)}
                        className="hover:bg-muted/30 flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left transition-colors"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <p className="text-foreground truncate text-sm font-semibold">
                              {tx.counterparty || t('banking.transactions.no_counterparty')}
                            </p>
                            {exact ? (
                              <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-emerald-800">
                                {t('banking.link_dialog.exact_match')}
                              </span>
                            ) : close ? (
                              <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-amber-800">
                                {t('banking.link_dialog.close_match')}
                              </span>
                            ) : null}
                          </div>
                          <p className="text-muted-foreground mt-0.5 truncate text-xs">
                            {formatExpenseDate(tx.executed_at)}
                            {tx.description ? ` · ${tx.description.slice(0, 60)}` : ''}
                          </p>
                        </div>
                        <div
                          className={cn(
                            'num shrink-0 text-sm font-bold tabular-nums',
                            'text-brand-sage-deep',
                          )}
                        >
                          +{formatCurrency(tx.amount_cents, tx.currency || currency)}
                        </div>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
