import { CalendarRange, Pause, Play, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

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
import { useServices } from '@/hooks/useServices'
import { useStaff } from '@/hooks/useStaff'
import {
  useClientTemplates,
  useCreateVisitTemplate,
  useDeleteVisitTemplate,
  useToggleTemplatePause,
} from '@/hooks/useVisitTemplates'

/**
 * Секция «Постоянные визиты» в ClientDrawer. Юзер задаёт recurrence
 * (например, каждые 21 день), мастера, услугу — мы запоминаем шаблон.
 * Дашборд-виджет «Скоро придут» показывает due-визиты.
 */
export function ClientTemplatesSection({
  salonId,
  clientId,
}: {
  salonId: string
  clientId: string
}) {
  const { t } = useTranslation()
  const { data: templates = [] } = useClientTemplates(clientId)
  const { data: staff = [] } = useStaff(salonId)
  const { data: services = [] } = useServices(salonId)
  const create = useCreateVisitTemplate(salonId)
  const remove = useDeleteVisitTemplate()
  const togglePause = useToggleTemplatePause()
  const [adding, setAdding] = useState(false)
  const [recurrenceDays, setRecurrenceDays] = useState('21')
  const [staffId, setStaffId] = useState('')
  const [serviceId, setServiceId] = useState('')
  const [nextDueAt, setNextDueAt] = useState(() => {
    const d = new Date()
    d.setDate(d.getDate() + 21)
    return d.toISOString().slice(0, 10)
  })

  function submit() {
    const days = parseInt(recurrenceDays, 10)
    if (!Number.isFinite(days) || days < 1 || days > 365) {
      toast.error(t('clients.templates.errors.bad_recurrence'))
      return
    }
    create.mutate(
      {
        client_id: clientId,
        staff_id: staffId || null,
        service_id: serviceId || null,
        recurrence_days: days,
        amount_cents: null,
        next_due_at: nextDueAt,
      },
      {
        onSuccess: () => {
          toast.success(t('clients.templates.toast_added'))
          setAdding(false)
          setStaffId('')
          setServiceId('')
        },
        onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
      },
    )
  }

  return (
    <section className="mb-6">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-brand-navy inline-flex items-center gap-2 text-sm font-bold uppercase tracking-wider">
          <CalendarRange className="size-4" strokeWidth={2} />
          {t('clients.templates.title')}
        </h3>
        {!adding && templates.length === 0 ? (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="text-secondary inline-flex items-center gap-1 text-xs font-bold hover:underline"
          >
            <Plus className="size-3" strokeWidth={2.5} />
            {t('clients.templates.add')}
          </button>
        ) : null}
      </div>

      {templates.map((tpl) => {
        const staffName = staff.find((s) => s.id === tpl.staff_id)?.full_name
        const serviceName = services.find((s) => s.id === tpl.service_id)?.name
        const paused = tpl.paused_at != null
        return (
          <div
            key={tpl.id}
            className="border-border bg-card mb-2 flex items-center justify-between gap-2 rounded-md border p-2 text-sm"
          >
            <div className="min-w-0 flex-1">
              <p className="text-foreground font-semibold">
                {t('clients.templates.every_n_days', { count: tpl.recurrence_days })}
                {paused ? (
                  <span className="text-muted-foreground ml-2 text-xs">
                    · {t('clients.templates.paused')}
                  </span>
                ) : null}
              </p>
              <p className="text-muted-foreground text-xs">
                {[serviceName, staffName].filter(Boolean).join(' · ') ||
                  t('clients.templates.no_details')}
                {' · '}
                {t('clients.templates.next', { date: tpl.next_due_at })}
              </p>
            </div>
            <button
              type="button"
              onClick={() => togglePause.mutate({ id: tpl.id, paused: !paused })}
              className="text-muted-foreground hover:text-foreground grid size-7 place-items-center rounded-md"
              title={paused ? t('clients.templates.resume') : t('clients.templates.pause')}
            >
              {paused ? (
                <Play className="size-3.5" strokeWidth={2} />
              ) : (
                <Pause className="size-3.5" strokeWidth={2} />
              )}
            </button>
            <button
              type="button"
              onClick={() => {
                if (!confirm(t('clients.templates.confirm_delete'))) return
                remove.mutate(tpl.id)
              }}
              className="text-muted-foreground hover:text-destructive grid size-7 place-items-center rounded-md"
              title={t('clients.templates.delete')}
            >
              <Trash2 className="size-3.5" strokeWidth={1.7} />
            </button>
          </div>
        )
      })}

      {adding ? (
        <div className="border-border bg-muted/30 mt-2 rounded-md border p-3">
          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col gap-1">
              <Label className="text-xs">{t('clients.templates.recurrence_label')}</Label>
              <Input
                type="number"
                min={1}
                max={365}
                value={recurrenceDays}
                onChange={(e) => setRecurrenceDays(e.target.value)}
                className="h-9"
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label className="text-xs">{t('clients.templates.next_label')}</Label>
              <Input
                type="date"
                value={nextDueAt}
                onChange={(e) => setNextDueAt(e.target.value)}
                className="h-9"
              />
            </div>
            <div className="col-span-2 flex flex-col gap-1 sm:col-span-1">
              <Label className="text-xs">{t('clients.templates.staff_label')}</Label>
              <Select value={staffId} onValueChange={setStaffId}>
                <SelectTrigger className="h-9">
                  <SelectValue placeholder={t('clients.templates.staff_any')} />
                </SelectTrigger>
                <SelectContent>
                  {staff.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.full_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="col-span-2 flex flex-col gap-1 sm:col-span-1">
              <Label className="text-xs">{t('clients.templates.service_label')}</Label>
              <Select value={serviceId} onValueChange={setServiceId}>
                <SelectTrigger className="h-9">
                  <SelectValue placeholder={t('clients.templates.service_any')} />
                </SelectTrigger>
                <SelectContent>
                  {services.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="mt-3 flex gap-2">
            <Button size="sm" onClick={submit} disabled={create.isPending}>
              {t('common.save')}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setAdding(false)}>
              {t('common.cancel')}
            </Button>
          </div>
        </div>
      ) : templates.length > 0 ? (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="text-secondary mt-1 inline-flex items-center gap-1 text-xs font-bold hover:underline"
        >
          <Plus className="size-3" strokeWidth={2.5} />
          {t('clients.templates.add')}
        </button>
      ) : null}
    </section>
  )
}
