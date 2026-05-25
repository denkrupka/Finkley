import { AlertTriangle, Edit3, Landmark, Link2, Link2Off, Loader2, RefreshCcw } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  useBankConnections,
  useBankInflows,
  useBankOutflows,
  useBankSyncNow,
  type BankInflowRow,
  type BankOutflowRow,
} from '@/hooks/useBanking'
import { cn } from '@/lib/utils/cn'
import { formatCurrency } from '@/lib/utils/format-currency'
import { formatExpenseDate } from '@/lib/utils/format-date'

import { ExpenseFormModal } from '@/routes/expenses/ExpenseFormModal'

import { LinkTransactionDialog } from './LinkTransactionDialog'

type Direction = 'debit' | 'credit'

type Props = {
  salonId: string
  /** debit — расходы (списания), credit — доходы (поступления) */
  direction: Direction
  period: { start: string; end: string }
  currency: string
}

/**
 * Универсальная таблица банковских транзакций для вкладки «Банкинг».
 * Для debit используется на странице Расходы, для credit — Доходы.
 *
 * Поля строки: Дата | Контрагент | Сумма | Назначение | Связано с | Действия.
 * Действия: «Связать» (если ещё нет), «Редактировать» (если есть), значок
 * предупреждения «требует перепроверки» (needs_review). Связывание открывает
 * LinkTransactionDialog — модалка с поиском по расходам или по доходам.
 */
export function BankingTransactionsTable({ salonId, direction, period, currency }: Props) {
  const { t } = useTranslation()
  const { data: connections = [] } = useBankConnections(salonId)
  const inflowsQ = useBankInflows(direction === 'credit' ? salonId : undefined, period)
  const outflowsQ = useBankOutflows(direction === 'debit' ? salonId : undefined, period)
  const sync = useBankSyncNow(salonId)
  const [linkOpen, setLinkOpen] = useState(false)
  const [linkTx, setLinkTx] = useState<BankInflowRow | BankOutflowRow | null>(null)
  // Создание расхода из транзакции — открывает ExpenseFormModal с prefill.
  const [createOpen, setCreateOpen] = useState(false)
  const [createPrefill, setCreatePrefill] = useState<{
    bank_transaction_id: string
    amount_cents: number
    date: string
    description: string
    counterparty_hint: string | null
  } | null>(null)

  const isLoading = inflowsQ.isLoading || outflowsQ.isLoading
  const rows: Array<BankInflowRow | BankOutflowRow> =
    direction === 'debit' ? (outflowsQ.data ?? []) : (inflowsQ.data ?? [])

  const hasActiveConnection = connections.some((c) => c.status === 'connected')

  function handleSyncAll() {
    const active = connections.filter((c) => c.status === 'connected')
    if (active.length === 0) {
      toast.error(t('banking.transactions.no_connections'))
      return
    }
    let done = 0
    for (const c of active) {
      sync.mutate(c.id, {
        onSuccess: () => {
          done += 1
          if (done === active.length) toast.success(t('banking.transactions.sync_done'))
        },
        onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
      })
    }
  }

  return (
    <div className="border-border bg-card shadow-finsm rounded-lg border">
      {/* Header */}
      <div className="border-border flex items-center justify-between gap-3 border-b px-5 py-3">
        <div className="flex items-center gap-2">
          <Landmark className="text-brand-teal-deep size-4" strokeWidth={1.7} />
          <p className="text-brand-navy text-sm font-bold tracking-tight">
            {t('banking.transactions.title')}
          </p>
          <span className="text-muted-foreground/80 text-xs">
            {rows.length} {t('banking.transactions.count_suffix')}
          </span>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleSyncAll}
          disabled={!hasActiveConnection || sync.isPending}
        >
          {sync.isPending ? (
            <Loader2 className="size-3.5 animate-spin" strokeWidth={2} />
          ) : (
            <RefreshCcw className="size-3.5" strokeWidth={1.8} />
          )}
          {t('banking.transactions.sync_now')}
        </Button>
      </div>

      {/* Empty / no connections */}
      {!hasActiveConnection ? (
        <div className="px-5 py-10 text-center">
          <Landmark className="text-muted-foreground/60 mx-auto size-8" strokeWidth={1.4} />
          <p className="text-foreground mt-3 text-sm font-semibold">
            {t('banking.transactions.no_connections_title')}
          </p>
          <p className="text-muted-foreground mx-auto mt-1 max-w-md text-xs">
            {t('banking.transactions.no_connections_hint')}
          </p>
          <Button asChild variant="primary" size="sm" className="mt-3">
            <a href={`/${salonId}/settings/integrations?tab=banking`}>
              {t('banking.transactions.go_connect')}
            </a>
          </Button>
        </div>
      ) : isLoading ? (
        <div className="flex items-center justify-center py-10">
          <Loader2 className="text-muted-foreground size-5 animate-spin" strokeWidth={2} />
        </div>
      ) : rows.length === 0 ? (
        <div className="px-5 py-10 text-center">
          <p className="text-muted-foreground text-sm">{t('banking.transactions.empty_period')}</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-border text-muted-foreground border-b text-xs font-semibold uppercase tracking-wider">
                <th className="px-4 py-2 text-left">{t('banking.transactions.col_date')}</th>
                <th className="px-4 py-2 text-left">
                  {t('banking.transactions.col_counterparty')}
                </th>
                <th className="px-4 py-2 text-right">{t('banking.transactions.col_amount')}</th>
                <th className="px-4 py-2 text-left">{t('banking.transactions.col_purpose')}</th>
                <th className="px-4 py-2 text-left">{t('banking.transactions.col_linked')}</th>
                <th className="px-4 py-2 text-right">{t('banking.transactions.col_actions')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((tx) => (
                <TransactionRow
                  key={tx.id}
                  tx={tx}
                  direction={direction}
                  currency={currency}
                  onLink={() => {
                    setLinkTx(tx)
                    setLinkOpen(true)
                  }}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {linkTx ? (
        <LinkTransactionDialog
          open={linkOpen}
          onOpenChange={(v) => {
            setLinkOpen(v)
            if (!v) setLinkTx(null)
          }}
          salonId={salonId}
          transaction={linkTx}
          direction={direction}
          onCreateExpenseFromTx={
            direction === 'debit'
              ? () => {
                  setCreatePrefill({
                    bank_transaction_id: linkTx.id,
                    amount_cents: linkTx.amount_cents,
                    date: linkTx.executed_at.slice(0, 10),
                    description: linkTx.description ?? '',
                    counterparty_hint: linkTx.counterparty,
                  })
                  setLinkOpen(false)
                  setCreateOpen(true)
                }
              : undefined
          }
        />
      ) : null}

      {createPrefill ? (
        <ExpenseFormModal
          open={createOpen}
          onOpenChange={(v) => {
            setCreateOpen(v)
            if (!v) {
              setCreatePrefill(null)
              setLinkTx(null)
            }
          }}
          salonId={salonId}
          currency={currency}
          prefillFromBankTx={createPrefill}
        />
      ) : null}
    </div>
  )
}

function TransactionRow({
  tx,
  direction,
  currency,
  onLink,
}: {
  tx: BankInflowRow | BankOutflowRow
  direction: Direction
  currency: string
  onLink: () => void
}) {
  const { t } = useTranslation()
  const linked =
    direction === 'debit' ? !!tx.expense_id : !!(tx.linked_visit_id || tx.linked_other_income_id)
  const counterparty = tx.counterparty || t('banking.transactions.no_counterparty')
  const purpose = tx.description || '—'

  return (
    <tr
      className={cn(
        'border-border hover:bg-muted/30 border-b last:border-b-0',
        tx.needs_review && 'bg-amber-50/40',
      )}
    >
      <td className="text-foreground whitespace-nowrap px-4 py-2.5 text-xs">
        {formatExpenseDate(tx.executed_at)}
      </td>
      <td className="text-foreground px-4 py-2.5 text-sm font-medium">
        <div className="flex items-center gap-1.5">
          <span className="truncate">{counterparty}</span>
          {tx.needs_review ? (
            <span title={t('banking.transactions.needs_review_tooltip')}>
              <AlertTriangle className="size-3.5 shrink-0 text-amber-600" strokeWidth={2} />
            </span>
          ) : null}
        </div>
      </td>
      <td
        className={cn(
          'num whitespace-nowrap px-4 py-2.5 text-right text-sm font-bold tabular-nums',
          direction === 'debit' ? 'text-destructive' : 'text-emerald-700',
        )}
      >
        {direction === 'debit' ? '−' : '+'}
        {formatCurrency(tx.amount_cents, currency)}
      </td>
      <td className="text-muted-foreground max-w-[280px] truncate px-4 py-2.5 text-xs">
        {purpose}
      </td>
      <td className="px-4 py-2.5">
        {linked ? (
          <span className="text-brand-teal-deep inline-flex items-center gap-1 text-xs font-semibold">
            <Link2 className="size-3" strokeWidth={2} />
            {t('banking.transactions.linked')}
          </span>
        ) : (
          <span className="text-muted-foreground/80 inline-flex items-center gap-1 text-xs">
            <Link2Off className="size-3" strokeWidth={1.7} />
            {t('banking.transactions.not_linked')}
          </span>
        )}
      </td>
      <td className="px-4 py-2.5 text-right">
        <button
          type="button"
          onClick={onLink}
          className={cn(
            'inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold transition-colors',
            linked
              ? 'text-foreground hover:bg-muted/60'
              : 'bg-brand-teal-soft text-brand-teal-deep hover:bg-brand-teal-soft/80',
          )}
        >
          {linked ? (
            <Edit3 className="size-3" strokeWidth={2} />
          ) : (
            <Link2 className="size-3" strokeWidth={2} />
          )}
          {linked ? t('banking.transactions.edit_link') : t('banking.transactions.link_action')}
        </button>
      </td>
    </tr>
  )
}
