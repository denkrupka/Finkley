import { zodResolver } from '@hookform/resolvers/zod'
import { format } from 'date-fns'
import { CalendarDays } from 'lucide-react'
import { useEffect } from 'react'
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
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useCreateStaffBlock } from '@/hooks/useStaffBlocks'
import { useStaff } from '@/hooks/useStaff'

type FormValues = {
  visit_date: string // YYYY-MM-DD
  start_time: string // HH:MM
  end_time: string // HH:MM
  staff_id: string
  reason: string
}

const schema = z.object({
  visit_date: z.string().min(1, 'visits.errors.date_required'),
  start_time: z.string().min(1, 'visits.errors.start_time_required'),
  end_time: z.string().min(1, 'visits.errors.end_time_required'),
  staff_id: z.string().min(1, 'visits.errors.staff_required'),
  reason: z.string().max(500).optional().default(''),
})

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  salonId: string
  prefill: { staffId: string; when: string; endAt?: string } | null
}

/**
 * ReservationModal — создание блока времени мастера (kind='reservation').
 *
 * Открывается из VisitsCalendarView когда юзер выбрал «Резерв времени» в
 * popover'е субслота (одиночный клик или диапазон через drag-select).
 * Поля: дата, время от/до, мастер, повод. Без поля «Оборудование» (sprzęt)
 * по запросу владельца — этот атрибут пока не моделируется в Finkley.
 */
export function ReservationModal({ open, onOpenChange, salonId, prefill }: Props) {
  const { t } = useTranslation()
  const { data: staff = [] } = useStaff(salonId)
  const createBlock = useCreateStaffBlock(salonId)

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      visit_date: format(new Date(), 'yyyy-MM-dd'),
      start_time: '10:00',
      end_time: '10:30',
      staff_id: '',
      reason: '',
    },
  })

  useEffect(() => {
    if (!open) return
    if (!prefill) return
    const when = new Date(prefill.when)
    const endAt = prefill.endAt ? new Date(prefill.endAt) : new Date(when.getTime() + 30 * 60_000)
    form.reset({
      visit_date: format(when, 'yyyy-MM-dd'),
      start_time: format(when, 'HH:mm'),
      end_time: format(endAt, 'HH:mm'),
      staff_id: prefill.staffId,
      reason: '',
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, prefill?.staffId, prefill?.when, prefill?.endAt])

  async function onSubmit(values: FormValues) {
    const [yyyy, mm, dd] = values.visit_date.split('-').map(Number)
    const [sh, sm] = values.start_time.split(':').map(Number)
    const [eh, em] = values.end_time.split(':').map(Number)
    const starts = new Date(yyyy ?? 1970, (mm ?? 1) - 1, dd ?? 1, sh ?? 0, sm ?? 0, 0, 0)
    const ends = new Date(yyyy ?? 1970, (mm ?? 1) - 1, dd ?? 1, eh ?? 0, em ?? 0, 0, 0)
    if (ends.getTime() <= starts.getTime()) {
      toast.error(t('visits.errors.end_before_start'))
      return
    }

    createBlock.mutate(
      {
        staff_id: values.staff_id,
        kind: 'reservation',
        starts_at: starts.toISOString(),
        ends_at: ends.toISOString(),
        label: values.reason.trim() || null,
      },
      {
        onSuccess: () => {
          toast.success(t('visits.calendar.subslot.toast_reserved'))
          onOpenChange(false)
        },
        onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
      },
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:!w-[520px] sm:!max-w-[520px]">
        <DialogHeader>
          <DialogTitle>{t('visits.reservation.title')}</DialogTitle>
          <DialogDescription>{t('visits.reservation.subtitle')}</DialogDescription>
        </DialogHeader>

        <form
          className="flex min-h-0 flex-col gap-3 overflow-y-auto px-5 pb-2 pt-2"
          onSubmit={form.handleSubmit(onSubmit)}
          noValidate
        >
          {/* Дата + Начало + Конец */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto_auto]">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="rs-date">{t('visits.form.date_label')} *</Label>
              <div className="border-border bg-card flex h-11 items-center gap-2 rounded-md border-[1.5px] px-3">
                <CalendarDays className="text-muted-foreground size-[17px]" strokeWidth={1.7} />
                <input
                  id="rs-date"
                  type="date"
                  {...form.register('visit_date')}
                  className="num text-foreground h-full min-w-0 flex-1 bg-transparent text-sm font-medium outline-none"
                />
              </div>
              {form.formState.errors.visit_date ? (
                <p className="text-destructive text-xs font-medium" role="alert">
                  {t(form.formState.errors.visit_date.message ?? '')}
                </p>
              ) : null}
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="rs-start">{t('visits.form.start_time_label')} *</Label>
              <input
                id="rs-start"
                type="time"
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
              <Label htmlFor="rs-end">{t('visits.form.end_time_label')} *</Label>
              <input
                id="rs-end"
                type="time"
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
                <Label htmlFor="rs-staff">{t('visits.form.staff_label')} *</Label>
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger id="rs-staff" className="h-11">
                    <SelectValue placeholder={t('visits.form.staff_placeholder')} />
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

          {/* Повод (необязательно) */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="rs-reason">{t('visits.reservation.reason_label')}</Label>
            <textarea
              id="rs-reason"
              rows={4}
              placeholder={t('visits.reservation.reason_placeholder')}
              {...form.register('reason')}
              className="border-input bg-card text-foreground placeholder:text-muted-foreground/60 focus:ring-ring/40 w-full resize-y rounded-md border px-3 py-2 text-sm outline-none focus:ring-2"
            />
          </div>
        </form>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            size="lg"
            onClick={() => onOpenChange(false)}
            disabled={createBlock.isPending}
          >
            {t('common.cancel')}
          </Button>
          <Button
            type="button"
            size="lg"
            onClick={form.handleSubmit(onSubmit)}
            disabled={createBlock.isPending}
          >
            {createBlock.isPending ? t('common.loading') : t('common.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
