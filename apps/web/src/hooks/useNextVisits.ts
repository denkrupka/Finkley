import { useQuery } from '@tanstack/react-query'

import { supabase } from '@/lib/supabase/client'

/**
 * Возвращает Map<client_id, next_visit_at> — ближайший будущий визит для
 * каждого клиента салона. Используется в Reports → Клиенты → Список для
 * колонки «Следующий визит».
 *
 * Реализация: SELECT клиентов, у которых есть `visits` с `visit_at >= now()`
 * и `status` ∈ ('pending', 'paid'). Группировка/min по client_id делается
 * на клиенте — у обычного салона за неделю наберётся <500 будущих визитов,
 * полный список визитов не нужен.
 */
export function useNextVisitsByClient(salonId: string | undefined) {
  return useQuery<Map<string, string>>({
    queryKey: ['next-visits-by-client', salonId],
    queryFn: async () => {
      const map = new Map<string, string>()
      if (!salonId) return map
      const nowIso = new Date().toISOString()
      const { data, error } = await supabase
        .from('visits')
        .select('client_id, visit_at')
        .eq('salon_id', salonId)
        .gte('visit_at', nowIso)
        .in('status', ['pending', 'paid'])
        .is('deleted_at', null)
        .not('client_id', 'is', null)
        .order('visit_at', { ascending: true })
        .limit(2000)
      if (error) throw error
      for (const r of (data ?? []) as { client_id: string | null; visit_at: string }[]) {
        if (!r.client_id) continue
        if (!map.has(r.client_id)) map.set(r.client_id, r.visit_at)
      }
      return map
    },
    enabled: !!salonId,
    staleTime: 60_000,
  })
}
