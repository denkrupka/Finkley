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
import { useLinkBankTransaction, type BankInflowRow } from '@/hooks/useBanking'
import { formatCurrency } from '@/lib/utils/format-currency'
import { formatExpenseDate } from '@/lib/utils/format-date'

import { BankingTransactionsTable } from './BankingTransactionsTable'

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
 * Реверс LinkTransactionDialog для прочих доходов: embed
 * BankingTransactionsTable picker-mode (см. owner-feedback 2026-05-26).
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

  function handlePick(tx: BankInflowRow) {
    link.mutate(
      { transactionId: tx.id, otherIncomeId: otherIncome.id, clearNeedsReview: true },
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
              {otherIncome.title}
              {' · '}
              <span className="text-brand-sage-deep">
                +{formatCurrency(otherIncome.amount_cents, currency)}
              </span>
              {' · '}
              {formatExpenseDate(otherIncome.income_at)}
            </DialogDescription>
          </div>
        </DialogHeader>

        <div className="overflow-y-auto px-5 py-3">
          <BankingTransactionsTable
            salonId={salonId}
            direction="credit"
            period={period}
            currency={currency}
            unlinkedOnly
            onPickTransaction={(tx) => handlePick(tx as BankInflowRow)}
          />
        </div>
      </DialogContent>
    </Dialog>
  )
}
