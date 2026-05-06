import { useMutation, useQueryClient } from '@tanstack/react-query'

import { supabase } from '@/lib/supabase/client'

export function useCreateStaff(salonId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: { full_name: string; payout_percent: number }) => {
      if (!salonId) throw new Error('no salon')
      const { data, error } = await supabase
        .from('staff')
        .insert({
          salon_id: salonId,
          full_name: input.full_name.trim(),
          payout_scheme: 'percent_revenue',
          payout_percent: input.payout_percent,
        })
        .select('*')
        .single()
      if (error) throw error
      return data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['staff', salonId] })
    },
  })
}

export function useUpdateStaff(salonId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: { id: string; full_name?: string; payout_percent?: number }) => {
      const { id, ...patch } = input
      const { error } = await supabase.from('staff').update(patch).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['staff', salonId] })
    },
  })
}

export function useArchiveStaff(salonId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (staffId: string) => {
      // Не удаляем — сохраняем историю визитов. is_active=false скрывает мастера в селектах.
      const { error } = await supabase.from('staff').update({ is_active: false }).eq('id', staffId)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['staff', salonId] })
    },
  })
}

export function useUnarchiveStaff(salonId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (staffId: string) => {
      const { error } = await supabase.from('staff').update({ is_active: true }).eq('id', staffId)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['staff', salonId] })
    },
  })
}
