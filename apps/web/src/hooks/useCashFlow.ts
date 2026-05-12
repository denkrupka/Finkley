import { useQuery } from '@tanstack/react-query'

import { supabase } from '@/lib/supabase/client'

export type CashFlowDayRow = {
  day: string // yyyy-mm-dd
  inflow_cents: number
  outflow_cents: number
  net_cents: number
}

/**
 * Движение денежных средств (ДДС) по дням за период.
 * Приход = visits (за вычетом скидок + чаевые) + other_incomes.
 * Расход = expenses.
 */
export function useCashFlowDaily(salonId: string | undefined, from: string, to: string) {
  return useQuery<CashFlowDayRow[]>({
    queryKey: ['cash-flow-daily', salonId, from, to],
    queryFn: async () => {
      if (!salonId) return []
      const { data, error } = await supabase.rpc('cash_flow_daily', {
        p_salon_id: salonId,
        p_from: from,
        p_to: to,
      })
      if (error) throw error
      return (data ?? []) as CashFlowDayRow[]
    },
    enabled: !!salonId,
  })
}
