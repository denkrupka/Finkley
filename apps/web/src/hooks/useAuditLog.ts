import { useQuery } from '@tanstack/react-query'

import { supabase } from '@/lib/supabase/client'

export type AuditEntry = {
  id: string
  user_id: string | null
  action: string
  entity_type: string | null
  entity_id: string | null
  payload: Record<string, unknown> | null
  created_at: string
}

export function useAuditLog(salonId: string | undefined, limit = 200) {
  return useQuery<AuditEntry[]>({
    queryKey: ['audit-log', salonId, limit],
    queryFn: async () => {
      if (!salonId) return []
      const { data, error } = await supabase
        .from('audit_log')
        .select('id, user_id, action, entity_type, entity_id, payload, created_at')
        .eq('salon_id', salonId)
        .order('created_at', { ascending: false })
        .limit(limit)
      if (error) throw error
      return (data ?? []) as AuditEntry[]
    },
    enabled: !!salonId,
    staleTime: 30_000,
  })
}
