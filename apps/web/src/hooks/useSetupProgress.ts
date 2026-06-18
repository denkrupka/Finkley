import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { supabase } from '@/lib/supabase/client'
import type { SetupProgressData, SetupStepId } from '@/lib/setup-progress'

/**
 * Серверный прогресс «Настройки Finkley» — RPC setup_progress (security
 * invoker, считает из реальных visits/expenses/интеграций). См. T2 +
 * миграцию 20260618000001.
 */
export function useSetupProgress(salonId: string | undefined) {
  return useQuery<SetupProgressData | null>({
    queryKey: ['setup-progress', salonId],
    queryFn: async () => {
      if (!salonId) return null
      const { data, error } = await supabase
        .rpc('setup_progress', { p_salon_id: salonId })
        .maybeSingle()
      if (error) throw error
      return (data as SetupProgressData | null) ?? null
    },
    enabled: !!salonId,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  })
}

/** Отмечает «открыт дашборд прибыли» серверным событием (идемпотентно). */
export function useMarkDashboardOpened() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (salonId: string) => {
      const { error } = await supabase.rpc('mark_dashboard_opened', { p_salon_id: salonId })
      if (error) throw error
    },
    onSuccess: (_data, salonId) => {
      qc.invalidateQueries({ queryKey: ['setup-progress', salonId] })
    },
  })
}

export type ClaimRewardResult = {
  granted: boolean
  reason?: string
  bonus_days?: number
  bonus_until?: string
}

/** Забирает приз «+14 дней» через edge function claim-setup-reward. */
export function useClaimSetupReward(salonId: string | undefined) {
  const qc = useQueryClient()
  return useMutation<ClaimRewardResult>({
    mutationFn: async () => {
      if (!salonId) throw new Error('no_salon')
      const { data, error } = await supabase.functions.invoke('claim-setup-reward', {
        body: { salon_id: salonId },
      })
      if (error) throw error
      return data as ClaimRewardResult
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['setup-progress', salonId] })
      qc.invalidateQueries({ queryKey: ['subscription', salonId] })
    },
  })
}

// ── Клиентские «пропуски» карточек (Booksy/банк) в localStorage ──────────────
// Это UI-affordance «у меня нет банка/Booksy», не серверная истина. Приз всё
// равно требует реальных visit+expense на сервере, так что пропуски не дают
// прокликать пустоту.

const DISMISS_KEY = (salonId: string) => `finkley:setup-dismissed:${salonId}`

export function readDismissedSteps(salonId: string): Set<SetupStepId> {
  try {
    const raw = localStorage.getItem(DISMISS_KEY(salonId))
    if (!raw) return new Set()
    const arr = JSON.parse(raw) as SetupStepId[]
    return new Set(Array.isArray(arr) ? arr : [])
  } catch {
    return new Set()
  }
}

export function writeDismissedStep(salonId: string, step: SetupStepId, dismissed: boolean): void {
  try {
    const cur = readDismissedSteps(salonId)
    if (dismissed) cur.add(step)
    else cur.delete(step)
    localStorage.setItem(DISMISS_KEY(salonId), JSON.stringify([...cur]))
  } catch {
    /* localStorage недоступен — пропуски просто не сохранятся */
  }
}
