import { useQuery } from '@tanstack/react-query'
import {
  AlertTriangle,
  Bell,
  Check,
  Info,
  MessageCircle,
  Sparkles,
  Zap,
  type LucideIcon,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useParams } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useAuth } from '@/hooks/useAuth'
import { useMarkAllInAppRead, useMarkInAppRead } from '@/hooks/useNotifications'
import { supabase } from '@/lib/supabase/client'
import { cn } from '@/lib/utils/cn'

type NotifRow = {
  id: string
  salon_id: string | null
  type: string
  payload: Record<string, unknown>
  read_at: string | null
  created_at: string
}

const PAGE_SIZE = 50

const TYPE_KEYS = [
  'ai_insights',
  'low_inventory',
  'payment_due_2d',
  'payment_due_1d',
  'payment_due_today',
  'payment_overdue',
  'booksy_new_visits',
  'calendar_conflicts',
  'messenger_new_message',
  'weekly_digest',
  'daily_digest',
] as const

/**
 * T44 — полный список in-app уведомлений для текущего юзера. Поддерживает:
 *   - Фильтр по типу (TYPE_KEYS).
 *   - Фильтр read/unread.
 *   - Пагинация 50 на страницу.
 *   - Кнопка «Прочитать всё».
 *   - Клик по строке → mark read + переход на источник.
 */
export function NotificationsPage() {
  const { t } = useTranslation()
  const { salonId } = useParams<{ salonId: string }>()
  const { user } = useAuth()
  const markAll = useMarkAllInAppRead()
  const markOne = useMarkInAppRead()

  const [typeFilter, setTypeFilter] = useState<string>('all')
  const [readFilter, setReadFilter] = useState<'all' | 'unread' | 'read'>('all')
  const [page, setPage] = useState(1)

  useEffect(() => {
    setPage(1)
  }, [typeFilter, readFilter])

  const query = useQuery<{ rows: NotifRow[]; total: number }>({
    queryKey: ['notifications-page', user?.id ?? 'anon', typeFilter, readFilter, page],
    queryFn: async () => {
      if (!user?.id) return { rows: [], total: 0 }
      let q = supabase
        .from('in_app_notifications')
        .select('id, salon_id, type, payload, read_at, created_at', { count: 'exact' })
        .order('created_at', { ascending: false })
        .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1)
      if (typeFilter !== 'all') q = q.eq('type', typeFilter)
      if (readFilter === 'unread') q = q.is('read_at', null)
      if (readFilter === 'read') q = q.not('read_at', 'is', null)
      const { data, count, error } = await q
      if (error) throw error
      return { rows: (data ?? []) as NotifRow[], total: count ?? 0 }
    },
    enabled: !!user?.id,
    staleTime: 10_000,
  })

  const rows = query.data?.rows ?? []
  const total = query.data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <div className="flex flex-1 flex-col px-5 py-7 sm:px-8 lg:pb-12">
      <header className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-brand-navy text-2xl font-bold tracking-tight">
            {t('notifications.page_title', { defaultValue: 'Уведомления' })}
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {t('notifications.page_subtitle', {
              defaultValue: 'История in-app уведомлений за всё время.',
            })}
          </p>
        </div>
        <Button
          variant="outline"
          size="md"
          onClick={() => markAll.mutate()}
          disabled={markAll.isPending}
        >
          <Check className="size-4" strokeWidth={2} />
          {t('notifications.mark_all_read', { defaultValue: 'Прочитать всё' })}
        </Button>
      </header>

      {/* Фильтры */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="h-10 w-[220px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">
              {t('notifications.filter.all_types', { defaultValue: 'Все типы' })}
            </SelectItem>
            {TYPE_KEYS.map((tk) => (
              <SelectItem key={tk} value={tk}>
                {t(`notif.type.${tk}`, { defaultValue: tk })}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={readFilter} onValueChange={(v) => setReadFilter(v as typeof readFilter)}>
          <SelectTrigger className="h-10 w-[180px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">
              {t('notifications.filter.all_status', { defaultValue: 'Все' })}
            </SelectItem>
            <SelectItem value="unread">
              {t('notifications.filter.unread', { defaultValue: 'Непрочитанные' })}
            </SelectItem>
            <SelectItem value="read">
              {t('notifications.filter.read', { defaultValue: 'Прочитанные' })}
            </SelectItem>
          </SelectContent>
        </Select>
        <span className="text-muted-foreground ml-auto text-xs">
          {t('notifications.records', { defaultValue: '{{n}} записей', n: total })}
        </span>
      </div>

      {/* Список */}
      <div className="border-border bg-card shadow-finsm overflow-hidden rounded-lg border">
        {query.isLoading ? (
          <div className="p-8 text-center">
            <Sparkles
              className="text-muted-foreground mx-auto size-6 animate-pulse"
              strokeWidth={1.5}
            />
          </div>
        ) : rows.length === 0 ? (
          <div className="p-12 text-center">
            <Bell className="text-muted-foreground mx-auto size-8" strokeWidth={1.5} />
            <p className="text-muted-foreground mt-3 text-sm">
              {t('notifications.empty', { defaultValue: 'Уведомлений нет' })}
            </p>
          </div>
        ) : (
          <ul>
            {rows.map((n) => (
              <NotificationListRow
                key={n.id}
                row={n}
                salonId={salonId}
                onClick={(id) => {
                  if (!n.read_at) markOne.mutate(id)
                }}
              />
            ))}
          </ul>
        )}
      </div>

      {/* Пагинация */}
      {totalPages > 1 ? (
        <div className="mt-3 flex items-center justify-end gap-2">
          <span className="text-muted-foreground text-xs">
            {page} / {totalPages}
          </span>
          <button
            type="button"
            onClick={() => setPage(Math.max(1, page - 1))}
            disabled={page === 1}
            className="border-border hover:bg-muted/40 inline-flex h-8 items-center rounded-md border px-3 text-xs font-semibold disabled:opacity-40"
          >
            ‹
          </button>
          <button
            type="button"
            onClick={() => setPage(Math.min(totalPages, page + 1))}
            disabled={page === totalPages}
            className="border-border hover:bg-muted/40 inline-flex h-8 items-center rounded-md border px-3 text-xs font-semibold disabled:opacity-40"
          >
            ›
          </button>
        </div>
      ) : null}
    </div>
  )
}

function NotificationListRow({
  row,
  salonId,
  onClick,
}: {
  row: NotifRow
  salonId: string | undefined
  onClick: (id: string) => void
}) {
  const { t } = useTranslation()
  const { title, body, severity, Icon, link } = describe(row, t, salonId)
  const isUnread = !row.read_at
  const colorCls =
    severity === 'critical'
      ? 'text-destructive'
      : severity === 'warning'
        ? 'text-amber-600'
        : 'text-brand-teal-deep'
  const ts = new Date(row.created_at).toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })

  const content = (
    <li
      className={cn(
        'border-border/60 flex items-start gap-3 border-b px-5 py-3.5 last:border-b-0',
        isUnread ? 'bg-amber-50/40' : '',
      )}
    >
      <div className="mt-0.5 flex shrink-0 items-center gap-1.5">
        {isUnread ? <span className="bg-destructive size-1.5 rounded-full" /> : null}
        <Icon className={cn('size-4', colorCls)} strokeWidth={2} />
      </div>
      <div className="min-w-0 flex-1">
        <p className={cn('text-brand-navy text-sm', isUnread ? 'font-bold' : 'font-semibold')}>
          {title}
        </p>
        {body ? <p className="text-muted-foreground mt-0.5 text-xs">{body}</p> : null}
      </div>
      <span className="num text-muted-foreground shrink-0 text-[11px]">{ts}</span>
    </li>
  )

  if (link) {
    return (
      <Link to={link} onClick={() => onClick(row.id)} className="hover:bg-muted/30 block">
        {content}
      </Link>
    )
  }
  return (
    <button
      type="button"
      onClick={() => onClick(row.id)}
      className="hover:bg-muted/30 block w-full text-left"
    >
      {content}
    </button>
  )
}

function describe(
  row: NotifRow,
  t: (k: string, opts?: Record<string, unknown>) => string,
  salonId: string | undefined,
): {
  title: string
  body: string
  severity: 'info' | 'warning' | 'critical'
  Icon: LucideIcon
  link?: string
} {
  const sid = row.salon_id || salonId
  const p = row.payload
  switch (row.type) {
    case 'ai_insights':
      return {
        title: `🔮 ${String(p.headline ?? '')}`,
        body: String(p.body ?? ''),
        severity: 'info',
        Icon: Sparkles,
        link: sid ? `/${sid}/dashboard` : undefined,
      }
    case 'low_inventory': {
      const items = (p.items as Array<{ name: string }>) ?? []
      return {
        title: t('notif.low_inv_title', { defaultValue: '⚠️ Заканчиваются материалы' }),
        body: t('notif.low_inv_desc', { defaultValue: '{{n}} ниже минимума', n: items.length }),
        severity: 'warning',
        Icon: Zap,
        link: sid ? `/${sid}/inventory` : undefined,
      }
    }
    case 'payment_overdue':
      return {
        title: t('notif.payment_overdue', { defaultValue: '🔴 Платёж просрочен' }),
        body: `${p.counterparty ?? '—'} · ${p.amount_formatted ?? ''}`,
        severity: 'critical',
        Icon: AlertTriangle,
        link: sid ? `/${sid}/expenses?tab=pending` : undefined,
      }
    case 'payment_due_today':
      return {
        title: t('notif.payment_due_today', { defaultValue: '⏰ Платёж сегодня' }),
        body: `${p.counterparty ?? '—'} · ${p.amount_formatted ?? ''}`,
        severity: 'warning',
        Icon: AlertTriangle,
        link: sid ? `/${sid}/expenses?tab=pending` : undefined,
      }
    case 'payment_due_1d':
      return {
        title: t('notif.payment_due_1d', { defaultValue: '⏰ Платёж завтра' }),
        body: `${p.counterparty ?? '—'} · ${p.amount_formatted ?? ''}`,
        severity: 'info',
        Icon: Info,
        link: sid ? `/${sid}/expenses?tab=pending` : undefined,
      }
    case 'payment_due_2d':
      return {
        title: t('notif.payment_due_2d', { defaultValue: '🗓 Платёж через 2 дня' }),
        body: `${p.counterparty ?? '—'} · ${p.amount_formatted ?? ''}`,
        severity: 'info',
        Icon: Info,
        link: sid ? `/${sid}/expenses?tab=pending` : undefined,
      }
    case 'booksy_new_visits':
      return {
        title: t('notif.booksy_title', {
          defaultValue: '📅 Импорт Booksy: +{{n}} визитов',
          n: p.count ?? 0,
        }),
        body: '',
        severity: 'info',
        Icon: Info,
        link: sid ? `/${sid}/income?tab=visits` : undefined,
      }
    case 'calendar_conflicts': {
      const conflicts = (p.conflicts as Array<unknown>) ?? []
      return {
        title: t('notif.conflict_title', { defaultValue: '⚠️ Конфликт в календаре' }),
        body: t('notif.conflict_desc', {
          defaultValue: '{{n}} двойных записей',
          n: conflicts.length,
        }),
        severity: 'warning',
        Icon: AlertTriangle,
        link: sid ? `/${sid}/income?tab=visits&view=calendar` : undefined,
      }
    }
    case 'messenger_new_message':
      return {
        title: t('notif.messenger_title', {
          defaultValue: '💬 Сообщение от {{sender}}',
          sender: String(p.sender ?? ''),
        }),
        body: String(p.preview ?? ''),
        severity: 'info',
        Icon: MessageCircle,
        link: sid ? `/${sid}/messenger` : undefined,
      }
    case 'weekly_digest':
      return {
        title: t('notif.weekly_digest', { defaultValue: '📊 Дайджест за неделю готов' }),
        body: '',
        severity: 'info',
        Icon: Info,
        link: sid ? `/${sid}/reports` : undefined,
      }
    case 'daily_digest':
      return {
        title: t('notif.daily_digest', { defaultValue: '📊 Сводка за день готова' }),
        body: '',
        severity: 'info',
        Icon: Info,
        link: sid ? `/${sid}/reports` : undefined,
      }
    default:
      return {
        title: t('notif.generic', { defaultValue: '🔔 Уведомление' }),
        body: '',
        severity: 'info',
        Icon: Bell,
      }
  }
}
