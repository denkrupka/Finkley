import { useQuery } from '@tanstack/react-query'

import { supabase } from '@/lib/supabase/client'

export type DigestChannel = 'email' | 'telegram'

export type SalonRow = {
  id: string
  name: string
  country_code: string
  currency: string
  timezone: string
  salon_type: string
  locale: string
  logo_url: string | null
  weekly_digest_enabled: boolean
  /** Optional — миграция 20260513000004 может ещё не примениться. */
  daily_digest_enabled?: boolean
  /** Optional — миграция 20260515000003 может ещё не примениться. */
  weekly_digest_channels?: DigestChannel[]
  daily_digest_channels?: DigestChannel[]
  benchmarks_opt_in: boolean
  opening_cash_balance_cents: number
  retention_window_days: number
  churn_window_days: number
  /** Optional — миграция 20260515000011 может ещё не примениться. */
  opening_hours?: Record<string, { open?: string; close?: string; closed?: boolean }>
  /** Optional — миграция 20260516000005 может ещё не примениться.
   *  Включает ли салон логику «кассового дня». */
  cash_discipline_enabled?: boolean
  created_at: string
  /** Optional — миграция 20260514150000 может ещё не примениться. */
  blocked_at?: string | null
  blocked_reason?: string | null
}

/**
 * Возвращает список салонов текущего юзера через RLS-политику
 * `members can read their salons`.
 *
 * Ключи кэша:
 * - ['salons', 'mine'] — все мои салоны
 *
 * Refetch on window focus отключён глобально (см. main.tsx).
 */
export function useMySalons() {
  return useQuery<SalonRow[]>({
    queryKey: ['salons', 'mine'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('salons')
        .select(
          'id, name, country_code, currency, timezone, salon_type, locale, logo_url, weekly_digest_enabled, daily_digest_enabled, weekly_digest_channels, daily_digest_channels, benchmarks_opt_in, opening_cash_balance_cents, retention_window_days, churn_window_days, cash_discipline_enabled, created_at, blocked_at, blocked_reason',
        )
        .order('created_at', { ascending: true })
      if (error) throw error
      return (data ?? []) as SalonRow[]
    },
    staleTime: 60_000,
  })
}

/**
 * Роль текущего юзера в салоне (owner/admin/staff). Используется для
 * условного рендера UI редактирования (только owner/admin).
 */
export function useSalonMembership(salonId: string | undefined) {
  return useQuery<{ role: string } | null>({
    queryKey: ['salon-membership', salonId],
    queryFn: async () => {
      if (!salonId) return null
      const { data, error } = await supabase
        .from('salon_members')
        .select('role')
        .eq('salon_id', salonId)
        .maybeSingle()
      if (error) throw error
      return (data as { role: string } | null) ?? null
    },
    enabled: !!salonId,
    staleTime: 5 * 60_000,
  })
}

/**
 * Один салон по id. RLS обеспечит, что юзер не может прочитать чужой.
 */
export function useSalon(salonId: string | undefined) {
  return useQuery<SalonRow | null>({
    queryKey: ['salons', 'one', salonId],
    queryFn: async () => {
      if (!salonId) return null
      const { data, error } = await supabase
        .from('salons')
        .select(
          'id, name, country_code, currency, timezone, salon_type, locale, logo_url, weekly_digest_enabled, daily_digest_enabled, weekly_digest_channels, daily_digest_channels, benchmarks_opt_in, opening_cash_balance_cents, retention_window_days, churn_window_days, cash_discipline_enabled, created_at, blocked_at, blocked_reason',
        )
        .eq('id', salonId)
        .maybeSingle()
      if (error) throw error
      return data as SalonRow | null
    },
    enabled: !!salonId,
    staleTime: 60_000,
  })
}
