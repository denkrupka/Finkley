import { zodResolver } from '@hookform/resolvers/zod'
import { format } from 'date-fns'
import { ru } from 'date-fns/locale'
import { CalendarDays } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { z } from 'zod'

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
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useCreateVisit, useDeleteVisit, useRestoreVisit } from '@/hooks/useVisits'
import { useServices } from '@/hooks/useServices'
import { useStaff } from '@/hooks/useStaff'
import { formatCurrency } from '@/lib/utils/format-currency'
import { cn } from '@/lib/utils/cn'

const PAYMENT_OPTIONS = ['cash', 'card', 'transfer'] as const
type PaymentOption = (typeof PAYMENT_OPTIONS)[number]

const STAFF_PALETTE = ['#F4D7C5', '#D7E4C5', '#C5DAE4', '#E4C5DC', '#E8C4B8', '#FBE5C0']

const LAST_PAYMENT_KEY = 'finkley:last-payment'
const LAST_STAFF_KEY = 'finkley:last-staff'

type FormValues = {
  staff_id: string
  service_id: string
  amount: string // string в input, потом парсим
  payment_method: PaymentOption
  comment: string
}

const schema = z.object({
  staff_id: z.string().min(1, 'visits.errors.staff_required'),
  service_id: z.string().optional().default(''),
  amount: z
    .string()
    .min(1, 'visits.errors.amount_required')
    .refine((v) => Number(v.replace(',', '.')) > 0, 'visits.errors.amount_positive'),
  payment_method: z.enum(PAYMENT_OPTIONS),
  comment: z.string().max(500).optional().default(''),
})

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  salonId: string
  currency: string
}

export function QuickEntryModal({ open, onOpenChange, salonId, currency }: Props) {
  const { t } = useTranslation()
  const { data: staff = [] } = useStaff(salonId)
  const { data: services = [] } = useServices(salonId)
  const createVisit = useCreateVisit(salonId)
  const deleteVisit = useDeleteVisit(salonId)
  const restoreVisit = useRestoreVisit(salonId)

  const today = useMemo(() => new Date(), [])
  const [showAddedAndContinue, setShowAddedAndContinue] = useState(false)

  const initialPayment =
    (typeof window !== 'undefined' &&
      (window.localStorage.getItem(LAST_PAYMENT_KEY) as PaymentOption | null)) ||
    'card'
  const initialStaff =
    (typeof window !== 'undefined' && window.localStorage.getItem(LAST_STAFF_KEY)) || ''

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      staff_id: '',
      service_id: '',
      amount: '',
      payment_method: initialPayment,
      comment: '',
    },
  })

  // При открытии — выставляем дефолтного мастера и сбрасываем форму
  useEffect(() => {
    if (!open) return
    const lastStaffValid = staff.some((s) => s.id === initialStaff)
    form.reset({
      staff_id: lastStaffValid ? initialStaff : (staff[0]?.id ?? ''),
      service_id: '',
      amount: '',
      payment_method: initialPayment,
      comment: '',
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- одноразовый ресет на open
  }, [open])

  // При выборе услуги — подкидываем default цену в amount, если пусто
  const watchedServiceId = form.watch('service_id')
  const watchedStaffId = form.watch('staff_id')
  useEffect(() => {
    if (!watchedServiceId) return
    const svc = services.find((s) => s.id === watchedServiceId)
    if (svc && !form.getValues('amount')) {
      form.setValue('amount', String(Math.round(svc.default_price_cents / 100)))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watchedServiceId])

  function onSubmit(values: FormValues, addAnother = false) {
    const amountCents = Math.round(Number(values.amount.replace(',', '.')) * 100)
    const svc = services.find((s) => s.id === values.service_id)
    const stf = staff.find((s) => s.id === values.staff_id)
    const visitAt = today.toISOString()

    createVisit.mutate(
      {
        salon_id: salonId,
        staff_id: values.staff_id || null,
        service_id: values.service_id || null,
        service_name_snapshot: svc?.name ?? null,
        visit_at: visitAt,
        amount_cents: amountCents,
        payment_method: values.payment_method,
        comment: values.comment || null,
      },
      {
        onSuccess: (created) => {
          window.localStorage.setItem(LAST_PAYMENT_KEY, values.payment_method)
          if (values.staff_id) window.localStorage.setItem(LAST_STAFF_KEY, values.staff_id)
          toast.success(t('visits.toast_added'), {
            description: `${stf?.full_name ?? ''} · ${formatCurrency(amountCents, currency)}`,
            action: {
              label: t('visits.toast_undo'),
              onClick: () => {
                deleteVisit.mutate(created.id, {
                  onSuccess: () => {
                    toast(t('visits.toast_undone'), {
                      action: {
                        label: t('visits.toast_restore'),
                        onClick: () => restoreVisit.mutate(created.id),
                      },
                    })
                  },
                })
              },
            },
          })
          if (addAnother) {
            // оставляем staff/payment, очищаем service/amount/comment
            form.reset({
              staff_id: values.staff_id,
              service_id: '',
              amount: '',
              payment_method: values.payment_method,
              comment: '',
            })
            setShowAddedAndContinue(true)
          } else {
            onOpenChange(false)
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

  const todayLabel =
    format(today, 'd MMMM yyyy, EEEE', { locale: ru }).charAt(0).toUpperCase() +
    format(today, 'd MMMM yyyy, EEEE', { locale: ru }).slice(1)

  // Цвет аватара выбранного мастера
  const selectedStaffIndex = staff.findIndex((s) => s.id === watchedStaffId)
  const selectedStaffColor =
    selectedStaffIndex >= 0 ? STAFF_PALETTE[selectedStaffIndex % STAFF_PALETTE.length]! : '#E8E5DF'
  const selectedStaffInitial =
    staff
      .find((s) => s.id === watchedStaffId)
      ?.full_name.charAt(0)
      .toUpperCase() ?? '?'

  const currencySymbol = currency === 'EUR' ? '€' : currency === 'USD' ? '$' : currency

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('visits.form.title_new')}</DialogTitle>
          <DialogDescription>{t('visits.form.subtitle')}</DialogDescription>
        </DialogHeader>

        <form
          className="flex flex-col gap-4 px-5 pb-2 pt-4"
          onSubmit={form.handleSubmit((v) => onSubmit(v, false))}
          noValidate
        >
          {/* Дата */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="qe-date">{t('visits.form.date_label')}</Label>
            <div className="border-border bg-card flex h-12 items-center gap-2.5 rounded-md border-[1.5px] px-3.5">
              <CalendarDays className="text-muted-foreground size-[17px]" strokeWidth={1.7} />
              <span id="qe-date" className="num text-sm font-medium">
                {todayLabel}
              </span>
              <span className="bg-brand-sage-soft text-brand-sage ml-auto rounded-full px-2 py-0.5 text-[11px] font-bold">
                {t('visits.form.today_pill')}
              </span>
            </div>
          </div>

          {/* Мастер */}
          <Controller
            name="staff_id"
            control={form.control}
            render={({ field }) => (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="qe-staff">{t('visits.form.staff_label')}</Label>
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger id="qe-staff" data-testid="qe-staff">
                    <span className="flex items-center gap-2.5">
                      <span
                        className="text-brand-navy grid size-7 place-items-center rounded-full text-xs font-bold"
                        style={{ background: selectedStaffColor }}
                      >
                        {selectedStaffInitial}
                      </span>
                      <SelectValue placeholder={t('visits.form.staff_placeholder')} />
                    </span>
                  </SelectTrigger>
                  <SelectContent>
                    {staff.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.full_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {form.formState.errors.staff_id ? (
                  <p className="text-destructive text-xs font-medium" role="alert">
                    {t(form.formState.errors.staff_id.message ?? '')}
                  </p>
                ) : null}
              </div>
            )}
          />

          {/* Услуга (Select; полноценный typeahead — позже) */}
          <Controller
            name="service_id"
            control={form.control}
            render={({ field }) => (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="qe-service">{t('visits.form.service_label')}</Label>
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger id="qe-service" data-testid="qe-service">
                    <SelectValue placeholder={t('visits.form.service_placeholder')} />
                  </SelectTrigger>
                  <SelectContent>
                    {services.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        <span className="flex w-full items-center justify-between gap-3">
                          <span>{s.name}</span>
                          <span className="num text-muted-foreground text-xs">
                            ≈ {formatCurrency(s.default_price_cents, currency)}
                          </span>
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          />

          {/* Сумма (yellow mono input) */}
          <div className="flex flex-col gap-2">
            <Label htmlFor="qe-amount">{t('visits.form.amount_label')}</Label>
            <div className="border-brand-yellow-deep bg-brand-yellow flex h-16 items-center gap-2 rounded-md border-[1.5px] px-4">
              <span className="num text-brand-navy text-3xl font-bold">{currencySymbol}</span>
              <input
                id="qe-amount"
                type="number"
                inputMode="decimal"
                step="any"
                min="0"
                placeholder="0"
                {...form.register('amount')}
                className="num text-brand-navy placeholder:text-brand-navy/30 h-full flex-1 bg-transparent text-3xl font-bold tracking-tight outline-none"
                data-testid="qe-amount"
              />
            </div>
            {form.formState.errors.amount ? (
              <p className="text-destructive text-xs font-medium" role="alert">
                {t(form.formState.errors.amount.message ?? '')}
              </p>
            ) : null}

            {/* Payment pills под суммой */}
            <Controller
              name="payment_method"
              control={form.control}
              render={({ field }) => (
                <div className="mt-1 flex gap-2" data-testid="qe-payment">
                  {PAYMENT_OPTIONS.map((p) => {
                    const active = field.value === p
                    return (
                      <button
                        type="button"
                        key={p}
                        onClick={() => field.onChange(p)}
                        className={cn(
                          'flex h-10 flex-1 items-center justify-center gap-1.5 rounded-full border-[1.5px] text-sm font-semibold transition-colors',
                          active
                            ? 'border-primary bg-primary text-primary-foreground'
                            : 'border-border bg-card text-foreground hover:bg-accent/50',
                        )}
                      >
                        {t(`payment_methods.${p}`)}
                      </button>
                    )
                  })}
                </div>
              )}
            />
          </div>

          {/* Комментарий */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="qe-comment">{t('visits.form.comment_label')}</Label>
            <Input
              id="qe-comment"
              placeholder={t('visits.form.comment_placeholder')}
              {...form.register('comment')}
            />
          </div>

          {showAddedAndContinue ? (
            <p className="bg-brand-sage-soft text-brand-sage rounded-md px-3 py-2 text-xs font-medium">
              {t('visits.toast_added')} ✓ {t('visits.form.continue_hint')}
            </p>
          ) : null}
        </form>

        <DialogFooter>
          <Button
            type="button"
            size="lg"
            onClick={form.handleSubmit((v) => onSubmit(v, false))}
            disabled={createVisit.isPending}
            data-testid="qe-submit"
          >
            {createVisit.isPending ? t('common.loading') : t('visits.form.submit')}
          </Button>
          <button
            type="button"
            onClick={form.handleSubmit((v) => onSubmit(v, true))}
            disabled={createVisit.isPending}
            className="text-secondary text-center text-sm font-semibold hover:underline disabled:opacity-50"
          >
            {t('visits.form.submit_and_continue')}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
