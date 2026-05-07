import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { supabase } from '@/lib/supabase/client'

// =============================================================================
// Cash on hand (#4)
// =============================================================================

export function useCashBalance(salonId: string | undefined) {
  return useQuery<number>({
    queryKey: ['cash-balance', salonId],
    queryFn: async () => {
      if (!salonId) return 0
      const { data, error } = await supabase.rpc('compute_cash_balance', {
        p_salon_id: salonId,
      })
      if (error) throw error
      return Number(data ?? 0)
    },
    enabled: !!salonId,
    staleTime: 30_000,
  })
}

export function useUpdateOpeningCashBalance(salonId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (cents: number) => {
      if (!salonId) throw new Error('no salon')
      const { error } = await supabase
        .from('salons')
        .update({ opening_cash_balance_cents: cents })
        .eq('id', salonId)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cash-balance', salonId] })
      qc.invalidateQueries({ queryKey: ['salons'] })
    },
  })
}

// =============================================================================
// Budget vs actual (#3)
// =============================================================================

export type CategoryBudgetRow = {
  category_id: string
  name: string
  monthly_budget_cents: number | null
  current_month_cents: number
  progress_pct: number | null
}

export function useCategoryBudgets(salonId: string | undefined) {
  return useQuery<CategoryBudgetRow[]>({
    queryKey: ['category-budgets', salonId],
    queryFn: async () => {
      if (!salonId) return []
      const { data, error } = await supabase.rpc('category_budgets_progress', {
        p_salon_id: salonId,
      })
      if (error) throw error
      return ((data ?? []) as CategoryBudgetRow[]).map((r) => ({
        ...r,
        monthly_budget_cents: r.monthly_budget_cents ? Number(r.monthly_budget_cents) : null,
        current_month_cents: Number(r.current_month_cents),
        progress_pct: r.progress_pct != null ? Number(r.progress_pct) : null,
      }))
    },
    enabled: !!salonId,
    staleTime: 60_000,
  })
}

export function useUpdateCategoryBudget(salonId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: { categoryId: string; cents: number | null }) => {
      const { error } = await supabase
        .from('expense_categories')
        .update({ monthly_budget_cents: input.cents })
        .eq('id', input.categoryId)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['category-budgets', salonId] })
    },
  })
}
