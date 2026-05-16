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
      qc.invalidateQueries({ queryKey: ['category-budgets-full', salonId] })
    },
  })
}

// =============================================================================
// Унифицированные Бюджеты (#6/#7): читаем kind + plan + actual прямо
// из expense_categories + expenses таблицы.
// =============================================================================

export type CategoryBudgetFull = {
  category_id: string
  name: string
  kind: 'fixed' | 'variable'
  monthly_budget_cents: number | null
  monthly_budget_pct: number | null
  current_month_cents: number
  /** Для variable: % факта от выручки. Для fixed: % факта от лимита. */
  progress_pct: number | null
}

/**
 * Полный список категорий с kind, планом и фактом за текущий месяц.
 * Источник истины: expense_categories. Факт по fixed-категориям —
 * SUM(expenses.amount_cents) за текущий месяц. Variable — то же самое,
 * progress_pct считаем как % от выручки за месяц (берём из visits.paid).
 */
export function useCategoryBudgetsFull(salonId: string | undefined) {
  return useQuery<CategoryBudgetFull[]>({
    queryKey: ['category-budgets-full', salonId],
    queryFn: async () => {
      if (!salonId) return []
      const now = new Date()
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
      const monthStartIso = monthStart.toISOString().slice(0, 10)
      const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0)
      const monthEndIso = monthEnd.toISOString().slice(0, 10)

      // Параллельные запросы: категории + расходы + выручка визитов.
      const [catsResp, expResp, revResp] = await Promise.all([
        supabase
          .from('expense_categories')
          .select('id, name, kind, monthly_budget_cents, monthly_budget_pct, sort_order')
          .eq('salon_id', salonId)
          .eq('is_archived', false)
          .order('sort_order'),
        supabase
          .from('expenses')
          .select('category_id, amount_cents')
          .eq('salon_id', salonId)
          .is('deleted_at', null)
          .gte('expense_at', monthStartIso)
          .lte('expense_at', monthEndIso),
        supabase
          .from('visits')
          .select('amount_cents, tip_cents, discount_cents')
          .eq('salon_id', salonId)
          .is('deleted_at', null)
          .eq('status', 'paid')
          .gte('visit_at', monthStart.toISOString())
          .lte('visit_at', monthEnd.toISOString()),
      ])

      if (catsResp.error) throw catsResp.error
      const cats = (catsResp.data ?? []) as Array<{
        id: string
        name: string
        kind: 'fixed' | 'variable'
        monthly_budget_cents: number | null
        monthly_budget_pct: number | null
      }>

      // Сгрупировать факт по category_id.
      const factByCat = new Map<string, number>()
      for (const e of (expResp.data ?? []) as Array<{
        category_id: string | null
        amount_cents: number
      }>) {
        if (!e.category_id) continue
        factByCat.set(e.category_id, (factByCat.get(e.category_id) ?? 0) + Number(e.amount_cents))
      }

      // Выручка за месяц — для variable progress.
      const revenueCents = (
        (revResp.data ?? []) as Array<{
          amount_cents: number
          tip_cents: number | null
          discount_cents: number | null
        }>
      ).reduce(
        (s, v) =>
          s + Number(v.amount_cents) + Number(v.tip_cents ?? 0) - Number(v.discount_cents ?? 0),
        0,
      )

      return cats.map((c) => {
        const fact = factByCat.get(c.id) ?? 0
        let progress_pct: number | null = null
        if (c.kind === 'fixed') {
          if (c.monthly_budget_cents && c.monthly_budget_cents > 0) {
            progress_pct = Math.round((fact / Number(c.monthly_budget_cents)) * 100)
          }
        } else {
          // variable: фактическая доля от выручки.
          if (revenueCents > 0) {
            progress_pct = Math.round((fact / revenueCents) * 100)
          }
        }
        return {
          category_id: c.id,
          name: c.name,
          kind: c.kind,
          monthly_budget_cents: c.monthly_budget_cents,
          monthly_budget_pct: c.monthly_budget_pct,
          current_month_cents: fact,
          progress_pct,
        }
      })
    },
    enabled: !!salonId,
    staleTime: 30_000,
  })
}

export function useUpdateCategoryKindAndBudget(salonId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: {
      categoryId: string
      kind?: 'fixed' | 'variable'
      monthly_budget_cents?: number | null
      monthly_budget_pct?: number | null
    }) => {
      const patch: Record<string, unknown> = {}
      if (input.kind !== undefined) patch.kind = input.kind
      if (input.monthly_budget_cents !== undefined)
        patch.monthly_budget_cents = input.monthly_budget_cents
      if (input.monthly_budget_pct !== undefined)
        patch.monthly_budget_pct = input.monthly_budget_pct
      const { error } = await supabase
        .from('expense_categories')
        .update(patch)
        .eq('id', input.categoryId)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['category-budgets', salonId] })
      qc.invalidateQueries({ queryKey: ['category-budgets-full', salonId] })
    },
  })
}

export function useCreateExpenseCategory(salonId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: {
      name: string
      kind: 'fixed' | 'variable'
      monthly_budget_cents?: number | null
      monthly_budget_pct?: number | null
    }) => {
      if (!salonId) throw new Error('no_salon')
      const { error } = await supabase.from('expense_categories').insert({
        salon_id: salonId,
        name: input.name.trim(),
        kind: input.kind,
        monthly_budget_cents: input.monthly_budget_cents ?? null,
        monthly_budget_pct: input.monthly_budget_pct ?? null,
      })
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['category-budgets-full', salonId] })
      qc.invalidateQueries({ queryKey: ['expense-categories', salonId] })
    },
  })
}

export function useArchiveExpenseCategory(salonId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (categoryId: string) => {
      const { error } = await supabase
        .from('expense_categories')
        .update({ is_archived: true })
        .eq('id', categoryId)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['category-budgets-full', salonId] })
      qc.invalidateQueries({ queryKey: ['expense-categories', salonId] })
    },
  })
}
