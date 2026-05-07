import { useQuery } from '@tanstack/react-query'

import { supabase } from '@/lib/supabase/client'

export type StaffPayoutScheme =
  | 'fixed'
  | 'percent_revenue'
  | 'percent_service'
  | 'chair_rent'
  | 'mixed'

export type StaffRow = {
  id: string
  salon_id: string
  full_name: string
  payout_scheme: StaffPayoutScheme
  payout_percent: number | null
  payout_fixed_cents: number | null
  chair_rent_cents: number | null
  is_active: boolean
}

const STAFF_FIELDS =
  'id, salon_id, full_name, payout_scheme, payout_percent, payout_fixed_cents, chair_rent_cents, is_active'

export function useStaff(salonId: string | undefined, opts?: { activeOnly?: boolean }) {
  const activeOnly = opts?.activeOnly ?? true
  return useQuery<StaffRow[]>({
    queryKey: ['staff', salonId, { activeOnly }],
    queryFn: async () => {
      if (!salonId) return []
      let q = supabase
        .from('staff')
        .select(STAFF_FIELDS)
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
