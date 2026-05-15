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
import { SearchableSelect } from '@/components/ui/SearchableSelect'
import { supabase } from '@/lib/supabase/client'
import { useCreateBooksyReservation } from '@/hooks/useBooksyReservation'
import { useSalonIntegrations } from '@/hooks/useIntegrations'
import { usePaymentMethods } from '@/hooks/usePaymentMethods'
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
  start_time: string // HH:MM
  end_time: string // HH:MM
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
  start_time: z.string().min(1, 'visits.errors.start_time_required'),
  end_time: z.string().min(1, 'visits.errors.end_time_required'),
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
   * и дату. Время визита берётся из `prefill.when` (ISO), мастер —
   * `prefill.staffId`. Если есть `prefill.endAt` (drag-select на нескольких
   * слотах), используем его как time_end.
   */
  prefill?: { staffId: string; when: string; clientId?: string; endAt?: string } | null
}

export function QuickEntryModal({ open, onOpenChange, salonId, currency, prefill }: Props) {
  const { t } = useTranslation()
  const { data: staff = [] } = useStaff(salonId)
  const { data: services = [] } = useServices(salonId)
  const { data: paymentMethods = [] } = usePaymentMethods(salonId)
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
      start_time: '10:00',
      end_time: '11:00',
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
  // Если задан prefill (из календаря) — staff/date/start_time/end_time
  // берутся из него.
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
    const prefillStart = prefill ? format(new Date(prefill.when), 'HH:mm') : '10:00'
    const prefillEnd = prefill?.endAt
      ? format(new Date(prefill.endAt), 'HH:mm')
      : // если endAt не задан — start + 60 мин default
        format(
          new Date(new Date(prefill?.when ?? `${todayIso}T10:00`).getTime() + 60 * 60_000),
          'HH:mm',
        )
    form.reset({
      visit_date: prefillDate,
      start_time: prefillStart,
      end_time: prefillEnd,
      staff_id: prefillStaff,
      client_id: prefill?.clientId ?? null,
      service_id: '',
      amount: '',
      tip: '',
      discount: '',
      payment_method: initialPayment,
      comment: '',
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- одноразовый ресет на open / prefill
  }, [open, prefill?.staffId, prefill?.when, prefill?.endAt, prefill?.clientId])

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

  // При выборе услуги — подкидываем default цену в amount, если пусто,
  // и end_time = start_time + service.default_duration_min (всегда
  // пересчитываем — длительность услуги важнее ручного значения).
  const watchedServiceId = form.watch('service_id')
  const watchedStaffId = form.watch('staff_id')
  const watchedStartTime = form.watch('start_time')
  useEffect(() => {
    if (!watchedServiceId) return
    const svc = services.find((s) => s.id === watchedServiceId)
    if (!svc) return
    if (!form.getValues('amount')) {
      form.setValue('amount', String(Math.round(svc.default_price_cents / 100)))
    }
    const dur = svc.default_duration_min ?? 60
    const start = form.getValues('start_time') || '10:00'
    const [hh, mm] = start.split(':').map(Number)
    if (Number.isFinite(hh) && Number.isFinite(mm)) {
      const total = hh! * 60 + mm! + dur
      const endHh = Math.floor((total / 60) % 24)
      const endMm = total % 60
      form.setValue(
        'end_time',
        `${String(endHh).padStart(2, '0')}:${String(endMm).padStart(2, '0')}`,
        { shouldValidate: false },
      )
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watchedServiceId, watchedStartTime])

  async function onSubmit(values: FormValues, addAnother = false) {
    const amountCents = Math.round(Number(values.amount.replace(',', '.')) * 100)
    const tipCents = values.tip ? Math.round(Number(values.tip.replace(',', '.')) * 100) : 0
    const discountCents = values.discount
      ? Math.round(Number(values.discount.replace(',', '.')) * 100)
      : 0
    const svc = services.find((s) => s.id === values.service_id)
    const stf = staff.find((s) => s.id === values.staff_id)
    // Время визита = visit_date + start_time. Дата всегда локальная (юзер
    // выбрал в форме); парсим как локальное время, чтобы совпадало с тем,
    // что человек ввёл, независимо от таймзоны браузера.
    const [yyyy, mm, dd] = values.visit_date.split('-').map(Number)
    const [sh, sm] = values.start_time.split(':').map(Number)
    const visitDate = new Date(yyyy ?? 1970, (mm ?? 1) - 1, dd ?? 1, sh ?? 0, sm ?? 0, 0, 0)
    const visitAt = visitDate.toISOString()
    // Длительность визита — из формы (end_time - start_time), а если поля
    // пустые/нелогичные, фоллбек на service.default_duration_min.
    const [eh, em] = values.end_time.split(':').map(Number)
    const formDur =
      Number.isFinite(sh) && Number.isFinite(eh) ? eh! * 60 + (em ?? 0) - (sh! * 60 + (sm ?? 0)) : 0

    // Conflict-detection: проверяем что у мастера в это время нет другого
    // визита. Считаем перекрытие как [start, start+dur) ∩ [exist, exist+dur).
    const newDurationMin = formDur > 0 ? formDur : (svc?.default_duration_min ?? 60)
    const newStartMs = visitDate.getTime()
    const newEndMs = newStartMs + newDurationMin * 60_000
    if (values.staff_id) {
      const dayStart = new Date(visitDate)
      dayStart.setHours(0, 0, 0, 0)
      const dayEnd = new Date(dayStart)
      dayEnd.setDate(dayEnd.getDate() + 1)
      const { data: sameDayVisits } = await supabase
        .from('visits')
        .select('id, visit_at, service_id, service_name_snapshot, payment_method, status')
        .eq('salon_id', salonId)
        .eq('staff_id', values.staff_id)
        .gte('visit_at', dayStart.toISOString())
        .lt('visit_at', dayEnd.toISOString())
      const conflict = (sameDayVisits ?? []).find(
        (v: { visit_at: string; service_id: string | null }) => {
          const existStart = new Date(v.visit_at).getTime()
          const existSvc = v.service_id ? services.find((s) => s.id === v.service_id) : null
          const existDur = (existSvc?.default_duration_min ?? 60) * 60_000
          const existEnd = existStart + existDur
          return existStart < newEndMs && existEnd > newStartMs
        },
      )
      if (conflict) {
        const c = conflict as {
          id: string
          visit_at: string
          service_id: string | null
          service_name_snapshot: string | null
        }
        const conflictTime = new Date(c.visit_at).toLocaleTimeString('ru-RU', {
          hour: '2-digit',
          minute: '2-digit',
        })
        const conflictSvc = c.service_id
          ? (services.find((s) => s.id === c.service_id)?.name ?? c.service_name_snapshot ?? '—')
          : (c.service_name_snapshot ?? '—')
        const ok = window.confirm(
          t('visits.errors.conflict', {
            time: conflictTime,
            service: conflictSvc,
          }),
        )
        if (!ok) return
      }
    }

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
        // Booksy-style: новый визит создаётся со статусом 'pending'
        // (ждёт оплаты). После нажатия «Рассчитать» в detail-модалке статус
        // меняется на 'paid' (см. EditVisitModal/charge-flow).
        status: 'pending',
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
            // оставляем staff/payment/date, очищаем service/amount/tip/discount/comment/client.
            // Время — сдвигаем на длительность только что добавленного визита,
            // чтобы следующий визит цеплялся встык. Удобно для бэк-ту-бэк
            // записей в один и тот же день.
            const nextStartMs = newStartMs + newDurationMin * 60_000
            const nextStart = new Date(nextStartMs)
            const nextEnd = new Date(nextStartMs + (svc?.default_duration_min ?? 60) * 60_000)
            form.reset({
              visit_date: values.visit_date,
              start_time: format(nextStart, 'HH:mm'),
              end_time: format(nextEnd, 'HH:mm'),
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
      <DialogContent className="sm:!w-[640px] sm:!max-w-[640px]">
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
            {/* Дата + Начало + Конец в одной строке. Время выставляется
                автоматически (drag-select на календаре или вручную); end
                пересчитывается при выборе услуги. */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto_auto]">
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

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="qe-start-time">{t('visits.form.start_time_label')}</Label>
                <input
                  id="qe-start-time"
                  type="time"
                  data-testid="qe-start-time"
                  {...form.register('start_time')}
                  className="num text-foreground border-border bg-card h-11 w-[110px] rounded-md border-[1.5px] px-3 text-sm font-medium outline-none"
                />
                {form.formState.errors.start_time ? (
                  <p className="text-destructive text-xs font-medium" role="alert">
                    {t(form.formState.errors.start_time.message ?? '')}
                  </p>
                ) : null}
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="qe-end-time">{t('visits.form.end_time_label')}</Label>
                <input
                  id="qe-end-time"
                  type="time"
                  data-testid="qe-end-time"
                  {...form.register('end_time')}
                  className="num text-foreground border-border bg-card h-11 w-[110px] rounded-md border-[1.5px] px-3 text-sm font-medium outline-none"
                />
                {form.formState.errors.end_time ? (
                  <p className="text-destructive text-xs font-medium" role="alert">
                    {t(form.formState.errors.end_time.message ?? '')}
                  </p>
                ) : null}
              </div>
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

            {/* Клиент + Услуга в одной строке */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
                    {/* Searchable select — у владельца много услуг (десятки),
                        обычный Select требует скроллить. Поиск по name. */}
                    <SearchableSelect
                      value={field.value}
                      onChange={field.onChange}
                      disabled={services.length === 0}
                      options={services.map((s) => ({
                        value: s.id,
                        label: s.name,
                        hint: `≈ ${formatCurrency(s.default_price_cents, currency)}`,
                      }))}
                      placeholder={
                        services.length === 0
                          ? t('visits.form.service_empty')
                          : t('visits.form.service_placeholder')
                      }
                      searchPlaceholder={t('visits.filters.search_services')}
                      emptyText={t('common.no_results')}
                      ariaLabel={t('visits.form.service_label')}
                    />
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

              {/* Payment pills под суммой — из справочника payment_methods.
                  Архивные не показываем. */}
              <Controller
                name="payment_method"
                control={form.control}
                render={({ field }) => (
                  <div className="mt-1 flex flex-wrap gap-2" data-testid="qe-payment">
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

            {/* Чаевые + скидка (опциональные) */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
