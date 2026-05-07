import { Pencil, Plus, Trash2, Undo2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useParams } from 'react-router-dom'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useSalon } from '@/hooks/useSalons'
import { useStaff, type StaffRow } from '@/hooks/useStaff'
import { useArchiveStaff, useCreateStaff, useUnarchiveStaff } from '@/hooks/useStaffMutations'
import { formatCurrency } from '@/lib/utils/format-currency'

import { StaffEditSheet } from './StaffEditSheet'

const PALETTE = ['#F4D7C5', '#D7E4C5', '#C5DAE4', '#E4C5DC', '#E8C4B8', '#FBE5C0']

/**
 * CRUD-страница мастеров (TASK-21):
 * — простая форма «Добавить мастера» (имя только; дефолтная схема — % с выручки 40%)
 * — карточки с summary схемы выплат и кнопкой «Изменить» (открывает StaffEditSheet
 *   с полным конфигом схемы и per-service overrides)
 * — архивирование (вместо удаления, чтобы сохранить историю визитов)
 */
export function StaffPage() {
  const { t } = useTranslation()
  const { salonId } = useParams<{ salonId: string }>()
  const { data: salon } = useSalon(salonId)

  const { data: active = [] } = useStaff(salonId, { activeOnly: true })
  const { data: all = [] } = useStaff(salonId, { activeOnly: false })
  const archived = all.filter((s) => !s.is_active)

  const [editing, setEditing] = useState<StaffRow | null>(null)
  const currency = salon?.currency ?? 'PLN'

  if (!salonId) return null

  return (
    <div className="flex flex-1 flex-col px-5 py-7 sm:px-8 lg:pb-12">
      <div className="mb-5">
        <h1 className="text-brand-navy text-2xl font-bold tracking-tight">{t('staff.title')}</h1>
        <p className="text-muted-foreground mt-1 text-sm">{t('staff.subtitle')}</p>
      </div>

      <NewStaffForm salonId={salonId} />

      <h2 className="text-muted-foreground mb-3 mt-6 text-xs font-bold uppercase tracking-wider">
        {t('staff.active', { count: active.length })}
      </h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {active.length === 0 ? (
          <p className="text-muted-foreground col-span-full text-sm">{t('staff.empty_active')}</p>
        ) : (
          active.map((s, i) => (
            <StaffCard
              key={s.id}
              staff={s}
              salonId={salonId}
              currency={currency}
              index={i}
              archived={false}
              onEdit={() => setEditing(s)}
            />
          ))
        )}
      </div>

      {archived.length > 0 ? (
        <>
          <h2 className="text-muted-foreground mb-3 mt-8 text-xs font-bold uppercase tracking-wider">
            {t('staff.archived', { count: archived.length })}
          </h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {archived.map((s) => (
              <StaffCard
                key={s.id}
                staff={s}
                salonId={salonId}
                currency={currency}
                index={all.indexOf(s)}
                archived
                onEdit={() => setEditing(s)}
              />
            ))}
          </div>
        </>
      ) : null}

      <StaffEditSheet
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) setEditing(null)
        }}
        salonId={salonId}
        staff={editing}
      />
    </div>
  )
}

function NewStaffForm({ salonId }: { salonId: string }) {
  const { t } = useTranslation()
  const [name, setName] = useState('')
  const create = useCreateStaff(salonId)

  function submit() {
    const trimmed = name.trim()
    if (trimmed.length < 2) {
      toast.error(t('staff.errors.name_too_short'))
      return
    }
    create.mutate(
      {
        full_name: trimmed,
        payout_scheme: 'percent_revenue',
        payout_percent: 40,
      },
      {
        onSuccess: () => {
          setName('')
          toast.success(t('staff.toast_added'))
        },
      },
    )
  }

  return (
    <div className="border-border bg-card shadow-finsm rounded-lg border p-4 sm:p-5">
      <h2 className="text-brand-navy mb-1 text-sm font-bold tracking-tight">
        {t('staff.add_title')}
      </h2>
      <p className="text-muted-foreground mb-3 text-xs">{t('staff.add_hint')}</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[2fr_auto]">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="staff-name">{t('staff.name_label')}</Label>
          <Input
            id="staff-name"
            placeholder={t('staff.name_placeholder')}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                submit()
              }
            }}
          />
        </div>
        <div className="flex items-end">
          <Button onClick={submit} disabled={create.isPending} className="w-full sm:w-auto">
            <Plus className="size-4" strokeWidth={2.4} />
            {t('staff.add_button')}
          </Button>
        </div>
      </div>
    </div>
  )
}

function payoutSummary(
  staff: StaffRow,
  currency: string,
  t: (key: string, opts?: unknown) => string,
): string {
  switch (staff.payout_scheme) {
    case 'percent_revenue':
      return t('staff.summary.percent_revenue', { percent: staff.payout_percent ?? 0 })
    case 'fixed':
      return t('staff.summary.fixed', {
        amount: formatCurrency(staff.payout_fixed_cents ?? 0, currency),
      })
    case 'percent_service':
      return t('staff.summary.percent_service')
    case 'chair_rent':
      return t('staff.summary.chair_rent', {
        amount: formatCurrency(staff.chair_rent_cents ?? 0, currency),
      })
    case 'mixed':
      return t('staff.summary.mixed', {
        amount: formatCurrency(staff.payout_fixed_cents ?? 0, currency),
        percent: staff.payout_percent ?? 0,
      })
    default:
      return ''
  }
}

function StaffCard({
  staff,
  salonId,
  currency,
  index,
  archived,
  onEdit,
}: {
  staff: StaffRow
  salonId: string
  currency: string
  index: number
  archived: boolean
  onEdit: () => void
}) {
  const { t } = useTranslation()
  const archive = useArchiveStaff(salonId)
  const unarchive = useUnarchiveStaff(salonId)
  const initial = (staff.full_name || '?').charAt(0).toUpperCase()
  const color = PALETTE[index % PALETTE.length]!

  return (
    <div className="border-border bg-card shadow-finsm rounded-lg border p-4">
      <div className="flex items-start justify-between">
        <div
          className="text-brand-navy grid size-12 place-items-center rounded-full text-base font-bold"
          style={{ background: archived ? '#E5E5E0' : color }}
        >
          {initial}
        </div>
        {archived ? (
          <button
            type="button"
            onClick={() =>
              unarchive.mutate(staff.id, {
                onSuccess: () => toast.success(t('staff.toast_unarchived')),
              })
            }
            className="text-secondary hover:underline"
            aria-label={t('staff.unarchive')}
            title={t('staff.unarchive')}
          >
            <Undo2 className="size-4" strokeWidth={1.7} />
          </button>
        ) : (
          <button
            type="button"
            onClick={() => {
              if (!confirm(t('staff.confirm_archive'))) return
              archive.mutate(staff.id, {
                onSuccess: () => toast.success(t('staff.toast_archived')),
              })
            }}
            className="text-muted-foreground hover:text-destructive"
            aria-label={t('staff.archive')}
            title={t('staff.archive')}
          >
            <Trash2 className="size-4" strokeWidth={1.7} />
          </button>
        )}
      </div>
      <div className="mt-3">
        <div className="text-brand-navy truncate text-base font-bold">{staff.full_name}</div>
        <div className="text-muted-foreground mt-1 text-xs">
          {payoutSummary(staff, currency, t as (key: string, opts?: unknown) => string)}
        </div>
      </div>
      {!archived ? (
        <Button variant="outline" size="sm" onClick={onEdit} className="mt-3 w-full">
          <Pencil className="size-3.5" strokeWidth={2} />
          {t('staff.edit_button')}
        </Button>
      ) : null}
    </div>
  )
}
