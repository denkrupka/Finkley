import { Plus, Trash2, Undo2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useParams } from 'react-router-dom'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useStaff, type StaffRow } from '@/hooks/useStaff'
import {
  useArchiveStaff,
  useCreateStaff,
  useUnarchiveStaff,
  useUpdateStaff,
} from '@/hooks/useStaffMutations'

const PALETTE = ['#F4D7C5', '#D7E4C5', '#C5DAE4', '#E4C5DC', '#E8C4B8', '#FBE5C0']

/**
 * Упрощённая CRUD-страница мастеров (TASK-12 стадия 1):
 * - имя, % от выручки
 * - архивирование вместо удаления (для сохранения истории визитов)
 *
 * Полная схема payout_scheme (фикс/чаевые/смешанная) — TASK-21 в стадии 2.
 *
 * Услуги (services CRUD) пока живут в /staff же отдельным разделом
 * либо переедут в /settings/services в TASK-18.
 */
export function StaffPage() {
  const { t } = useTranslation()
  const { salonId } = useParams<{ salonId: string }>()

  const { data: active = [] } = useStaff(salonId, { activeOnly: true })
  const { data: all = [] } = useStaff(salonId, { activeOnly: false })
  const archived = all.filter((s) => !s.is_active)

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
            <StaffCard key={s.id} staff={s} salonId={salonId} index={i} archived={false} />
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
              <StaffCard key={s.id} staff={s} salonId={salonId} index={all.indexOf(s)} archived />
            ))}
          </div>
        </>
      ) : null}
    </div>
  )
}

function NewStaffForm({ salonId }: { salonId: string }) {
  const { t } = useTranslation()
  const [name, setName] = useState('')
  const [percent, setPercent] = useState('40')
  const create = useCreateStaff(salonId)

  function submit() {
    const trimmed = name.trim()
    const pct = Number(percent)
    if (trimmed.length < 2) {
      toast.error(t('staff.errors.name_too_short'))
      return
    }
    if (Number.isNaN(pct) || pct < 0 || pct > 100) {
      toast.error(t('staff.errors.percent_invalid'))
      return
    }
    create.mutate(
      { full_name: trimmed, payout_percent: pct },
      {
        onSuccess: () => {
          setName('')
          setPercent('40')
          toast.success(t('staff.toast_added'))
        },
      },
    )
  }

  return (
    <div className="border-border bg-card shadow-finsm rounded-lg border p-4 sm:p-5">
      <h2 className="text-brand-navy mb-3 text-sm font-bold tracking-tight">
        {t('staff.add_title')}
      </h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[2fr_140px_auto]">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="staff-name">{t('staff.name_label')}</Label>
          <Input
            id="staff-name"
            placeholder={t('staff.name_placeholder')}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="staff-pct">{t('staff.percent_label')}</Label>
          <div className="border-brand-yellow-deep bg-brand-yellow flex h-11 items-center rounded-md border-[1.5px] px-3">
            <input
              id="staff-pct"
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

function StaffCard({
  staff,
  salonId,
  index,
  archived,
}: {
  staff: StaffRow
  salonId: string
  index: number
  archived: boolean
}) {
  const { t } = useTranslation()
  const update = useUpdateStaff(salonId)
  const archive = useArchiveStaff(salonId)
  const unarchive = useUnarchiveStaff(salonId)
  const [name, setName] = useState(staff.full_name)
  const [percent, setPercent] = useState(String(staff.payout_percent ?? 40))
  const initial = (staff.full_name || '?').charAt(0).toUpperCase()
  const color = PALETTE[index % PALETTE.length]!

  const dirty =
    name.trim() !== staff.full_name || Number(percent) !== Number(staff.payout_percent ?? 40)

  function save() {
    const pct = Number(percent)
    if (Number.isNaN(pct) || pct < 0 || pct > 100) {
      toast.error(t('staff.errors.percent_invalid'))
      return
    }
    update.mutate(
      { id: staff.id, full_name: name.trim(), payout_percent: pct },
      {
        onSuccess: () => toast.success(t('staff.toast_saved')),
      },
    )
  }

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
          >
            <Trash2 className="size-4" strokeWidth={1.7} />
          </button>
        )}
      </div>
      <div className="mt-3 flex flex-col gap-2">
        <Input value={name} onChange={(e) => setName(e.target.value)} disabled={archived} />
        <div className="border-brand-yellow-deep bg-brand-yellow flex h-11 items-center rounded-md border-[1.5px] px-3">
          <input
            type="number"
            min={0}
            max={100}
            value={percent}
            onChange={(e) => setPercent(e.target.value)}
            disabled={archived}
            className="num text-brand-navy h-full flex-1 bg-transparent text-base font-bold outline-none disabled:opacity-50"
          />
          <span className="num text-brand-navy text-base font-bold">%</span>
        </div>
        {dirty && !archived ? (
          <Button size="sm" onClick={save} disabled={update.isPending}>
            {t('common.save')}
          </Button>
        ) : null}
      </div>
    </div>
  )
}
