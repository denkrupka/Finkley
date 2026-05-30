import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'

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
  title: string
  /** Полная сумма транзакции (для расчёта «Комиссия от чего») — paid_amount_cents
   *  или amount_cents источника. */
  txAmountCents: number
}

/**
 * T15 — модалка транзакций комиссий. Для каждого расхода категории «Комиссии»
 * подтягивает связанный источник (visits / other_incomes) и показывает строку:
 *
 *   Дата  | Тип (Визит / Продажа / Доход) | Название | Метод | Сумма tx | Комиссия
 *
 * Клик по строке → onOpenSource → родитель открывает соответствующую модалку
 * (VisitDetailModal или OtherIncomeEditModal).
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

  // Источники транзакций для расходов комиссий. Батчем тянем visits и
  // other_incomes — для отображения «Название» и «Сумма tx».
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
        const { data, error } = await supabase
          .from('visits')
          .select(
            'id, kind, amount_cents, paid_amount_cents, service_name_snapshot, client_full_name_snapshot',
          )
          .in('id', visitIds)
        if (error) throw error
        for (const r of data ?? []) {
          const tx =
            r.paid_amount_cents != null && r.paid_amount_cents > 0
              ? r.paid_amount_cents
              : r.amount_cents
          const title =
            r.kind === 'retail'
              ? r.service_name_snapshot || '—'
              : [r.client_full_name_snapshot, r.service_name_snapshot]
                  .filter(Boolean)
                  .join(' · ') || '—'
          map.set(`visits:${r.id}`, {
            id: r.id,
            table: 'visits',
            title,
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
            title: r.comment || '—',
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

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="w-[min(960px,96vw)] max-w-none">
        <DialogHeader>
          <DialogTitle>{t('expenses.commissions.title')}</DialogTitle>
          <DialogDescription>
            {t('expenses.commissions.subtitle')}
            {' · '}
            {t('expenses.commissions.total', { total: formatCurrency(total, currency) })}
          </DialogDescription>
        </DialogHeader>

        {expenses.length === 0 ? (
          <p className="text-muted-foreground py-6 text-center text-sm">
            {t('expenses.commissions.empty')}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-muted-foreground border-border border-b text-left text-[11px] uppercase tracking-wider">
                <tr>
                  <th className="py-2">{t('expenses.commissions.col_date')}</th>
                  <th className="py-2">{t('expenses.commissions.col_kind')}</th>
                  <th className="py-2">{t('expenses.commissions.col_title')}</th>
                  <th className="py-2">{t('expenses.commissions.col_method')}</th>
                  <th className="num py-2 text-right">{t('expenses.commissions.col_tx')}</th>
                  <th className="num py-2 text-right">
                    {t('expenses.commissions.col_commission')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {expenses.map((e) => {
                  const key = `${e.commission_source_table}:${e.commission_source_id}`
                  const src = sourcesQuery.data?.get(key)
                  const kindLabel =
                    e.commission_source_table === 'visits'
                      ? t('expenses.commissions.kind_visit')
                      : t('expenses.commissions.kind_income')
                  return (
                    <tr
                      key={e.id}
                      className="border-border/40 hover:bg-muted/30 cursor-pointer border-b last:border-b-0"
                      onClick={() => {
                        if (e.commission_source_table && e.commission_source_id) {
                          onOpenSource(e.commission_source_table, e.commission_source_id)
                        }
                      }}
                    >
                      <td className="num py-2 text-xs">{formatExpenseDate(e.expense_at)}</td>
                      <td className="py-2 text-xs">{kindLabel}</td>
                      <td className="py-2 text-xs">{src?.title ?? '—'}</td>
                      <td className="py-2 text-xs">
                        {e.payment_method
                          ? (labelByCode.get(e.payment_method) ?? e.payment_method)
                          : '—'}
                      </td>
                      <td className="num py-2 text-right text-xs">
                        {src ? formatCurrency(src.txAmountCents, currency) : '—'}
                      </td>
                      <td className="num text-destructive py-2 text-right text-xs font-semibold">
                        {formatCurrency(effectivePaidCents(e), currency)}
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
