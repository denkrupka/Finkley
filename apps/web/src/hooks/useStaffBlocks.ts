import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { supabase } from '@/lib/supabase/client'

export type StaffBlockKind = 'reservation' | 'absence'

export type StaffBlockRow = {
  id: string
  salon_id: string
  staff_id: string
  kind: StaffBlockKind
  starts_at: string
  ends_at: string
  label: string | null
  created_at: string
}

/** Возвращает блокировки времени мастеров в диапазоне дат. */
export function useStaffBlocks(salonId: string | undefined, range: { start: string; end: string }) {
  return useQuery<StaffBlockRow[]>({
    queryKey: ['staff-blocks', salonId, range.start, range.end],
    queryFn: async () => {
      if (!salonId) return []
      const { data, error } = await supabase
        .from('staff_time_blocks')
        .select('*')
        .eq('salon_id', salonId)
        .lt('starts_at', range.end)
        .gt('ends_at', range.start)
        .order('starts_at', { ascending: true })
      if (error) throw error
      return (data ?? []) as StaffBlockRow[]
    },
    enabled: !!salonId,
  })
}

export function useCreateStaffBlock(salonId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: {
      staff_id: string
      kind: StaffBlockKind
      starts_at: string
      ends_at: string
      label?: string | null
    }) => {
      if (!salonId) throw new Error('no_salon')
      const { data, error } = await supabase
        .from('staff_time_blocks')
        .insert({ salon_id: salonId, ...input, label: input.label ?? null })
        .select('id')
        .single()
      if (error) throw error
      return data as { id: string }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['staff-blocks', salonId] })
    },
  })
}

export function useUpdateStaffBlock(salonId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: {
      id: string
      staff_id?: string
      starts_at?: string
      ends_at?: string
      label?: string | null
    }) => {
      const { id, ...patch } = input
      const { error } = await supabase.from('staff_time_blocks').update(patch).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['staff-blocks', salonId] })
    },
  })
}

export function useDeleteStaffBlock(salonId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('staff_time_blocks').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['staff-blocks', salonId] })
    },
  })
}
