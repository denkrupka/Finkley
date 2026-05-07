import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { supabase } from '@/lib/supabase/client'

export type StaffServiceOverrideRow = {
  id: string
  staff_id: string
  service_id: string
  payout_percent: number | null
}

export function useStaffServiceOverrides(staffId: string | undefined) {
  return useQuery<StaffServiceOverrideRow[]>({
    queryKey: ['staff_service_overrides', staffId],
    queryFn: async () => {
      if (!staffId) return []
      const { data, error } = await supabase
        .from('staff_service_overrides')
        .select('id, staff_id, service_id, payout_percent')
        .eq('staff_id', staffId)
      if (error) throw error
      return (data ?? []) as StaffServiceOverrideRow[]
    },
    enabled: !!staffId,
    staleTime: 30_000,
  })
}

/**
 * Upsert по (staff_id, service_id) — уникальный constraint позволяет
 * вставить или обновить одной операцией.
 */
export function useUpsertStaffServiceOverride(staffId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: { service_id: string; payout_percent: number }) => {
      if (!staffId) throw new Error('no staff')
      const { error } = await supabase.from('staff_service_overrides').upsert(
        {
          staff_id: staffId,
          service_id: input.service_id,
          payout_percent: input.payout_percent,
        },
        { onConflict: 'staff_id,service_id' },
      )
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['staff_service_overrides', staffId] })
    },
  })
}

export function useDeleteStaffServiceOverride(staffId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (overrideId: string) => {
      const { error } = await supabase.from('staff_service_overrides').delete().eq('id', overrideId)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['staff_service_overrides', staffId] })
    },
  })
}
