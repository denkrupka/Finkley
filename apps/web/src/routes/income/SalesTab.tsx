import { Plus, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { useQueryClient } from '@tanstack/react-query'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
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
import { useRequireCashShift } from '@/hooks/useCashShifts'
import { useOtherIncomeCategories, useOtherIncomes } from '@/hooks/useOtherIncomes'
import { usePaymentMethods } from '@/hooks/usePaymentMethods'
import { useSalon } from '@/hooks/useSalons'
import { useStaff } from '@/hooks/useStaff'
import {
  useDeleteVisit,
  useVisits,
  visitsKeys,
  type PaymentMethod,
  type VisitRow,
} from '@/hooks/useVisits'
import { formatCurrency } from '@/lib/utils/format-currency'
import { formatVisitDate } from '@/lib/utils/format-date'
import { RetailSaleWizard } from '@/routes/visits/RetailSaleWizard'
import { VisitDetailModal } from '@/routes/visits/VisitDetailModal'

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
  const qc = useQueryClient()
  const { data: salon } = useSalon(salonId)
  const currency = salon?.currency ?? 'PLN'

  const [period, setPeriod] = useState<PeriodValue>(() => currentMonthPeriod())
  const r = periodToRange(period)
  const range = { start: r.start.toISOString(), end: r.end.toISOString() }

  const { data: staff = [] } = useStaff(salonId)
  const { data: paymentMethods = [] } = usePaymentMethods(salonId)
  const [staffFilter, setStaffFilter] = useState<string>('')
  const [payFilter, setPayFilter] = useState<PaymentMethod | ''>('')
  const [createOpen, setCreateOpen] = useState(false)
  const { hasOpenShift } = useRequireCashShift(salonId)
  // Image #98: клик по строке продажи → открыть карточку с возможностью
  // редактировать любое поле (используем VisitDetailModal в режиме detail).
  const [editingSale, setEditingSale] = useState<VisitRow | null>(null)

  const { data: sales = [], isLoading } = useVisits(salonId, range, {
    kind: 'retail',
    staffId: staffFilter || null,
    paymentMethod: payFilter || null,
  })
  // Image #127: продажи через wizard'овский таб «Прочие доходы» (kind=
  // 'other_income') попадают в other_incomes, не в visits — раньше они
  // не показывались в SalesTab вообще. Тянем их тут и мержим в общий
  // список, чтобы юзер видел все продажи в одном месте независимо от
  // того, какую вкладку wizard'а использовал.
  const { data: otherIncomes = [] } = useOtherIncomes(salonId, {
    start: r.start,
    end: r.end,
  })
  const { data: otherCategories = [] } = useOtherIncomeCategories(salonId)
  const otherCategoriesById = useMemo(
    () => new Map(otherCategories.map((c) => [c.id, c.name])),
    [otherCategories],
  )

  // Применяем те же фильтры (payment_method) к other_incomes. staffFilter
  // к ним не применим — у других доходов нет мастера.
  const filteredOtherIncomes = useMemo(() => {
    let list = otherIncomes
    if (payFilter) list = list.filter((o) => o.payment_method === payFilter)
    // Если включён фильтр по мастеру — other_incomes исключаем целиком
    // (у них staff_id нет, показывать их в «выборке по мастеру» странно).
    if (staffFilter) list = []
    return list
  }, [otherIncomes, payFilter, staffFilter])

  const deleteVisit = useDeleteVisit(salonId)

  const salesTotal = sales.reduce(
    (acc, s) => acc + s.amount_cents - s.discount_cents + s.tip_cents,
    0,
  )
  const otherTotal = filteredOtherIncomes.reduce((acc, o) => acc + o.amount_cents, 0)
  const total = salesTotal + otherTotal
  const totalCount = sales.length + filteredOtherIncomes.length

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
              count: totalCount,
              revenue: formatCurrency(total, currency),
            })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <PeriodPickerPopover value={period} onChange={setPeriod} />
          <Button
            variant="secondary"
            size="md"
            onClick={() => {
              // Per-user касса: «+Продажа» — гейт ДО открытия wizard'а,
              // чтобы не проходить 4 шага зря.
              if (!hasOpenShift) {
                toast.error(t('finance.cash.gate_required_title'), {
                  description: t('finance.cash.gate_required_sale'),
                })
                return
              }
              setCreateOpen(true)
            }}
          >
            <Plus className="size-4" strokeWidth={2.4} />
            {t('income.sales.add_button')}
          </Button>
        </div>
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
            {paymentMethods.map((m) => (
              <SelectItem key={m.id} value={m.code}>
                {m.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <div className="border-border bg-card shadow-finsm overflow-x-auto rounded-lg border">
        {isLoading ? (
          <p className="text-muted-foreground p-6 text-sm">{t('common.loading')}</p>
        ) : totalCount === 0 ? (
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
              {/* Image #127: товары (retail visits) + прочие доходы рисуем
                  в одной таблице. Прочие доходы помечены пилюлей-бейджем,
                  чтобы юзер сразу видел тип. */}
              {filteredOtherIncomes.map((o) => (
                <tr key={`oi-${o.id}`} className="border-border/60 hover:bg-muted/30 border-t">
                  <td className="num text-muted-foreground px-4 py-2 text-xs">
                    {formatVisitDate(o.income_at)}
                  </td>
                  <td className="text-foreground px-4 py-2">
                    <span className="font-semibold">
                      {o.category_id ? (otherCategoriesById.get(o.category_id) ?? '—') : '—'}
                    </span>
                    <span className="bg-brand-teal-soft text-brand-teal-deep ml-2 rounded-full px-1.5 py-0.5 text-[10px] font-bold uppercase">
                      {t('income.sales.tag_other')}
                    </span>
                    {o.comment ? (
                      <span className="text-muted-foreground ml-2 text-xs">· {o.comment}</span>
                    ) : null}
                  </td>
                  <td className="text-muted-foreground px-4 py-2 text-xs">—</td>
                  <td className="text-muted-foreground px-4 py-2 text-xs">
                    {paymentMethods.find((m) => m.code === o.payment_method)?.label ??
                      (o.payment_method ? t(`payment_methods.${o.payment_method}`) : '—')}
                  </td>
                  <td className="num text-brand-sage-deep px-4 py-2 text-right font-bold">
                    +{formatCurrency(o.amount_cents, currency)}
                  </td>
                  <td className="px-4 py-2" />
                </tr>
              ))}
              {sales.map((s) => {
                const stf = staff.find((x) => x.id === s.staff_id)
                return (
                  <tr
                    key={s.id}
                    className="border-border/60 hover:bg-muted/30 cursor-pointer border-t"
                    onClick={() => setEditingSale(s)}
                  >
                    <td className="num text-muted-foreground px-4 py-2 text-xs">
                      {formatVisitDate(s.visit_at)}
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
                      {paymentMethods.find((m) => m.code === s.payment_method)?.label ??
                        t(`payment_methods.${s.payment_method}`)}
                    </td>
                    <td className="num text-brand-sage-deep px-4 py-2 text-right font-bold">
                      +{formatCurrency(s.amount_cents - s.discount_cents + s.tip_cents, currency)}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
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

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        {/* width: 96vw на мобиле/планшете, 680px на десктопе.
            На скриншоте Image #24 720px вылезал за viewport — сужаем
            и даём gap-0/p-0 чтобы wizard сам управлял padding'ом. */}
        <DialogContent className="w-[96vw] gap-0 p-0 sm:!w-[760px] sm:!max-w-[760px]">
          <div className="px-4 pt-4 sm:px-5 sm:pt-5">
            <DialogHeader>
              <DialogTitle>{t('income.sales.create_title')}</DialogTitle>
              <DialogDescription>{t('income.sales.create_subtitle')}</DialogDescription>
            </DialogHeader>
          </div>
          <RetailSaleWizard
            salonId={salonId}
            currency={currency}
            staff={staff}
            onDone={() => {
              // Image #92: после оформления продажи кэш visits не
              // обновлялся, и список «Продажи» был пустой до reload.
              // Image #127: добавил refetchType:'all' — без него фоновые
              // (или не-observed) подвыборки SalesTab не подхватывали свежие
              // данные, и продажа со «skip document» не появлялась в списке.
              void qc.invalidateQueries({
                queryKey: visitsKeys(salonId),
                refetchType: 'all',
              })
              void qc.invalidateQueries({ queryKey: ['dashboard', salonId] })
              setCreateOpen(false)
            }}
          />
        </DialogContent>
      </Dialog>

      <VisitDetailModal
        visit={editingSale}
        onClose={() => setEditingSale(null)}
        salonId={salonId}
        currency={currency}
      />
    </div>
  )
}
