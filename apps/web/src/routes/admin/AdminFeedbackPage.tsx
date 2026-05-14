import { Bug, Check, Lightbulb, ShieldAlert, User2, Users, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import {
  useAdminFeedback,
  useFeedbackApprove,
  useFeedbackReject,
  useFeedbackStatus,
  type AdminFeedbackRow,
} from '@/hooks/useAdmin'

type Filter = {
  source: 'all' | 'team' | 'client'
  status: 'all' | 'open' | 'in_progress' | 'fixed' | 'wontfix'
  kind: 'all' | 'bug' | 'feature'
  onlyPending: boolean
}

/**
 * Фидбек/баг-репорты. Источники:
 * - team — личная команда через @finklay_dev_bot (автоматически approved)
 * - client — клиенты салонов, требует ручного апрува super-admin'а
 */
export function AdminFeedbackPage() {
  const { t } = useTranslation()
  const { data, isLoading, error } = useAdminFeedback()
  const [filter, setFilter] = useState<Filter>({
    source: 'all',
    status: 'all',
    kind: 'all',
    onlyPending: false,
  })

  const filtered = useMemo(() => {
    const rows = data?.feedback ?? []
    return rows.filter((r) => {
      if (filter.source !== 'all' && r.source !== filter.source) return false
      if (filter.status !== 'all' && r.status !== filter.status) return false
      if (filter.kind !== 'all' && r.kind !== filter.kind) return false
      if (filter.onlyPending && !(r.requires_approval && !r.approved_at)) return false
      return true
    })
  }, [data, filter])

  const pendingCount = (data?.feedback ?? []).filter(
    (r) => r.requires_approval && !r.approved_at,
  ).length

  if (isLoading) {
    return (
      <div className="p-8">
        <p className="text-muted-foreground text-sm">{t('common.loading')}</p>
      </div>
    )
  }
  if (error || !data) {
    return (
      <div className="p-8">
        <p className="text-destructive text-sm">
          {error instanceof Error ? error.message : 'load_failed'}
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col p-5 sm:p-8">
      <header className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-brand-navy text-xl font-bold">{t('admin.feedback.title')}</h1>
          <p className="text-muted-foreground mt-1 text-xs">
            {t('admin.feedback.subtitle')}
            {pendingCount > 0 ? (
              <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-bold uppercase text-rose-700">
                <ShieldAlert className="size-3" strokeWidth={2} />
                {t('admin.feedback.pending_count', { count: pendingCount })}
              </span>
            ) : null}
          </p>
        </div>

        <div className="flex flex-wrap gap-1.5">
          <Select
            value={filter.source}
            onChange={(v) => setFilter((f) => ({ ...f, source: v as Filter['source'] }))}
            options={[
              { value: 'all', label: t('admin.feedback.filter.all_sources') },
              { value: 'team', label: t('admin.feedback.source.team') },
              { value: 'client', label: t('admin.feedback.source.client') },
            ]}
          />
          <Select
            value={filter.status}
            onChange={(v) => setFilter((f) => ({ ...f, status: v as Filter['status'] }))}
            options={[
              { value: 'all', label: t('admin.feedback.filter.all_statuses') },
              { value: 'open', label: t('admin.feedback.status.open') },
              { value: 'in_progress', label: t('admin.feedback.status.in_progress') },
              { value: 'fixed', label: t('admin.feedback.status.fixed') },
              { value: 'wontfix', label: t('admin.feedback.status.wontfix') },
            ]}
          />
          <Select
            value={filter.kind}
            onChange={(v) => setFilter((f) => ({ ...f, kind: v as Filter['kind'] }))}
            options={[
              { value: 'all', label: t('admin.feedback.filter.all_kinds') },
              { value: 'bug', label: t('admin.feedback.kind.bug') },
              { value: 'feature', label: t('admin.feedback.kind.feature') },
            ]}
          />
          <label className="hover:bg-muted/60 inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-md border px-2 text-xs font-semibold">
            <input
              type="checkbox"
              checked={filter.onlyPending}
              onChange={(e) => setFilter((f) => ({ ...f, onlyPending: e.target.checked }))}
            />
            {t('admin.feedback.filter.only_pending')}
          </label>
        </div>
      </header>

      <div className="border-border bg-card shadow-finsm overflow-hidden rounded-lg border">
        {filtered.length === 0 ? (
          <p className="text-muted-foreground p-8 text-center text-sm">
            {t('admin.feedback.empty_filtered')}
          </p>
        ) : (
          <ul className="divide-border divide-y">
            {filtered.map((r) => (
              <FeedbackRow key={r.id} row={r} />
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function FeedbackRow({ row }: { row: AdminFeedbackRow }) {
  const { t } = useTranslation()
  const approve = useFeedbackApprove()
  const reject = useFeedbackReject()
  const status = useFeedbackStatus()

  const isPendingApproval = row.requires_approval && !row.approved_at
  const KindIcon = row.kind === 'feature' ? Lightbulb : Bug
  const SourceIcon = row.source === 'client' ? User2 : Users

  return (
    <li className="p-4">
      <div className="flex items-start gap-3">
        <KindIcon
          className={`mt-0.5 size-4 shrink-0 ${row.kind === 'feature' ? 'text-amber-600' : 'text-rose-600'}`}
          strokeWidth={1.8}
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span
              className={[
                'inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-bold uppercase',
                row.source === 'client'
                  ? 'bg-amber-100 text-amber-800'
                  : 'bg-slate-100 text-slate-700',
              ].join(' ')}
            >
              <SourceIcon className="size-3" strokeWidth={2} />
              {t(`admin.feedback.source.${row.source}`)}
            </span>
            <span
              className={[
                'inline-flex rounded-full px-1.5 py-0.5 text-[10px] font-bold uppercase',
                STATUS_COLOR[row.status] ?? 'bg-slate-100 text-slate-700',
              ].join(' ')}
            >
              {t(`admin.feedback.status.${row.status}`)}
            </span>
            {isPendingApproval ? (
              <span className="inline-flex items-center gap-0.5 rounded-full bg-rose-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-rose-700">
                <ShieldAlert className="size-3" strokeWidth={2} />
                {t('admin.feedback.pending_approval')}
              </span>
            ) : null}
            <span className="text-muted-foreground text-[10px]">
              {new Date(row.reported_at).toLocaleString('ru-RU')}
            </span>
          </div>

          <p className="text-foreground mt-1 whitespace-pre-wrap text-sm">
            {row.message_text || row.ai_summary || '—'}
          </p>

          <div className="text-muted-foreground mt-1 flex flex-wrap gap-2 text-[11px]">
            {row.sender_username ? <span>@{row.sender_username}</span> : null}
            {row.sender_first_name ? <span>{row.sender_first_name}</span> : null}
            {row.area ? <span>· {row.area}</span> : null}
          </div>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-1">
          {isPendingApproval ? (
            <div className="flex gap-1">
              <button
                type="button"
                onClick={() =>
                  approve.mutate(
                    { id: row.id },
                    {
                      onSuccess: () => toast.success(t('admin.feedback.toast.approved')),
                      onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
                    },
                  )
                }
                className="inline-flex h-7 items-center gap-1 rounded-md bg-emerald-600 px-2 text-xs font-semibold text-white hover:bg-emerald-700"
              >
                <Check className="size-3.5" strokeWidth={2} />
                {t('admin.feedback.action.approve')}
              </button>
              <button
                type="button"
                onClick={() =>
                  reject.mutate(
                    { id: row.id },
                    {
                      onSuccess: () => toast.success(t('admin.feedback.toast.rejected')),
                      onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
                    },
                  )
                }
                className="inline-flex h-7 items-center gap-1 rounded-md bg-rose-600 px-2 text-xs font-semibold text-white hover:bg-rose-700"
              >
                <X className="size-3.5" strokeWidth={2} />
                {t('admin.feedback.action.reject')}
              </button>
            </div>
          ) : (
            <select
              value={row.status}
              onChange={(e) =>
                status.mutate(
                  { id: row.id, status: e.target.value },
                  {
                    onSuccess: () => toast.success(t('admin.feedback.toast.status_updated')),
                    onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
                  },
                )
              }
              className="border-border bg-card h-7 rounded-md border px-1.5 text-xs"
            >
              <option value="open">{t('admin.feedback.status.open')}</option>
              <option value="in_progress">{t('admin.feedback.status.in_progress')}</option>
              <option value="fixed">{t('admin.feedback.status.fixed')}</option>
              <option value="wontfix">{t('admin.feedback.status.wontfix')}</option>
              <option value="duplicate">{t('admin.feedback.status.duplicate')}</option>
            </select>
          )}
        </div>
      </div>
    </li>
  )
}

function Select({
  value,
  onChange,
  options,
}: {
  value: string
  onChange: (v: string) => void
  options: Array<{ value: string; label: string }>
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="border-border bg-card h-9 rounded-md border px-2 text-xs"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  )
}

const STATUS_COLOR: Record<string, string> = {
  open: 'bg-sky-100 text-sky-700',
  in_progress: 'bg-amber-100 text-amber-800',
  fixed: 'bg-emerald-100 text-emerald-700',
  wontfix: 'bg-slate-100 text-slate-600',
  duplicate: 'bg-slate-100 text-slate-600',
}
