import { Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import {
  currentMonthPeriod,
  periodToRange,
  type PeriodValue,
} from '@/components/ui/period-picker-utils'
import { PeriodPickerPopover } from '@/components/ui/PeriodPickerPopover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useSalon } from '@/hooks/useSalons'
import { useStaff } from '@/hooks/useStaff'
import { useDeleteVisit, useVisits, type PaymentMethod } from '@/hooks/useVisits'
import { formatCurrency } from '@/lib/utils/format-currency'
import { formatExpenseDate } from '@/lib/utils/format-date'

const PAYMENT_OPTIONS: PaymentMethod[] = ['cash', 'card', 'transfer']

/**
 * Таб «Продажи» под /income. Показывает товарные продажи (visits с kind=retail)
 * как **список товаров**, а не визитов. По смыслу — это маленький розничный
 * учёт: дата, мастер (кто пробил), товар, сумма, способ оплаты.
 *
 * MVP: только текущий месяц + фильтры мастер/способ оплаты. Период-toggle —
 * следующая итерация если будет спрос.
 */
export function SalesTab({ salonId }: { salonId: string }) {
  const { t } = useTranslation()
  const { data: salon } = useSalon(salonId)
  const currency = salon?.currency ?? 'PLN'

  const [period, setPeriod] = useState<PeriodValue>(() => currentMonthPeriod())
  const r = periodToRange(period)
  const range = { start: r.start.toISOString(), end: r.end.toISOString() }

  const { data: staff = [] } = useStaff(salonId)
  const [staffFilter, setStaffFilter] = useState<string>('')
  const [payFilter, setPayFilter] = useState<PaymentMethod | ''>('')

  const { data: sales = [], isLoading } = useVisits(salonId, range, {
    kind: 'retail',
    staffId: staffFilter || null,
    paymentMethod: payFilter || null,
  })
  const deleteVisit = useDeleteVisit(salonId)

  const total = sales.reduce((acc, s) => acc + s.amount_cents - s.discount_cents + s.tip_cents, 0)

  return (
    <div>
      {/* Header */}
      <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
        <div>
          <h2 className="text-brand-navy text-lg font-bold tracking-tight">
            {t('income.sales.title')}
          </h2>
          <p className="text-muted-foreground mt-1 text-sm">
            {t('income.sales.subtitle_total', {
              count: sales.length,
              revenue: formatCurrency(total, currency),
            })}
          </p>
        </div>
        <PeriodPickerPopover value={period} onChange={setPeriod} />
      </div>

      {/* Filters */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Select
          value={staffFilter || 'all'}
          onValueChange={(v) => setStaffFilter(v === 'all' ? '' : v)}
        >
          <SelectTrigger className="h-10 w-[200px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('income.sales.filters.all_staff')}</SelectItem>
            {staff.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.full_name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={payFilter || 'all'}
          onValueChange={(v) => setPayFilter(v === 'all' ? '' : (v as PaymentMethod))}
        >
          <SelectTrigger className="h-10 w-[180px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('income.sales.filters.all_payments')}</SelectItem>
            {PAYMENT_OPTIONS.map((p) => (
              <SelectItem key={p} value={p}>
                {t(`payment_methods.${p}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <div className="border-border bg-card shadow-finsm overflow-x-auto rounded-lg border">
        {isLoading ? (
          <p className="text-muted-foreground p-6 text-sm">{t('common.loading')}</p>
        ) : sales.length === 0 ? (
          <p className="text-muted-foreground p-6 text-sm">{t('income.sales.empty')}</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-muted-foreground text-xs uppercase tracking-wider">
              <tr>
                <th className="px-4 py-2 text-left font-semibold">{t('income.sales.col_date')}</th>
                <th className="px-4 py-2 text-left font-semibold">{t('income.sales.col_item')}</th>
                <th className="px-4 py-2 text-left font-semibold">{t('income.sales.col_staff')}</th>
                <th className="px-4 py-2 text-left font-semibold">
                  {t('income.sales.col_payment')}
                </th>
                <th className="px-4 py-2 text-right font-semibold">
                  {t('income.sales.col_amount')}
                </th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {sales.map((s) => {
                const stf = staff.find((x) => x.id === s.staff_id)
                return (
                  <tr key={s.id} className="border-border/60 border-t">
                    <td className="num text-muted-foreground px-4 py-2 text-xs">
                      {formatExpenseDate(s.visit_at)}
                    </td>
                    <td className="text-foreground px-4 py-2 font-semibold">
                      {s.service_name_snapshot ?? '—'}
                      {s.comment ? (
                        <span className="text-muted-foreground ml-2 text-xs">· {s.comment}</span>
                      ) : null}
                    </td>
                    <td className="text-muted-foreground px-4 py-2 text-xs">
                      {stf?.full_name ?? '—'}
                    </td>
                    <td className="text-muted-foreground px-4 py-2 text-xs">
                      {t(`payment_methods.${s.payment_method}`)}
                    </td>
                    <td className="num text-brand-sage-deep px-4 py-2 text-right font-bold">
                      +{formatCurrency(s.amount_cents - s.discount_cents + s.tip_cents, currency)}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <button
                        type="button"
                        onClick={() => {
                          if (!confirm(t('income.sales.confirm_delete'))) return
                          deleteVisit.mutate(s.id, {
                            onSuccess: () => toast.success(t('income.sales.toast_deleted')),
                          })
                        }}
                        className="text-muted-foreground hover:text-destructive grid size-8 place-items-center rounded-md"
                        aria-label="delete"
                      >
                        <Trash2 className="size-4" strokeWidth={1.7} />
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
