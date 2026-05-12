import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { supabase } from '@/lib/supabase/client'

export type ServiceRow = {
  id: string
  salon_id: string
  category_id: string | null
  name: string
  default_price_cents: number
  default_duration_min: number | null
  /** Себестоимость одной оказанной услуги в центах. NULL = не задана. */
  cost_cents: number | null
  is_archived: boolean
  // Capacity-planning параметры (миграция 20260513000002)
  staff_count_required: number
  avg_service_hours: number
  staff_work_hours_per_day: number
  staff_work_days_per_month: number
  utilization_pct: number
  avg_check_cents: number
  staff_payout_pct: number
  materials_pct: number
}

/** Поля, к которым применимо bulk-обновление через ServicePlanningTab. */
export type ServicePlanningField =
  | 'staff_count_required'
  | 'avg_service_hours'
  | 'staff_work_hours_per_day'
  | 'staff_work_days_per_month'
  | 'utilization_pct'
  | 'avg_check_cents'
  | 'staff_payout_pct'
  | 'materials_pct'

export type ServiceCategoryRow = {
  id: string
  salon_id: string
  name: string
  sort_order: number
  is_archived: boolean
}

export function useServices(salonId: string | undefined) {
  return useQuery<ServiceRow[]>({
    queryKey: ['services', salonId],
    queryFn: async () => {
      if (!salonId) return []
      const { data, error } = await supabase
        .from('services')
        .select(
          'id, salon_id, category_id, name, default_price_cents, default_duration_min, cost_cents, is_archived, staff_count_required, avg_service_hours, staff_work_hours_per_day, staff_work_days_per_month, utilization_pct, avg_check_cents, staff_payout_pct, materials_pct',
        )
        .eq('salon_id', salonId)
        .eq('is_archived', false)
        .order('name', { ascending: true })
      if (error) throw error
      return (data ?? []) as ServiceRow[]
    },
    enabled: !!salonId,
    staleTime: 60_000,
  })
}

/**
 * Patch полей услуги (name / category_id / default_price_cents / cost_cents /
 * default_duration_min / is_archived).
 */
export function useUpdateService(salonId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: {
      id: string
      name?: string
      category_id?: string | null
      cost_cents?: number | null
      default_price_cents?: number
      default_duration_min?: number | null
      is_archived?: boolean
      staff_count_required?: number
      avg_service_hours?: number
      staff_work_hours_per_day?: number
      staff_work_days_per_month?: number
      utilization_pct?: number
      avg_check_cents?: number
      staff_payout_pct?: number
      materials_pct?: number
    }) => {
      const { id, ...patch } = input
      const { error } = await supabase.from('services').update(patch).eq('id', id)
      if (error) throw error
      return id
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['services', salonId] })
      qc.invalidateQueries({ queryKey: ['top-services', salonId] })
      qc.invalidateQueries({ queryKey: ['dashboard', salonId] })
      qc.invalidateQueries({ queryKey: ['reports', salonId] })
    },
  })
}

/**
 * Bulk-обновление одного поля сразу у всех активных услуг салона.
 * Используется в кнопке «Применить ко всем» в Service Planning tab.
 */
export function useBulkUpdateServicePlanning(salonId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: { field: ServicePlanningField; value: number }) => {
      if (!salonId) throw new Error('no_salon')
      const { error } = await supabase
        .from('services')
        .update({ [input.field]: input.value })
        .eq('salon_id', salonId)
        .eq('is_archived', false)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['services', salonId] })
    },
  })
}

export function useCreateService(salonId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: {
      name: string
      category_id?: string | null
      default_price_cents: number
      cost_cents?: number | null
      default_duration_min?: number | null
    }) => {
      if (!salonId) throw new Error('no_salon')
      const { data, error } = await supabase
        .from('services')
        .insert({ salon_id: salonId, ...input })
        .select('id')
        .single()
      if (error) throw error
      return data.id as string
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['services', salonId] })
      qc.invalidateQueries({ queryKey: ['service_categories', salonId] })
    },
  })
}

export function useServiceCategories(salonId: string | undefined) {
  return useQuery<ServiceCategoryRow[]>({
    queryKey: ['service_categories', salonId],
    queryFn: async () => {
      if (!salonId) return []
      const { data, error } = await supabase
        .from('service_categories')
        .select('id, salon_id, name, sort_order, is_archived')
        .eq('salon_id', salonId)
        .eq('is_archived', false)
        .order('sort_order', { ascending: true })
      if (error) throw error
      return (data ?? []) as ServiceCategoryRow[]
    },
    enabled: !!salonId,
    staleTime: 60_000,
  })
}

export function useCreateServiceCategory(salonId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: { name: string; sort_order?: number }) => {
      if (!salonId) throw new Error('no_salon')
      const { data, error } = await supabase
        .from('service_categories')
        .insert({ salon_id: salonId, name: input.name, sort_order: input.sort_order ?? 100 })
        .select('id')
        .single()
      if (error) throw error
      return data.id as string
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['service_categories', salonId] })
    },
  })
}

export function useUpdateServiceCategory(salonId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: { id: string; name?: string; is_archived?: boolean }) => {
      const { id, ...patch } = input
      const { error } = await supabase.from('service_categories').update(patch).eq('id', id)
      if (error) throw error
      return id
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['service_categories', salonId] })
      qc.invalidateQueries({ queryKey: ['services', salonId] })
    },
  })
}
