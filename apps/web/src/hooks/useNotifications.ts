import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { useBenchmarkComparison } from './useBenchmarks'
import { useCategoryBudgets } from './useExpenseExtras'
import { useInsights } from './useInsights'
import { useUpcomingTemplates } from './useVisitTemplates'

export type NotificationItem = {
  id: string
  kind: 'insight' | 'overdue_template' | 'budget_exceeded'
  severity: 'info' | 'warning' | 'critical'
  title: string
  body: string
  link?: string
  /** ISO timestamp — для чтения с last-seen стейтом */
  ts: string
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
  // benchmark не показываем как нотификацию — это скорее интересный факт, не алерт
  useBenchmarkComparison(salonId) // подгружаем в кэш для consistency

  const items = useMemo<NotificationItem[]>(() => {
    const out: NotificationItem[] = []

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
  }, [insights, upcoming, budgets, salonId, t])

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
