import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

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
  /** Optional — миграция 20260521000002. Какие ТИПЫ уведомлений включены.
   *  Отсутствующие ключи трактуются как true (показывать). */
  notification_prefs?: Record<string, boolean>
  /** Optional — миграция 20260521000014. URL Google Maps места салона. */
  google_place_url?: string | null
  /** Optional — миграция 20260521000019. Гео-поля и партнёрские URL. */
  google_place_id?: string | null
  booksy_url?: string | null
  address?: string | null
  city?: string | null
  lat?: number | null
  lng?: number | null
  /** Optional — миграция 20260522000002. URLs соцсетей салона
   *  для метрик контента в Reports → Конкуренты. */
  instagram_url?: string | null
  facebook_url?: string | null
  /** Optional — миграция 20260523000002. Manual override Content-метрик
   *  (auto-scrape Meta заблокирован datacenter-IP, эти поля заполняются
   *  владельцем салона из настроек и из Reports → Конкуренты → Параметры). */
  content_followers?: number | null
  content_posts?: number | null
  content_fb_likes?: number | null
  content_posts_per_month?: number | null
  content_updated_at?: string | null
}

/** Полный список типов уведомлений с человекочитаемыми i18n-ключами. */
export type NotificationTypeKey =
  | 'weekly_digest'
  | 'daily_digest'
  | 'ai_insights'
  | 'payment_due_2d'
  | 'payment_due_1d'
  | 'payment_due_today'
  | 'payment_overdue'
  | 'low_inventory'
  | 'booksy_new_visits'
  | 'calendar_conflicts'
  | 'messenger_new_message'

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
          'id, name, country_code, currency, timezone, salon_type, locale, logo_url, weekly_digest_enabled, daily_digest_enabled, weekly_digest_channels, daily_digest_channels, benchmarks_opt_in, opening_cash_balance_cents, retention_window_days, churn_window_days, cash_discipline_enabled, created_at, blocked_at, blocked_reason, notification_prefs, address, city, lat, lng, google_place_id, google_place_url, booksy_url, instagram_url, facebook_url, content_followers, content_posts, content_fb_likes, content_posts_per_month, content_updated_at',
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
 *
 * T30/T35 — также возвращает permissions матрицу из salon_members.permissions.
 * Структура: { "income.visits": "edit", "settings.*": "view", ... }
 * NULL = preset по роли (см. PermissionsBlock.presetForRole).
 */
export function useSalonMembership(salonId: string | undefined) {
  return useQuery<{ role: string; permissions: Record<string, 'view' | 'edit'> | null } | null>({
    queryKey: ['salon-membership', salonId],
    queryFn: async () => {
      if (!salonId) return null
      // ВАЖНО: фильтруем по user_id явно. RLS для admin/owner возвращает
      // все строки salon_members (видимость всех участников), и без этого
      // фильтра .maybeSingle() падает с "multiple rows" — sidebar теряет
      // role и скрывает все nav-пункты кроме Dashboard/Settings.
      const { data: userResp } = await supabase.auth.getUser()
      const userId = userResp.user?.id
      if (!userId) return null
      const { data, error } = await supabase
        .from('salon_members')
        .select('role, permissions')
        .eq('salon_id', salonId)
        .eq('user_id', userId)
        .maybeSingle()
      if (error) throw error
      return (
        (data as {
          role: string
          permissions: Record<string, 'view' | 'edit'> | null
        } | null) ?? null
      )
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
          'id, name, country_code, currency, timezone, salon_type, locale, logo_url, weekly_digest_enabled, daily_digest_enabled, weekly_digest_channels, daily_digest_channels, benchmarks_opt_in, opening_cash_balance_cents, retention_window_days, churn_window_days, cash_discipline_enabled, created_at, blocked_at, blocked_reason, notification_prefs, address, city, lat, lng, google_place_id, google_place_url, booksy_url, instagram_url, facebook_url, content_followers, content_posts, content_fb_likes, content_posts_per_month, content_updated_at',
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

/**
 * Patch'ает salons.notification_prefs одним ключом. Использует merge:
 * текущий prefs объединяется с patch перед UPDATE, чтобы не затереть
 * другие типы. Для атомарности merge делается на клиенте — race с
 * параллельным edit'ом возможен, но в UI чекбоксы редко жмут пачкой.
 */
export function useUpdateNotificationPref(salonId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (patch: Record<string, boolean>) => {
      if (!salonId) throw new Error('no_salon')
      // Текущие prefs из кеша (если есть) — для merge.
      const cached = qc.getQueryData<SalonRow | null>(['salons', 'one', salonId])
      const current = cached?.notification_prefs ?? {}
      const next = { ...current, ...patch }
      const { error } = await supabase
        .from('salons')
        .update({ notification_prefs: next })
        .eq('id', salonId)
      if (error) throw error
      return next
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['salons', 'one', salonId] })
      qc.invalidateQueries({ queryKey: ['salons', 'mine'] })
    },
  })
}
