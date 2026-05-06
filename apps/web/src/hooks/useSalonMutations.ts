import { useMutation, useQueryClient } from '@tanstack/react-query'

import { supabase } from '@/lib/supabase/client'

export type UpdateSalonInput = {
  id: string
  name?: string
  country_code?: string
  currency?: string
  timezone?: string
  salon_type?: string
  locale?: string
  logo_url?: string | null
}

export function useUpdateSalon() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: UpdateSalonInput) => {
      const { id, ...patch } = input
      const { error } = await supabase.from('salons').update(patch).eq('id', id)
      if (error) throw error
      return id
    },
    onSuccess: (id) => {
      qc.invalidateQueries({ queryKey: ['salons'] })
      qc.invalidateQueries({ queryKey: ['salons', 'one', id] })
    },
  })
}

/**
 * Soft delete салона (`deleted_at = now()`). Через 30 дней grace period
 * scheduled function зачистит окончательно (TASK-26 в стадии 2).
 */
export function useDeleteSalon() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (salonId: string) => {
      const { error } = await supabase
        .from('salons')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', salonId)
      if (error) throw error
      return salonId
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['salons'] })
    },
  })
}
