import { useMutation, useQueryClient } from '@tanstack/react-query'

import { supabase } from '@/lib/supabase/client'

/**
 * Дёргает edge function send-weekly-digest для текущего салона.
 * Function проверит membership через JWT и пришлёт KPI-письмо на email юзера.
 */
export function useSendWeeklyDigest(salonId: string | undefined) {
  return useMutation({
    mutationFn: async () => {
      if (!salonId) throw new Error('no salon')
      const { data, error } = await supabase.functions.invoke('send-weekly-digest', {
        body: { salon_id: salonId },
      })
      if (error) throw error
      return data as { ok: boolean; sent_to: string; period: { start: string; end: string } }
    },
  })
}

/**
 * Опт-аут переключатель `salons.weekly_digest_enabled`.
 * Используется в Settings для отключения дайджеста.
 */
export function useToggleWeeklyDigest(salonId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (enabled: boolean) => {
      if (!salonId) throw new Error('no salon')
      const { error } = await supabase
        .from('salons')
        .update({ weekly_digest_enabled: enabled })
        .eq('id', salonId)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['salons'] })
    },
  })
}
