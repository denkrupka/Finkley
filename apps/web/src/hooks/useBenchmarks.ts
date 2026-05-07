import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { supabase } from '@/lib/supabase/client'

export type BenchmarkComparison = {
  available: boolean
  country_code?: string
  salon_type?: string
  salon_count?: number
  computed_at?: string
  me?: {
    avg_check_cents: number
    visits_per_week: number
    revenue_per_master_cents: number
    rebooking_rate_pct: number
  }
  market?: {
    avg_check_cents: number
    visits_per_week: number
    revenue_per_master_cents: number
    rebooking_rate_pct: number
    top_services: { name: string; total_revenue: number; visit_count: number }[]
  }
  reason?: string // 'bucket_empty' если меньше 10 салонов в нише
}

/**
 * Сравнение с рынком для дашборд-виджета. Возвращает мои метрики и
 * усреднённые по моему bucket'у (страна × тип салона), либо available=false.
 */
export function useBenchmarkComparison(salonId: string | undefined) {
  return useQuery<BenchmarkComparison | null>({
    queryKey: ['benchmark', salonId],
    queryFn: async () => {
      if (!salonId) return null
      const { data, error } = await supabase.rpc('get_benchmark_comparison', {
        p_salon_id: salonId,
      })
      if (error) throw error
      return data as BenchmarkComparison
    },
    enabled: !!salonId,
    staleTime: 60_000 * 60, // benchmarks пересчитываются раз в сутки
  })
}

/** Toggle benchmarks_opt_in для салона. */
export function useToggleBenchmarksOptIn(salonId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (enabled: boolean) => {
      if (!salonId) throw new Error('no salon')
      const { error } = await supabase
        .from('salons')
        .update({ benchmarks_opt_in: enabled })
        .eq('id', salonId)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['salons'] })
    },
  })
}
