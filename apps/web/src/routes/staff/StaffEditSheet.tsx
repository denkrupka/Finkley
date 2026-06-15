import { Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { useServiceCategories, useServices, type ServiceRow } from '@/hooks/useServices'
import {
  DAY_KEYS,
  type StaffPayoutScheme,
  type StaffRow,
  type WeeklySchedule,
} from '@/hooks/useStaff'
import { useCreateStaff, useUpdateStaff } from '@/hooks/useStaffMutations'
import {
  useDeleteStaffServiceOverride,
  useStaffServiceOverrides,
  useUpsertStaffServiceOverride,
} from '@/hooks/useStaffServiceOverrides'
import {
  useBulkSetStaffServices,
  useStaffServices,
  useToggleStaffService,
} from '@/hooks/useStaffServices'

const SCHEMES: StaffPayoutScheme[] = [
  'percent_revenue',
  'fixed',
  'percent_service',
  'chair_rent',
  'mixed',
]

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  salonId: string
  staff: StaffRow | null
}

function centsToInput(cents: number | null): string {
  if (cents == null) return ''
  return String(Math.round(cents) / 100)
}

function inputToCents(value: string): number {
  const n = Number(value.replace(',', '.'))
  if (Number.isNaN(n) || n < 0) return 0
  return Math.round(n * 100)
}

function defaultSchedule(): WeeklySchedule {
  const work = { start: '09:00', end: '19:00', off: false }
  const off = { start: '09:00', end: '19:00', off: true }
  return {
    mon: { ...work },
    tue: { ...work },
    wed: { ...work },
    thu: { ...work },
    fri: { ...work },
    sat: { ...off },
    sun: { ...off },
  }
}

export function StaffEditSheet({ open, onOpenChange, salonId, staff }: Props) {
  const { t } = useTranslation()
  const update = useUpdateStaff(salonId)
  // Bug 37b3b3e0 (Елена 05.06): тот же sheet используется и для add'а
  // нового мастера в онбординге (передаётся staff=null). В этом режиме
  // save() инсёртит через useCreateStaff вместо useUpdateStaff.
  const create = useCreateStaff(salonId)
  const isCreate = !staff

  const [name, setName] = useState('')
  const [scheme, setScheme] = useState<StaffPayoutScheme>('percent_revenue')
  const [percent, setPercent] = useState('40')
  const [fixedAmount, setFixedAmount] = useState('')
  const [chairRent, setChairRent] = useState('')
  const [retailEnabled, setRetailEnabled] = useState(true)
  const [retailPercent, setRetailPercent] = useState('') // '' = use payout_percent
  const [retentionDays, setRetentionDays] = useState('') // '' = inherit salon
  const [schedule, setSchedule] = useState<WeeklySchedule>(defaultSchedule())

  useEffect(() => {
    if (!staff) {
      // create-mode: ресетим к дефолтам каждый раз когда sheet открывается
      // на null (иначе после edit'а одного мастера и закрытия — поля бы
      // остались заполненными от предыдущего).
      setName('')
      setScheme('percent_revenue')
      setPercent('40')
      setFixedAmount('')
      setChairRent('')
      setRetailEnabled(true)
      setRetailPercent('')
      setRetentionDays('')
      setSchedule(defaultSchedule())
      return
    }
    setName(staff.full_name)
    setScheme(staff.payout_scheme)
    setPercent(staff.payout_percent != null ? String(staff.payout_percent) : '40')
    setFixedAmount(centsToInput(staff.payout_fixed_cents))
    setChairRent(centsToInput(staff.chair_rent_cents))
    setRetailEnabled(staff.retail_payout_enabled)
    setRetailPercent(staff.retail_payout_percent != null ? String(staff.retail_payout_percent) : '')
    setRetentionDays(staff.retention_window_days != null ? String(staff.retention_window_days) : '')
    setSchedule(staff.weekly_schedule ?? defaultSchedule())
  }, [staff?.id, staff, open])

  function save() {
    const trimmed = name.trim()
    if (trimmed.length < 2) {
      toast.error(t('staff.errors.name_too_short'))
      return
    }
    const pct = Number(percent.replace(',', '.'))
    if (
      (scheme === 'percent_revenue' || scheme === 'mixed') &&
      (Number.isNaN(pct) || pct < 0 || pct > 100)
    ) {
      toast.error(t('staff.errors.percent_invalid'))
      return
    }
    const retailPctNum =
      retailPercent.trim() === '' ? null : Number(retailPercent.replace(',', '.'))
    if (
      retailPctNum !== null &&
      (Number.isNaN(retailPctNum) || retailPctNum < 0 || retailPctNum > 100)
    ) {
      toast.error(t('staff.errors.percent_invalid'))
      return
    }
    const retentionNum = retentionDays.trim() === '' ? null : parseInt(retentionDays, 10)
    if (
      retentionNum !== null &&
      (Number.isNaN(retentionNum) || retentionNum < 7 || retentionNum > 365)
    ) {
      toast.error(t('staff.errors.retention_invalid'))
      return
    }

    const payload = {
      full_name: trimmed,
      payout_scheme: scheme,
      payout_percent: scheme === 'percent_revenue' || scheme === 'mixed' ? pct : null,
      payout_fixed_cents:
        scheme === 'fixed' || scheme === 'mixed' ? inputToCents(fixedAmount) : null,
      chair_rent_cents: scheme === 'chair_rent' ? inputToCents(chairRent) : null,
      weekly_schedule: schedule,
      retail_payout_enabled: retailEnabled,
      retail_payout_percent: retailPctNum,
      retention_window_days: retentionNum,
    }

    const handlers = {
      onSuccess: () => {
        toast.success(t('staff.toast_saved'))
        onOpenChange(false)
      },
      onError: (err: unknown) => {
        toast.error(err instanceof Error ? err.message : String(err))
      },
    }

    if (isCreate) {
      create.mutate(payload, handlers)
    } else {
      update.mutate({ id: staff!.id, ...payload }, handlers)
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>
            {isCreate
              ? t('staff.sheet_title_create', { defaultValue: 'Новый мастер' })
              : t('staff.sheet_title')}
          </SheetTitle>
          <SheetDescription>{t('staff.sheet_subtitle')}</SheetDescription>
        </SheetHeader>
        <SheetBody className="px-5 py-5">
          <div className="flex flex-col gap-5">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="staff-edit-name">{t('staff.name_label')}</Label>
              <Input id="staff-edit-name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>

            <div className="flex flex-col gap-2">
              <Label>{t('staff.scheme_label')}</Label>
              <div className="flex flex-col gap-2">
                {SCHEMES.map((s) => (
                  <SchemeOption
                    key={s}
                    scheme={s}
                    selected={scheme === s}
                    onSelect={() => setScheme(s)}
                  />
                ))}
              </div>
            </div>

            {scheme === 'percent_revenue' || scheme === 'mixed' ? (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="staff-edit-percent">{t('staff.percent_label')}</Label>
                <div className="border-brand-yellow-deep bg-brand-yellow flex h-11 items-center rounded-md border-[1.5px] px-3">
                  <input
                    id="staff-edit-percent"
                    type="number"
                    min={0}
                    max={100}
                    value={percent}
                    onChange={(e) => setPercent(e.target.value)}
                    className="num text-brand-navy h-full flex-1 bg-transparent text-base font-bold outline-none"
                  />
                  <span className="num text-brand-navy text-base font-bold">%</span>
                </div>
              </div>
            ) : null}

            {scheme === 'fixed' || scheme === 'mixed' ? (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="staff-edit-fixed">{t('staff.fixed_label')}</Label>
                <Input
                  id="staff-edit-fixed"
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="any"
                  value={fixedAmount}
                  onChange={(e) => setFixedAmount(e.target.value)}
                  placeholder="4000"
                />
              </div>
            ) : null}

            {scheme === 'chair_rent' ? (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="staff-edit-rent">{t('staff.chair_rent_label')}</Label>
                <Input
                  id="staff-edit-rent"
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="any"
                  value={chairRent}
                  onChange={(e) => setChairRent(e.target.value)}
                  placeholder="1500"
                />
              </div>
            ) : null}

            {scheme === 'percent_service' ? (
              <ServiceOverridesEditor staffId={staff?.id} salonId={salonId} />
            ) : null}

            {/* ─── Услуги, которые выполняет мастер ───────────────────── */}
            <div className="border-border rounded-md border p-4">
              <StaffServicesEditor staffId={staff?.id} salonId={salonId} />
            </div>

            {/* ─── Рабочее расписание ─────────────────────────────────── */}
            <div className="border-border rounded-md border p-4">
              <Label className="mb-2 block">{t('staff.schedule.title')}</Label>
              <p className="text-muted-foreground mb-3 text-xs">{t('staff.schedule.hint')}</p>
              <div className="flex flex-col gap-1.5">
                {DAY_KEYS.map((d) => {
                  const day = schedule[d]
                  return (
                    <div
                      key={d}
                      className="grid grid-cols-[60px_auto_1fr_1fr] items-center gap-2 text-sm"
                    >
                      <span className="text-foreground font-semibold">
                        {t(`staff.schedule.days.${d}`)}
                      </span>
                      <input
                        type="checkbox"
                        checked={!day.off}
                        onChange={(e) =>
                          setSchedule({
                            ...schedule,
                            [d]: { ...day, off: !e.target.checked },
                          })
                        }
                        className="size-4 cursor-pointer"
                      />
                      <input
                        type="time"
                        value={day.start}
                        disabled={day.off}
                        onChange={(e) =>
                          setSchedule({ ...schedule, [d]: { ...day, start: e.target.value } })
                        }
                        className="border-border bg-card num h-8 rounded-md border px-2 text-xs disabled:opacity-40"
                      />
                      <input
                        type="time"
                        value={day.end}
                        disabled={day.off}
                        onChange={(e) =>
                          setSchedule({ ...schedule, [d]: { ...day, end: e.target.value } })
                        }
                        className="border-border bg-card num h-8 rounded-md border px-2 text-xs disabled:opacity-40"
                      />
                    </div>
                  )
                })}
              </div>
            </div>

            {/* ─── Retail payout ──────────────────────────────────────── */}
            <div className="border-border rounded-md border p-4">
              <Label className="mb-2 block">{t('staff.retail_payout.title')}</Label>
              <p className="text-muted-foreground mb-3 text-xs">{t('staff.retail_payout.hint')}</p>
              <label className="text-foreground flex cursor-pointer items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={retailEnabled}
                  onChange={(e) => setRetailEnabled(e.target.checked)}
                  className="size-4 cursor-pointer"
                />
                {t('staff.retail_payout.enabled_label')}
              </label>
              {retailEnabled ? (
                <div className="mt-3 flex flex-col gap-1.5">
                  <Label htmlFor="staff-edit-retail-pct" className="text-xs">
                    {t('staff.retail_payout.percent_label')}
                  </Label>
                  <div className="border-border bg-card flex h-10 items-center rounded-md border px-3">
                    <input
                      id="staff-edit-retail-pct"
                      type="number"
                      min={0}
                      max={100}
                      placeholder={t('staff.retail_payout.placeholder_inherit', {
                        pct: percent || '40',
                      })}
                      value={retailPercent}
                      onChange={(e) => setRetailPercent(e.target.value)}
                      className="num text-foreground h-full flex-1 bg-transparent text-sm outline-none"
                    />
                    <span className="num text-muted-foreground text-sm">%</span>
                  </div>
                  <p className="text-muted-foreground text-xs">
                    {t('staff.retail_payout.percent_help')}
                  </p>
                </div>
              ) : null}
            </div>

            {/* ─── Retention window (per-master) ─────────────────────── */}
            <div className="border-border rounded-md border p-4">
              <Label htmlFor="staff-edit-retention" className="mb-2 block">
                {t('staff.retention_window.title')}
              </Label>
              <p className="text-muted-foreground mb-3 text-xs">
                {t('staff.retention_window.hint')}
              </p>
              <div className="border-border bg-card flex h-10 items-center rounded-md border px-3">
                <input
                  id="staff-edit-retention"
                  type="number"
                  min={7}
                  max={365}
                  placeholder={t('staff.retention_window.placeholder_inherit')}
                  value={retentionDays}
                  onChange={(e) => setRetentionDays(e.target.value)}
                  className="num text-foreground h-full flex-1 bg-transparent text-sm outline-none"
                />
                <span className="num text-muted-foreground text-sm">
                  {t('staff.retention_window.days')}
                </span>
              </div>
            </div>
          </div>
        </SheetBody>
        <SheetFooter>
          <Button onClick={save} disabled={update.isPending || create.isPending} className="w-full">
            {t('common.save')}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

function SchemeOption({
  scheme,
  selected,
  onSelect,
}: {
  scheme: StaffPayoutScheme
  selected: boolean
  onSelect: () => void
}) {
  const { t } = useTranslation()
  return (
    <button
      type="button"
      onClick={onSelect}
      className={[
        'rounded-md border px-3 py-2.5 text-left transition-colors',
        selected
          ? 'border-brand-navy bg-brand-yellow/40'
          : 'border-border bg-card hover:bg-muted/40',
      ].join(' ')}
    >
      <div className="text-brand-navy text-sm font-bold">{t(`staff.schemes.${scheme}.title`)}</div>
      <div className="text-muted-foreground mt-0.5 text-xs">
        {t(`staff.schemes.${scheme}.hint`)}
      </div>
    </button>
  )
}

function ServiceOverridesEditor({
  staffId,
  salonId,
}: {
  staffId: string | undefined
  salonId: string
}) {
  const { t } = useTranslation()
  const { data: services = [] } = useServices(salonId)
  const { data: overrides = [] } = useStaffServiceOverrides(staffId)
  const upsert = useUpsertStaffServiceOverride(staffId)
  const remove = useDeleteStaffServiceOverride(staffId)

  const overrideByService = useMemo(() => {
    const m = new Map<string, { id: string; payout_percent: number | null }>()
    for (const o of overrides) m.set(o.service_id, { id: o.id, payout_percent: o.payout_percent })
    return m
  }, [overrides])

  if (!staffId) {
    return <p className="text-muted-foreground text-xs">{t('staff.overrides.save_first')}</p>
  }

  if (services.length === 0) {
    return (
      <div className="border-border bg-muted/30 rounded-md border p-3">
        <p className="text-muted-foreground text-xs">{t('staff.overrides.no_services')}</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <Label>{t('staff.overrides.title')}</Label>
        <span className="text-muted-foreground text-xs">{t('staff.overrides.hint')}</span>
      </div>
      <div className="border-border divide-border bg-card divide-y rounded-md border">
        {services.map((service) => (
          <ServiceOverrideRow
            key={service.id}
            service={service}
            current={overrideByService.get(service.id)}
            onSave={(percent) => upsert.mutate({ service_id: service.id, payout_percent: percent })}
            onClear={(id) => remove.mutate(id)}
          />
        ))}
      </div>
    </div>
  )
}

function ServiceOverrideRow({
  service,
  current,
  onSave,
  onClear,
}: {
  service: ServiceRow
  current: { id: string; payout_percent: number | null } | undefined
  onSave: (percent: number) => void
  onClear: (id: string) => void
}) {
  const { t } = useTranslation()
  const initial = current?.payout_percent != null ? String(current.payout_percent) : ''
  const [value, setValue] = useState(initial)

  useEffect(() => {
    setValue(initial)
  }, [initial])

  const dirty = value !== initial

  function commit() {
    const n = Number(value.replace(',', '.'))
    if (value === '' || Number.isNaN(n)) return
    if (n < 0 || n > 100) return
    onSave(n)
  }

  return (
    <div className="flex items-center gap-2 px-3 py-2">
      <div className="text-brand-navy min-w-0 flex-1 truncate text-sm">{service.name}</div>
      <div className="border-brand-yellow-deep bg-brand-yellow flex h-9 w-24 items-center rounded-md border-[1.5px] px-2">
        <input
          type="number"
          min={0}
          max={100}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={() => {
            if (dirty) commit()
          }}
          placeholder="—"
          className="num text-brand-navy h-full w-full bg-transparent text-sm font-bold outline-none"
        />
        <span className="num text-brand-navy text-sm font-bold">%</span>
      </div>
      {current ? (
        <button
          type="button"
          onClick={() => onClear(current.id)}
          className="text-muted-foreground hover:text-destructive p-1"
          aria-label={t('staff.overrides.clear')}
          title={t('staff.overrides.clear')}
        >
          <Trash2 className="size-4" strokeWidth={1.7} />
        </button>
      ) : (
        <span className="w-6" />
      )}
    </div>
  )
}

/**
 * Выбор услуг, которые ВЫПОЛНЯЕТ мастер (таблица staff_services). Группировка
 * по категориям + чекбоксы по услугам + «выбрать/снять всю категорию».
 * Виден всегда (не зависит от схемы выплат). Для нового (ещё не сохранённого)
 * мастера просит сначала сохранить (нужен staff_id).
 */
function StaffServicesEditor({
  staffId,
  salonId,
}: {
  staffId: string | undefined
  salonId: string
}) {
  const { t } = useTranslation()
  const { data: services = [] } = useServices(salonId)
  const { data: categories = [] } = useServiceCategories(salonId)
  const { data: assigned = [] } = useStaffServices(staffId)
  const toggle = useToggleStaffService(salonId, staffId)
  const bulk = useBulkSetStaffServices(salonId, staffId)

  const selected = useMemo(() => new Set(assigned.map((a) => a.service_id)), [assigned])

  const groups = useMemo(() => {
    const m = new Map<string, ServiceRow[]>()
    for (const s of services) {
      const key = s.category_id ?? '__none__'
      if (!m.has(key)) m.set(key, [])
      m.get(key)!.push(s)
    }
    return m
  }, [services])

  if (!staffId) {
    return (
      <>
        <Label className="mb-2 block">
          {t('staff.services.title', { defaultValue: 'Услуги мастера' })}
        </Label>
        <p className="text-muted-foreground text-xs">
          {t('staff.services.save_first', {
            defaultValue: 'Сначала сохрани мастера — потом сможешь отметить его услуги.',
          })}
        </p>
      </>
    )
  }

  if (services.length === 0) {
    return (
      <>
        <Label className="mb-2 block">
          {t('staff.services.title', { defaultValue: 'Услуги мастера' })}
        </Label>
        <p className="text-muted-foreground text-xs">
          {t('staff.services.no_services', {
            defaultValue: 'Сначала добавь услуги в Справочники → Услуги.',
          })}
        </p>
      </>
    )
  }

  const catName = new Map(categories.map((c) => [c.id, c.name]))
  const orderedKeys = [
    ...categories.map((c) => c.id).filter((id) => groups.has(id)),
    ...(groups.has('__none__') ? ['__none__'] : []),
  ]

  return (
    <>
      <div className="mb-1 flex items-center justify-between">
        <Label>{t('staff.services.title', { defaultValue: 'Услуги мастера' })}</Label>
        <span className="text-muted-foreground text-xs">
          {t('staff.services.count', { defaultValue: 'выбрано: {{n}}', n: selected.size })}
        </span>
      </div>
      <p className="text-muted-foreground mb-3 text-xs">
        {t('staff.services.hint', {
          defaultValue: 'Отметь услуги, которые делает мастер. Можно выбрать целую категорию.',
        })}
      </p>
      <div className="border-border divide-border bg-card divide-y rounded-md border">
        {orderedKeys.map((key) => {
          const items = groups.get(key) ?? []
          const name =
            key === '__none__'
              ? t('staff.services.uncategorized', { defaultValue: 'Без категории' })
              : (catName.get(key) ?? '—')
          const ids = items.map((s) => s.id)
          const allOn = ids.length > 0 && ids.every((id) => selected.has(id))
          return (
            <div key={key} className="p-2">
              <div className="mb-1 flex items-center justify-between px-1">
                <span className="text-brand-navy text-xs font-bold uppercase tracking-wide">
                  {name}
                </span>
                <button
                  type="button"
                  onClick={() => bulk.mutate({ service_ids: ids, enabled: !allOn })}
                  className="text-secondary text-xs font-semibold hover:underline"
                >
                  {allOn
                    ? t('staff.services.clear_cat', { defaultValue: 'снять все' })
                    : t('staff.services.select_cat', { defaultValue: 'выбрать все' })}
                </button>
              </div>
              {items.map((s) => (
                <label
                  key={s.id}
                  className="hover:bg-muted/40 flex cursor-pointer items-center gap-2 rounded px-1 py-1.5 text-sm"
                >
                  <input
                    type="checkbox"
                    checked={selected.has(s.id)}
                    onChange={(e) => toggle.mutate({ service_id: s.id, enabled: e.target.checked })}
                    className="size-4 cursor-pointer"
                  />
                  <span className="text-foreground flex-1 truncate">{s.name}</span>
                </label>
              ))}
            </div>
          )
        })}
      </div>
    </>
  )
}
