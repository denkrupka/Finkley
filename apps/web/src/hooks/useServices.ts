import { useQuery } from '@tanstack/react-query'

import { supabase } from '@/lib/supabase/client'

export type ServiceRow = {
  id: string
  salon_id: string
  category_id: string | null
  name: string
  default_price_cents: number
  default_duration_min: number | null
  is_archived: boolean
}

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
          'id, salon_id, category_id, name, default_price_cents, default_duration_min, is_archived',
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
