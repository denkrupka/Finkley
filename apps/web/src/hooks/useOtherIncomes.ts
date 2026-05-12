import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { supabase } from '@/lib/supabase/client'
import type { PaymentMethod } from '@/hooks/useVisits'

export type OtherIncomeRow = {
  id: string
  salon_id: string
  category_id: string | null
  income_at: string
  amount_cents: number
  payment_method: PaymentMethod | null
  comment: string | null
  receipt_url: string | null
  source: string
  created_at: string
  updated_at: string
  deleted_at: string | null
}

export type OtherIncomeCategoryRow = {
  id: string
  salon_id: string
  name: string
  is_archived: boolean
  is_system: boolean
  sort_order: number
}

export function useOtherIncomeCategories(salonId: string | undefined) {
  return useQuery<OtherIncomeCategoryRow[]>({
    queryKey: ['other-income-categories', salonId],
    queryFn: async () => {
      if (!salonId) return []
      const { data, error } = await supabase
        .from('other_income_categories')
        .select('id, salon_id, name, is_archived, is_system, sort_order')
        .eq('salon_id', salonId)
        .eq('is_archived', false)
        .order('sort_order')
      if (error) throw error
      return (data ?? []) as OtherIncomeCategoryRow[]
    },
    enabled: !!salonId,
  })
}

export function useOtherIncomes(
  salonId: string | undefined,
  range: { start: Date; end: Date },
  opts: { categoryId?: string | null } = {},
) {
  return useQuery<OtherIncomeRow[]>({
    queryKey: [
      'other-incomes',
      salonId,
      range.start.toISOString(),
      range.end.toISOString(),
      opts.categoryId ?? null,
    ],
    queryFn: async () => {
      if (!salonId) return []
      const startIso = range.start.toISOString().slice(0, 10)
      const endIso = range.end.toISOString().slice(0, 10)
      let q = supabase
        .from('other_incomes')
        .select('*')
        .eq('salon_id', salonId)
        .is('deleted_at', null)
        .gte('income_at', startIso)
        .lte('income_at', endIso)
        .order('income_at', { ascending: false })
      if (opts.categoryId) q = q.eq('category_id', opts.categoryId)
      const { data, error } = await q
      if (error) throw error
      return (data ?? []) as OtherIncomeRow[]
    },
    enabled: !!salonId,
  })
}

export type CreateOtherIncomeInput = {
  salon_id: string
  income_at: string
  amount_cents: number
  category_id: string | null
  payment_method: PaymentMethod | null
  comment: string | null
}

export function useCreateOtherIncome(salonId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: CreateOtherIncomeInput) => {
      const { data, error } = await supabase
        .from('other_incomes')
        .insert(input)
        .select('id')
        .single()
      if (error) throw error
      return data as { id: string }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['other-incomes', salonId] })
    },
  })
}

export function useDeleteOtherIncome(salonId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('other_incomes')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['other-incomes', salonId] })
    },
  })
}
