import { zodResolver } from '@hookform/resolvers/zod'
import { format } from 'date-fns'
import { Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { z } from 'zod'

import { Button } from '@/components/ui/button'
import {
  currentMonthPeriod,
  periodToRange,
  type PeriodValue,
} from '@/components/ui/period-picker-utils'
import { PeriodPickerPopover } from '@/components/ui/PeriodPickerPopover'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useCashRegisters, type CashRegisterOption } from '@/hooks/useCashRegisters'
import {
  useCreateOtherIncome,
  useDeleteOtherIncome,
  useOtherIncomeCategories,
  useOtherIncomes,
} from '@/hooks/useOtherIncomes'
import { usePaymentMethods, type PaymentMethodRow } from '@/hooks/usePaymentMethods'
import type { PaymentMethod } from '@/hooks/useVisits'
import { useSalon } from '@/hooks/useSalons'
import { cn } from '@/lib/utils/cn'
import { formatCurrency } from '@/lib/utils/format-currency'
import { formatExpenseDate } from '@/lib/utils/format-date'

type FormValues = {
  category_id: string
  amount: string
  payment_method: PaymentMethod | ''
  cash_register_id: string
  comment: string
}

const schema = z.object({
  category_id: z.string().min(1, 'income.other_form.errors.category_required'),
  amount: z
    .string()
    .min(1, 'income.other_form.errors.amount_required')
    .refine((v) => Number(v.replace(',', '.')) > 0, 'income.other_form.errors.amount_positive'),
  payment_method: z
    .enum(['cash', 'card', 'transfer', 'online', 'mixed', ''])
    .optional()
    .default(''),
  cash_register_id: z.string().optional().default(''),
  comment: z.string().max(500).optional().default(''),
})

/**
 * Контент таба «Прочие доходы» страницы /income. CRUD-список для нерегулярных
 * поступлений: аренда кресла, кэшбек, проценты, возвраты и т.п.
 */
export function OtherIncomeTab({ salonId }: { salonId: string }) {
  const { t } = useTranslation()
  const { data: salon } = useSalon(salonId)
  const currency = salon?.currency ?? 'PLN'

  const [period, setPeriod] = useState<PeriodValue>(() => currentMonthPeriod())
  const range = periodToRange(period)

  const { data: categories = [] } = useOtherIncomeCategories(salonId)
  const { data: paymentMethods = [] } = usePaymentMethods(salonId)
  const { data: incomes = [], isLoading } = useOtherIncomes(salonId, range)
  const createIncome = useCreateOtherIncome(salonId)
  const deleteIncome = useDeleteOtherIncome(salonId)

  const [formOpen, setFormOpen] = useState(false)
  const total = incomes.reduce((acc, i) => acc + i.amount_cents, 0)

  return (
    <div>
      <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
        <div>
          <h2 className="text-brand-navy text-lg font-bold tracking-tight">
            {t('income.other.title')}
          </h2>
          <p className="text-muted-foreground mt-1 text-sm">
            {t('income.other.subtitle_total')}{' '}
            <span className="num text-brand-sage-deep font-bold">
              {formatCurrency(total, currency)}
            </span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <PeriodPickerPopover value={period} onChange={setPeriod} />
          <Button variant="secondary" size="md" onClick={() => setFormOpen(true)}>
            <Plus className="size-4" strokeWidth={2.4} />
            {t('income.other.add_button')}
          </Button>
        </div>
      </div>

      <div className="border-border bg-card shadow-finsm rounded-lg border">
        {isLoading ? (
          <div className="text-muted-foreground p-6 text-sm">{t('common.loading')}</div>
        ) : incomes.length === 0 ? (
          <div className="text-muted-foreground p-6 text-sm">{t('income.other.empty')}</div>
        ) : (
          <ul className="divide-border divide-y">
            {incomes.map((row) => {
              const cat = categories.find((c) => c.id === row.category_id)
              return (
                <li
                  key={row.id}
                  className="grid grid-cols-[80px_1fr_auto_auto] items-center gap-3 px-4 py-3"
                >
                  <span className="num text-muted-foreground text-xs">
                    {formatExpenseDate(row.income_at)}
                  </span>
                  <span className="flex flex-col">
                    <span className="text-foreground text-sm font-semibold">
                      {cat?.name ?? '—'}
                    </span>
                    {row.comment ? (
                      <span className="text-brand-text-faint mt-0.5 line-clamp-2 text-[11px]">
                        {row.comment}
                      </span>
                    ) : null}
                  </span>
                  <span className="num text-brand-sage-deep text-right text-sm font-bold">
                    +{formatCurrency(row.amount_cents, currency)}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      if (!confirm(t('income.other.confirm_delete'))) return
                      deleteIncome.mutate(row.id, {
                        onSuccess: () => toast.success(t('income.other.toast_deleted')),
                      })
                    }}
                    className="text-muted-foreground hover:text-destructive grid size-8 place-items-center rounded-md"
                    aria-label={t('common.delete')}
                  >
                    <Trash2 className="size-4" strokeWidth={1.7} />
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      <OtherIncomeFormModal
        open={formOpen}
        onOpenChange={setFormOpen}
        salonId={salonId}
        currency={currency}
        categories={categories}
        paymentMethods={paymentMethods}
        onCreate={(input) =>
          createIncome.mutate(input, {
            onSuccess: () => {
              toast.success(t('income.other.toast_added'))
              setFormOpen(false)
            },
            onError: (err) =>
              toast.error(t('income.other.toast_error'), {
                description: err instanceof Error ? err.message : String(err),
              }),
          })
        }
        isPending={createIncome.isPending}
      />
    </div>
  )
}

function OtherIncomeFormModal({
  open,
  onOpenChange,
  salonId,
  currency,
  categories,
  paymentMethods,
  onCreate,
  isPending,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  salonId: string
  currency: string
  categories: { id: string; name: string }[]
  paymentMethods: PaymentMethodRow[]
  onCreate: (input: {
    salon_id: string
    income_at: string
    amount_cents: number
    category_id: string | null
    payment_method: PaymentMethod | null
    cash_register_id: string | null
    comment: string | null
  }) => void
  isPending: boolean
}) {
  const { t } = useTranslation()
  const { data: cashRegisters = [] } = useCashRegisters(salonId)

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      category_id: '',
      amount: '',
      payment_method: '',
      cash_register_id: '',
      comment: '',
    },
  })

  function onSubmit(values: FormValues) {
    const amountCents = Math.round(Number(values.amount.replace(',', '.')) * 100)
    // Дата убрана из формы по UX-запросу — всегда «сегодня».
    const todayIso = format(new Date(), 'yyyy-MM-dd')
    onCreate({
      salon_id: salonId,
      income_at: todayIso,
      category_id: values.category_id || null,
      amount_cents: amountCents,
      payment_method: (values.payment_method || null) as PaymentMethod | null,
      cash_register_id: values.cash_register_id || null,
      comment: values.comment || null,
    })
    form.reset({
      category_id: '',
      amount: '',
      payment_method: '',
      cash_register_id: '',
      comment: '',
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('income.other_form.title')}</DialogTitle>
        </DialogHeader>

        <form className="flex flex-col gap-4 px-5 pb-2 pt-2" onSubmit={form.handleSubmit(onSubmit)}>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="oi-category">{t('income.other_form.category')}</Label>
            <Controller
              name="category_id"
              control={form.control}
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger id="oi-category">
                    <SelectValue placeholder={t('income.other_form.category_placeholder')} />
                  </SelectTrigger>
                  <SelectContent>
                    {categories.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
            {form.formState.errors.category_id ? (
              <p className="text-destructive text-xs">
                {t(form.formState.errors.category_id.message ?? '')}
              </p>
            ) : null}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="oi-amount">
              {t('income.other_form.amount')} ({currency})
            </Label>
            <Input
              id="oi-amount"
              inputMode="decimal"
              placeholder="0.00"
              {...form.register('amount')}
            />
            {form.formState.errors.amount ? (
              <p className="text-destructive text-xs">
                {t(form.formState.errors.amount.message ?? '')}
              </p>
            ) : null}
          </div>

          {/* Метод оплаты как кнопки из справочника payment_methods.
              Юзер кликает — мгновенно выбирает. Архивные не показываем. */}
          <div className="flex flex-col gap-1.5">
            <Label>{t('income.other_form.payment_method')}</Label>
            <Controller
              name="payment_method"
              control={form.control}
              render={({ field }) => (
                <div className="flex flex-wrap gap-1.5">
                  {paymentMethods.map((m) => {
                    const active = field.value === m.code
                    return (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => field.onChange(active ? '' : m.code)}
                        className={cn(
                          'border-border h-9 rounded-md border px-3 text-xs font-semibold transition-colors',
                          active
                            ? 'border-primary bg-primary text-primary-foreground'
                            : 'bg-card hover:bg-muted/40',
                        )}
                      >
                        {m.label}
                      </button>
                    )
                  })}
                </div>
              )}
            />
          </div>

          {/* Конкретная касса salon'а (ADR-014). Нужна для per-register
              балансов в модалке «Перестановка средств». Без неё доход
              не попадёт в баланс конкретной кассы. */}
          {cashRegisters.length > 0 ? (
            <div className="flex flex-col gap-1.5">
              <Label>{t('income.other_form.cash_register')}</Label>
              <Controller
                name="cash_register_id"
                control={form.control}
                render={({ field }) => (
                  <div className="flex flex-wrap gap-1.5">
                    {cashRegisters.map((r: CashRegisterOption) => {
                      const active = field.value === r.id
                      return (
                        <button
                          key={r.id}
                          type="button"
                          onClick={() => field.onChange(active ? '' : r.id)}
                          className={cn(
                            'border-border h-9 rounded-md border px-3 text-xs font-semibold transition-colors',
                            active
                              ? 'border-primary bg-primary text-primary-foreground'
                              : 'bg-card hover:bg-muted/40',
                          )}
                        >
                          {r.label}
                        </button>
                      )
                    })}
                  </div>
                )}
              />
            </div>
          ) : null}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="oi-comment">{t('income.other_form.comment')}</Label>
            <Input
              id="oi-comment"
              placeholder={t('income.other_form.comment_placeholder')}
              {...form.register('comment')}
            />
          </div>

          <DialogFooter className="px-0">
            <Button
              variant="outline"
              type="button"
              onClick={() => onOpenChange(false)}
              disabled={isPending}
            >
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={isPending}>
              {t('common.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
