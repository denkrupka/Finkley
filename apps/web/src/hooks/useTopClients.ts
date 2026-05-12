import { useQuery } from '@tanstack/react-query'

import { supabase } from '@/lib/supabase/client'

export type TopClientRow = {
  client_id: string
  full_name: string
  phone: string | null
  email: string | null
  visit_count: number
  revenue_cents: number
  last_visit_at: string | null
}

/**
 * Топ клиентов по выручке за период. Используется в Reports → Клиенты.
 */
export function useTopClientsByRevenue(
  salonId: string | undefined,
  startIso: string,
  endIso: string,
  limit = 20,
) {
  return useQuery<TopClientRow[]>({
    queryKey: ['top-clients-by-revenue', salonId, startIso, endIso, limit],
    queryFn: async () => {
      if (!salonId) return []
      const { data, error } = await supabase.rpc('top_clients_by_revenue', {
        p_salon_id: salonId,
        p_start: startIso,
        p_end: endIso,
        p_limit: limit,
      })
      if (error) throw error
      return (data ?? []) as TopClientRow[]
    },
    enabled: !!salonId,
  })
}
