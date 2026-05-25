import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { supabase } from '@/lib/supabase/client'

import { useBenchmarkComparison } from './useBenchmarks'
import { useCategoryBudgets } from './useExpenseExtras'
import { useInsights } from './useInsights'
import { useSalon } from './useSalons'
import { useUpcomingTemplates } from './useVisitTemplates'

export type NotificationItem = {
  id: string
  kind: 'insight' | 'overdue_template' | 'budget_exceeded' | 'messenger_message'
  severity: 'info' | 'warning' | 'critical'
  title: string
  body: string
  link?: string
  /** ISO timestamp — для чтения с last-seen стейтом */
  ts: string
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
  // benchmark не показываем как нотификацию — это скорее интересный факт, не алерт
  useBenchmarkComparison(salonId) // подгружаем в кэш для consistency

  // Тогл «Новое сообщение в мессенджере» из Настройки → Уведомления → Типы.
  // Отсутствие ключа = включено по умолчанию.
  const messengerNotifEnabled = (salon?.notification_prefs ?? {}).messenger_new_message !== false

  const items = useMemo<NotificationItem[]>(() => {
    const out: NotificationItem[] = []

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
  }, [insights, upcoming, budgets, unreadConvos, messengerNotifEnabled, salonId, t])

  const lastSeen =
    salonId && typeof window !== 'undefined'
      ? Number(localStorage.getItem(LAST_SEEN_KEY(salonId)) ?? '0')
      : 0

  const unreadCount = items.filter((i) => new Date(i.ts).getTime() > lastSeen).length

  function markAllRead() {
    if (!salonId || typeof window === 'undefined') return
    localStorage.setItem(LAST_SEEN_KEY(salonId), String(Date.now()))
  }

  return { items, unreadCount, markAllRead }
}
