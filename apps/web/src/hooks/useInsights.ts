import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { supabase } from '@/lib/supabase/client'

export type InsightSeverity = 'info' | 'warning' | 'critical'

export type InsightRow = {
  id: string
  kind: string
  severity: InsightSeverity
  area: string | null
  title: string
  body: string
  payload: Record<string, unknown> | null
  created_at: string
}

/**
 * Активные (не dismissed) инсайты салона. Виджет на дашборде показывает топ-3.
 */
export function useInsights(salonId: string | undefined) {
  return useQuery<InsightRow[]>({
    queryKey: ['insights', salonId],
    queryFn: async () => {
      if (!salonId) return []
      const { data, error } = await supabase
        .from('insights')
        .select('id, kind, severity, area, title, body, payload, created_at')
        .eq('salon_id', salonId)
        .is('dismissed_at', null)
        .order('created_at', { ascending: false })
        .limit(3)
      if (error) throw error
      return (data ?? []) as InsightRow[]
    },
    enabled: !!salonId,
    staleTime: 60_000,
  })
}

/** Скрыть инсайт. Set dismissed_at — больше не появляется в виджете. */
export function useDismissInsight(salonId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (insightId: string) => {
      const { error } = await supabase
        .from('insights')
        .update({ dismissed_at: new Date().toISOString() })
        .eq('id', insightId)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['insights', salonId] })
    },
  })
}
