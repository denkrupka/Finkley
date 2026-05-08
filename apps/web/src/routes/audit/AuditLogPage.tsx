import { format, formatDistanceToNow } from 'date-fns'
import { ru } from 'date-fns/locale'
import { ArrowLeft, FileText, History } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link, useParams } from 'react-router-dom'

import { useAuditLog, type AuditEntry } from '@/hooks/useAuditLog'

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

export function AuditLogPage() {
  const { t } = useTranslation()
  const { salonId } = useParams<{ salonId: string }>()
  const { data: entries = [], isLoading, error } = useAuditLog(salonId)

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

  return (
    <li className="grid grid-cols-[24px_1fr_auto] items-start gap-3 px-5 py-3.5">
      <span className="text-base leading-6" aria-hidden>
        {icon}
      </span>
      <div className="min-w-0">
        <p className="text-foreground text-sm font-medium">
          {t(`audit.action.${entry.action}`, entry.action)}
        </p>
        {entry.payload ? (
          <p className="text-muted-foreground mt-0.5 truncate text-xs">
            {summarizePayload(entry.action, entry.payload)}
          </p>
        ) : null}
      </div>
      <span className="text-muted-foreground shrink-0 text-xs" title={fullDate}>
        {ago}
      </span>
    </li>
  )
}

function summarizePayload(action: string, payload: Record<string, unknown>): string {
  if (action.startsWith('visit')) {
    const amount = (payload.amount_cents ??
      (payload.new as Record<string, unknown>)?.amount_cents) as number | undefined
    return amount !== undefined ? `${(amount / 100).toFixed(2)} (cents)` : ''
  }
  if (action.startsWith('expense')) {
    const amount = (payload.amount_cents ?? payload.new_amount) as number | undefined
    return amount !== undefined ? `${(amount / 100).toFixed(2)} (cents)` : ''
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
