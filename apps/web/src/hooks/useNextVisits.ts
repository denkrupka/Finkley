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

/**
 * Возвращает Set<client_id> — клиенты, у которых был хотя бы один визит в
 * заданном диапазоне дат. Используется в Reports → Клиенты для фильтрации
 * списка клиентов по выбранному периоду (image #113).
 *
 * Если range = null — запрос не делается, возвращаем `null` (фильтр выключен).
 */
export function useClientIdsWithVisitsInPeriod(
  salonId: string | undefined,
  range: { start: string; end: string } | null,
) {
  return useQuery<Set<string> | null>({
    queryKey: ['client-ids-by-period', salonId, range],
    queryFn: async () => {
      if (!salonId || !range) return null
      const set = new Set<string>()
      const { data, error } = await supabase
        .from('visits')
        .select('client_id')
        .eq('salon_id', salonId)
        .gte('visit_at', range.start)
        .lte('visit_at', range.end)
        .is('deleted_at', null)
        .not('client_id', 'is', null)
        .limit(5000)
      if (error) throw error
      for (const r of (data ?? []) as { client_id: string | null }[]) {
        if (r.client_id) set.add(r.client_id)
      }
      return set
    },
    enabled: !!salonId && !!range,
    staleTime: 30_000,
  })
}
