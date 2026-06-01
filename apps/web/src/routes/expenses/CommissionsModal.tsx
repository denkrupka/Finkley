import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Receipt, ShoppingBag, Wallet } from 'lucide-react'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { effectivePaidCents, type ExpenseRow } from '@/hooks/useExpenses'
import { usePaymentMethods } from '@/hooks/usePaymentMethods'
import { supabase } from '@/lib/supabase/client'
import { cn } from '@/lib/utils/cn'
import { formatCurrency } from '@/lib/utils/format-currency'
import { formatExpenseDate } from '@/lib/utils/format-date'

type Props = {
  open: boolean
  onClose: () => void
  salonId: string
  currency: string
  /** Расходы категории «Комиссии» за текущий период (передаются с родительской страницы). */
  expenses: ExpenseRow[]
  /** Открыть исходный визит/доход по клику на строку. */
  onOpenSource: (table: 'visits' | 'other_incomes', id: string) => void
}

type SourceInfo = {
  id: string
  table: 'visits' | 'other_incomes'
  clientName: string | null
  serviceName: string | null
  kindLabel: 'visit' | 'retail' | 'income'
  txAmountCents: number
}

/**
 * T15 — модалка транзакций комиссий. Для каждого расхода категории «Комиссии»
 * подтягивает связанный источник (visits / other_incomes) и показывает:
 *
 *   Дата | Тип | Клиент | Услуга / Описание | Метод | Сумма tx | Комиссия
 *
 * 02.06: расширена + новая колонка «Услуга», клиент через join с clients.
 */
export function CommissionsModal({
  open,
  onClose,
  salonId,
  currency,
  expenses,
  onOpenSource,
}: Props) {
  const { t } = useTranslation()
  const { data: paymentMethods = [] } = usePaymentMethods(salonId, { includeArchived: true })
  const labelByCode = new Map(paymentMethods.map((m) => [m.code, m.label]))

  const visitIds = expenses
    .filter((e) => e.commission_source_table === 'visits' && e.commission_source_id)
    .map((e) => e.commission_source_id as string)
  const incomeIds = expenses
    .filter((e) => e.commission_source_table === 'other_incomes' && e.commission_source_id)
    .map((e) => e.commission_source_id as string)

  const sourcesQuery = useQuery<Map<string, SourceInfo>>({
    queryKey: [
      'commission-sources',
      salonId,
      [...visitIds].sort().join(','),
      [...incomeIds].sort().join(','),
    ],
    queryFn: async () => {
      const map = new Map<string, SourceInfo>()
      if (visitIds.length > 0) {
        // JOIN clients для имени — в visits только client_id (FK).
        const { data, error } = await supabase
          .from('visits')
          .select(
            'id, kind, amount_cents, paid_amount_cents, service_name_snapshot, client:clients(name)',
          )
          .in('id', visitIds)
        if (error) throw error
        for (const r of data ?? []) {
          const tx =
            r.paid_amount_cents != null && r.paid_amount_cents > 0
              ? r.paid_amount_cents
              : r.amount_cents
          // client может прийти как массив (PostgREST embed) или объект
          const clientObj = Array.isArray(r.client)
            ? r.client[0]
            : (r.client as { name?: string } | null)
          map.set(`visits:${r.id}`, {
            id: r.id,
            table: 'visits',
            clientName: clientObj?.name ?? null,
            serviceName: r.service_name_snapshot ?? null,
            kindLabel: r.kind === 'retail' ? 'retail' : 'visit',
            txAmountCents: tx,
          })
        }
      }
      if (incomeIds.length > 0) {
        const { data, error } = await supabase
          .from('other_incomes')
          .select('id, amount_cents, paid_amount_cents, comment')
          .in('id', incomeIds)
        if (error) throw error
        for (const r of data ?? []) {
          const tx =
            r.paid_amount_cents != null && r.paid_amount_cents > 0
              ? r.paid_amount_cents
              : r.amount_cents
          map.set(`other_incomes:${r.id}`, {
            id: r.id,
            table: 'other_incomes',
            clientName: null,
            serviceName: r.comment ?? null,
            kindLabel: 'income',
            txAmountCents: tx,
          })
        }
      }
      return map
    },
    enabled: open && expenses.length > 0,
    staleTime: 30_000,
  })

  const total = expenses.reduce((s, e) => s + effectivePaidCents(e), 0)
  const totalTx = expenses.reduce((s, e) => {
    const key = `${e.commission_source_table}:${e.commission_source_id}`
    const src = sourcesQuery.data?.get(key)
    if (src && src.txAmountCents > 0) return s + src.txAmountCents
    // fallback по rate
    const pm = e.payment_method ? paymentMethods.find((p) => p.code === e.payment_method) : null
    const rate = pm?.commission_pct ?? 0
    const commission = effectivePaidCents(e)
    if (rate > 0 && commission > 0) return s + Math.round((commission * 100) / rate)
    return s
  }, 0)

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="flex max-h-[90vh] w-[min(1200px,96vw)] !max-w-none flex-col gap-0 p-0">
        {/* Header */}
        <div className="border-border bg-card shrink-0 border-b px-6 py-4">
          <DialogHeader>
            <DialogTitle className="text-foreground flex items-center gap-2 text-xl font-bold tracking-tight">
              <Receipt className="text-brand-yellow-deep size-5" strokeWidth={2} />
              {t('expenses.commissions.title')}
            </DialogTitle>
            <DialogDescription className="text-muted-foreground mt-1 text-sm">
              {t('expenses.commissions.subtitle')}
            </DialogDescription>
          </DialogHeader>
          {/* KPI row */}
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="border-border bg-muted/30 rounded-md border p-3">
              <p className="text-muted-foreground text-[10px] font-bold uppercase tracking-wider">
                {t('expenses.commissions.kpi_count', { defaultValue: 'Транзакций' })}
              </p>
              <p className="num text-foreground mt-1 text-lg font-bold">{expenses.length}</p>
            </div>
            <div className="border-border bg-muted/30 rounded-md border p-3">
              <p className="text-muted-foreground text-[10px] font-bold uppercase tracking-wider">
                {t('expenses.commissions.kpi_tx_total', { defaultValue: 'Оборот' })}
              </p>
              <p className="num text-foreground mt-1 text-lg font-bold">
                {formatCurrency(totalTx, currency)}
              </p>
            </div>
            <div className="border-brand-yellow-deep bg-brand-yellow rounded-md border p-3">
              <p className="text-brand-navy/70 text-[10px] font-bold uppercase tracking-wider">
                {t('expenses.commissions.kpi_commission', { defaultValue: 'Комиссия' })}
              </p>
              <p className="num text-brand-navy mt-1 text-lg font-bold">
                {formatCurrency(total, currency)}
              </p>
            </div>
          </div>
        </div>

        {/* Body */}
        {expenses.length === 0 ? (
          <div className="text-muted-foreground flex-1 py-10 text-center text-sm">
            {t('expenses.commissions.empty')}
          </div>
        ) : (
          <div className="flex-1 overflow-x-auto overflow-y-auto">
            <table className="w-full min-w-[920px] text-sm">
              <thead className="border-border bg-muted/30 sticky top-0 z-10 border-b">
                <tr className="text-muted-foreground text-left text-[10px] font-bold uppercase tracking-wider">
                  <th className="px-4 py-2.5">{t('expenses.commissions.col_date')}</th>
                  <th className="px-4 py-2.5">{t('expenses.commissions.col_kind')}</th>
                  <th className="px-4 py-2.5">
                    {t('expenses.commissions.col_client', { defaultValue: 'Клиент' })}
                  </th>
                  <th className="px-4 py-2.5">
                    {t('expenses.commissions.col_service', { defaultValue: 'Услуга / описание' })}
                  </th>
                  <th className="px-4 py-2.5">{t('expenses.commissions.col_method')}</th>
                  <th className="num px-4 py-2.5 text-right">
                    {t('expenses.commissions.col_tx', { defaultValue: 'Сумма' })}
                  </th>
                  <th className="num px-4 py-2.5 text-right">
                    {t('expenses.commissions.col_commission')}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-border/40 divide-y">
                {expenses.map((e, idx) => {
                  const key = `${e.commission_source_table}:${e.commission_source_id}`
                  const src = sourcesQuery.data?.get(key)
                  const kindLabel =
                    src?.kindLabel === 'retail'
                      ? t('expenses.commissions.kind_retail', { defaultValue: 'Продажа' })
                      : src?.kindLabel === 'income'
                        ? t('expenses.commissions.kind_income')
                        : t('expenses.commissions.kind_visit')
                  const KindIcon =
                    src?.kindLabel === 'retail'
                      ? ShoppingBag
                      : src?.kindLabel === 'income'
                        ? Wallet
                        : Receipt
                  const pm = e.payment_method
                    ? paymentMethods.find((p) => p.code === e.payment_method)
                    : null
                  const rate = pm?.commission_pct ?? 0
                  const commission = effectivePaidCents(e)
                  let txDisplay: string | null = null
                  let txEstimated = false
                  if (src && src.txAmountCents > 0) {
                    txDisplay = formatCurrency(src.txAmountCents, currency)
                  } else if (rate > 0 && commission > 0) {
                    txDisplay = formatCurrency(Math.round((commission * 100) / rate), currency)
                    txEstimated = true
                  }
                  return (
                    <tr
                      key={e.id}
                      className={cn(
                        'hover:bg-brand-yellow/30 cursor-pointer transition-colors',
                        idx % 2 === 1 && 'bg-muted/10',
                      )}
                      onClick={() => {
                        if (e.commission_source_table && e.commission_source_id) {
                          onOpenSource(e.commission_source_table, e.commission_source_id)
                        }
                      }}
                    >
                      <td className="num text-foreground whitespace-nowrap px-4 py-3 text-xs">
                        {formatExpenseDate(e.expense_at)}
                      </td>
                      <td className="px-4 py-3">
                        <span className="border-border bg-card inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-semibold">
                          <KindIcon className="text-muted-foreground size-3" strokeWidth={2} />
                          {kindLabel}
                        </span>
                      </td>
                      <td className="text-foreground max-w-[180px] truncate px-4 py-3 text-xs font-semibold">
                        {src?.clientName ?? <span className="text-muted-foreground/60">—</span>}
                      </td>
                      <td className="text-muted-foreground max-w-[260px] truncate px-4 py-3 text-xs">
                        {src?.serviceName ?? <span className="text-muted-foreground/60">—</span>}
                      </td>
                      <td className="text-muted-foreground whitespace-nowrap px-4 py-3 text-xs">
                        {e.payment_method
                          ? (labelByCode.get(e.payment_method) ?? e.payment_method)
                          : '—'}
                      </td>
                      <td className="num text-foreground whitespace-nowrap px-4 py-3 text-right text-xs">
                        {txDisplay ? (
                          <span
                            title={
                              txEstimated
                                ? t('expenses.commissions.tx_estimated', {
                                    defaultValue: 'Оценка по ставке',
                                  })
                                : undefined
                            }
                            className={cn(txEstimated && 'text-muted-foreground italic')}
                          >
                            {txEstimated ? `≈ ${txDisplay}` : txDisplay}
                          </span>
                        ) : (
                          <span className="text-muted-foreground/60">—</span>
                        )}
                      </td>
                      <td className="num text-destructive whitespace-nowrap px-4 py-3 text-right text-xs font-bold">
                        −{formatCurrency(commission, currency)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
