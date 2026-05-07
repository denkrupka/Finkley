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
import { useServices, type ServiceRow } from '@/hooks/useServices'
import type { StaffPayoutScheme, StaffRow } from '@/hooks/useStaff'
import { useUpdateStaff } from '@/hooks/useStaffMutations'
import {
  useDeleteStaffServiceOverride,
  useStaffServiceOverrides,
  useUpsertStaffServiceOverride,
} from '@/hooks/useStaffServiceOverrides'

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

export function StaffEditSheet({ open, onOpenChange, salonId, staff }: Props) {
  const { t } = useTranslation()
  const update = useUpdateStaff(salonId)

  const [name, setName] = useState('')
  const [scheme, setScheme] = useState<StaffPayoutScheme>('percent_revenue')
  const [percent, setPercent] = useState('40')
  const [fixedAmount, setFixedAmount] = useState('')
  const [chairRent, setChairRent] = useState('')

  useEffect(() => {
    if (!staff) return
    setName(staff.full_name)
    setScheme(staff.payout_scheme)
    setPercent(staff.payout_percent != null ? String(staff.payout_percent) : '40')
    setFixedAmount(centsToInput(staff.payout_fixed_cents))
    setChairRent(centsToInput(staff.chair_rent_cents))
  }, [staff?.id, staff])

  function save() {
    if (!staff) return
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
    update.mutate(
      {
        id: staff.id,
        full_name: trimmed,
        payout_scheme: scheme,
        payout_percent: scheme === 'percent_revenue' || scheme === 'mixed' ? pct : null,
        payout_fixed_cents:
          scheme === 'fixed' || scheme === 'mixed' ? inputToCents(fixedAmount) : null,
        chair_rent_cents: scheme === 'chair_rent' ? inputToCents(chairRent) : null,
      },
      {
        onSuccess: () => {
          toast.success(t('staff.toast_saved'))
          onOpenChange(false)
        },
        onError: (err) => {
          toast.error(err instanceof Error ? err.message : String(err))
        },
      },
    )
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>{t('staff.sheet_title')}</SheetTitle>
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
          </div>
        </SheetBody>
        <SheetFooter>
          <Button onClick={save} disabled={update.isPending} className="w-full">
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
