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
import { formatExpenseDate, toLocalISODate } from '@/lib/utils/format-date'

import { BankingTransactionsTable } from './BankingTransactionsTable'

type Props = {
  open: boolean
  onOpenChange: (v: boolean) => void
  salonId: string
  currency: string
  /** Визит, для которого подыскиваем неpривязанную credit-транзакцию. */
  visit: {
    id: string
    /** amount_cents − discount_cents + tip_cents — то, что реально получено. */
    amount_cents: number
    visit_at: string
    title: string
  }
  onLinked?: () => void
}

/**
 * Обратное направление для credit: с карточки визита/продажи выбираем
 * банковскую credit-tx. Embed BankingTransactionsTable picker-mode
 * (см. owner-feedback 2026-05-26 image #12/#13).
 */
export function LinkVisitToBankDialog({
  open,
  onOpenChange,
  salonId,
  currency,
  visit,
  onLinked,
}: Props) {
  const { t } = useTranslation()
  const link = useLinkBankTransaction(salonId)

  const period = useMemo(() => {
    const d = new Date(visit.visit_at)
    const start = new Date(d)
    start.setDate(start.getDate() - 90)
    const end = new Date(d)
    end.setDate(end.getDate() + 90)
    return {
      start: toLocalISODate(start),
      end: toLocalISODate(end),
    }
  }, [visit.visit_at])

  function handlePick(tx: BankInflowRow) {
    link.mutate(
      { transactionId: tx.id, visitId: visit.id, clearNeedsReview: true },
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
              {visit.title}
              {' · '}
              <span className="text-brand-sage-deep">
                +{formatCurrency(visit.amount_cents, currency)}
              </span>
              {' · '}
              {formatExpenseDate(visit.visit_at)}
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
