import { Link2, Plus, Unlink2 } from 'lucide-react'
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
import { useLinkBankTransaction, type BankInflowRow, type BankOutflowRow } from '@/hooks/useBanking'
import { type ExpenseRow } from '@/hooks/useExpenses'
import { formatCurrency } from '@/lib/utils/format-currency'
import { formatExpenseDate } from '@/lib/utils/format-date'
import { ExpensesPage } from '@/routes/expenses/ExpensesPage'
import { IncomePage } from '@/routes/income/IncomePage'

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
  const link = useLinkBankTransaction(salonId)

  const txCurrency = transaction.currency || 'PLN'

  function handlePick(item: PickerItem) {
    const args: Parameters<typeof link.mutate>[0] = {
      transactionId: transaction.id,
      clearNeedsReview: true,
    }
    if (item.kind === 'expense') args.expenseId = item.id
    else if (item.kind === 'visit') args.visitId = item.id
    else if (item.kind === 'other_income') args.otherIncomeId = item.id
    link.mutate(args, {
      onSuccess: () => {
        toast.success(t('banking.link_dialog.linked_toast'))
        onOpenChange(false)
      },
      onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
    })
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
      date: expense.expense_at,
    })
  }

  // Debit: embedded full ExpensesPage в широкой модалке (см. owner-feedback
  // 2026-05-26 — image #10/#11). Юзер видит вкладки Оплачено/Не оплачено,
  // структуру, фильтры — выбирает расход кликом и связывается с tx.
  if (direction === 'debit') {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
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
            onPickVisit={(v) => {
              handlePick({
                kind: 'visit',
                id: v.id,
                title: v.service_name_snapshot ?? '',
                subtitle: '',
                amount_cents: v.amount_cents - (v.discount_cents ?? 0) + (v.tip_cents ?? 0),
                date: v.visit_at,
              })
            }}
            onPickOtherIncome={(o) => {
              handlePick({
                kind: 'other_income',
                id: o.id,
                title: o.comment ?? 'Прочий доход',
                subtitle: '',
                amount_cents: o.amount_cents,
                date: o.income_at,
              })
            }}
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
