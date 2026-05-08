import { useQuery } from '@tanstack/react-query'

import { supabase } from '@/lib/supabase/client'

export type AnalyticsKpis = {
  revenue_cents: number
  expense_cents: number
  profit_cents: number
  visits_count: number
}

export function useAnalyticsKpis(
  salonId: string | undefined,
  periodStartIso: string | undefined,
  periodEndIso: string | undefined,
) {
  return useQuery<AnalyticsKpis | null>({
    queryKey: ['analytics', 'kpis', salonId, periodStartIso, periodEndIso],
    queryFn: async () => {
      if (!salonId || !periodStartIso || !periodEndIso) return null
      const { data, error } = await supabase
        .rpc('dashboard_kpis', {
          p_salon_id: salonId,
          p_period_start: periodStartIso,
          p_period_end: periodEndIso,
        })
        .single()
      if (error) throw error
      const r = data as {
        revenue_cents: number
        expense_cents: number
        profit_cents: number
        visits_count: number
      }
      return {
        revenue_cents: Number(r.revenue_cents),
        expense_cents: Number(r.expense_cents),
        profit_cents: Number(r.profit_cents),
        visits_count: Number(r.visits_count),
      }
    },
    enabled: !!salonId && !!periodStartIso && !!periodEndIso,
    staleTime: 60_000,
  })
}

export type StaffRevenueRow = { staff_id: string; full_name: string; revenue_cents: number }

export function useRevenueByStaff(
  salonId: string | undefined,
  periodStartIso: string | undefined,
  periodEndIso: string | undefined,
) {
  return useQuery<StaffRevenueRow[]>({
    queryKey: ['analytics', 'staff-revenue', salonId, periodStartIso, periodEndIso],
    queryFn: async () => {
      if (!salonId || !periodStartIso || !periodEndIso) return []
      const { data, error } = await supabase.rpc('top_staff_by_revenue', {
        p_salon_id: salonId,
        p_period_start: periodStartIso,
        p_period_end: periodEndIso,
        p_limit: 100,
      })
      if (error) throw error
      return ((data ?? []) as StaffRevenueRow[]).map((r) => ({
        ...r,
        revenue_cents: Number(r.revenue_cents),
      }))
    },
    enabled: !!salonId && !!periodStartIso && !!periodEndIso,
    staleTime: 60_000,
  })
}

export type ServiceRevenueRow = {
  service_id: string
  service_name: string
  revenue_cents: number
  visits_count: number
  cost_cents: number | null
  margin_cents: number | null
  margin_pct: number | null
}

export function useRevenueByService(
  salonId: string | undefined,
  periodStartIso: string | undefined,
  periodEndIso: string | undefined,
) {
  return useQuery<ServiceRevenueRow[]>({
    queryKey: ['analytics', 'service-revenue', salonId, periodStartIso, periodEndIso],
    queryFn: async () => {
      if (!salonId || !periodStartIso || !periodEndIso) return []
      const { data, error } = await supabase.rpc('top_services_by_revenue', {
        p_salon_id: salonId,
        p_period_start: periodStartIso,
        p_period_end: periodEndIso,
        p_limit: 50,
      })
      if (error) throw error
      return ((data ?? []) as ServiceRevenueRow[]).map((r) => ({
        ...r,
        revenue_cents: Number(r.revenue_cents),
        visits_count: Number(r.visits_count),
        cost_cents: r.cost_cents == null ? null : Number(r.cost_cents),
        margin_cents: r.margin_cents == null ? null : Number(r.margin_cents),
        margin_pct: r.margin_pct == null ? null : Number(r.margin_pct),
      }))
    },
    enabled: !!salonId && !!periodStartIso && !!periodEndIso,
    staleTime: 60_000,
  })
}

export type PaymentMethodRow = {
  payment_method: 'cash' | 'card' | 'transfer' | 'online' | 'mixed'
  visits_count: number
  revenue_cents: number
}

export function useRevenueByPayment(
  salonId: string | undefined,
  periodStartIso: string | undefined,
  periodEndIso: string | undefined,
) {
  return useQuery<PaymentMethodRow[]>({
    queryKey: ['analytics', 'payment-revenue', salonId, periodStartIso, periodEndIso],
    queryFn: async () => {
      if (!salonId || !periodStartIso || !periodEndIso) return []
      const { data, error } = await supabase.rpc('analytics_revenue_by_payment', {
        p_salon_id: salonId,
        p_period_start: periodStartIso,
        p_period_end: periodEndIso,
      })
      if (error) throw error
      return ((data ?? []) as PaymentMethodRow[]).map((r) => ({
        ...r,
        visits_count: Number(r.visits_count),
        revenue_cents: Number(r.revenue_cents),
      }))
    },
    enabled: !!salonId && !!periodStartIso && !!periodEndIso,
    staleTime: 60_000,
  })
}

export type HeatmapCell = {
  dow: number // 0=Sun ... 6=Sat (Postgres extract dow)
  hour_of_day: number // 0..23
  visits_count: number
  revenue_cents: number
}

export function useVisitsHeatmap(
  salonId: string | undefined,
  periodStartIso: string | undefined,
  periodEndIso: string | undefined,
  timezone: string | undefined,
) {
  return useQuery<HeatmapCell[]>({
    queryKey: ['analytics', 'heatmap', salonId, periodStartIso, periodEndIso, timezone],
    queryFn: async () => {
      if (!salonId || !periodStartIso || !periodEndIso) return []
      const { data, error } = await supabase.rpc('analytics_visits_heatmap', {
        p_salon_id: salonId,
        p_period_start: periodStartIso,
        p_period_end: periodEndIso,
        p_timezone: timezone ?? 'Europe/Warsaw',
      })
      if (error) throw error
      return ((data ?? []) as HeatmapCell[]).map((r) => ({
        dow: Number(r.dow),
        hour_of_day: Number(r.hour_of_day),
        visits_count: Number(r.visits_count),
        revenue_cents: Number(r.revenue_cents),
      }))
    },
    enabled: !!salonId && !!periodStartIso && !!periodEndIso,
    staleTime: 60_000,
  })
}
