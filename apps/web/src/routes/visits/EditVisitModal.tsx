import { Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useUpdateVisit, type PaymentMethod, type VisitRow } from '@/hooks/useVisits'

const PAYMENT_OPTIONS = ['cash', 'card', 'transfer', 'online', 'mixed'] as const

/**
 * Минимальная форма редактирования визита: сумма, метод оплаты, чаевые,
 * скидка, комментарий. Дата/мастер/услуга/клиент — пока read-only;
 * для них юзер удаляет визит и создаёт заново через QuickEntry.
 */
export function EditVisitModal({
  visit,
  onClose,
  salonId,
  currency,
}: {
  visit: VisitRow | null
  onClose: () => void
  salonId: string
  currency: string
}) {
  const { t } = useTranslation()
  const update = useUpdateVisit(salonId)

  const [amount, setAmount] = useState('')
  const [tip, setTip] = useState('')
  const [discount, setDiscount] = useState('')
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash')
  const [comment, setComment] = useState('')

  useEffect(() => {
    if (!visit) return
    setAmount((visit.amount_cents / 100).toFixed(2).replace('.', ','))
    setTip(visit.tip_cents > 0 ? (visit.tip_cents / 100).toFixed(2).replace('.', ',') : '')
    setDiscount(
      visit.discount_cents > 0 ? (visit.discount_cents / 100).toFixed(2).replace('.', ',') : '',
    )
    setPaymentMethod(visit.payment_method)
    setComment(visit.comment ?? '')
  }, [visit])

  function parseMoney(v: string): number {
    const n = Number(v.replace(',', '.'))
    return Number.isFinite(n) ? Math.round(n * 100) : 0
  }

  function handleSubmit() {
    if (!visit) return
    const amountCents = parseMoney(amount)
    if (amountCents <= 0) {
      toast.error(t('visits.errors.amount_positive'))
      return
    }
    update.mutate(
      {
        id: visit.id,
        amount_cents: amountCents,
        tip_cents: parseMoney(tip),
        discount_cents: parseMoney(discount),
        payment_method: paymentMethod,
        comment: comment.trim() || null,
      },
      {
        onSuccess: () => {
          toast.success(t('visits.toast_updated'))
          onClose()
        },
        onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
      },
    )
  }

  return (
    <Dialog open={visit !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('visits.edit.title')}</DialogTitle>
          <DialogDescription>{t('visits.edit.subtitle')}</DialogDescription>
        </DialogHeader>

        <form
          className="flex flex-col gap-4 px-5 pb-2 pt-3"
          onSubmit={(e) => {
            e.preventDefault()
            handleSubmit()
          }}
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="edit-amount">{t('visits.edit.amount_label', { currency })}</Label>
            <Input
              id="edit-amount"
              type="text"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="edit-payment">{t('visits.edit.payment_label')}</Label>
            <Select
              value={paymentMethod}
              onValueChange={(v) => setPaymentMethod(v as PaymentMethod)}
            >
              <SelectTrigger id="edit-payment">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAYMENT_OPTIONS.map((p) => (
                  <SelectItem key={p} value={p}>
                    {t(`payment_methods.${p}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="edit-tip">{t('visits.edit.tip_label')}</Label>
              <Input
                id="edit-tip"
                type="text"
                inputMode="decimal"
                value={tip}
                onChange={(e) => setTip(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="edit-discount">{t('visits.edit.discount_label')}</Label>
              <Input
                id="edit-discount"
                type="text"
                inputMode="decimal"
                value={discount}
                onChange={(e) => setDiscount(e.target.value)}
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="edit-comment">{t('visits.edit.comment_label')}</Label>
            <Input
              id="edit-comment"
              type="text"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
            />
          </div>
        </form>

        <DialogFooter className="px-5">
          <Button variant="outline" type="button" onClick={onClose} disabled={update.isPending}>
            {t('common.cancel')}
          </Button>
          <Button type="button" onClick={handleSubmit} disabled={update.isPending}>
            {update.isPending ? (
              <>
                <Loader2 className="size-4 animate-spin" strokeWidth={2} />
                {t('visits.edit.saving')}
              </>
            ) : (
              t('visits.edit.save')
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
