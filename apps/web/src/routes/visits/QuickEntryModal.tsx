import { zodResolver } from '@hookform/resolvers/zod'
import { format } from 'date-fns'
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
import { useCreateBooksyReservation } from '@/hooks/useBooksyReservation'
import { useSalonIntegrations } from '@/hooks/useIntegrations'
import { useCreateVisit, useDeleteVisit, useRestoreVisit } from '@/hooks/useVisits'
import { useServices } from '@/hooks/useServices'
import { useStaff } from '@/hooks/useStaff'
import { formatCurrency } from '@/lib/utils/format-currency'
import { cn } from '@/lib/utils/cn'
import { ClientPicker } from '@/routes/clients/ClientPicker'

import { BulkVisitsForm } from './BulkVisitsForm'

const PAYMENT_OPTIONS = ['cash', 'card', 'transfer'] as const
type PaymentOption = (typeof PAYMENT_OPTIONS)[number]

const STAFF_PALETTE = ['#F4D7C5', '#D7E4C5', '#C5DAE4', '#E4C5DC', '#E8C4B8', '#FBE5C0']

const LAST_PAYMENT_KEY = 'finkley:last-payment'
const LAST_STAFF_KEY = 'finkley:last-staff'

type FormValues = {
  visit_date: string // YYYY-MM-DD из <input type="date">
  staff_id: string
  client_id: string | null
  service_id: string
  amount: string // string в input, потом парсим
  tip: string
  discount: string
  payment_method: PaymentOption
  comment: string
}

const schema = z.object({
  visit_date: z.string().min(1, 'visits.errors.date_required'),
  staff_id: z.string().min(1, 'visits.errors.staff_required'),
  client_id: z.string().nullable().optional().default(null),
  service_id: z.string().optional().default(''),
  amount: z
    .string()
    .min(1, 'visits.errors.amount_required')
    .refine((v) => Number(v.replace(',', '.')) > 0, 'visits.errors.amount_positive'),
  tip: z
    .string()
    .optional()
    .default('')
    .refine((v) => v === '' || Number(v.replace(',', '.')) >= 0, 'visits.errors.tip_negative'),
  discount: z
    .string()
    .optional()
    .default('')
    .refine((v) => v === '' || Number(v.replace(',', '.')) >= 0, 'visits.errors.discount_negative'),
  payment_method: z.enum(PAYMENT_OPTIONS),
  comment: z.string().max(500).optional().default(''),
})

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  salonId: string
  currency: string
  /**
   * Префилл из календаря: клик по 15-мин субслоту → подставляем мастера
   * и дату. Время визита берётся из `prefill.when` (ISO), мастер — `prefill.staffId`.
   */
  prefill?: { staffId: string; when: string } | null
}

export function QuickEntryModal({ open, onOpenChange, salonId, currency, prefill }: Props) {
  const { t } = useTranslation()
  const { data: staff = [] } = useStaff(salonId)
  const { data: services = [] } = useServices(salonId)
  const { data: integrations = [] } = useSalonIntegrations(salonId)
  const createVisit = useCreateVisit(salonId)
  const deleteVisit = useDeleteVisit(salonId)
  const reserveBooksy = useCreateBooksyReservation()
  const restoreVisit = useRestoreVisit(salonId)

  const today = useMemo(() => new Date(), [])
  const todayIso = useMemo(() => format(today, 'yyyy-MM-dd'), [today])
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
      visit_date: todayIso,
      staff_id: '',
      client_id: null,
      service_id: '',
      amount: '',
      tip: '',
      discount: '',
      payment_method: initialPayment,
      comment: '',
    },
  })

  // При открытии — выставляем дефолтного мастера и сбрасываем форму.
  // Если задан prefill (из календаря) — staff/date берутся из него.
  useEffect(() => {
    if (!open) return
    const lastStaffValid = staff.some((s) => s.id === initialStaff)
    const prefillDate = prefill ? format(new Date(prefill.when), 'yyyy-MM-dd') : todayIso
    const prefillStaff =
      prefill && staff.some((s) => s.id === prefill.staffId)
        ? prefill.staffId
        : lastStaffValid
          ? initialStaff
          : (staff[0]?.id ?? '')
    form.reset({
      visit_date: prefillDate,
      staff_id: prefillStaff,
      client_id: null,
      service_id: '',
      amount: '',
      tip: '',
      discount: '',
      payment_method: initialPayment,
      comment: '',
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- одноразовый ресет на open / prefill
  }, [open, prefill?.staffId, prefill?.when])

  // Если staff подгрузился ПОСЛЕ открытия модалки (быстрый клик на FAB),
  // ловим это и выставляем дефолт. Иначе форма требует «Выбери мастера»
  // и юзер не понимает почему — мастер же есть.
  useEffect(() => {
    if (!open) return
    if (!form.getValues('staff_id') && staff.length > 0) {
      const lastStaffValid = staff.some((s) => s.id === initialStaff)
      form.setValue('staff_id', lastStaffValid ? initialStaff : staff[0]!.id, {
        shouldValidate: false,
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, staff])

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
    const tipCents = values.tip ? Math.round(Number(values.tip.replace(',', '.')) * 100) : 0
    const discountCents = values.discount
      ? Math.round(Number(values.discount.replace(',', '.')) * 100)
      : 0
    const svc = services.find((s) => s.id === values.service_id)
    const stf = staff.find((s) => s.id === values.staff_id)
    // Если есть prefill из календаря — берём время из subslot'а (HH:mm).
    // Иначе: дата из формы + текущее время (порядок визитов естественный).
    const [yyyy, mm, dd] = values.visit_date.split('-').map(Number)
    const visitDate = prefill ? new Date(prefill.when) : new Date(today)
    if (yyyy && mm && dd && !prefill) visitDate.setFullYear(yyyy, mm - 1, dd)
    const visitAt = visitDate.toISOString()

    createVisit.mutate(
      {
        salon_id: salonId,
        staff_id: values.staff_id || null,
        client_id: values.client_id || null,
        service_id: values.service_id || null,
        service_name_snapshot: svc?.name ?? null,
        visit_at: visitAt,
        amount_cents: amountCents,
        tip_cents: tipCents,
        discount_cents: discountCents,
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
          // Booksy reverse-sync: блокируем слот в Booksy чтобы клиент не
          // мог забукать одно и то же время онлайн. Silent fire-and-forget —
          // если Booksy не подключён, у мастера нет external_id или вызов
          // упал, визит в Finkley всё равно сохранён.
          //
          // На retail-продажах reservation не нужен (нет времени визита).
          // Пока что reservation_id не сохраняется в БД — если визит
          // отменят в Finkley, блок останется в Booksy и юзер удалит
          // вручную. Полная двусторонняя синхронизация — отдельный TASK
          // когда добавим visits.metadata jsonb.
          const booksyConnected = integrations.some(
            (i) => i.provider === 'booksy' && i.status === 'connected',
          )
          const stfExternal =
            stf?.external_source === 'booksy' && stf.external_id ? stf.external_id : null
          if (
            booksyConnected &&
            stfExternal &&
            svc?.default_duration_min &&
            svc.default_duration_min > 0
          ) {
            const startAt = new Date(visitAt)
            const endAt = new Date(startAt.getTime() + svc.default_duration_min * 60000)
            reserveBooksy.mutate({
              salonId,
              staffIdExternal: stfExternal,
              startAt: startAt.toISOString(),
              endAt: endAt.toISOString(),
              title: svc.name ?? 'Visit',
            })
          }

          if (addAnother) {
            // оставляем staff/payment/date, очищаем service/amount/tip/discount/comment/client
            form.reset({
              visit_date: values.visit_date,
              staff_id: values.staff_id,
              client_id: null,
              service_id: '',
              amount: '',
              tip: '',
              discount: '',
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
  // «Продажа» убрана из QuickEntryModal по решению owner (2026-05-12) —
  // продажи теперь живут на отдельной странице /income → Sales.
  const [tab, setTab] = useState<'single' | 'bulk'>('single')
  useEffect(() => {
    if (open) setTab('single')
  }, [open])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:!max-w-[640px]">
        <DialogHeader>
          <DialogTitle>{t('visits.form.title_new')}</DialogTitle>
          <DialogDescription>{t('visits.form.subtitle')}</DialogDescription>
          <div className="border-border bg-muted/40 mt-2 inline-flex w-full rounded-full border p-[3px]">
            {(['single', 'bulk'] as const).map((id) => (
              <button
                key={id}
                type="button"
                onClick={() => setTab(id)}
                className={cn(
                  'flex-1 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors',
                  tab === id
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {t(`visits.tabs.${id}`)}
              </button>
            ))}
          </div>
        </DialogHeader>

        {tab === 'bulk' ? (
          <BulkVisitsForm
            salonId={salonId}
            currency={currency}
            onDone={() => onOpenChange(false)}
          />
        ) : (
          <form
            className="flex min-h-0 flex-col gap-2.5 px-5 pb-2 pt-2"
            onSubmit={form.handleSubmit((v) => onSubmit(v, false))}
            noValidate
          >
            {/* Дата + Мастер в одной строке для компактности */}
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="qe-date">{t('visits.form.date_label')}</Label>
                <div className="border-border bg-card flex h-11 items-center gap-2 rounded-md border-[1.5px] px-3">
                  <CalendarDays className="text-muted-foreground size-[17px]" strokeWidth={1.7} />
                  <input
                    id="qe-date"
                    type="date"
                    data-testid="qe-date"
                    {...form.register('visit_date')}
                    className="num text-foreground h-full min-w-0 flex-1 bg-transparent text-sm font-medium outline-none"
                  />
                  {form.watch('visit_date') === todayIso ? (
                    <span className="bg-brand-sage-soft text-brand-sage rounded-full px-2 py-0.5 text-[11px] font-bold">
                      {t('visits.form.today_pill')}
                    </span>
                  ) : null}
                </div>
                {form.formState.errors.visit_date ? (
                  <p className="text-destructive text-xs font-medium" role="alert">
                    {t(form.formState.errors.visit_date.message ?? '')}
                  </p>
                ) : null}
              </div>

              <Controller
                name="staff_id"
                control={form.control}
                render={({ field }) => (
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="qe-staff">{t('visits.form.staff_label')}</Label>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger id="qe-staff" data-testid="qe-staff" className="h-11">
                        <span className="flex items-center gap-2">
                          <span
                            className="text-brand-navy grid size-6 place-items-center rounded-full text-[10px] font-bold"
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
            </div>

            {/* Клиент + Услуга в одной строке */}
            <div className="grid grid-cols-2 gap-3">
              <Controller
                name="client_id"
                control={form.control}
                render={({ field }) => (
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="qe-client">{t('visits.form.client_label')}</Label>
                    <ClientPicker
                      salonId={salonId}
                      value={field.value}
                      onChange={field.onChange}
                      placeholder={t('clients.picker.no_client')}
                      testId="qe-client"
                    />
                  </div>
                )}
              />

              <Controller
                name="service_id"
                control={form.control}
                render={({ field }) => (
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="qe-service">{t('visits.form.service_label')}</Label>
                    <Select
                      value={field.value}
                      onValueChange={field.onChange}
                      disabled={services.length === 0}
                    >
                      <SelectTrigger id="qe-service" data-testid="qe-service">
                        <SelectValue
                          placeholder={
                            services.length === 0
                              ? t('visits.form.service_empty')
                              : t('visits.form.service_placeholder')
                          }
                        />
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
                    {services.length === 0 ? (
                      <p className="text-muted-foreground text-xs">
                        {t('visits.form.service_empty_hint')}{' '}
                        <a
                          href={`/salon/${salonId}/services`}
                          className="text-primary font-semibold hover:underline"
                        >
                          {t('visits.form.service_empty_link')}
                        </a>
                      </p>
                    ) : null}
                  </div>
                )}
              />
            </div>

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
                  className="num text-brand-navy placeholder:text-brand-navy/30 h-full min-w-0 flex-1 bg-transparent text-3xl font-bold tracking-tight outline-none"
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
                  <div className="mt-1 grid grid-cols-3 gap-2" data-testid="qe-payment">
                    {PAYMENT_OPTIONS.map((p) => {
                      const active = field.value === p
                      return (
                        <button
                          type="button"
                          key={p}
                          onClick={() => field.onChange(p)}
                          className={cn(
                            'flex h-10 min-w-0 items-center justify-center gap-1.5 rounded-full border-[1.5px] px-2 text-sm font-semibold transition-colors',
                            active
                              ? 'border-primary bg-primary text-primary-foreground'
                              : 'border-border bg-card text-foreground hover:bg-accent/50',
                          )}
                        >
                          <span className="truncate">{t(`payment_methods.${p}`)}</span>
                        </button>
                      )
                    })}
                  </div>
                )}
              />
            </div>

            {/* Чаевые + скидка (опциональные) */}
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="qe-tip">{t('visits.form.tip_label')}</Label>
                <div className="border-border bg-card flex h-12 items-center gap-2 rounded-md border-[1.5px] px-3.5">
                  <span className="num text-muted-foreground text-sm">+{currencySymbol}</span>
                  <input
                    id="qe-tip"
                    type="number"
                    inputMode="decimal"
                    step="any"
                    min="0"
                    placeholder="0"
                    {...form.register('tip')}
                    className="num text-foreground placeholder:text-muted-foreground/50 h-full min-w-0 flex-1 bg-transparent text-base font-semibold outline-none"
                    data-testid="qe-tip"
                  />
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="qe-discount">{t('visits.form.discount_label')}</Label>
                <div className="border-border bg-card flex h-12 items-center gap-2 rounded-md border-[1.5px] px-3.5">
                  <span className="num text-muted-foreground text-sm">−{currencySymbol}</span>
                  <input
                    id="qe-discount"
                    type="number"
                    inputMode="decimal"
                    step="any"
                    min="0"
                    placeholder="0"
                    {...form.register('discount')}
                    className="num text-foreground placeholder:text-muted-foreground/50 h-full min-w-0 flex-1 bg-transparent text-base font-semibold outline-none"
                    data-testid="qe-discount"
                  />
                </div>
              </div>
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
        )}

        {tab === 'single' ? (
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
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
