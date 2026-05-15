import { zodResolver } from '@hookform/resolvers/zod'
import { format } from 'date-fns'
import { CalendarDays, Plus, Trash2 } from 'lucide-react'
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
import { useCreateVisit, useDeleteVisit, useRestoreVisit } from '@/hooks/useVisits'
import { useServices } from '@/hooks/useServices'
import { useStaff } from '@/hooks/useStaff'
import { formatCurrency } from '@/lib/utils/format-currency'
import { cn } from '@/lib/utils/cn'
import { ClientPicker } from '@/routes/clients/ClientPicker'

const STAFF_PALETTE = ['#F4D7C5', '#D7E4C5', '#C5DAE4', '#E4C5DC', '#E8C4B8', '#FBE5C0']

const LAST_STAFF_KEY = 'finkley:last-staff'
const LAST_PAYMENT_KEY = 'finkley:last-payment'

type ServiceLine = {
  /** Локальный uuid для key/remove — не путать с service_id из БД. */
  uid: string
  service_id: string
  name: string
  price_cents: number
  duration_min: number | null
}

type FormValues = {
  visit_date: string // YYYY-MM-DD
  start_time: string // HH:MM
  end_time: string // HH:MM
  staff_id: string
  client_id: string | null
  tip: string
  discount: string
  comment: string
}

const schema = z.object({
  visit_date: z.string().min(1, 'visits.errors.date_required'),
  start_time: z.string().min(1, 'visits.errors.start_time_required'),
  end_time: z.string().min(1, 'visits.errors.end_time_required'),
  staff_id: z.string().min(1, 'visits.errors.staff_required'),
  // Клиент — обязательное поле по новому ТЗ (раньше можно было «без клиента»).
  client_id: z
    .string()
    .nullable()
    .refine((v) => !!v && v.length > 0, 'visits.errors.client_required'),
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
  comment: z.string().max(500).optional().default(''),
})

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  salonId: string
  currency: string
  /**
   * Префилл из календаря: subslot/drag-select задаёт staff/date/time.
   * `endAt` (опционально) — если drag-select захватил диапазон, то это
   * желаемое время конца; используем как fallback пока юзер не выбрал услуги.
   */
  prefill?: { staffId: string; when: string; clientId?: string; endAt?: string } | null
}

/**
 * QuickEntryModal — единственная форма записи визита (раньше было два таба:
 * «один визит» и «несколько визитов»; bulk-форма удалена по запросу владельца,
 * см. image #66).
 *
 * Особенности:
 *   - Услуги выбираются СПИСКОМ: одна-несколько штук; сумма автосчитается,
 *     end_time = start_time + Σ durations. Если выбрано >1 услуги, на submit
 *     создаются N visits, связанные общим group_key (как retail-wizard).
 *   - Все поля обязательны кроме комментария. Tip/discount могут быть пустыми
 *     (приравниваются к нулю), но не отрицательными.
 *   - Метод оплаты ЗДЕСЬ не спрашиваем — это создаёт визит со статусом
 *     `pending`. Реальный payment_method выбирается в карточке визита при
 *     нажатии «Рассчитать» (см. VisitDetailModal → ChargeView).
 */
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

  const initialStaff =
    (typeof window !== 'undefined' && window.localStorage.getItem(LAST_STAFF_KEY)) || ''

  const [lines, setLines] = useState<ServiceLine[]>([])
  const [pendingServiceId, setPendingServiceId] = useState<string>('')
  /**
   * Отдельный флаг для подсветки пустого списка услуг под форму.
   * react-hook-form не валидирует `lines`, держим вне формы.
   */
  const [linesTouched, setLinesTouched] = useState(false)

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      visit_date: todayIso,
      start_time: '10:00',
      end_time: '11:00',
      staff_id: '',
      client_id: null,
      tip: '',
      discount: '',
      comment: '',
    },
  })

  // Префилл при открытии: дата/время/мастер/клиент из календаря (drag-select).
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
      : format(
          new Date(new Date(prefill?.when ?? `${todayIso}T10:00`).getTime() + 60 * 60_000),
          'HH:mm',
        )
    form.reset({
      visit_date: prefillDate,
      start_time: prefillStart,
      end_time: prefillEnd,
      staff_id: prefillStaff,
      client_id: prefill?.clientId ?? null,
      tip: '',
      discount: '',
      comment: '',
    })
    setLines([])
    setPendingServiceId('')
    setLinesTouched(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, prefill?.staffId, prefill?.when, prefill?.endAt, prefill?.clientId])

  // Догрузка staff после открытия — выставляем дефолт, если ещё не выбран.
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

  // Пересчёт end_time из start_time + Σ длительностей всех выбранных услуг.
  // Если duration_min не задан у каких-то услуг — для них default 60 мин.
  const watchedStartTime = form.watch('start_time')
  useEffect(() => {
    if (lines.length === 0) return
    const totalMin = lines.reduce((sum, l) => sum + (l.duration_min ?? 60), 0)
    const [hh, mm] = (watchedStartTime || '10:00').split(':').map(Number)
    if (!Number.isFinite(hh) || !Number.isFinite(mm)) return
    const total = hh! * 60 + mm! + totalMin
    const endHh = Math.floor((total / 60) % 24)
    const endMm = total % 60
    form.setValue(
      'end_time',
      `${String(endHh).padStart(2, '0')}:${String(endMm).padStart(2, '0')}`,
      { shouldValidate: false },
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines, watchedStartTime])

  function addService() {
    if (!pendingServiceId) return
    const svc = services.find((s) => s.id === pendingServiceId)
    if (!svc) return
    setLines((prev) => [
      ...prev,
      {
        uid: crypto.randomUUID(),
        service_id: svc.id,
        name: svc.name,
        price_cents: svc.default_price_cents,
        duration_min: svc.default_duration_min,
      },
    ])
    setPendingServiceId('')
    setLinesTouched(true)
  }

  function removeLine(uid: string) {
    setLines((prev) => prev.filter((l) => l.uid !== uid))
  }

  const totalAmountCents = lines.reduce((s, l) => s + l.price_cents, 0)
  const watchedStaffId = form.watch('staff_id')

  async function onSubmit(values: FormValues) {
    if (lines.length === 0) {
      setLinesTouched(true)
      toast.error(t('visits.errors.services_required'))
      return
    }

    const tipCentsTotal = values.tip ? Math.round(Number(values.tip.replace(',', '.')) * 100) : 0
    const discountCentsTotal = values.discount
      ? Math.round(Number(values.discount.replace(',', '.')) * 100)
      : 0
    const stf = staff.find((s) => s.id === values.staff_id)

    const [yyyy, mm, dd] = values.visit_date.split('-').map(Number)
    const [sh, sm] = values.start_time.split(':').map(Number)
    const visitDate = new Date(yyyy ?? 1970, (mm ?? 1) - 1, dd ?? 1, sh ?? 0, sm ?? 0, 0, 0)
    const visitAt = visitDate.toISOString()

    // Длительность брони — из формы (end-start) либо сумма duration_min услуг.
    const [eh, em] = values.end_time.split(':').map(Number)
    const formDur =
      Number.isFinite(sh) && Number.isFinite(eh) ? eh! * 60 + (em ?? 0) - (sh! * 60 + (sm ?? 0)) : 0
    const totalDurationMin =
      formDur > 0 ? formDur : lines.reduce((s, l) => s + (l.duration_min ?? 60), 0)

    // Conflict-detection — проверяем перекрытие со всеми визитами того же
    // мастера в этот день в диапазоне [start, start+totalDuration).
    const newStartMs = visitDate.getTime()
    const newEndMs = newStartMs + totalDurationMin * 60_000
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
          t('visits.errors.conflict', { time: conflictTime, service: conflictSvc }),
        )
        if (!ok) return
      }
    }

    // Метод оплаты на этом шаге не выбирается — реальный выбор будет в
    // VisitDetailModal → «Рассчитать». Сохраняем дефолт (последний
    // использованный либо 'card'), чтобы прошли NOT NULL constraint.
    const defaultPayment =
      (typeof window !== 'undefined' && window.localStorage.getItem(LAST_PAYMENT_KEY)) || 'card'

    // Создаём N visits — по одной строке на услугу. Связываем общим
    // group_key, если услуг >1, чтобы UI и charge-flow видели группу.
    const groupKey = lines.length > 1 ? crypto.randomUUID() : null
    const createdIds: string[] = []
    try {
      for (let i = 0; i < lines.length; i++) {
        const l = lines[i]!
        const firstLine = i === 0
        const created = await createVisit.mutateAsync({
          salon_id: salonId,
          staff_id: values.staff_id || null,
          client_id: values.client_id || null,
          service_id: l.service_id,
          service_name_snapshot: l.name,
          // Все услуги в группе делим один и тот же visit_at — это одна
          // запись с несколькими услугами, не последовательные визиты.
          visit_at: visitAt,
          amount_cents: l.price_cents,
          // Tip/discount навешиваем на первую строку группы — упрощённо;
          // при «Рассчитать» юзер увидит общую сумму группы и сможет
          // перераспределить, если нужно.
          tip_cents: firstLine ? tipCentsTotal : 0,
          discount_cents: firstLine ? discountCentsTotal : 0,
          payment_method: defaultPayment as 'cash' | 'card' | 'transfer' | 'online' | 'mixed',
          comment: firstLine ? values.comment || null : null,
          status: 'pending',
          group_key: groupKey,
        })
        createdIds.push(created.id)
      }
      window.localStorage.setItem(LAST_STAFF_KEY, values.staff_id)

      toast.success(t('visits.toast_added'), {
        description: `${stf?.full_name ?? ''} · ${formatCurrency(
          totalAmountCents - discountCentsTotal + tipCentsTotal,
          currency,
        )}`,
        action: {
          label: t('visits.toast_undo'),
          onClick: () => {
            for (const id of createdIds) {
              deleteVisit.mutate(id, {
                onSuccess: () => {
                  toast(t('visits.toast_undone'), {
                    action: {
                      label: t('visits.toast_restore'),
                      onClick: () => restoreVisit.mutate(id),
                    },
                  })
                },
              })
            }
          },
        },
      })

      // Booksy reverse-sync — резервируем слот на длительность всей записи.
      const booksyConnected = integrations.some(
        (i) => i.provider === 'booksy' && i.status === 'connected',
      )
      const stfExternal =
        stf?.external_source === 'booksy' && stf.external_id ? stf.external_id : null
      if (booksyConnected && stfExternal && totalDurationMin > 0) {
        const startAt = new Date(visitAt)
        const endAt = new Date(startAt.getTime() + totalDurationMin * 60000)
        reserveBooksy.mutate({
          salonId,
          staffIdExternal: stfExternal,
          startAt: startAt.toISOString(),
          endAt: endAt.toISOString(),
          title: lines.map((l) => l.name).join(', '),
        })
      }

      onOpenChange(false)
    } catch (err) {
      toast.error(t('visits.toast_error'), {
        description: err instanceof Error ? err.message : String(err),
      })
    }
  }

  const selectedStaffIndex = staff.findIndex((s) => s.id === watchedStaffId)
  const selectedStaffColor =
    selectedStaffIndex >= 0 ? STAFF_PALETTE[selectedStaffIndex % STAFF_PALETTE.length]! : '#E8E5DF'
  const selectedStaffInitial =
    staff
      .find((s) => s.id === watchedStaffId)
      ?.full_name.charAt(0)
      .toUpperCase() ?? '?'

  const currencySymbol = currency === 'EUR' ? '€' : currency === 'USD' ? '$' : currency
  const linesError = linesTouched && lines.length === 0

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:!w-[640px] sm:!max-w-[640px]">
        <DialogHeader>
          <DialogTitle>{t('visits.form.title_new')}</DialogTitle>
          <DialogDescription>{t('visits.form.subtitle')}</DialogDescription>
        </DialogHeader>

        <form
          className="flex min-h-0 flex-col gap-2.5 overflow-y-auto px-5 pb-2 pt-2"
          onSubmit={form.handleSubmit(onSubmit)}
          noValidate
        >
          {/* Услуги — самый верх. Можно добавить несколько. */}
          <div className="flex flex-col gap-1.5">
            <Label>{t('visits.form.service_label')} *</Label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <div className="min-w-0 flex-1">
                <SearchableSelect
                  value={pendingServiceId}
                  onChange={setPendingServiceId}
                  disabled={services.length === 0}
                  options={services.map((s) => ({
                    value: s.id,
                    label: s.name,
                    hint: `≈ ${formatCurrency(s.default_price_cents, currency)}${
                      s.default_duration_min
                        ? ` · ${s.default_duration_min} ${t('common.min')}`
                        : ''
                    }`,
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
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={addService}
                disabled={!pendingServiceId}
                size="md"
              >
                <Plus className="size-4" strokeWidth={2} />
                {t('visits.form.add_service')}
              </Button>
            </div>
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

            {/* Список выбранных услуг */}
            {lines.length > 0 ? (
              <ul className="border-border bg-card divide-border/60 mt-1 flex flex-col divide-y rounded-md border">
                {lines.map((l) => (
                  <li key={l.uid} className="flex items-center justify-between gap-2 px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-foreground truncate text-sm font-semibold">{l.name}</p>
                      <p className="text-muted-foreground text-[11px]">
                        {l.duration_min ? `${l.duration_min} ${t('common.min')} · ` : ''}
                        <span className="num">{formatCurrency(l.price_cents, currency)}</span>
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeLine(l.uid)}
                      aria-label={t('common.remove')}
                      className="text-muted-foreground hover:text-destructive grid size-7 place-items-center rounded-md"
                    >
                      <Trash2 className="size-3.5" strokeWidth={1.8} />
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            {linesError ? (
              <p className="text-destructive text-xs font-medium" role="alert">
                {t('visits.errors.services_required')}
              </p>
            ) : null}
          </div>

          {/* Дата + Время от/до */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto_auto]">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="qe-date">{t('visits.form.date_label')} *</Label>
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
              <Label htmlFor="qe-start-time">{t('visits.form.start_time_label')} *</Label>
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
              <Label htmlFor="qe-end-time">{t('visits.form.end_time_label')} *</Label>
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

          {/* Мастер */}
          <Controller
            name="staff_id"
            control={form.control}
            render={({ field }) => (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="qe-staff">{t('visits.form.staff_label')} *</Label>
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

          {/* Клиент — теперь обязательное поле */}
          <Controller
            name="client_id"
            control={form.control}
            render={({ field }) => (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="qe-client">{t('visits.form.client_label')} *</Label>
                <ClientPicker
                  salonId={salonId}
                  value={field.value}
                  onChange={field.onChange}
                  placeholder={t('clients.picker.no_client')}
                  testId="qe-client"
                />
                {form.formState.errors.client_id ? (
                  <p className="text-destructive text-xs font-medium" role="alert">
                    {t(form.formState.errors.client_id.message ?? '')}
                  </p>
                ) : null}
              </div>
            )}
          />

          {/* Сумма — автоматически из суммы услуг (read-only). */}
          <div className="flex flex-col gap-1.5">
            <Label>{t('visits.form.amount_label')}</Label>
            <div className="border-brand-yellow-deep bg-brand-yellow flex h-16 items-center gap-2 rounded-md border-[1.5px] px-4">
              <span className="num text-brand-navy text-3xl font-bold">{currencySymbol}</span>
              <span
                className={cn(
                  'num text-brand-navy h-full min-w-0 flex-1 self-center text-3xl font-bold tracking-tight',
                  totalAmountCents === 0 && 'text-brand-navy/30',
                )}
                data-testid="qe-amount-display"
              >
                {(totalAmountCents / 100).toFixed(2)}
              </span>
            </div>
            <p className="text-muted-foreground text-[10.5px]">
              {t('visits.form.amount_auto_hint')}
            </p>
          </div>

          {/* Чаевые + скидка (опциональные, но валидируются на ≥0) */}
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
              {form.formState.errors.tip ? (
                <p className="text-destructive text-xs font-medium" role="alert">
                  {t(form.formState.errors.tip.message ?? '')}
                </p>
              ) : null}
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
              {form.formState.errors.discount ? (
                <p className="text-destructive text-xs font-medium" role="alert">
                  {t(form.formState.errors.discount.message ?? '')}
                </p>
              ) : null}
            </div>
          </div>

          {/* Комментарий — единственное необязательное поле */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="qe-comment">{t('visits.form.comment_label')}</Label>
            <Input
              id="qe-comment"
              placeholder={t('visits.form.comment_placeholder')}
              {...form.register('comment')}
            />
          </div>
        </form>

        <DialogFooter>
          <Button
            type="button"
            size="lg"
            onClick={form.handleSubmit(onSubmit)}
            disabled={createVisit.isPending}
            data-testid="qe-submit"
          >
            {createVisit.isPending ? t('common.loading') : t('visits.form.submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
