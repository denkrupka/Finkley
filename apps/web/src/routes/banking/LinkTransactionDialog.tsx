import { Link2, Loader2, Search, Unlink2 } from 'lucide-react'
import { useMemo, useState } from 'react'
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
import { useLinkBankTransaction, type BankInflowRow, type BankOutflowRow } from '@/hooks/useBanking'
import { useExpenses, type ExpenseRow } from '@/hooks/useExpenses'
import { useOtherIncomes, type OtherIncomeRow } from '@/hooks/useOtherIncomes'
import { formatCurrency } from '@/lib/utils/format-currency'
import { formatExpenseDate } from '@/lib/utils/format-date'

type Props = {
  open: boolean
  onOpenChange: (v: boolean) => void
  salonId: string
  transaction: BankInflowRow | BankOutflowRow
  direction: 'debit' | 'credit'
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
}: Props) {
  const { t } = useTranslation()
  const [search, setSearch] = useState('')
  const link = useLinkBankTransaction(salonId)

  // Ищем расходы/доходы в широком окне ±90 дней от даты транзакции — чтобы
  // не пропустить случай «расход добавили заранее, а транзакция пришла позже».
  const period = useMemo(() => {
    const d = new Date(transaction.executed_at)
    const start = new Date(d)
    start.setDate(start.getDate() - 90)
    const end = new Date(d)
    end.setDate(end.getDate() + 90)
    return {
      start: start.toISOString().slice(0, 10),
      end: end.toISOString().slice(0, 10),
    }
  }, [transaction.executed_at])

  const expensesQ = useExpenses(direction === 'debit' ? salonId : undefined, period)
  const otherRange = useMemo(
    () => ({ start: new Date(period.start), end: new Date(period.end) }),
    [period],
  )
  const otherQ = useOtherIncomes(direction === 'credit' ? salonId : undefined, otherRange)

  // NOTE: Связь с визитами оставлена на Этап 4 — на VisitsPage есть join с
  // клиентами, тут это лишний код. Для credit достаточно other_incomes;
  // оплату визита банк-переводом маркетологи обычно проводят как other_income.
  const items: PickerItem[] = useMemo(() => {
    if (direction === 'debit') {
      return (expensesQ.data ?? [])
        .filter((e) => filterMatch(search, e.description, e.document_number, e.amount_cents))
        .map((e) => expenseToItem(e))
    }
    return (otherQ.data ?? [])
      .filter((o) => filterMatch(search, o.comment ?? '', null, o.amount_cents))
      .map((o) => otherIncomeToItem(o))
      .sort((a, b) => b.date.localeCompare(a.date))
  }, [direction, expensesQ.data, otherQ.data, search])

  const txCurrency = transaction.currency || 'PLN'

  function handlePick(item: PickerItem) {
    const args: Parameters<typeof link.mutate>[0] = {
      transactionId: transaction.id,
      clearNeedsReview: true,
    }
    if (item.kind === 'expense') args.expenseId = item.id
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Link2 className="text-brand-teal-deep size-4" strokeWidth={2} />
            {direction === 'debit'
              ? t('banking.link_dialog.title_debit')
              : t('banking.link_dialog.title_credit')}
          </DialogTitle>
          <DialogDescription>
            <span className="block">
              {transaction.counterparty || t('banking.transactions.no_counterparty')}
              {' · '}
              <span className={direction === 'debit' ? 'text-destructive' : 'text-emerald-700'}>
                {direction === 'debit' ? '−' : '+'}
                {formatCurrency(transaction.amount_cents, txCurrency)}
              </span>
              {' · '}
              {formatExpenseDate(transaction.executed_at)}
            </span>
            {transaction.description ? (
              <span className="text-muted-foreground/80 mt-1 block truncate text-xs">
                {transaction.description}
              </span>
            ) : null}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3 px-5 pb-2 pt-1">
          <div className="relative">
            <Search
              className="text-muted-foreground pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2"
              strokeWidth={1.7}
            />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={
                direction === 'debit'
                  ? t('banking.link_dialog.search_expense')
                  : t('banking.link_dialog.search_income')
              }
              className="pl-8"
              autoFocus
            />
          </div>

          <div className="border-border h-[320px] overflow-y-auto rounded-md border">
            {expensesQ.isLoading || otherQ.isLoading ? (
              <div className="flex h-full items-center justify-center">
                <Loader2 className="text-muted-foreground size-5 animate-spin" strokeWidth={2} />
              </div>
            ) : items.length === 0 ? (
              <div className="text-muted-foreground flex h-full items-center justify-center px-4 text-center text-sm">
                {t('banking.link_dialog.empty')}
              </div>
            ) : (
              <ul>
                {items.slice(0, 100).map((item) => (
                  <PickerRow
                    key={`${item.kind}:${item.id}`}
                    item={item}
                    txAmount={transaction.amount_cents}
                    currency={txCurrency}
                    onPick={() => handlePick(item)}
                  />
                ))}
              </ul>
            )}
          </div>

          {/* TODO Этап 4: «Создать новый расход из этой транзакции» с
              prefill (amount/date/counterparty) — требует расширения
              ExpenseFormModal. */}
        </div>

        <DialogFooter className="flex items-center justify-between gap-2 sm:justify-between">
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
      kind: 'other_income'
      id: string
      title: string
      subtitle: string
      amount_cents: number
      date: string
    }

function expenseToItem(e: ExpenseRow): PickerItem {
  return {
    kind: 'expense',
    id: e.id,
    title: e.description || e.document_number || '—',
    subtitle: e.document_number ? `№ ${e.document_number}` : '',
    amount_cents: e.amount_cents,
    date: e.expense_at,
  }
}

function otherIncomeToItem(o: OtherIncomeRow): PickerItem {
  return {
    kind: 'other_income',
    id: o.id,
    title: o.comment || 'Прочий доход',
    subtitle: '',
    amount_cents: o.amount_cents,
    date: o.income_at,
  }
}

function filterMatch(
  q: string,
  text: string | null,
  doc: string | null,
  amount: number | null,
): boolean {
  if (!q.trim()) return true
  const needle = q.toLowerCase().trim()
  if ((text ?? '').toLowerCase().includes(needle)) return true
  if ((doc ?? '').toLowerCase().includes(needle)) return true
  if (amount != null) {
    const amountStr = (amount / 100).toFixed(2)
    if (amountStr.includes(needle)) return true
  }
  return false
}

function PickerRow({
  item,
  txAmount,
  currency,
  onPick,
}: {
  item: PickerItem
  txAmount: number
  currency: string
  onPick: () => void
}) {
  const { t } = useTranslation()
  const matchDelta = Math.abs(item.amount_cents - txAmount)
  const exactMatch = matchDelta < 1
  const closeMatch = !exactMatch && matchDelta < 100 // <1 unit difference

  return (
    <li className="border-border border-b last:border-b-0">
      <button
        type="button"
        onClick={onPick}
        className="hover:bg-muted/30 flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left transition-colors"
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="text-foreground truncate text-sm font-semibold">{item.title}</p>
            {exactMatch ? (
              <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-emerald-800">
                {t('banking.link_dialog.exact_match')}
              </span>
            ) : closeMatch ? (
              <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-amber-800">
                {t('banking.link_dialog.close_match')}
              </span>
            ) : null}
          </div>
          <p className="text-muted-foreground mt-0.5 text-xs">
            {formatExpenseDate(item.date)}
            {item.subtitle ? ` · ${item.subtitle}` : ''}
          </p>
        </div>
        <div className="text-foreground num shrink-0 text-sm font-bold tabular-nums">
          {formatCurrency(item.amount_cents, currency)}
        </div>
      </button>
    </li>
  )
}
