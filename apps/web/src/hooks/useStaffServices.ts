import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { supabase } from '@/lib/supabase/client'

export type StaffServiceRow = {
  id: string
  staff_id: string
  service_id: string
}

/** Услуги, которые выполняет мастер (связи staff↔service). */
export function useStaffServices(staffId: string | undefined) {
  return useQuery<StaffServiceRow[]>({
    queryKey: ['staff-services', staffId],
    queryFn: async () => {
      if (!staffId) return []
      const { data, error } = await supabase
        .from('staff_services')
        .select('id, staff_id, service_id')
        .eq('staff_id', staffId)
      if (error) throw error
      return (data ?? []) as StaffServiceRow[]
    },
    enabled: !!staffId,
    staleTime: 60_000,
  })
}

/** Включить/выключить одну услугу у мастера. */
export function useToggleStaffService(salonId: string | undefined, staffId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: { service_id: string; enabled: boolean }) => {
      if (!salonId || !staffId) throw new Error('no_staff')
      if (input.enabled) {
        // upsert по (staff_id, service_id) — повторное включение не дублирует
        const { error } = await supabase
          .from('staff_services')
          .upsert(
            { salon_id: salonId, staff_id: staffId, service_id: input.service_id },
            { onConflict: 'staff_id,service_id', ignoreDuplicates: true },
          )
        if (error) throw error
      } else {
        const { error } = await supabase
          .from('staff_services')
          .delete()
          .eq('staff_id', staffId)
          .eq('service_id', input.service_id)
        if (error) throw error
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['staff-services', staffId] }),
  })
}

/** Массово включить/выключить набор услуг (например, целую категорию). */
export function useBulkSetStaffServices(salonId: string | undefined, staffId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: { service_ids: string[]; enabled: boolean }) => {
      if (!salonId || !staffId) throw new Error('no_staff')
      if (input.service_ids.length === 0) return
      if (input.enabled) {
        const rows = input.service_ids.map((service_id) => ({
          salon_id: salonId,
          staff_id: staffId,
          service_id,
        }))
        const { error } = await supabase
          .from('staff_services')
          .upsert(rows, { onConflict: 'staff_id,service_id', ignoreDuplicates: true })
        if (error) throw error
      } else {
        const { error } = await supabase
          .from('staff_services')
          .delete()
          .eq('staff_id', staffId)
          .in('service_id', input.service_ids)
        if (error) throw error
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['staff-services', staffId] }),
  })
}
