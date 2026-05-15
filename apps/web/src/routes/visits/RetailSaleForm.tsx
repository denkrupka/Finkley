import { zodResolver } from '@hookform/resolvers/zod'
import { format } from 'date-fns'
import { CalendarDays } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { z } from 'zod'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { usePaymentMethods } from '@/hooks/usePaymentMethods'
import { useCreateVisit } from '@/hooks/useVisits'
import { cn } from '@/lib/utils/cn'

const PAYMENT_OPTIONS = ['cash', 'card', 'transfer'] as const
type PaymentOption = (typeof PAYMENT_OPTIONS)[number]

type FormValues = {
  sold_date: string
  staff_id: string
  item_name: string
  amount: string
  payment_method: PaymentOption
  comment: string
}

const schema = z.object({
  sold_date: z.string().min(1, 'visits.errors.date_required'),
  // Мастер опционален: ритейл могла продать reception без привязки к мастеру.
  staff_id: z.string().optional().default(''),
  item_name: z.string().min(1, 'visits.retail.errors.item_required').max(120),
  amount: z
    .string()
    .min(1, 'visits.errors.amount_required')
    .refine((v) => Number(v.replace(',', '.')) > 0, 'visits.errors.amount_positive'),
  payment_method: z.enum(PAYMENT_OPTIONS),
  comment: z.string().max(500).optional().default(''),
})

type Props = {
  salonId: string
  currency: string
  staff: { id: string; full_name: string }[]
  onDone: () => void
}

const LAST_PAYMENT_KEY = 'finkley:last-payment'

/**
 * Простая форма для ритейла — продажа косметики, абонементов, доп.услуг.
 *
 * Записывается в `visits` с `kind='retail'`, `service_id=null`,
 * `service_name_snapshot=item_name`. Это позволяет существующим dashboard
 * RPC (top_services_by_revenue, KPI и т.п.) считать ритейл как часть
 * выручки без отдельных ветвей. На экране визитов retail-строки
 * различаются по бейджу.
 */
export function RetailSaleForm({ salonId, currency, staff, onDone }: Props) {
  const { t } = useTranslation()
  const createVisit = useCreateVisit(salonId)
  const { data: paymentMethods = [] } = usePaymentMethods(salonId)

  const today = useMemo(() => new Date(), [])
  const todayIso = useMemo(() => format(today, 'yyyy-MM-dd'), [today])
  const [showAddedAndContinue, setShowAddedAndContinue] = useState(false)

  const initialPayment =
    (typeof window !== 'undefined' &&
      (window.localStorage.getItem(LAST_PAYMENT_KEY) as PaymentOption | null)) ||
    'card'

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      sold_date: todayIso,
      staff_id: '',
      item_name: '',
      amount: '',
      payment_method: initialPayment,
      comment: '',
    },
  })

  useEffect(() => {
    form.reset({
      sold_date: todayIso,
      staff_id: '',
      item_name: '',
      amount: '',
      payment_method: initialPayment,
      comment: '',
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function submit(values: FormValues, addAnother: boolean) {
    const amountCents = Math.round(Number(values.amount.replace(',', '.')) * 100)
    const [yyyy, mm, dd] = values.sold_date.split('-').map(Number)
    const dt = new Date(today)
    if (yyyy && mm && dd) dt.setFullYear(yyyy, mm - 1, dd)

    createVisit.mutate(
      {
        salon_id: salonId,
        staff_id: values.staff_id || null,
        client_id: null,
        service_id: null,
        service_name_snapshot: values.item_name.trim(),
        visit_at: dt.toISOString(),
        amount_cents: amountCents,
        tip_cents: 0,
        discount_cents: 0,
        payment_method: values.payment_method,
        comment: values.comment || null,
        kind: 'retail',
      },
      {
        onSuccess: () => {
          window.localStorage.setItem(LAST_PAYMENT_KEY, values.payment_method)
          toast.success(t('visits.retail.toast_added'))
          if (addAnother) {
            form.reset({
              sold_date: values.sold_date,
              staff_id: values.staff_id,
              item_name: '',
              amount: '',
              payment_method: values.payment_method,
              comment: '',
            })
            setShowAddedAndContinue(true)
          } else {
            onDone()
          }
        },
        onError: (err) => {
          toast.error(t('visits.toast_error'), {
            description: err instanceof Error ? err.message : String(err),
          })
        },
      },
    )
  }

  const currencySymbol = currency === 'EUR' ? '€' : currency === 'USD' ? '$' : currency

  return (
    <>
      <form
        className="flex min-h-0 flex-col gap-4 overflow-y-auto px-5 pb-2 pt-4"
        onSubmit={form.handleSubmit((v) => submit(v, false))}
        noValidate
      >
        {/* Дата */}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="rt-date">{t('visits.form.date_label')}</Label>
          <div className="border-border bg-card flex h-12 items-center gap-2.5 rounded-md border-[1.5px] px-3.5">
            <CalendarDays className="text-muted-foreground size-[17px]" strokeWidth={1.7} />
            <input
              id="rt-date"
              type="date"
              {...form.register('sold_date')}
              className="num text-foreground h-full min-w-0 flex-1 bg-transparent text-sm font-medium outline-none"
            />
          </div>
        </div>

        {/* Название товара */}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="rt-item">{t('visits.retail.item_label')}</Label>
          <Input
            id="rt-item"
            placeholder={t('visits.retail.item_placeholder')}
            {...form.register('item_name')}
            autoFocus
          />
          {form.formState.errors.item_name ? (
            <p className="text-destructive text-xs font-medium" role="alert">
              {t(form.formState.errors.item_name.message ?? '')}
            </p>
          ) : null}
        </div>

        {/* Мастер (опционально). Radix Select требует value != "" — иначе
            падает с «Select.Item must have a value prop that is not an empty
            string». Используем sentinel `__none__` и мапим в "" в onChange. */}
        <Controller
          name="staff_id"
          control={form.control}
          render={({ field }) => (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="rt-staff">{t('visits.retail.staff_label_optional')}</Label>
              <Select
                value={field.value || '__none__'}
                onValueChange={(v) => field.onChange(v === '__none__' ? '' : v)}
              >
                <SelectTrigger id="rt-staff">
                  <SelectValue placeholder={t('visits.retail.staff_placeholder')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">{t('visits.retail.staff_none')}</SelectItem>
                  {staff.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.full_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        />

        {/* Сумма */}
        <div className="flex flex-col gap-2">
          <Label htmlFor="rt-amount">{t('visits.form.amount_label')}</Label>
          <div className="border-brand-yellow-deep bg-brand-yellow flex h-16 items-center gap-2 rounded-md border-[1.5px] px-4">
            <span className="num text-brand-navy text-3xl font-bold">{currencySymbol}</span>
            <input
              id="rt-amount"
              type="number"
              inputMode="decimal"
              step="any"
              min="0"
              placeholder="0"
              {...form.register('amount')}
              className="num text-brand-navy placeholder:text-brand-navy/30 h-full min-w-0 flex-1 bg-transparent text-3xl font-bold tracking-tight outline-none"
            />
          </div>
          {form.formState.errors.amount ? (
            <p className="text-destructive text-xs font-medium" role="alert">
              {t(form.formState.errors.amount.message ?? '')}
            </p>
          ) : null}

          <Controller
            name="payment_method"
            control={form.control}
            render={({ field }) => (
              <div className="mt-1 flex flex-wrap gap-2">
                {paymentMethods.map((m) => {
                  const active = field.value === m.code
                  return (
                    <button
                      type="button"
                      key={m.id}
                      onClick={() => field.onChange(m.code as PaymentOption)}
                      className={cn(
                        'flex h-10 min-w-0 items-center justify-center gap-1.5 rounded-full border-[1.5px] px-3 text-sm font-semibold transition-colors',
                        active
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'border-border bg-card text-foreground hover:bg-accent/50',
                      )}
                    >
                      <span className="truncate">{m.label}</span>
                    </button>
                  )
                })}
              </div>
            )}
          />
        </div>

        {/* Комментарий */}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="rt-comment">{t('visits.form.comment_label')}</Label>
          <Input
            id="rt-comment"
            placeholder={t('visits.retail.comment_placeholder')}
            {...form.register('comment')}
          />
        </div>

        {showAddedAndContinue ? (
          <p className="bg-brand-sage-soft text-brand-sage rounded-md px-3 py-2 text-xs font-medium">
            {t('visits.retail.toast_added')} ✓ {t('visits.retail.continue_hint')}
          </p>
        ) : null}
      </form>

      <div className="flex flex-col gap-2 px-5 pb-5 pt-2">
        <Button
          type="button"
          size="lg"
          onClick={form.handleSubmit((v) => submit(v, false))}
          disabled={createVisit.isPending}
        >
          {createVisit.isPending ? t('common.loading') : t('visits.retail.submit')}
        </Button>
        <button
          type="button"
          onClick={form.handleSubmit((v) => submit(v, true))}
          disabled={createVisit.isPending}
          className="text-secondary text-center text-sm font-semibold hover:underline disabled:opacity-50"
        >
          {t('visits.retail.submit_and_continue')}
        </button>
      </div>
    </>
  )
}
