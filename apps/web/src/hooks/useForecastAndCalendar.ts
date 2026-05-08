import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { supabase } from '@/lib/supabase/client'

export type MonthForecast = {
  revenue_so_far: number
  pending_in_month: number
  forecast: number
  prev_month_revenue: number
  days_passed: number
  days_total: number
  vs_prev_month_pct: number | null
}

export function useMonthForecast(salonId: string | undefined) {
  return useQuery<MonthForecast | null>({
    queryKey: ['month-forecast', salonId],
    queryFn: async () => {
      if (!salonId) return null
      const { data, error } = await supabase.rpc('month_forecast', { p_salon_id: salonId })
      if (error) throw error
      return data as MonthForecast | null
    },
    enabled: !!salonId,
    staleTime: 5 * 60_000,
  })
}

export function useCalendarToken(salonId: string | undefined) {
  return useQuery<string | null>({
    queryKey: ['calendar-token', salonId],
    queryFn: async () => {
      if (!salonId) return null
      const { data, error } = await supabase.rpc('get_or_create_calendar_token', {
        p_salon_id: salonId,
      })
      if (error) throw error
      return (data as string | null) ?? null
    },
    enabled: !!salonId,
    staleTime: 60 * 60_000,
  })
}

export function useRevokeCalendarToken(salonId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      if (!salonId) return false
      const { error } = await supabase.rpc('revoke_calendar_token', { p_salon_id: salonId })
      if (error) throw error
      return true
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['calendar-token', salonId] }),
  })
}
