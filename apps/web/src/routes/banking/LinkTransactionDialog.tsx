import { Link2, Plus, Unlink2 } from 'lucide-react'
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
import { useLinkBankTransaction, type BankInflowRow, type BankOutflowRow } from '@/hooks/useBanking'
import { type ExpenseRow } from '@/hooks/useExpenses'
import { type OtherIncomeRow } from '@/hooks/useOtherIncomes'
import { type VisitRow } from '@/hooks/useVisits'
import { supabase } from '@/lib/supabase/client'
import { formatCurrency } from '@/lib/utils/format-currency'
import { formatExpenseDate } from '@/lib/utils/format-date'
import { ExpensesPage } from '@/routes/expenses/ExpensesPage'
import { IncomePage } from '@/routes/income/IncomePage'

import { AmountMismatchDialog, type MismatchAction } from './AmountMismatchDialog'

type Props = {
  open: boolean
  onOpenChange: (v: boolean) => void
  salonId: string
  transaction: BankInflowRow | BankOutflowRow
  direction: 'debit' | 'credit'
  /** Callback для кнопки «Создать новый расход» — родитель открывает
   *  ExpenseFormModal с prefill из этой транзакции. Только для debit. */
  onCreateExpenseFromTx?: () => void
}

/**
 * Модалка привязки банковской транзакции к доменной сущности:
 *  - debit: к расходу из списка expenses
 *  - credit: к visit (услуга/продажа) ИЛИ к other_income
 *
 * Дополнительно: «Создать новый расход» — открывает ExpenseFormModal
 * с префиллом из транзакции. После создания auto-link выполняется.
 */
export function LinkTransactionDialog({
  open,
  onOpenChange,
  salonId,
  transaction,
  direction,
  onCreateExpenseFromTx,
}: Props) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const link = useLinkBankTransaction(salonId)
  // Mismatch state — храним выбранную сущность для модалки подтверждения,
  // если сумма tx не совпадает с (остаток к доплате) сущности.
  const [mismatchCtx, setMismatchCtx] = useState<{
    item: PickerItem
    entityAmount: number
    alreadyPaid: number
  } | null>(null)
  const [mismatchBusy, setMismatchBusy] = useState(false)

  const txCurrency = transaction.currency || 'PLN'

  function doLink(item: PickerItem, opts: { partial?: boolean } = {}) {
    const args: Parameters<typeof link.mutate>[0] = {
      transactionId: transaction.id,
      clearNeedsReview: true,
    }
    if (item.kind === 'expense') args.expenseId = item.id
    else if (item.kind === 'visit') args.visitId = item.id
    else if (item.kind === 'other_income') args.otherIncomeId = item.id
    link.mutate(args, {
      onSuccess: () => {
        toast.success(
          opts.partial
            ? t('banking.mismatch.toast_partial', {
                defaultValue: 'Привязано как частичная оплата',
              })
            : t('banking.link_dialog.linked_toast'),
        )
        onOpenChange(false)
      },
      onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
    })
  }

  async function applyMismatch(action: MismatchAction) {
    if (!mismatchCtx) return
    if (action === 'cancel') {
      setMismatchCtx(null)
      return
    }
    setMismatchBusy(true)
    try {
      const { item, alreadyPaid } = mismatchCtx
      const txAmt = transaction.amount_cents

      if (action === 'partial') {
        // Только для expense — paid_amount_cents хранится только на expenses.
        // Для visit/other_income частичная оплата как концепт не моделируется
        // (см. ADR-024 — partial paid live only on expense). Линкуем как есть.
        if (item.kind === 'expense') {
          // Создаём installment-запись (триггер сам пересчитает
          // expenses.paid_amount_cents через recalc_expense_paid_amount).
          const { error } = await supabase.from('expense_payment_installments').insert({
            expense_id: item.id,
            paid_at: transaction.executed_at,
            amount_cents: txAmt,
            bank_transaction_id: transaction.id,
            payment_method: 'transfer',
            comment: transaction.description ?? null,
          })
          if (error) throw new Error(error.message)
        }
      } else if (action === 'adjust_amount') {
        // Меняем сумму сущности так чтобы tx закрывал её полностью.
        // Для expense: amount = (alreadyPaid + txAmt), paid_amount_cents = null
        // (полностью оплачено).
        if (item.kind === 'expense') {
          const newAmount = alreadyPaid + txAmt
          const { error } = await supabase
            .from('expenses')
            .update({ amount_cents: newAmount, paid_amount_cents: null })
            .eq('id', item.id)
          if (error) throw new Error(error.message)
        } else if (item.kind === 'visit') {
          // На visits нет paid_amount_cents — просто меняем amount_cents.
          const { error } = await supabase
            .from('visits')
            .update({ amount_cents: txAmt })
            .eq('id', item.id)
          if (error) throw new Error(error.message)
        } else {
          const { error } = await supabase
            .from('other_incomes')
            .update({ amount_cents: txAmt })
            .eq('id', item.id)
          if (error) throw new Error(error.message)
        }
      }

      await qc.invalidateQueries({ queryKey: ['expenses', salonId] })
      await qc.invalidateQueries({ queryKey: ['visits', salonId] })
      await qc.invalidateQueries({ queryKey: ['other-incomes', salonId] })

      // Делаем link после изменения сущности.
      doLink(item, { partial: action === 'partial' })
      setMismatchCtx(null)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setMismatchBusy(false)
    }
  }

  function handlePick(item: PickerItem) {
    // Проверяем mismatch с remaining (для expense — amount - paid_amount_cents).
    const entityAmount = item.amount_cents
    const alreadyPaid =
      item.kind === 'expense' && item.paid_amount_cents != null ? item.paid_amount_cents : 0
    const remaining = Math.max(0, entityAmount - alreadyPaid)
    if (transaction.amount_cents !== remaining) {
      setMismatchCtx({ item, entityAmount, alreadyPaid })
      return
    }
    doLink(item)
  }

  function handleUnlink() {
    link.mutate(
      {
        transactionId: transaction.id,
        expenseId: null,
        visitId: null,
        otherIncomeId: null,
      },
      {
        onSuccess: () => {
          toast.success(t('banking.link_dialog.unlinked_toast'))
          onOpenChange(false)
        },
        onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
      },
    )
  }

  const hasExistingLink =
    direction === 'debit'
      ? !!transaction.expense_id
      : !!(transaction.linked_visit_id || transaction.linked_other_income_id)

  function handlePickExpense(expense: ExpenseRow) {
    handlePick({
      kind: 'expense',
      id: expense.id,
      title: expense.description || '',
      subtitle: '',
      amount_cents: expense.amount_cents,
      paid_amount_cents: expense.paid_amount_cents,
      date: expense.expense_at,
    })
  }
  function handlePickVisit(v: VisitRow) {
    handlePick({
      kind: 'visit',
      id: v.id,
      title: v.service_name_snapshot ?? '',
      subtitle: '',
      amount_cents: v.amount_cents - (v.discount_cents ?? 0) + (v.tip_cents ?? 0),
      date: v.visit_at,
    })
  }
  function handlePickOtherIncome(o: OtherIncomeRow) {
    handlePick({
      kind: 'other_income',
      id: o.id,
      title: o.comment ?? 'Прочий доход',
      subtitle: '',
      amount_cents: o.amount_cents,
      date: o.income_at,
    })
  }

  const mismatchDialog = mismatchCtx ? (
    <AmountMismatchDialog
      open={!!mismatchCtx}
      onOpenChange={(v) => !v && setMismatchCtx(null)}
      txAmount={transaction.amount_cents}
      entityAmount={mismatchCtx.entityAmount}
      alreadyPaid={mismatchCtx.alreadyPaid}
      currency={txCurrency}
      entityKind={mismatchCtx.item.kind}
      busy={mismatchBusy}
      onChoose={applyMismatch}
    />
  ) : null

  // Debit: embedded full ExpensesPage в широкой модалке (см. owner-feedback
  // 2026-05-26 — image #10/#11). Юзер видит вкладки Оплачено/Не оплачено,
  // структуру, фильтры — выбирает расход кликом и связывается с tx.
  if (direction === 'debit') {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        {mismatchDialog}
        <DialogContent className="!max-h-[92vh] !w-[min(96vw,1100px)] !max-w-[1100px] gap-0 overflow-hidden p-0">
          <DialogHeader>
            <div className="border-border border-b px-5 py-3">
              <DialogTitle className="flex items-center gap-2 text-base">
                <Link2 className="text-brand-teal-deep size-4" strokeWidth={2} />
                {t('banking.link_dialog.title_debit')}
              </DialogTitle>
              <DialogDescription className="text-xs">
                <span className="block">
                  {transaction.counterparty || t('banking.transactions.no_counterparty')}
                  {' · '}
                  <span className="text-destructive">
                    −{formatCurrency(transaction.amount_cents, txCurrency)}
                  </span>
                  {' · '}
                  {formatExpenseDate(transaction.executed_at)}
                </span>
                {transaction.description ? (
                  <span className="text-muted-foreground/80 mt-0.5 block truncate text-[11px]">
                    {transaction.description}
                  </span>
                ) : null}
              </DialogDescription>
            </div>
          </DialogHeader>

          <div className="overflow-y-auto px-5 py-3">
            <ExpensesPage
              embedded
              pickerSalonId={salonId}
              hideBankingTab
              highlightExpenseId={transaction.expense_id ?? null}
              onPickExpense={handlePickExpense}
            />
          </div>

          <DialogFooter className="border-border flex items-center justify-between gap-2 border-t px-5 py-3 sm:justify-between">
            {hasExistingLink ? (
              <Button
                variant="outline"
                size="sm"
                onClick={handleUnlink}
                disabled={link.isPending}
                className="text-destructive border-destructive/40"
              >
                <Unlink2 className="size-3.5" strokeWidth={2} />
                {t('banking.link_dialog.unlink')}
              </Button>
            ) : (
              <span />
            )}
            <div className="flex items-center gap-2">
              {onCreateExpenseFromTx ? (
                <Button variant="secondary" size="sm" onClick={onCreateExpenseFromTx}>
                  <Plus className="size-3.5" strokeWidth={2.4} />
                  {t('banking.link_dialog.create_new_expense', {
                    defaultValue: 'Создать новый расход с этими данными',
                  })}
                </Button>
              ) : null}
              <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
                {t('common.cancel')}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    )
  }

  // Credit: embedded full IncomePage в широкой модалке (см. owner-feedback
  // 2026-05-26 image #11) — таб «Банкинг» скрыт, juzер выбирает визит или
  // прочий доход кликом, и tx линкуется с этой сущностью.
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {mismatchDialog}
      <DialogContent className="!max-h-[92vh] !w-[min(96vw,1100px)] !max-w-[1100px] gap-0 overflow-hidden p-0">
        <DialogHeader>
          <div className="border-border border-b px-5 py-3">
            <DialogTitle className="flex items-center gap-2 text-base">
              <Link2 className="text-brand-teal-deep size-4" strokeWidth={2} />
              {t('banking.link_dialog.title_credit')}
            </DialogTitle>
            <DialogDescription className="text-xs">
              <span className="block">
                {transaction.counterparty || t('banking.transactions.no_counterparty')}
                {' · '}
                <span className="text-emerald-700">
                  +{formatCurrency(transaction.amount_cents, txCurrency)}
                </span>
                {' · '}
                {formatExpenseDate(transaction.executed_at)}
              </span>
              {transaction.description ? (
                <span className="text-muted-foreground/80 mt-0.5 block truncate text-[11px]">
                  {transaction.description}
                </span>
              ) : null}
            </DialogDescription>
          </div>
        </DialogHeader>

        <div className="overflow-y-auto px-5 py-3">
          <IncomePage
            embedded
            pickerSalonId={salonId}
            hideBankingTab
            onPickVisit={handlePickVisit}
            onPickOtherIncome={handlePickOtherIncome}
            highlightVisitId={transaction.linked_visit_id ?? null}
            highlightOtherIncomeId={transaction.linked_other_income_id ?? null}
          />
        </div>

        <DialogFooter className="border-border flex items-center justify-between gap-2 border-t px-5 py-3 sm:justify-between">
          {hasExistingLink ? (
            <Button
              variant="outline"
              size="sm"
              onClick={handleUnlink}
              disabled={link.isPending}
              className="text-destructive border-destructive/40"
            >
              <Unlink2 className="size-3.5" strokeWidth={2} />
              {t('banking.link_dialog.unlink')}
            </Button>
          ) : (
            <span />
          )}
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

type PickerItem =
  | {
      kind: 'expense'
      id: string
      title: string
      subtitle: string
      amount_cents: number
      /** Уже оплаченная часть (NULL = full paid). Нужно для mismatch-логики
       *  — сравниваем tx с remaining = amount - paid, а не с total. */
      paid_amount_cents: number | null
      date: string
    }
  | {
      kind: 'visit'
      id: string
      title: string
      subtitle: string
      amount_cents: number
      date: string
    }
  | {
      kind: 'other_income'
      id: string
      title: string
      subtitle: string
      amount_cents: number
      date: string
    }
