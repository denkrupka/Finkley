import { useQuery } from '@tanstack/react-query'

import { supabase } from '@/lib/supabase/client'

export type StaffRow = {
  id: string
  salon_id: string
  full_name: string
  payout_scheme: string
  payout_percent: number | null
  is_active: boolean
}

export function useStaff(salonId: string | undefined, opts?: { activeOnly?: boolean }) {
  const activeOnly = opts?.activeOnly ?? true
  return useQuery<StaffRow[]>({
    queryKey: ['staff', salonId, { activeOnly }],
    queryFn: async () => {
      if (!salonId) return []
      let q = supabase
        .from('staff')
        .select('id, salon_id, full_name, payout_scheme, payout_percent, is_active')
        .eq('salon_id', salonId)
        .is('deleted_at', null)
      if (activeOnly) q = q.eq('is_active', true)
      const { data, error } = await q.order('full_name', { ascending: true })
      if (error) throw error
      return (data ?? []) as StaffRow[]
    },
    enabled: !!salonId,
    staleTime: 60_000,
  })
}
