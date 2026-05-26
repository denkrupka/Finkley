import { Landmark } from 'lucide-react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useLinkBankTransaction, type BankOutflowRow } from '@/hooks/useBanking'
import { formatCurrency } from '@/lib/utils/format-currency'
import { formatExpenseDate } from '@/lib/utils/format-date'

import { BankingTransactionsTable } from './BankingTransactionsTable'

type Props = {
  open: boolean
  onOpenChange: (v: boolean) => void
  salonId: string
  currency: string
  /** Расход, для которого подыскиваем неpривязанную банковскую транзакцию. */
  expense: {
    id: string
    amount_cents: number
    expense_at: string
    description: string | null
    document_number: string | null
  }
  onLinked?: () => void
}

/**
 * Обратное направление LinkTransactionDialog: пользователь стоит на
 * карточке расхода и выбирает банковскую транзакцию для привязки.
 * Embed-режим полноценной BankingTransactionsTable (см. owner-feedback
 * 2026-05-26 image #12/#13) — юзер видит ту же таблицу что и на /expenses
 * → таб «Банкинг», только в picker-режиме.
 *
 * Период — ±90 дней от даты расхода (auto-match window). unlinkedOnly=true
 * скрывает уже связанные tx — нет смысла предлагать связать их ещё раз.
 */
export function LinkExpenseToBankDialog({
  open,
  onOpenChange,
  salonId,
  currency,
  expense,
  onLinked,
}: Props) {
  const { t } = useTranslation()
  const link = useLinkBankTransaction(salonId)

  const period = useMemo(() => {
    const d = new Date(expense.expense_at)
    const start = new Date(d)
    start.setDate(start.getDate() - 90)
    const end = new Date(d)
    end.setDate(end.getDate() + 90)
    return {
      start: start.toISOString().slice(0, 10),
      end: end.toISOString().slice(0, 10),
    }
  }, [expense.expense_at])

  function handlePick(tx: BankOutflowRow) {
    link.mutate(
      { transactionId: tx.id, expenseId: expense.id, clearNeedsReview: true },
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
      <DialogContent className="!max-h-[92vh] !w-[min(96vw,1100px)] !max-w-[1100px] gap-0 overflow-hidden p-0">
        <DialogHeader>
          <div className="border-border border-b px-5 py-3">
            <DialogTitle className="flex items-center gap-2 text-base">
              <Landmark className="text-brand-teal-deep size-4" strokeWidth={2} />
              {t('banking.reverse_link.title')}
            </DialogTitle>
            <DialogDescription className="text-xs">
              {expense.description || '—'}
              {' · '}
              <span className="text-destructive">
                −{formatCurrency(expense.amount_cents, currency)}
              </span>
              {' · '}
              {formatExpenseDate(expense.expense_at)}
              {expense.document_number ? ` · № ${expense.document_number}` : ''}
            </DialogDescription>
          </div>
        </DialogHeader>

        <div className="overflow-y-auto px-5 py-3">
          <BankingTransactionsTable
            salonId={salonId}
            direction="debit"
            period={period}
            currency={currency}
            unlinkedOnly
            onPickTransaction={(tx) => handlePick(tx as BankOutflowRow)}
          />
        </div>
      </DialogContent>
    </Dialog>
  )
}
