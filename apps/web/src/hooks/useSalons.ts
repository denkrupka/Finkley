import { useQuery } from '@tanstack/react-query'

import { supabase } from '@/lib/supabase/client'

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
  created_at: string
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
          'id, name, country_code, currency, timezone, salon_type, locale, logo_url, weekly_digest_enabled, created_at',
        )
        .order('created_at', { ascending: true })
      if (error) throw error
      return (data ?? []) as SalonRow[]
    },
    staleTime: 60_000,
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
          'id, name, country_code, currency, timezone, salon_type, locale, logo_url, weekly_digest_enabled, created_at',
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
