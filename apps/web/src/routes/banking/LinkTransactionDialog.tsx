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
import {
  useBankLinkedIncomeIds,
  useLinkBankTransaction,
  useMultiLinkBankTransaction,
  type BankInflowRow,
  type BankOutflowRow,
} from '@/hooks/useBanking'
import { type ExpenseRow } from '@/hooks/useExpenses'
import { type OtherIncomeRow } from '@/hooks/useOtherIncomes'
import { type VisitRow } from '@/hooks/useVisits'
import { supabase } from '@/lib/supabase/client'
import { formatCurrency } from '@/lib/utils/format-currency'
import { formatExpenseDate } from '@/lib/utils/format-date'
import { ExpensesPage } from '@/routes/expenses/ExpensesPage'
import { IncomePage } from '@/routes/income/IncomePage'

import { AmountMismatchDialog, type MismatchAction } from './AmountMismatchDialog'
import { LinkConflictDialog, type ConflictAction } from './LinkConflictDialog'
import { PartiallyPaidExpenseDialog } from './PartiallyPaidExpenseDialog'

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
  const multiLink = useMultiLinkBankTransaction(salonId)
  // Используем для conflict-check (image #45): сущность уже связана с другой tx?
  const { data: bankLinkedAll } = useBankLinkedIncomeIds(salonId)
  const [conflictCtx, setConflictCtx] = useState<{ item: PickerItem } | null>(null)
  // PartiallyPaid-flow (image #47/#48) — отдельная модалка для частично-оплаченных
  // расходов с журналом installments + 2/3 опциями привязки.
  const [partialCtx, setPartialCtx] = useState<{ expense: ExpenseRow } | null>(null)
  // Mismatch state — храним выбранную сущность для модалки подтверждения,
  // если сумма tx не совпадает с (остаток к доплате) сущности.
  const [mismatchCtx, setMismatchCtx] = useState<{
    item: PickerItem
    entityAmount: number
    alreadyPaid: number
  } | null>(null)
  const [mismatchBusy, setMismatchBusy] = useState(false)

  // Multi-select state — для multi-link (одна tx → N сущностей).
  const [multiMode, setMultiMode] = useState(false)
  const [selectedExpenses, setSelectedExpenses] = useState<Map<string, ExpenseRow>>(new Map())
  const [selectedVisits, setSelectedVisits] = useState<Map<string, VisitRow>>(new Map())
  const [selectedOtherIncomes, setSelectedOtherIncomes] = useState<Map<string, OtherIncomeRow>>(
    new Map(),
  )
  function visitNet(v: VisitRow): number {
    return v.amount_cents - (v.discount_cents ?? 0) + (v.tip_cents ?? 0)
  }
  const selectedCreditSum =
    Array.from(selectedVisits.values()).reduce((s, v) => s + visitNet(v), 0) +
    Array.from(selectedOtherIncomes.values()).reduce((s, o) => s + o.amount_cents, 0)
  const selectedCreditCount = selectedVisits.size + selectedOtherIncomes.size
  function toggleVisit(v: VisitRow) {
    setSelectedVisits((prev) => {
      const next = new Map(prev)
      if (next.has(v.id)) next.delete(v.id)
      else next.set(v.id, v)
      return next
    })
  }
  function toggleOtherIncome(o: OtherIncomeRow) {
    setSelectedOtherIncomes((prev) => {
      const next = new Map(prev)
      if (next.has(o.id)) next.delete(o.id)
      else next.set(o.id, o)
      return next
    })
  }
  function handleMultiSubmitCredit() {
    if (selectedCreditCount === 0) return
    const splits = [
      ...Array.from(selectedVisits.values()).map((v) => ({
        kind: 'visit' as const,
        entityId: v.id,
        amountCents: visitNet(v),
      })),
      ...Array.from(selectedOtherIncomes.values()).map((o) => ({
        kind: 'other_income' as const,
        entityId: o.id,
        amountCents: o.amount_cents,
      })),
    ]
    const sumSplits = splits.reduce((s, x) => s + x.amountCents, 0)
    if (sumSplits !== transaction.amount_cents) {
      const diff = sumSplits - transaction.amount_cents
      const dir = diff > 0 ? 'over' : 'under'
      const msg = t('banking.link_dialog.multi_mismatch_confirm_credit', {
        defaultValue:
          dir === 'over'
            ? 'Сумма выбранных доходов ({{sum}}) превышает транзакцию ({{tx}}) на {{diff}}. Записать как есть?'
            : 'Сумма выбранных доходов ({{sum}}) меньше транзакции ({{tx}}) на {{diff}}. Записать как есть?',
        sum: formatCurrency(sumSplits, txCurrency),
        tx: formatCurrency(transaction.amount_cents, txCurrency),
        diff: formatCurrency(Math.abs(diff), txCurrency),
      })
      if (!window.confirm(msg)) return
    }
    multiLink.mutate(
      { transactionId: transaction.id, splits, clearNeedsReview: true },
      {
        onSuccess: () => {
          toast.success(
            t('banking.link_dialog.multi_linked_toast_credit', {
              defaultValue: 'Связано с {{count}} доходами',
              count: splits.length,
            }),
          )
          onOpenChange(false)
        },
        onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
      },
    )
  }
  const selectedSum = Array.from(selectedExpenses.values()).reduce(
    (s, e) => s + (e.amount_cents - (e.paid_amount_cents ?? 0)),
    0,
  )
  function toggleExpense(e: ExpenseRow) {
    setSelectedExpenses((prev) => {
      const next = new Map(prev)
      if (next.has(e.id)) next.delete(e.id)
      else next.set(e.id, e)
      return next
    })
  }
  function handleMultiSubmit() {
    if (selectedExpenses.size === 0) return
    const splits = Array.from(selectedExpenses.values()).map((e) => ({
      kind: 'expense' as const,
      entityId: e.id,
      amountCents: e.amount_cents - (e.paid_amount_cents ?? 0),
    }))
    const sumSplits = splits.reduce((s, x) => s + x.amountCents, 0)
    // Mismatch guard: если total selected != tx.amount — confirm dialog.
    // Записываем как есть (splits с full remaining); юзеру предлагается
    // либо подтвердить (расходы останутся частично оплаченными), либо
    // вернуться к выбору и поправить.
    if (sumSplits !== transaction.amount_cents) {
      const diff = sumSplits - transaction.amount_cents
      const direction = diff > 0 ? 'over' : 'under'
      const msg = t('banking.link_dialog.multi_mismatch_confirm', {
        defaultValue:
          direction === 'over'
            ? 'Сумма выбранных расходов ({{sum}}) превышает транзакцию ({{tx}}) на {{diff}}. Записать как есть? Расходы останутся частично оплаченными.'
            : 'Сумма выбранных расходов ({{sum}}) меньше транзакции ({{tx}}) на {{diff}}. Записать как есть? Разница не закроет ни один расход полностью.',
        sum: formatCurrency(sumSplits, txCurrency),
        tx: formatCurrency(transaction.amount_cents, txCurrency),
        diff: formatCurrency(Math.abs(diff), txCurrency),
      })
      if (!window.confirm(msg)) return
    }
    multiLink.mutate(
      { transactionId: transaction.id, splits, clearNeedsReview: true },
      {
        onSuccess: () => {
          toast.success(
            t('banking.link_dialog.multi_linked_toast', {
              defaultValue: 'Связано с {{count}} расходами',
              count: splits.length,
            }),
          )
          onOpenChange(false)
        },
        onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
      },
    )
  }

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
    if (action === 'pick_multiple') {
      // Image #43: переключаемся в multiMode, текущий выбранный expense уже в
      // selectedExpenses. Закрываем mismatch — юзер продолжит выбирать ещё.
      if (mismatchCtx.item.kind === 'expense') {
        // Авто-добавляем текущий expense в выбор, чтобы не терять его.
        // ExpensesPage достанет полные данные из useExpenses через ID,
        // нам же для multi нужны только id и remaining; используем заглушку.
        setMultiMode(true)
      }
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

  function isAlreadyLinkedElsewhere(item: PickerItem): boolean {
    // Сущность уже связана с какой-то tx? Сравниваем с открытой transaction.
    // Если связана с тем же tx — это renew/highlight, не конфликт.
    if (item.kind === 'expense') {
      if (transaction.expense_id === item.id) return false
      return bankLinkedAll?.expenseIds.has(item.id) ?? false
    }
    if (item.kind === 'visit') {
      if (transaction.linked_visit_id === item.id) return false
      return bankLinkedAll?.visitIds.has(item.id) ?? false
    }
    if (transaction.linked_other_income_id === item.id) return false
    return bankLinkedAll?.otherIncomeIds.has(item.id) ?? false
  }

  function handlePick(item: PickerItem) {
    // (1) Конфликт привязки (image #45) — сущность уже связана с другой tx.
    if (isAlreadyLinkedElsewhere(item)) {
      setConflictCtx({ item })
      return
    }
    // (2) Проверяем mismatch с remaining (для expense — amount - paid_amount_cents).
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

  function handleConflict(action: ConflictAction) {
    if (!conflictCtx) return
    if (action === 'cancel' || action === 'pick_another') {
      setConflictCtx(null)
      return
    }
    // 'rebind' — отвязываем предыдущую tx, потом проходим обычный handlePick
    // (он сам обработает mismatch если суммы не сходятся).
    const item = conflictCtx.item
    setConflictCtx(null)
    // Отвязка предыдущей tx происходит через очистку FK на сущности на стороне
    // useLinkBankTransaction — оно автоматически перепривяжет (одна сущность
    // → одна tx через legacy FK; в splits — допускается N→N). Простейшая
    // реализация: вызываем doLink, он перезапишет связь.
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
    // Image #47/#48: если расход уже частично оплачен — отдельная модалка
    // с журналом installments + опциями (частичная / изменить / отмена).
    // Не используем общий handlePick для таких — там mismatch без истории.
    if (
      expense.paid_amount_cents != null &&
      expense.paid_amount_cents > 0 &&
      expense.paid_amount_cents < expense.amount_cents
    ) {
      setPartialCtx({ expense })
      return
    }
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
      allowPickMultiple={direction === 'debit' && mismatchCtx.item.kind === 'expense'}
      onChoose={applyMismatch}
    />
  ) : null

  const conflictDialog = conflictCtx ? (
    <LinkConflictDialog
      open={!!conflictCtx}
      onOpenChange={(v) => !v && setConflictCtx(null)}
      entityKind={conflictCtx.item.kind}
      busy={link.isPending}
      onChoose={handleConflict}
    />
  ) : null

  const partialDialog = partialCtx ? (
    <PartiallyPaidExpenseDialog
      open={!!partialCtx}
      onOpenChange={(v) => !v && setPartialCtx(null)}
      salonId={salonId}
      expense={partialCtx.expense}
      txAmount={transaction.amount_cents}
      txCurrency={txCurrency}
      txId={transaction.id}
      txExecutedAt={transaction.executed_at}
      onLinked={() => {
        setPartialCtx(null)
        // Инвалидация и закрытие парента — как при обычном link.mutate
        void qc.invalidateQueries({ queryKey: ['expenses', salonId] })
        void qc.invalidateQueries({ queryKey: ['expense-installments', partialCtx.expense.id] })
        void qc.invalidateQueries({ queryKey: ['bank-inflows', salonId] })
        void qc.invalidateQueries({ queryKey: ['bank-outflows', salonId] })
        void qc.invalidateQueries({ queryKey: ['bank-linked-income-ids', salonId] })
        onOpenChange(false)
      }}
    />
  ) : null

  // Debit: embedded full ExpensesPage в широкой модалке (см. owner-feedback
  // 2026-05-26 — image #10/#11). Юзер видит вкладки Оплачено/Не оплачено,
  // структуру, фильтры — выбирает расход кликом и связывается с tx.
  if (direction === 'debit') {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        {mismatchDialog}
        {conflictDialog}
        {partialDialog}
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
              onPickExpense={multiMode ? undefined : handlePickExpense}
              multiSelectMode={multiMode}
              selectedExpenseIds={new Set(selectedExpenses.keys())}
              onToggleExpenseSelection={toggleExpense}
            />
          </div>

          {multiMode && selectedExpenses.size > 0 ? (
            <div className="border-border bg-muted/40 flex items-center justify-between gap-3 border-t px-5 py-2 text-xs">
              <span className="text-foreground font-semibold">
                {t('banking.link_dialog.multi_selected', {
                  defaultValue: 'Выбрано {{n}} · сумма {{sum}} → tx {{tx}}',
                  n: selectedExpenses.size,
                  sum: formatCurrency(selectedSum, txCurrency),
                  tx: formatCurrency(transaction.amount_cents, txCurrency),
                })}
              </span>
              {selectedSum !== transaction.amount_cents ? (
                <span className="text-[11px] text-amber-700">
                  {selectedSum < transaction.amount_cents
                    ? t('banking.link_dialog.multi_under', {
                        defaultValue: 'не хватает {{d}}',
                        d: formatCurrency(transaction.amount_cents - selectedSum, txCurrency),
                      })
                    : t('banking.link_dialog.multi_over', {
                        defaultValue: 'превышает на {{d}}',
                        d: formatCurrency(selectedSum - transaction.amount_cents, txCurrency),
                      })}
                </span>
              ) : null}
            </div>
          ) : null}

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
              <Button
                variant={multiMode ? 'primary' : 'outline'}
                size="sm"
                onClick={() => {
                  setMultiMode((v) => !v)
                  setSelectedExpenses(new Map())
                }}
              >
                {multiMode
                  ? t('banking.link_dialog.multi_cancel', { defaultValue: 'Одиночный выбор' })
                  : t('banking.link_dialog.multi_start', { defaultValue: 'Выбрать несколько' })}
              </Button>
              {multiMode && selectedExpenses.size > 0 ? (
                <Button
                  variant="primary"
                  size="sm"
                  onClick={handleMultiSubmit}
                  disabled={multiLink.isPending}
                >
                  <Link2 className="size-3.5" strokeWidth={2} />
                  {t('banking.link_dialog.multi_submit', {
                    defaultValue: 'Связать ({{n}})',
                    n: selectedExpenses.size,
                  })}
                </Button>
              ) : null}
              {onCreateExpenseFromTx && !multiMode ? (
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
            onPickVisit={multiMode ? undefined : handlePickVisit}
            onPickOtherIncome={multiMode ? undefined : handlePickOtherIncome}
            highlightVisitId={transaction.linked_visit_id ?? null}
            highlightOtherIncomeId={transaction.linked_other_income_id ?? null}
            multiSelectMode={multiMode}
            selectedVisitIds={new Set(selectedVisits.keys())}
            selectedOtherIncomeIds={new Set(selectedOtherIncomes.keys())}
            onToggleVisitSelection={toggleVisit}
            onToggleOtherIncomeSelection={toggleOtherIncome}
          />
        </div>

        {multiMode && selectedCreditCount > 0 ? (
          <div className="border-border bg-muted/40 flex items-center justify-between gap-3 border-t px-5 py-2 text-xs">
            <span className="text-foreground font-semibold">
              {t('banking.link_dialog.multi_selected_credit', {
                defaultValue: 'Выбрано {{n}} · сумма {{sum}} → tx {{tx}}',
                n: selectedCreditCount,
                sum: formatCurrency(selectedCreditSum, txCurrency),
                tx: formatCurrency(transaction.amount_cents, txCurrency),
              })}
            </span>
            {selectedCreditSum !== transaction.amount_cents ? (
              <span className="text-[11px] text-amber-700">
                {selectedCreditSum < transaction.amount_cents
                  ? t('banking.link_dialog.multi_under', {
                      defaultValue: 'не хватает {{d}}',
                      d: formatCurrency(transaction.amount_cents - selectedCreditSum, txCurrency),
                    })
                  : t('banking.link_dialog.multi_over', {
                      defaultValue: 'превышает на {{d}}',
                      d: formatCurrency(selectedCreditSum - transaction.amount_cents, txCurrency),
                    })}
              </span>
            ) : null}
          </div>
        ) : null}

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
            <Button
              variant={multiMode ? 'primary' : 'outline'}
              size="sm"
              onClick={() => {
                setMultiMode((v) => !v)
                setSelectedVisits(new Map())
                setSelectedOtherIncomes(new Map())
              }}
            >
              {multiMode
                ? t('banking.link_dialog.multi_cancel', { defaultValue: 'Одиночный выбор' })
                : t('banking.link_dialog.multi_start', { defaultValue: 'Выбрать несколько' })}
            </Button>
            {multiMode && selectedCreditCount > 0 ? (
              <Button
                variant="primary"
                size="sm"
                onClick={handleMultiSubmitCredit}
                disabled={multiLink.isPending}
              >
                <Link2 className="size-3.5" strokeWidth={2} />
                {t('banking.link_dialog.multi_submit', {
                  defaultValue: 'Связать ({{n}})',
                  n: selectedCreditCount,
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
