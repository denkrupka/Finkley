import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { supabase } from '@/lib/supabase/client'
import type { PaymentMethod } from './useVisits'

export type ExpenseRow = {
  id: string
  salon_id: string
  category_id: string | null
  expense_at: string // date (YYYY-MM-DD)
  amount_cents: number
  payment_method: PaymentMethod | null
  comment: string | null
  source: string
  created_at: string
  updated_at: string
  deleted_at: string | null
}

export type ExpenseCategoryRow = {
  id: string
  salon_id: string
  name: string
  is_archived: boolean
  is_system: boolean
  sort_order: number
}

export type ExpensesPeriod = { start: string; end: string } // ISO dates

export function expensesKeys(salonId: string | undefined) {
  return ['expenses', salonId] as const
}

export function useExpenseCategories(salonId: string | undefined) {
  return useQuery<ExpenseCategoryRow[]>({
    queryKey: ['expense_categories', salonId],
    queryFn: async () => {
      if (!salonId) return []
      const { data, error } = await supabase
        .from('expense_categories')
        .select('id, salon_id, name, is_archived, is_system, sort_order')
        .eq('salon_id', salonId)
        .eq('is_archived', false)
        .order('sort_order', { ascending: true })
      if (error) throw error
      return (data ?? []) as ExpenseCategoryRow[]
    },
    enabled: !!salonId,
    staleTime: 60_000,
  })
}

export function useExpenses(salonId: string | undefined, period: ExpensesPeriod) {
  return useQuery<ExpenseRow[]>({
    queryKey: [...expensesKeys(salonId), 'list', period],
    queryFn: async () => {
      if (!salonId) return []
      const { data, error } = await supabase
        .from('expenses')
        .select(
          'id, salon_id, category_id, expense_at, amount_cents, payment_method, comment, source, created_at, updated_at, deleted_at',
        )
        .eq('salon_id', salonId)
        .is('deleted_at', null)
        .gte('expense_at', period.start)
        .lte('expense_at', period.end)
        .order('expense_at', { ascending: false })
        .limit(500)
      if (error) throw error
      return (data ?? []) as ExpenseRow[]
    },
    enabled: !!salonId,
    staleTime: 30_000,
  })
}

export type CreateExpenseInput = {
  salon_id: string
  category_id?: string | null
  expense_at: string
  amount_cents: number
  payment_method?: PaymentMethod | null
  comment?: string | null
}

export function useCreateExpense(salonId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: CreateExpenseInput) => {
      const { data, error } = await supabase
        .from('expenses')
        .insert({ ...input, source: 'manual' })
        .select('*')
        .single()
      if (error) throw error
      return data as ExpenseRow
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: expensesKeys(salonId) })
      qc.invalidateQueries({ queryKey: ['dashboard', salonId] })
    },
  })
}

export function useDeleteExpense(salonId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (expenseId: string) => {
      const { error } = await supabase
        .from('expenses')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', expenseId)
      if (error) throw error
      return expenseId
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: expensesKeys(salonId) })
      qc.invalidateQueries({ queryKey: ['dashboard', salonId] })
    },
  })
}
