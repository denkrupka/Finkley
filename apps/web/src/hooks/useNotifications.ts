import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { useAuth } from '@/hooks/useAuth'
import { supabase } from '@/lib/supabase/client'

import { useBenchmarkComparison } from './useBenchmarks'
import { useCategoryBudgets } from './useExpenseExtras'
import { useInsights } from './useInsights'
import { useSalon } from './useSalons'
import { useUpcomingTemplates } from './useVisitTemplates'

export type NotificationItem = {
  id: string
  kind: 'insight' | 'overdue_template' | 'budget_exceeded' | 'messenger_message' | 'in_app'
  severity: 'info' | 'warning' | 'critical'
  title: string
  body: string
  link?: string
  /** ISO timestamp — для чтения с last-seen стейтом */
  ts: string
  /** Только для kind='in_app': прочитано ли (in_app_notifications.read_at IS NOT NULL). */
  read?: boolean
  /** Только для kind='in_app': id строки в БД для mark-as-read. */
  dbId?: string
}

/** Непрочитанные диалоги мессенджера для feed уведомлений в TopBar. */
function useMessengerUnreadConversations(salonId: string | undefined) {
  const qc = useQueryClient()
  useEffect(() => {
    if (!salonId) return
    const channel = supabase
      .channel(`notifs-messenger:${salonId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'messenger_conversations',
          filter: `salon_id=eq.${salonId}`,
        },
        () => {
          qc.invalidateQueries({ queryKey: ['notifs-messenger-unread', salonId] })
        },
      )
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [salonId, qc])

  return useQuery<
    Array<{
      id: string
      display_name: string
      last_message_preview: string | null
      last_message_at: string
      unread_count: number
      channel: string
    }>
  >({
    queryKey: ['notifs-messenger-unread', salonId],
    queryFn: async () => {
      if (!salonId) return []
      const { data, error } = await supabase
        .from('messenger_conversations')
        .select('id, display_name, last_message_preview, last_message_at, unread_count, channel')
        .eq('salon_id', salonId)
        .gt('unread_count', 0)
        .is('archived_at', null)
        .order('last_message_at', { ascending: false })
        .limit(20)
      if (error) throw error
      return data ?? []
    },
    enabled: !!salonId,
    staleTime: 10_000,
  })
}

const LAST_SEEN_KEY = (salonId: string) => `finkley:notif-last-seen:${salonId}`

/** Тип уведомления → ссылка в портале + severity. */
function deriveLink(salonId: string | undefined, type: string): string | undefined {
  if (!salonId) return undefined
  switch (type) {
    case 'low_inventory':
      return `/${salonId}/inventory`
    case 'payment_due_2d':
    case 'payment_due_1d':
    case 'payment_due_today':
    case 'payment_overdue':
      return `/${salonId}/expenses?tab=pending`
    case 'booksy_new_visits':
      return `/${salonId}/income?tab=visits`
    case 'calendar_conflicts':
      return `/${salonId}/income?tab=visits&view=calendar`
    case 'messenger_new_message':
      return `/${salonId}/messenger`
    case 'ai_insights':
      return `/${salonId}/dashboard`
    case 'weekly_digest':
    case 'daily_digest':
      return `/${salonId}/reports`
    default:
      return undefined
  }
}

function deriveSeverity(type: string): 'info' | 'warning' | 'critical' {
  if (type === 'payment_overdue') return 'critical'
  if (type === 'low_inventory' || type === 'calendar_conflicts' || type === 'payment_due_today')
    return 'warning'
  return 'info'
}

function deriveTitleBody(
  type: string,
  payload: Record<string, unknown>,
  t: (k: string, opts?: Record<string, unknown>) => string,
): { title: string; body: string } {
  switch (type) {
    case 'ai_insights':
      return {
        title: `🔮 ${String(payload.headline ?? t('notif.generic'))}`,
        body: String(payload.body ?? ''),
      }
    case 'low_inventory': {
      const items = (payload.items as Array<{ name: string }>) ?? []
      return {
        title: t('notif.low_inv_title', { defaultValue: '⚠️ Заканчиваются материалы' }),
        body: t('notif.low_inv_desc', {
          defaultValue: '{{n}} позиций ниже минимума',
          n: items.length,
        }),
      }
    }
    case 'payment_overdue':
      return {
        title: t('notif.payment_overdue', { defaultValue: '🔴 Платёж просрочен' }),
        body: `${payload.counterparty ?? '—'} · ${payload.amount_formatted ?? ''}`,
      }
    case 'payment_due_today':
      return {
        title: t('notif.payment_due_today', { defaultValue: '⏰ Платёж сегодня' }),
        body: `${payload.counterparty ?? '—'} · ${payload.amount_formatted ?? ''}`,
      }
    case 'payment_due_1d':
      return {
        title: t('notif.payment_due_1d', { defaultValue: '⏰ Платёж завтра' }),
        body: `${payload.counterparty ?? '—'} · ${payload.amount_formatted ?? ''}`,
      }
    case 'payment_due_2d':
      return {
        title: t('notif.payment_due_2d', { defaultValue: '🗓 Платёж через 2 дня' }),
        body: `${payload.counterparty ?? '—'} · ${payload.amount_formatted ?? ''}`,
      }
    case 'booksy_new_visits':
      return {
        title: t('notif.booksy_title', {
          defaultValue: '📅 Импорт Booksy: +{{n}} визитов',
          n: payload.count ?? 0,
        }),
        body: '',
      }
    case 'calendar_conflicts': {
      const conflicts = (payload.conflicts as Array<unknown>) ?? []
      return {
        title: t('notif.conflict_title', { defaultValue: '⚠️ Конфликт в календаре' }),
        body: t('notif.conflict_desc', {
          defaultValue: '{{n}} двойных записей',
          n: conflicts.length,
        }),
      }
    }
    case 'messenger_new_message':
      return {
        title: t('notif.messenger_title', {
          defaultValue: '💬 Новое сообщение · {{sender}}',
          sender: String(payload.sender ?? ''),
        }),
        body: String(payload.preview ?? ''),
      }
    case 'weekly_digest':
      return {
        title: t('notif.weekly_digest', { defaultValue: '📊 Дайджест за неделю готов' }),
        body: '',
      }
    case 'daily_digest':
      return {
        title: t('notif.daily_digest', { defaultValue: '📊 Сводка за день готова' }),
        body: '',
      }
    default:
      return { title: t('notif.generic', { defaultValue: '🔔 Уведомление' }), body: '' }
  }
}

/** Список последних 50 in-app уведомлений из БД + realtime invalidation. */
function useInAppNotificationsList() {
  const { user } = useAuth()
  const qc = useQueryClient()
  useEffect(() => {
    if (!user?.id) return
    const channel = supabase
      .channel(`in-app-notif-list:${user.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'in_app_notifications',
          filter: `user_id=eq.${user.id}`,
        },
        () => {
          qc.invalidateQueries({ queryKey: ['in-app-notifications', user.id] })
        },
      )
      .subscribe()
    return () => {
      void supabase.removeChannel(channel)
    }
  }, [user?.id, qc])
  return useQuery<
    Array<{
      id: string
      salon_id: string | null
      type: string
      payload: Record<string, unknown>
      read_at: string | null
      created_at: string
    }>
  >({
    queryKey: ['in-app-notifications', user?.id ?? 'anon'],
    queryFn: async () => {
      if (!user?.id) return []
      const { data, error } = await supabase
        .from('in_app_notifications')
        .select('id, salon_id, type, payload, read_at, created_at')
        .order('created_at', { ascending: false })
        .limit(50)
      if (error) throw error
      return data ?? []
    },
    enabled: !!user?.id,
    staleTime: 10_000,
  })
}

/** Mark all unread in_app_notifications as read. */
export function useMarkAllInAppRead() {
  const { user } = useAuth()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      if (!user?.id) return
      const { error } = await supabase
        .from('in_app_notifications')
        .update({ read_at: new Date().toISOString() })
        .eq('user_id', user.id)
        .is('read_at', null)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['in-app-notifications', user?.id] })
    },
  })
}

/** Mark single notification as read (по dbId). */
export function useMarkInAppRead() {
  const { user } = useAuth()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('in_app_notifications')
        .update({ read_at: new Date().toISOString() })
        .eq('id', id)
        .is('read_at', null)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['in-app-notifications', user?.id] })
    },
  })
}

/**
 * In-app уведомления — вместо Web Push. Объединяет в один feed:
 *  - открытые AI-инсайты (severity ≥ warning)
 *  - просроченные visit_templates (days_until ≤ 0)
 *  - категории расходов с превышением бюджета (>100%)
 *
 * Read-state хранится в localStorage (last-seen timestamp), не в БД —
 * тут и так всё derive'ится. Mark-all-read обновляет last-seen на сейчас.
 */
export function useNotifications(salonId: string | undefined) {
  const { t } = useTranslation()
  const { data: insights = [] } = useInsights(salonId)
  const { data: upcoming = [] } = useUpcomingTemplates(salonId, 0) // только overdue/today
  const { data: budgets = [] } = useCategoryBudgets(salonId)
  const { data: unreadConvos = [] } = useMessengerUnreadConversations(salonId)
  const { data: salon } = useSalon(salonId)
  const { data: inAppList = [] } = useInAppNotificationsList()
  const markAllInApp = useMarkAllInAppRead()
  // benchmark не показываем как нотификацию — это скорее интересный факт, не алерт
  useBenchmarkComparison(salonId) // подгружаем в кэш для consistency

  // Тогл «Новое сообщение в мессенджере» из Настройки → Уведомления → Типы.
  // Отсутствие ключа = включено по умолчанию.
  const messengerNotifEnabled = (salon?.notification_prefs ?? {}).messenger_new_message !== false

  const items = useMemo<NotificationItem[]>(() => {
    const out: NotificationItem[] = []

    // T43 — in_app_notifications из БД (отправляются send-notification Edge
    // Function для всех типов: low_inventory, payment_due_*, ai_insights и т.д.).
    for (const n of inAppList) {
      // Фильтруем по текущему салону если задан, иначе показываем все.
      if (salonId && n.salon_id && n.salon_id !== salonId) continue
      const { title, body } = deriveTitleBody(n.type, n.payload, t)
      out.push({
        id: `inapp:${n.id}`,
        kind: 'in_app',
        severity: deriveSeverity(n.type),
        title,
        body,
        link: deriveLink(n.salon_id ?? salonId, n.type),
        ts: n.created_at,
        read: !!n.read_at,
        dbId: n.id,
      })
    }

    if (messengerNotifEnabled) {
      for (const c of unreadConvos) {
        const channelLabel = t(`messenger.channel.${c.channel}`, { defaultValue: c.channel })
        out.push({
          id: `msg:${c.id}`,
          kind: 'messenger_message',
          severity: 'warning',
          title: c.display_name || t('messenger.unknown_sender'),
          body:
            c.last_message_preview?.slice(0, 120) ||
            t('notifications.messenger.body_no_preview', {
              count: c.unread_count,
              channel: channelLabel,
              defaultValue: `${c.unread_count} непрочитанных в ${channelLabel}`,
            }),
          link: salonId ? `/${salonId}/messenger?convo=${c.id}` : undefined,
          ts: c.last_message_at,
        })
      }
    }

    for (const i of insights) {
      // Только warning/critical — info-инсайты живут на дашборде, не в уведомлениях
      if (i.severity === 'info') continue
      out.push({
        id: `insight:${i.id}`,
        kind: 'insight',
        severity: i.severity,
        title: i.title,
        body: i.body,
        link: salonId ? `/${salonId}/dashboard` : undefined,
        ts: i.created_at,
      })
    }

    for (const u of upcoming) {
      if (u.days_until > 0) continue
      const overdue = u.days_until < 0
      out.push({
        id: `overdue:${u.id}`,
        kind: 'overdue_template',
        severity: overdue ? 'warning' : 'info',
        title: t('notifications.overdue.title', { name: u.client_name }),
        body: overdue
          ? t('notifications.overdue.body_overdue', { count: Math.abs(u.days_until) })
          : t('notifications.overdue.body_today'),
        link: salonId ? `/${salonId}/clients` : undefined,
        ts: new Date().toISOString(),
      })
    }

    for (const b of budgets) {
      if (b.progress_pct == null || b.progress_pct < 100) continue
      out.push({
        id: `budget:${b.category_id}`,
        kind: 'budget_exceeded',
        severity: b.progress_pct > 130 ? 'critical' : 'warning',
        title: t('notifications.budget.title', { name: b.name }),
        body: t('notifications.budget.body', { pct: Math.round(b.progress_pct) }),
        link: salonId ? `/${salonId}/expenses` : undefined,
        ts: new Date().toISOString(),
      })
    }

    return out.sort((a, b) => b.ts.localeCompare(a.ts))
  }, [insights, upcoming, budgets, unreadConvos, messengerNotifEnabled, inAppList, salonId, t])

  const lastSeen =
    salonId && typeof window !== 'undefined'
      ? Number(localStorage.getItem(LAST_SEEN_KEY(salonId)) ?? '0')
      : 0

  // T43 — unread считаем: для in_app — по read_at в БД; для derive-источников —
  // по lastSeen в localStorage. Это даёт точный счётчик после frontend mark-read.
  const unreadCount = items.filter((i) => {
    if (i.kind === 'in_app') return !i.read
    return new Date(i.ts).getTime() > lastSeen
  }).length

  function markAllRead() {
    if (typeof window !== 'undefined' && salonId) {
      localStorage.setItem(LAST_SEEN_KEY(salonId), String(Date.now()))
    }
    // T43 — также маркируем все unread in_app записи в БД.
    markAllInApp.mutate()
  }

  return { items, unreadCount, markAllRead }
}
