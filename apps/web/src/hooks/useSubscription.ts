import { useQuery } from '@tanstack/react-query'

import { supabase } from '@/lib/supabase/client'

export type SubscriptionStatus =
  | 'trialing'
  | 'active'
  | 'past_due'
  | 'canceled'
  | 'incomplete'
  | 'incomplete_expired'
  | 'unpaid'
  | 'paused'

export type SalonSubscription = {
  salon_id: string
  /** Nullable после миграции 20260514150000 (ручные/бонусные подписки без Stripe). */
  stripe_customer_id: string | null
  stripe_subscription_id: string | null
  stripe_price_id: string | null
  status: SubscriptionStatus
  trial_ends_at: string | null
  current_period_start: string
  current_period_end: string
  cancel_at_period_end: boolean
  /** Тарифный план (T7, миграция 20260618000002). demo|free|t19|t49|t69|t99. */
  plan?: string | null
  /** Бонусные дни поверх подписки (ручной грант / награда за настройку). */
  bonus_until?: string | null
  /** 'stripe' | 'manual_admin'. */
  source?: string | null
}

export function useSubscription(salonId: string | undefined) {
  return useQuery<SalonSubscription | null>({
    queryKey: ['subscription', salonId],
    queryFn: async () => {
      if (!salonId) return null
      const { data, error } = await supabase
        .from('salon_subscriptions')
        .select('*')
        .eq('salon_id', salonId)
        .maybeSingle()
      if (error) throw error
      return (data as SalonSubscription | null) ?? null
    },
    enabled: !!salonId,
    staleTime: 60_000,
  })
}

/**
 * `true` если подписка активна (или ещё в триале) — записывать визиты можно.
 * `false` → read-only режим, баннер «Подписка истекла», UI блокирует мутации.
 *
 * Если subscription не существует (новый юзер до checkout) — возвращаем `true`
 * на 14 дней grace-period от created_at салона.
 */
export function isSubscriptionActive(
  sub: SalonSubscription | null,
  salonCreatedAt?: string,
): boolean {
  if (sub) {
    return sub.status === 'active' || sub.status === 'trialing'
  }
  // Нет subscription записи — даём grace-период
  if (!salonCreatedAt) return true
  const ageMs = Date.now() - new Date(salonCreatedAt).getTime()
  const days14 = 14 * 24 * 60 * 60 * 1000
  return ageMs < days14
}
