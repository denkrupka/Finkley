import { AlertTriangle, Landmark, Loader2, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { useQueryClient } from '@tanstack/react-query'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import type { ExpenseRow } from '@/hooks/useExpenses'
import {
  expenseInstallmentsKey,
  useExpensePaymentInstallments,
} from '@/hooks/useExpensePaymentInstallments'
import { supabase } from '@/lib/supabase/client'
import { formatCurrency } from '@/lib/utils/format-currency'
import { formatExpenseDate } from '@/lib/utils/format-date'

type Props = {
  open: boolean
  onOpenChange: (v: boolean) => void
  salonId: string
  expense: ExpenseRow
  /** Сумма транзакции — что юзер пытается привязать. */
  txAmount: number
  txCurrency: string
  txId: string
  txExecutedAt: string
  /** После успеха модалка закрывает и сообщает родителю что link сделан. */
  onLinked: (mode: 'partial' | 'full') => void
}

/**
 * Модалка для частично-оплаченного расхода (image #47/#48).
 *
 * Показывает:
 *  - историю installments (дата · сумма · банк)
 *  - оплачено / осталось
 *  - блок текущей транзакции и кнопки:
 *    - tx == remaining → «Привязать (полностью оплачено)»
 *    - tx < remaining → «Оплатить частично» / «Изменить сумму расхода» / «Отмена»
 *    - tx > remaining → «Изменить сумму расхода (увеличить)» / «Отмена»
 *
 * При «частичной» создаём новый installment + linking tx с expense.
 * При «полностью» — создаём installment на сумму tx (trigger выставит paid=NULL).
 * При «изменить сумму» — UPDATE expenses.amount_cents и создаём installment на остаток.
 */
export function PartiallyPaidExpenseDialog({
  open,
  onOpenChange,
  salonId,
  expense,
  txAmount,
  txCurrency,
  txId,
  txExecutedAt,
  onLinked,
}: Props) {
  const { t } = useTranslation()
  const qcInstallments = useQueryClient()
  const { data: installments = [] } = useExpensePaymentInstallments(expense.id)
  const [busy, setBusy] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  async function deleteInstallment(id: string, bankTxId: string | null) {
    if (
      !window.confirm(
        t('banking.partial_paid.confirm_delete', {
          defaultValue:
            'Удалить эту оплату? Если она была привязана к банковской транзакции, связь тоже будет снята.',
        }),
      )
    ) {
      return
    }
    setDeletingId(id)
    try {
      // 1) Удалить installment — trigger пересчитает paid_amount_cents
      const { error: delErr } = await supabase
        .from('expense_payment_installments')
        .delete()
        .eq('id', id)
      if (delErr) throw new Error(delErr.message)
      // 2) Если installment был привязан к bank_tx — снять связь tx → expense.
      // Делаем только если эта tx больше не упоминается в других installments
      // этого расхода (т.е. это была единственная installment с этого банка).
      if (bankTxId) {
        const remaining = installments.filter(
          (i) => i.id !== id && i.bank_transaction_id === bankTxId,
        )
        if (remaining.length === 0) {
          await supabase
            .from('bank_transactions')
            .update({ expense_id: null })
            .eq('id', bankTxId)
            .eq('expense_id', expense.id)
        }
      }
      toast.success(
        t('banking.partial_paid.deleted_toast', {
          defaultValue: 'Оплата удалена',
        }),
      )
      await qcInstallments.invalidateQueries({ queryKey: expenseInstallmentsKey(expense.id) })
      await qcInstallments.invalidateQueries({ queryKey: ['expenses', salonId] })
      await qcInstallments.invalidateQueries({ queryKey: ['bank-inflows', salonId] })
      await qcInstallments.invalidateQueries({ queryKey: ['bank-outflows', salonId] })
      await qcInstallments.invalidateQueries({ queryKey: ['bank-linked-income-ids', salonId] })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setDeletingId(null)
    }
  }

  const alreadyPaid = expense.paid_amount_cents ?? 0
  const remaining = Math.max(0, expense.amount_cents - alreadyPaid)
  const txEqualsRemaining = txAmount === remaining
  const txLessThanRemaining = txAmount < remaining

  async function createInstallmentAndLink(mode: 'partial' | 'full') {
    setBusy(mode)
    try {
      // 1) installment на сумму tx
      const { error: insErr } = await supabase.from('expense_payment_installments').insert({
        expense_id: expense.id,
        paid_at: txExecutedAt,
        amount_cents: txAmount,
        bank_transaction_id: txId,
        payment_method: 'transfer',
      })
      if (insErr) throw new Error(insErr.message)

      // 2) Linking bank-tx с expense через legacy FK (одна tx → один expense).
      //    Trigger в БД сам пересчитает paid_amount_cents.
      const { error: linkErr } = await supabase
        .from('bank_transactions')
        .update({
          expense_id: expense.id,
          linked_visit_id: null,
          linked_other_income_id: null,
          needs_review: false,
        })
        .eq('id', txId)
      if (linkErr) throw new Error(linkErr.message)

      toast.success(
        mode === 'full'
          ? t('banking.partial_paid.toast_full', { defaultValue: 'Расход полностью оплачен' })
          : t('banking.partial_paid.toast_partial', {
              defaultValue: 'Привязано как частичная оплата',
            }),
      )
      onLinked(mode)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  async function adjustExpenseAmountAndLink() {
    setBusy('adjust')
    try {
      // Новая сумма расхода = alreadyPaid + txAmount → ровно покрывается.
      const newAmount = alreadyPaid + txAmount
      const { error: upErr } = await supabase
        .from('expenses')
        .update({ amount_cents: newAmount })
        .eq('id', expense.id)
      if (upErr) throw new Error(upErr.message)
      // Дальше — как «full»: installment + link.
      await createInstallmentAndLink('full')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  async function increaseExpenseAmountAndLink() {
    // tx > remaining → увеличиваем расход до alreadyPaid + txAmount.
    await adjustExpenseAmountAndLink()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] max-w-2xl flex-col p-0">
        <div className="border-border shrink-0 border-b px-5 py-3">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="size-4 text-amber-600" strokeWidth={2} />
              {t('banking.partial_paid.title', {
                defaultValue: 'Привязка к частично оплаченному расходу',
              })}
            </DialogTitle>
            <DialogDescription className="text-xs">
              {expense.description ?? '—'} · {formatExpenseDate(expense.expense_at)}
            </DialogDescription>
          </DialogHeader>
        </div>

        <div className="flex flex-1 flex-col gap-3 overflow-y-auto px-5 py-3">
          {/* Сводка по расходу */}
          <div className="bg-muted/30 grid grid-cols-3 gap-3 rounded-md p-3 text-sm">
            <div>
              <p className="text-muted-foreground text-[10.5px] uppercase tracking-wider">
                {t('banking.partial_paid.total', { defaultValue: 'Всего' })}
              </p>
              <p className="num text-foreground font-bold">
                {formatCurrency(expense.amount_cents, txCurrency)}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground text-[10.5px] uppercase tracking-wider">
                {t('banking.partial_paid.paid', { defaultValue: 'Оплачено' })}
              </p>
              <p className="num font-bold text-emerald-700">
                {formatCurrency(alreadyPaid, txCurrency)}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground text-[10.5px] uppercase tracking-wider">
                {t('banking.partial_paid.remaining', { defaultValue: 'Осталось' })}
              </p>
              <p className="num font-bold text-amber-700">
                {formatCurrency(remaining, txCurrency)}
              </p>
            </div>
          </div>

          {/* История installments */}
          {installments.length > 0 ? (
            <div className="border-border rounded-md border">
              <div className="bg-muted/40 border-border border-b px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-amber-900">
                {t('banking.partial_paid.history', { defaultValue: 'История оплат' })}
              </div>
              <ul>
                {installments.map((it) => (
                  <li
                    key={it.id}
                    className="border-border/60 grid grid-cols-[80px_1fr_auto_28px] items-center gap-3 border-t px-3 py-2 text-sm first:border-t-0"
                  >
                    <span className="num text-muted-foreground text-xs">
                      {formatExpenseDate(it.paid_at)}
                    </span>
                    <span className="text-foreground flex items-center gap-1.5 text-xs">
                      {it.bank_transaction_id ? (
                        <>
                          <Landmark className="text-brand-teal-deep size-3" strokeWidth={2} />
                          {t('banking.partial_paid.via_bank', { defaultValue: 'Банк' })}
                        </>
                      ) : (
                        (it.payment_method ?? '—')
                      )}
                      {it.comment ? (
                        <span className="text-muted-foreground/70">· {it.comment}</span>
                      ) : null}
                    </span>
                    <span className="num text-foreground text-right text-xs font-bold">
                      {formatCurrency(it.amount_cents, txCurrency)}
                    </span>
                    <button
                      type="button"
                      onClick={() => deleteInstallment(it.id, it.bank_transaction_id)}
                      disabled={!!deletingId || !!busy}
                      className="text-muted-foreground hover:text-destructive grid size-7 place-items-center rounded-md disabled:opacity-30"
                      aria-label={t('banking.partial_paid.delete_aria', {
                        defaultValue: 'Удалить оплату',
                      })}
                    >
                      {deletingId === it.id ? (
                        <Loader2 className="size-3 animate-spin" strokeWidth={2} />
                      ) : (
                        <Trash2 className="size-3.5" strokeWidth={1.7} />
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {/* Блок текущей транзакции */}
          <div className="border-brand-teal/40 bg-brand-teal-soft/20 rounded-md border p-3">
            <p className="text-muted-foreground text-[10.5px] uppercase tracking-wider">
              {t('banking.partial_paid.current_tx', { defaultValue: 'Эта транзакция' })}
            </p>
            <p className="num text-brand-teal-deep mt-0.5 text-base font-bold">
              {formatCurrency(txAmount, txCurrency)} · {formatExpenseDate(txExecutedAt)}
            </p>
            {txLessThanRemaining ? (
              <p className="text-muted-foreground mt-1 text-xs">
                {t('banking.partial_paid.hint_less', {
                  defaultValue:
                    'Транзакция меньше остатка к доплате — её можно записать как частичную оплату или изменить расход с учётом разницы.',
                })}
              </p>
            ) : !txEqualsRemaining ? (
              <p className="text-muted-foreground mt-1 text-xs">
                {t('banking.partial_paid.hint_more', {
                  defaultValue:
                    'Транзакция больше остатка к доплате — можно увеличить сумму расхода чтобы покрыть её полностью.',
                })}
              </p>
            ) : null}
          </div>
        </div>

        <DialogFooter className="border-border shrink-0 flex-col gap-2 border-t px-5 py-3 sm:flex-col sm:items-stretch">
          {txEqualsRemaining ? (
            <Button
              variant="primary"
              onClick={() => createInstallmentAndLink('full')}
              disabled={!!busy}
              className="h-auto w-full justify-start whitespace-normal py-2.5 text-left leading-snug"
            >
              {busy === 'full' ? (
                <Loader2 className="size-4 shrink-0 animate-spin" strokeWidth={2} />
              ) : null}
              <span className="block">
                {t('banking.partial_paid.action_link_full', {
                  defaultValue: 'Привязать (полностью оплачено)',
                })}
              </span>
            </Button>
          ) : txLessThanRemaining ? (
            <>
              <Button
                variant="primary"
                onClick={() => createInstallmentAndLink('partial')}
                disabled={!!busy}
                className="h-auto w-full justify-start whitespace-normal py-2.5 text-left leading-snug"
              >
                {busy === 'partial' ? (
                  <Loader2 className="size-4 shrink-0 animate-spin" strokeWidth={2} />
                ) : null}
                <span className="block">
                  {t('banking.partial_paid.action_partial', {
                    defaultValue: 'Оплатить частично (остаток в «Не оплачено»)',
                  })}
                </span>
              </Button>
              <Button
                variant="outline"
                onClick={adjustExpenseAmountAndLink}
                disabled={!!busy}
                className="h-auto w-full justify-start whitespace-normal py-2.5 text-left leading-snug"
              >
                {busy === 'adjust' ? (
                  <Loader2 className="size-4 shrink-0 animate-spin" strokeWidth={2} />
                ) : null}
                <span className="block">
                  {t('banking.partial_paid.action_adjust_down', {
                    defaultValue: 'Изменить расход (новая сумма = {{new}}) — закрыть полностью',
                    new: formatCurrency(alreadyPaid + txAmount, txCurrency),
                  })}
                </span>
              </Button>
            </>
          ) : (
            <Button
              variant="outline"
              onClick={increaseExpenseAmountAndLink}
              disabled={!!busy}
              className="h-auto w-full justify-start whitespace-normal py-2.5 text-left leading-snug"
            >
              {busy === 'adjust' ? (
                <Loader2 className="size-4 shrink-0 animate-spin" strokeWidth={2} />
              ) : null}
              <span className="block">
                {t('banking.partial_paid.action_adjust_up', {
                  defaultValue: 'Увеличить расход до {{new}} — транзакция закроет его полностью',
                  new: formatCurrency(alreadyPaid + txAmount, txCurrency),
                })}
              </span>
            </Button>
          )}
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={!!busy}
            className="h-auto w-full justify-start whitespace-normal py-2 text-left"
          >
            {t('common.cancel')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
