import { Landmark, Link2, Link2Off, Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { useQueryClient } from '@tanstack/react-query'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
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
import { useBankLinkedIncomeIds } from '@/hooks/useBanking'
import { useCashRegisters } from '@/hooks/useCashRegisters'
import {
  useDeleteOtherIncome,
  useOtherIncomeCategories,
  useUpdateOtherIncome,
  type OtherIncomeRow,
} from '@/hooks/useOtherIncomes'
import { usePaymentMethods } from '@/hooks/usePaymentMethods'
import type { PaymentMethod } from '@/hooks/useVisits'
import { supabase } from '@/lib/supabase/client'
import { cn } from '@/lib/utils/cn'
import { LinkOtherIncomeToBankDialog } from '@/routes/banking/LinkOtherIncomeToBankDialog'

type Props = {
  open: boolean
  onClose: () => void
  salonId: string
  currency: string
  income: OtherIncomeRow | null
}

/**
 * Редактирование строки прочего дохода. Открывается из SalesTab кликом по
 * строке (рядом с retail-визитами они мешаются — для них VisitDetailModal,
 * для прочих доходов своя форма с категорией / суммой / способом оплаты /
 * кассой / датой / комментарием).
 */
export function OtherIncomeEditModal({ open, onClose, salonId, currency, income }: Props) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const update = useUpdateOtherIncome(salonId)
  const remove = useDeleteOtherIncome(salonId)
  const { data: categories = [] } = useOtherIncomeCategories(salonId)
  const { data: paymentMethods = [] } = usePaymentMethods(salonId)
  const { data: cashRegisters = [] } = useCashRegisters(salonId)
  const { data: bankLinked } = useBankLinkedIncomeIds(salonId)
  const isBankLinked = income ? (bankLinked?.otherIncomeIds.has(income.id) ?? false) : false

  const [categoryId, setCategoryId] = useState<string>('')
  const [amount, setAmount] = useState<string>('')
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | ''>('')
  const [cashRegisterId, setCashRegisterId] = useState<string>('')
  const [comment, setComment] = useState<string>('')
  const [incomeAt, setIncomeAt] = useState<string>('')
  const [pickerOpen, setPickerOpen] = useState(false)
  const [unlinking, setUnlinking] = useState(false)

  useEffect(() => {
    if (open && income) {
      setCategoryId(income.category_id ?? '')
      setAmount((income.amount_cents / 100).toFixed(2))
      setPaymentMethod((income.payment_method ?? '') as PaymentMethod | '')
      setCashRegisterId(income.cash_register_id ?? '')
      setComment(income.comment ?? '')
      setIncomeAt(income.income_at)
    }
  }, [open, income])

  if (!income) return null

  function handleSave() {
    if (!income) return
    const cents = Math.round(Number(amount.replace(',', '.')) * 100)
    if (!Number.isFinite(cents) || cents <= 0) {
      toast.error(t('income.other_form.errors.amount_positive'))
      return
    }
    update.mutate(
      {
        id: income.id,
        category_id: categoryId || null,
        amount_cents: cents,
        payment_method: (paymentMethod || null) as PaymentMethod | null,
        cash_register_id: cashRegisterId || null,
        comment: comment.trim() || null,
        income_at: incomeAt,
      },
      {
        onSuccess: () => {
          toast.success(t('income.other.toast_updated'))
          onClose()
        },
        onError: (e) =>
          toast.error(t('common.error_generic'), {
            description: e instanceof Error ? e.message : String(e),
          }),
      },
    )
  }

  async function handleUnlinkBank() {
    if (!income) return
    setUnlinking(true)
    try {
      const { error } = await supabase
        .from('bank_transactions')
        .update({ linked_other_income_id: null })
        .eq('linked_other_income_id', income.id)
      if (error) throw error
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['bank-linked-income-ids', salonId] }),
        qc.invalidateQueries({ queryKey: ['bank-inflows', salonId] }),
        qc.invalidateQueries({ queryKey: ['other-incomes', salonId] }),
      ])
      toast.success(t('banking.unlink_toast'))
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setUnlinking(false)
    }
  }

  function handleDelete() {
    if (!income) return
    if (!window.confirm(t('income.other.confirm_delete'))) return
    remove.mutate(income.id, {
      onSuccess: () => {
        toast.success(t('income.other.toast_deleted'))
        onClose()
      },
      onError: (e) =>
        toast.error(t('common.error_generic'), {
          description: e instanceof Error ? e.message : String(e),
        }),
    })
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('income.other_edit.title')}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-3 px-5 pb-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="oi-edit-category">{t('income.other_form.category')}</Label>
            <Select value={categoryId} onValueChange={setCategoryId}>
              <SelectTrigger id="oi-edit-category">
                <SelectValue placeholder={t('income.other_form.category_placeholder')} />
              </SelectTrigger>
              <SelectContent>
                {categories.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="oi-edit-amount">
              {t('income.other_form.amount')} ({currency})
            </Label>
            <Input
              id="oi-edit-amount"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>{t('income.other_form.payment_method')}</Label>
            <div className="flex flex-wrap gap-1.5">
              {paymentMethods.map((m) => {
                const active = paymentMethod === m.code
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setPaymentMethod(active ? '' : m.code)}
                    className={cn(
                      'border-border h-9 rounded-md border px-3 text-xs font-semibold transition-colors',
                      active
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'bg-card hover:bg-muted/40',
                    )}
                  >
                    {m.label}
                  </button>
                )
              })}
            </div>
          </div>

          {cashRegisters.length > 0 ? (
            <div className="flex flex-col gap-1.5">
              <Label>{t('income.other_form.cash_register')}</Label>
              <div className="flex flex-wrap gap-1.5">
                {cashRegisters.map((r) => {
                  const active = cashRegisterId === r.id
                  return (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => setCashRegisterId(active ? '' : r.id)}
                      className={cn(
                        'border-border h-9 rounded-md border px-3 text-xs font-semibold transition-colors',
                        active
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'bg-card hover:bg-muted/40',
                      )}
                    >
                      {r.label}
                    </button>
                  )
                })}
              </div>
            </div>
          ) : null}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="oi-edit-date">{t('income.other_edit.date')}</Label>
            <Input
              id="oi-edit-date"
              type="date"
              value={incomeAt}
              onChange={(e) => setIncomeAt(e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="oi-edit-comment">{t('income.other_form.comment')}</Label>
            <Input
              id="oi-edit-comment"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder={t('income.other_form.comment_placeholder')}
            />
          </div>

          <div className="border-border bg-muted/30 mt-1 flex items-center justify-between gap-2 rounded-md border px-3 py-2">
            <div className="flex min-w-0 items-center gap-2 text-xs">
              <Landmark
                className={cn(
                  'size-4 shrink-0',
                  isBankLinked ? 'text-brand-teal-deep' : 'text-muted-foreground',
                )}
                strokeWidth={1.8}
              />
              <span
                className={cn(
                  'truncate font-semibold',
                  isBankLinked ? 'text-brand-teal-deep' : 'text-muted-foreground',
                )}
              >
                {isBankLinked ? t('banking.linked_to_bank') : t('banking.not_linked_hint')}
              </span>
            </div>
            {isBankLinked ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleUnlinkBank}
                disabled={unlinking}
                className="shrink-0"
              >
                <Link2Off className="size-3.5" strokeWidth={2} />
                {t('banking.unlink')}
              </Button>
            ) : (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setPickerOpen(true)}
                className="shrink-0"
              >
                <Link2 className="size-3.5" strokeWidth={2} />
                {t('banking.link_to_bank')}
              </Button>
            )}
          </div>
        </div>

        <LinkOtherIncomeToBankDialog
          open={pickerOpen}
          onOpenChange={setPickerOpen}
          salonId={salonId}
          currency={currency}
          otherIncome={{
            id: income.id,
            amount_cents: income.amount_cents,
            income_at: income.income_at,
            title:
              categories.find((c) => c.id === income.category_id)?.name ??
              t('income.other_form.title'),
          }}
        />

        <DialogFooter className="justify-between sm:justify-between">
          <Button
            variant="ghost"
            onClick={handleDelete}
            disabled={remove.isPending || update.isPending}
            className="text-destructive hover:text-destructive"
          >
            {t('common.delete')}
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose} disabled={update.isPending}>
              {t('common.cancel')}
            </Button>
            <Button variant="primary" onClick={handleSave} disabled={update.isPending}>
              {update.isPending ? <Loader2 className="size-4 animate-spin" /> : t('common.save')}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
