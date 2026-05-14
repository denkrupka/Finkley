import { Archive, Pencil, Undo2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useParams } from 'react-router-dom'
import { toast } from 'sonner'

import { SegmentationCard } from '@/routes/settings/SegmentationCard'
import { useSalon } from '@/hooks/useSalons'
import { useStaff, type StaffRow } from '@/hooks/useStaff'
import { useArchiveStaff, useUnarchiveStaff } from '@/hooks/useStaffMutations'
import { formatCurrency } from '@/lib/utils/format-currency'

import { StaffEditSheet } from './StaffEditSheet'

/**
 * /staff — справочник мастеров салона.
 *
 * Мастера появляются здесь двумя путями:
 *   1. Auto-create при accept-invite с role='staff' (через настройки →
 *      команда → пригласить мастера).
 *   2. Импорт из Booksy / других порталов бронирования.
 *
 * Ручное добавление через форму на этой странице — убрано (по требованию
 * владельца): чтобы не было разрыва между «членом команды» и «мастером».
 *
 * Таблица показывает: имя · схема выплат · доля с ретейла · ретеншен.
 * Ниже — настройки сегментации клиентов (raw cohort windows).
 *
 * «Эффективность мастеров» (визиты, выручка, ср.чек, клиенты, возвраты)
 * переехала в /reports/staff.
 */
export function StaffPage() {
  const { t } = useTranslation()
  const { salonId } = useParams<{ salonId: string }>()
  const { data: salon } = useSalon(salonId)

  const { data: active = [] } = useStaff(salonId, { activeOnly: true })
  const { data: all = [] } = useStaff(salonId, { activeOnly: false })
  const archived = all.filter((s) => !s.is_active)
  const [showArchived, setShowArchived] = useState(false)

  const [editing, setEditing] = useState<StaffRow | null>(null)
  const currency = salon?.currency ?? 'PLN'
  const tt = t as (key: string, opts?: unknown) => string

  if (!salonId) return null

  return (
    <div className="flex flex-1 flex-col px-5 py-7 sm:px-8 lg:pb-12">
      <header className="mb-5">
        <h1 className="text-brand-navy text-2xl font-bold tracking-tight">{t('staff.title')}</h1>
        <p className="text-muted-foreground mt-1 text-sm">{t('staff.subtitle_new')}</p>
      </header>

      {/* Таблица активных мастеров */}
      <div className="border-border bg-card shadow-finsm overflow-hidden rounded-lg border">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="bg-muted/40 text-muted-foreground text-xs uppercase tracking-wider">
              <tr>
                <th className="px-4 py-3 text-left">{t('staff.cols.name')}</th>
                <th className="px-4 py-3 text-left">{t('staff.cols.payout_scheme')}</th>
                <th className="px-4 py-3 text-right">{t('staff.cols.retail_share')}</th>
                <th className="px-4 py-3 text-right">{t('staff.cols.retention')}</th>
                <th className="px-4 py-3 text-right">{t('staff.cols.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {active.length === 0 ? (
                <tr>
                  <td colSpan={5} className="text-muted-foreground px-4 py-8 text-center">
                    {t('staff.empty_new')}
                  </td>
                </tr>
              ) : (
                active.map((s) => (
                  <StaffRowItem
                    key={s.id}
                    staff={s}
                    salonId={salonId}
                    currency={currency}
                    archived={false}
                    tt={tt}
                    onEdit={() => setEditing(s)}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Архив — отдельным toggle-блоком */}
      {archived.length > 0 ? (
        <div className="mt-6">
          <button
            type="button"
            onClick={() => setShowArchived((v) => !v)}
            className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider"
          >
            <Archive className="size-3.5" strokeWidth={1.8} />
            {t('staff.archived', { count: archived.length })}
            <span className="text-muted-foreground/60">{showArchived ? '▼' : '▶'}</span>
          </button>
          {showArchived ? (
            <div className="border-border bg-card shadow-finsm mt-3 overflow-hidden rounded-lg border">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-sm">
                  <tbody>
                    {archived.map((s) => (
                      <StaffRowItem
                        key={s.id}
                        staff={s}
                        salonId={salonId}
                        currency={currency}
                        archived
                        tt={tt}
                        onEdit={() => setEditing(s)}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {/* Сегментация клиентов — перенесена сюда из настроек профиля салона */}
      {salon ? (
        <div className="mt-8">
          <SegmentationCard salon={salon} />
        </div>
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

function StaffRowItem({
  staff,
  salonId,
  currency,
  archived,
  tt,
  onEdit,
}: {
  staff: StaffRow
  salonId: string
  currency: string
  archived: boolean
  tt: (key: string, opts?: unknown) => string
  onEdit: () => void
}) {
  const archive = useArchiveStaff(salonId)
  const unarchive = useUnarchiveStaff(salonId)

  const retailShare = staff.retail_payout_enabled ? `${staff.retail_payout_percent ?? 0}%` : '—'

  // Ретеншен — placeholder, реальные данные считаются на /reports/staff
  // (там RPC компонует визиты в когорты). На этой странице — просто инфо
  // про окно (retention_window_days) из настроек мастера или салона.
  const retentionWindow = staff.retention_window_days
    ? tt('staff.retention_days', { days: staff.retention_window_days })
    : '—'

  return (
    <tr className={['border-border border-t', archived ? 'opacity-60' : ''].join(' ')}>
      <td className="px-4 py-3 font-semibold">{staff.full_name}</td>
      <td className="text-muted-foreground px-4 py-3 text-xs">
        {payoutSummary(staff, currency, tt)}
      </td>
      <td className="num text-foreground px-4 py-3 text-right">{retailShare}</td>
      <td className="num text-muted-foreground px-4 py-3 text-right text-xs">{retentionWindow}</td>
      <td className="px-4 py-3 text-right">
        <div className="inline-flex gap-1">
          {!archived ? (
            <button
              type="button"
              onClick={onEdit}
              className="hover:bg-muted/60 inline-flex size-8 items-center justify-center rounded-md"
              aria-label={tt('staff.edit_button')}
              title={tt('staff.edit_button')}
            >
              <Pencil className="size-4" strokeWidth={1.8} />
            </button>
          ) : null}
          {archived ? (
            <button
              type="button"
              onClick={() =>
                unarchive.mutate(staff.id, {
                  onSuccess: () => toast.success(tt('staff.toast_unarchived')),
                })
              }
              className="text-secondary hover:bg-muted/60 inline-flex size-8 items-center justify-center rounded-md"
              aria-label={tt('staff.unarchive')}
              title={tt('staff.unarchive')}
            >
              <Undo2 className="size-4" strokeWidth={1.7} />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => {
                if (!confirm(tt('staff.confirm_archive'))) return
                archive.mutate(staff.id, {
                  onSuccess: () => toast.success(tt('staff.toast_archived')),
                })
              }}
              className="text-muted-foreground hover:text-destructive inline-flex size-8 items-center justify-center rounded-md hover:bg-rose-50"
              aria-label={tt('staff.archive')}
              title={tt('staff.archive')}
            >
              <Archive className="size-4" strokeWidth={1.7} />
            </button>
          )}
        </div>
      </td>
    </tr>
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
        percent: staff.payout_percent ?? 0,
        amount: formatCurrency(staff.payout_fixed_cents ?? 0, currency),
      })
    default:
      return ''
  }
}
