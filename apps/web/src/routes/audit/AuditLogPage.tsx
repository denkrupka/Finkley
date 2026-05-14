import { format, formatDistanceToNow } from 'date-fns'
import { ru } from 'date-fns/locale'
import { ArrowLeft, FileText, History, User as UserIcon } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useParams } from 'react-router-dom'

import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAuditLog, type AuditEntry, type AuditFilters } from '@/hooks/useAuditLog'

const ACTION_ICON: Record<string, string> = {
  'visit.create': '✨',
  'visit.update': '✏️',
  'visit.delete': '🗑',
  'expense.create': '💸',
  'expense.update': '✏️',
  'expense.delete': '🗑',
  'team.member_added': '👋',
  'team.role_changed': '🔧',
  'team.member_removed': '👋',
  'team.invitation_sent': '✉️',
  'team.invitation_accepted': '🎉',
  'team.invitation_cancelled': '✖',
  'salon.updated': '⚙️',
  'salon.deleted': '🗑',
}

const ACTION_FILTERS: { value: string; key: string }[] = [
  { value: '', key: 'audit.filter.all' },
  { value: 'visit.', key: 'audit.filter.visits' },
  { value: 'expense.', key: 'audit.filter.expenses' },
  { value: 'team.', key: 'audit.filter.team' },
  { value: 'salon.', key: 'audit.filter.salon' },
]

/**
 * /salon/settings/audit — журнал событий. Показывает кто (имя/email),
 * когда (полная дата + relative «час назад»), действие, базовые детали
 * (из payload через summarizePayload). Фильтры: диапазон дат + тип события.
 */
export function AuditLogPage() {
  const { t } = useTranslation()
  const { salonId } = useParams<{ salonId: string }>()
  const [filters, setFilters] = useState<AuditFilters>({})
  const { data: entries = [], isLoading, error } = useAuditLog(salonId, filters)

  if (!salonId) return null

  return (
    <div className="flex flex-1 flex-col px-5 py-7 sm:px-8 lg:pb-12">
      <div className="mb-5">
        <Link
          to={`/${salonId}/settings`}
          className="text-muted-foreground hover:text-foreground mb-2 inline-flex items-center gap-1 text-sm"
        >
          <ArrowLeft className="size-4" strokeWidth={1.7} />
          {t('audit.back_to_settings')}
        </Link>
        <h1 className="text-brand-navy flex items-center gap-2 text-2xl font-bold tracking-tight">
          <History className="size-5" strokeWidth={1.8} />
          {t('audit.title')}
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">{t('audit.subtitle')}</p>
      </div>

      {/* Фильтры */}
      <div className="border-border bg-card shadow-finsm mb-4 grid grid-cols-1 gap-3 rounded-lg border p-4 sm:grid-cols-[1fr_1fr_1fr]">
        <div>
          <Label className="text-xs">{t('audit.filter.from')}</Label>
          <Input
            type="date"
            value={filters.fromDate ?? ''}
            onChange={(e) => setFilters((f) => ({ ...f, fromDate: e.target.value || null }))}
            className="mt-1 h-9"
          />
        </div>
        <div>
          <Label className="text-xs">{t('audit.filter.to')}</Label>
          <Input
            type="date"
            value={filters.toDate ?? ''}
            onChange={(e) => setFilters((f) => ({ ...f, toDate: e.target.value || null }))}
            className="mt-1 h-9"
          />
        </div>
        <div>
          <Label className="text-xs">{t('audit.filter.type')}</Label>
          <select
            value={filters.actionPrefix ?? ''}
            onChange={(e) => setFilters((f) => ({ ...f, actionPrefix: e.target.value }))}
            className="border-border bg-card mt-1 h-9 w-full rounded-md border px-2 text-sm"
          >
            {ACTION_FILTERS.map((a) => (
              <option key={a.value} value={a.value}>
                {t(a.key)}
              </option>
            ))}
          </select>
        </div>
      </div>

      {isLoading ? (
        <div className="flex flex-col gap-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="bg-muted/60 h-12 animate-pulse rounded-md" />
          ))}
        </div>
      ) : error ? (
        <p className="text-destructive text-sm">{(error as Error).message}</p>
      ) : entries.length === 0 ? (
        <div className="border-border bg-card rounded-lg border border-dashed px-6 py-12 text-center">
          <FileText className="text-muted-foreground mx-auto mb-3 size-8" strokeWidth={1.5} />
          <p className="text-muted-foreground text-sm">{t('audit.empty')}</p>
        </div>
      ) : (
        <ul className="border-border bg-card shadow-finsm divide-border divide-y overflow-hidden rounded-lg border">
          {entries.map((e) => (
            <AuditRow key={e.id} entry={e} />
          ))}
        </ul>
      )}
    </div>
  )
}

function AuditRow({ entry }: { entry: AuditEntry }) {
  const { t } = useTranslation()
  const icon = ACTION_ICON[entry.action] ?? '•'
  const date = new Date(entry.created_at)
  const ago = formatDistanceToNow(date, { addSuffix: true, locale: ru })
  const fullDate = format(date, 'd MMMM yyyy, HH:mm', { locale: ru })

  const author = entry.user_full_name || entry.user_email || t('audit.unknown_author')

  return (
    <li className="grid grid-cols-[24px_1fr_auto] items-start gap-3 px-5 py-3.5">
      <span className="text-base leading-6" aria-hidden>
        {icon}
      </span>
      <div className="min-w-0">
        <p className="text-foreground text-sm font-medium">
          {t(`audit.action.${entry.action}`, entry.action)}
        </p>
        <p className="text-muted-foreground mt-0.5 inline-flex items-center gap-1 text-[11px]">
          <UserIcon className="size-3" strokeWidth={1.8} />
          {author}
          {entry.user_email && entry.user_full_name ? (
            <span className="text-muted-foreground/70"> · {entry.user_email}</span>
          ) : null}
        </p>
        {entry.payload ? (
          <p className="text-muted-foreground mt-0.5 truncate text-xs">
            {summarizePayload(entry.action, entry.payload)}
          </p>
        ) : null}
      </div>
      <div className="shrink-0 text-right">
        <p className="text-muted-foreground text-xs" title={fullDate}>
          {ago}
        </p>
        <p className="text-muted-foreground/70 mt-0.5 text-[10px]">{fullDate}</p>
      </div>
    </li>
  )
}

function summarizePayload(action: string, payload: Record<string, unknown>): string {
  if (action.startsWith('visit')) {
    const amount = (payload.amount_cents ??
      (payload.new as Record<string, unknown>)?.amount_cents) as number | undefined
    return amount !== undefined ? `${(amount / 100).toFixed(2)}` : ''
  }
  if (action.startsWith('expense')) {
    const amount = (payload.amount_cents ?? payload.new_amount) as number | undefined
    return amount !== undefined ? `${(amount / 100).toFixed(2)}` : ''
  }
  if (action.startsWith('team.')) {
    const email = payload.email as string | undefined
    const role = payload.role as string | undefined
    return [email, role].filter(Boolean).join(' · ')
  }
  if (action === 'salon.updated') {
    const oldName = payload.old_name as string | undefined
    const newName = payload.new_name as string | undefined
    return oldName !== newName ? `${oldName ?? '—'} → ${newName ?? '—'}` : ''
  }
  return ''
}
