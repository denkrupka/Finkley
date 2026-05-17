import { useQuery } from '@tanstack/react-query'

import { supabase } from '@/lib/supabase/client'

export type StaffPayoutScheme =
  | 'fixed'
  | 'percent_revenue'
  | 'percent_service'
  | 'chair_rent'
  | 'mixed'

export type WeeklyDay = { start: string; end: string; off: boolean }
export type WeeklySchedule = {
  mon: WeeklyDay
  tue: WeeklyDay
  wed: WeeklyDay
  thu: WeeklyDay
  fri: WeeklyDay
  sat: WeeklyDay
  sun: WeeklyDay
}

export const DAY_KEYS: ReadonlyArray<keyof WeeklySchedule> = [
  'mon',
  'tue',
  'wed',
  'thu',
  'fri',
  'sat',
  'sun',
]

export type StaffRow = {
  id: string
  salon_id: string
  full_name: string
  payout_scheme: StaffPayoutScheme
  payout_percent: number | null
  payout_fixed_cents: number | null
  chair_rent_cents: number | null
  is_active: boolean
  weekly_schedule: WeeklySchedule
  retail_payout_enabled: boolean
  retail_payout_percent: number | null
  retention_window_days: number | null
  external_id: string | null
  external_source: string | null
}

const STAFF_FIELDS =
  'id, salon_id, full_name, payout_scheme, payout_percent, payout_fixed_cents, chair_rent_cents, is_active, weekly_schedule, retail_payout_enabled, retail_payout_percent, retention_window_days, external_id, external_source'

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

/**
 * Staff-карточки, у которых ещё нет привязки к user (salon_members.staff_id IS
 * NULL для этого staff.id). Используется в team-invite — выбор существующего
 * мастера для multi-role «Админ-Мастер» (например, импортированные из Booksy
 * мастера, которым ещё не выдан логин).
 */
export function useUnlinkedStaff(salonId: string | undefined) {
  return useQuery<StaffRow[]>({
    queryKey: ['staff', salonId, 'unlinked'],
    queryFn: async () => {
      if (!salonId) return []
      // staff без связи в salon_members. Тащим всех активных, затем фильтруем
      // на клиенте — у салона до сотни staff'ов, влияние минимальное.
      const [{ data: staff, error: e1 }, { data: members, error: e2 }] = await Promise.all([
        supabase
          .from('staff')
          .select(STAFF_FIELDS)
          .eq('salon_id', salonId)
          .eq('is_active', true)
          .is('deleted_at', null)
          .order('full_name', { ascending: true }),
        supabase
          .from('salon_members')
          .select('staff_id')
          .eq('salon_id', salonId)
          .not('staff_id', 'is', null),
      ])
      if (e1) throw e1
      if (e2) throw e2
      const linkedIds = new Set((members ?? []).map((m) => m.staff_id as string))
      return ((staff ?? []) as StaffRow[]).filter((s) => !linkedIds.has(s.id))
    },
    enabled: !!salonId,
    staleTime: 60_000,
  })
}
