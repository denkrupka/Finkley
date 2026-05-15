import { useQuery } from '@tanstack/react-query'

import { supabase } from '@/lib/supabase/client'

/**
 * Суммы авансов по мастерам за период (для Reports → Зарплаты).
 *
 * Источник — expenses с категорией is_payroll=true, payroll_kind='advance',
 * по дате expense_at в диапазоне. Группируется по payroll_staff_id.
 *
 * Возвращает Map: staff_id → total_advance_cents.
 */
export function usePayrollAdvances(salonId: string | undefined, startIso: string, endIso: string) {
  return useQuery<Map<string, number>>({
    queryKey: ['payroll-advances', salonId, startIso, endIso],
    queryFn: async () => {
      const map = new Map<string, number>()
      if (!salonId) return map
      const { data, error } = await supabase
        .from('expenses')
        .select('payroll_staff_id, amount_cents')
        .eq('salon_id', salonId)
        .eq('payroll_kind', 'advance')
        .gte('expense_at', startIso)
        .lte('expense_at', endIso)
        .is('deleted_at', null)
      if (error) throw error
      for (const r of data ?? []) {
        const row = r as { payroll_staff_id: string | null; amount_cents: number }
        if (!row.payroll_staff_id) continue
        map.set(row.payroll_staff_id, (map.get(row.payroll_staff_id) ?? 0) + row.amount_cents)
      }
      return map
    },
    enabled: !!salonId,
  })
}
