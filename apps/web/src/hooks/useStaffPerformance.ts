import { useQuery } from '@tanstack/react-query'

import { supabase } from '@/lib/supabase/client'

export type StaffPerformanceRow = {
  staff_id: string
  full_name: string
  is_active: boolean
  total_revenue_cents: number
  visits_revenue_cents: number
  retail_revenue_cents: number
  /** Сумма чаевых за период (только visit-kind). Добавлено в миграции
   *  20260521000011_staff_performance_tips. */
  tips_cents: number
  visits_count: number
  unique_clients_count: number
  returned_clients_count: number
  rebook_pct: number
  revenue_6m_cents: number
  hire_date: string | null
  scheduled_minutes: number
  worked_minutes: number
  utilization_pct: number
}

/**
 * Расширенный отчёт по эффективности мастеров.
 * Wraps RPC staff_performance_advanced (см. миграцию 20260515000013).
 */
export function useStaffPerformanceAdvanced(
  salonId: string | undefined,
  startIso: string,
  endIso: string,
) {
  return useQuery<StaffPerformanceRow[]>({
    queryKey: ['staff-performance-adv', salonId, startIso, endIso],
    queryFn: async () => {
      if (!salonId) return []
      const { data, error } = await supabase.rpc('staff_performance_advanced', {
        p_salon_id: salonId,
        p_start_ts: startIso,
        p_end_ts: endIso,
      })
      if (error) throw error
      return (data ?? []) as StaffPerformanceRow[]
    },
    enabled: !!salonId,
  })
}
