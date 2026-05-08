import { useQuery } from '@tanstack/react-query'

import { supabase } from '@/lib/supabase/client'

export type DashboardKpis = {
  revenue_cents: number
  expense_cents: number
  profit_cents: number
  visits_count: number
}

export type TopStaffRow = {
  staff_id: string
  full_name: string
  revenue_cents: number
}

export type TopServiceRow = {
  service_id: string
  service_name: string
  revenue_cents: number
  visits_count: number
  /** Total cost = unit cost × visits_count. NULL если cost не задан в services. */
  cost_cents: number | null
  /** revenue − cost. NULL если cost_cents NULL. */
  margin_cents: number | null
  /** margin / revenue × 100. NULL если cost не задан. */
  margin_pct: number | null
}

export type DashboardPeriod = { start: string; end: string } // ISO

export function dashboardKey(salonId: string | undefined) {
  return ['dashboard', salonId] as const
}

export function useDashboardKpis(salonId: string | undefined, period: DashboardPeriod) {
  return useQuery<DashboardKpis>({
    queryKey: [...dashboardKey(salonId), 'kpis', period],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('dashboard_kpis', {
        p_salon_id: salonId!,
        p_period_start: period.start,
        p_period_end: period.end,
      })
      if (error) throw error
      const row = (data ?? [])[0]
      return {
        revenue_cents: Number(row?.revenue_cents ?? 0),
        expense_cents: Number(row?.expense_cents ?? 0),
        profit_cents: Number(row?.profit_cents ?? 0),
        visits_count: Number(row?.visits_count ?? 0),
      }
    },
    enabled: !!salonId,
    staleTime: 30_000,
  })
}

export function useTopStaff(salonId: string | undefined, period: DashboardPeriod, limit = 4) {
  return useQuery<TopStaffRow[]>({
    queryKey: [...dashboardKey(salonId), 'top_staff', period, limit],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('top_staff_by_revenue', {
        p_salon_id: salonId!,
        p_period_start: period.start,
        p_period_end: period.end,
        p_limit: limit,
      })
      if (error) throw error
      return (data ?? []).map((r: TopStaffRow) => ({
        staff_id: r.staff_id,
        full_name: r.full_name,
        revenue_cents: Number(r.revenue_cents ?? 0),
      }))
    },
    enabled: !!salonId,
    staleTime: 30_000,
  })
}

export function useTopServices(salonId: string | undefined, period: DashboardPeriod, limit = 5) {
  return useQuery<TopServiceRow[]>({
    queryKey: [...dashboardKey(salonId), 'top_services', period, limit],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('top_services_by_revenue', {
        p_salon_id: salonId!,
        p_period_start: period.start,
        p_period_end: period.end,
        p_limit: limit,
      })
      if (error) throw error
      return (data ?? []).map((r: TopServiceRow) => ({
        service_id: r.service_id,
        service_name: r.service_name,
        revenue_cents: Number(r.revenue_cents ?? 0),
        visits_count: Number(r.visits_count ?? 0),
        cost_cents: r.cost_cents == null ? null : Number(r.cost_cents),
        margin_cents: r.margin_cents == null ? null : Number(r.margin_cents),
        margin_pct: r.margin_pct == null ? null : Number(r.margin_pct),
      }))
    },
    enabled: !!salonId,
    staleTime: 30_000,
  })
}
