import { useQuery } from '@tanstack/react-query'

import { supabase } from '@/lib/supabase/client'

export type AuditEntry = {
  id: string
  user_id: string | null
  user_email: string | null
  user_full_name: string | null
  action: string
  entity_type: string | null
  entity_id: string | null
  payload: Record<string, unknown> | null
  created_at: string
}

export type AuditFilters = {
  fromDate?: string | null
  toDate?: string | null
  /** Префикс action — 'visit.' / 'expense.' / 'team.' / 'salon.' / '' (всё). */
  actionPrefix?: string
}

/**
 * Журнал событий: кто, когда, что менял. Идёт через RPC list_salon_audit
 * (security definer), который сразу резолвит автора (email + имя из
 * profiles). Фильтры — диапазон дат и тип события (action prefix).
 */
export function useAuditLog(salonId: string | undefined, filters: AuditFilters = {}) {
  return useQuery<AuditEntry[]>({
    queryKey: ['audit-log', salonId, filters],
    queryFn: async () => {
      if (!salonId) return []
      const { data, error } = await supabase.rpc('list_salon_audit', {
        p_salon_id: salonId,
        p_from: filters.fromDate ? `${filters.fromDate}T00:00:00Z` : null,
        p_to: filters.toDate ? `${filters.toDate}T23:59:59Z` : null,
        p_action_prefix: filters.actionPrefix ? filters.actionPrefix : null,
        p_limit: 500,
      })
      if (error) throw error
      return (data ?? []) as AuditEntry[]
    },
    enabled: !!salonId,
    staleTime: 30_000,
  })
}
