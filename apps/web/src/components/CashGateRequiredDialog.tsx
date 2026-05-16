import { Loader2, Unlock } from 'lucide-react'
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
import { useOpenShift, useShiftHistory } from '@/hooks/useCashShifts'
import { useSalon } from '@/hooks/useSalons'

type Props = {
  open: boolean
  onClose: () => void
  salonId: string
  /** Что юзер пытался сделать. Используется в тексте модалки для уточнения
   *  («чтобы рассчитать визит» / «чтобы добавить расход» / «чтобы добавить продажу»). */
  action?: 'expense' | 'sale' | 'visit_charge'
  /** Колбек после успешного открытия смены — обычно «снова попробовать
   *  изначальное действие». Если не задан — просто закрывает модалку. */
  onShiftOpened?: () => void
}

/**
 * Универсальный гейт «Касса не открыта». Используется вместо тостов и
 * баннеров на /expenses, /income, при расчёте визита и т.д. Двухшаговый
 * flow внутри одной модалки:
 *
 *   1. Сообщение «Касса не открыта» + кнопки «Открыть кассу» / «Отменить»
 *   2. После «Открыть кассу» — форма открытия смены (opening_amount + comment)
 *
 * При успехе открытия — вызывает onShiftOpened и закрывается, чтобы юзер
 * продолжил то, что начал.
 */
export function CashGateRequiredDialog({
  open,
  onClose,
  salonId,
  action = 'expense',
  onShiftOpened,
}: Props) {
  const { t } = useTranslation()
  const { data: salon } = useSalon(salonId)
  const currency = salon?.currency ?? 'PLN'
  const { data: history = [] } = useShiftHistory(salonId)
  const openShift = useOpenShift(salonId)

  const [step, setStep] = useState<'gate' | 'form'>('gate')
  const lastClosed = history[0]
  const defaultOpeningCents =
    lastClosed?.actual_cash_cents ?? salon?.opening_cash_balance_cents ?? 0
  const [amount, setAmount] = useState((defaultOpeningCents / 100).toFixed(2))
  const [comment, setComment] = useState('')

  // Сброс состояния при каждом открытии — гейт всегда стартует на step=gate.
  useEffect(() => {
    if (open) {
      setStep('gate')
      setAmount((defaultOpeningCents / 100).toFixed(2))
      setComment('')
    }
  }, [open, defaultOpeningCents])

  const descKey =
    action === 'sale'
      ? 'finance.cash.gate_required_sale'
      : action === 'visit_charge'
        ? 'finance.cash.gate_required_charge'
        : 'finance.cash.gate_required_expense'

  function handleOpenShift() {
    const n = Number(amount.replace(',', '.'))
    if (!Number.isFinite(n) || n < 0) {
      toast.error(t('finance.cash.invalid_amount'))
      return
    }
    openShift.mutate(
      {
        opening_amount_cents: Math.round(n * 100),
        opening_comment: comment.trim() || undefined,
      },
      {
        onSuccess: () => {
          toast.success(t('finance.cash.toast_opened'))
          onClose()
          onShiftOpened?.()
        },
        onError: (err) => {
          const msg = err instanceof Error ? err.message : String(err)
          toast.error(t('finance.cash.toast_open_error'), { description: msg })
        },
      },
    )
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && !openShift.isPending && onClose()}>
      <DialogContent>
        {step === 'gate' ? (
          <>
            <DialogHeader>
              <DialogTitle>{t('finance.cash.gate_required_title')}</DialogTitle>
              <DialogDescription>{t(descKey)}</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={onClose}>
                {t('common.cancel')}
              </Button>
              <Button variant="primary" onClick={() => setStep('form')}>
                <Unlock className="size-4" strokeWidth={2} />
                {t('finance.cash.gate_required_open_button')}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>{t('finance.cash.open_shift_title')}</DialogTitle>
              <DialogDescription>{t('finance.cash.open_shift_subtitle')}</DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-3 px-5 pb-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="gate-open-amount">
                  {t('finance.cash.opening_amount_label', { currency })}
                </Label>
                <Input
                  id="gate-open-amount"
                  type="number"
                  inputMode="decimal"
                  step="any"
                  min="0"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  autoFocus
                />
                <p className="text-muted-foreground text-xs">
                  {t('finance.cash.opening_amount_hint')}
                </p>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="gate-open-comment">{t('finance.cash.opening_comment_label')}</Label>
                <Input
                  id="gate-open-comment"
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder={t('finance.cash.opening_comment_placeholder')}
                />
              </div>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setStep('gate')}
                disabled={openShift.isPending}
              >
                {t('cash_transfer.button_back')}
              </Button>
              <Button variant="primary" onClick={handleOpenShift} disabled={openShift.isPending}>
                {openShift.isPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  t('finance.cash.open_shift_submit')
                )}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
