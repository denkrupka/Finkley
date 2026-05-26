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
  /** Конкретная касса salon'а (из financial_settings.cash_registers.items[]).
   *  Нужна для per-register балансов в модалке «Перестановка средств» (ADR-014). */
  cash_register_id: string | null
  comment: string | null
  receipt_url: string | null
  source: string
  /** Плательщик/контрагент (для ДДС-детализации). */
  payer_name: string | null
  /** Под-статья (иерархическая детализация). */
  sub_article: string | null
  /** Image #51: сумма уже полученного (для частичных поступлений).
   *  NULL = полностью получено. См. income_payment_installments. */
  paid_amount_cents: number | null
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
  /** Родительская категория (иерархия, миграция 20260517000001). */
  parent_id: string | null
}

export function useOtherIncomeCategories(
  salonId: string | undefined,
  opts: { includeArchived?: boolean } = {},
) {
  return useQuery<OtherIncomeCategoryRow[]>({
    queryKey: ['other-income-categories', salonId, opts.includeArchived ?? false],
    queryFn: async () => {
      if (!salonId) return []
      let q = supabase
        .from('other_income_categories')
        .select('id, salon_id, name, is_archived, is_system, sort_order, parent_id')
        .eq('salon_id', salonId)
        .order('sort_order')
      if (!opts.includeArchived) q = q.eq('is_archived', false)
      const { data, error } = await q
      if (error) throw error
      return (data ?? []) as OtherIncomeCategoryRow[]
    },
    enabled: !!salonId,
  })
}

export function useCreateOtherIncomeCategory(salonId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: { name: string; sort_order?: number; parent_id?: string | null }) => {
      if (!salonId) throw new Error('no_salon')
      const { data, error } = await supabase
        .from('other_income_categories')
        .insert({
          salon_id: salonId,
          name: input.name.trim(),
          sort_order: input.sort_order ?? 100,
          is_archived: false,
          is_system: false,
          parent_id: input.parent_id ?? null,
        })
        .select('id')
        .single()
      if (error) throw error
      return data as { id: string }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['other-income-categories', salonId] })
    },
  })
}

export function useUpdateOtherIncomeCategory(salonId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: {
      id: string
      name?: string
      is_archived?: boolean
      sort_order?: number
    }) => {
      const { id, ...patch } = input
      const { error } = await supabase.from('other_income_categories').update(patch).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['other-income-categories', salonId] })
    },
  })
}

export function useDeleteOtherIncomeCategory(salonId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('other_income_categories').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['other-income-categories', salonId] })
    },
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
  cash_register_id?: string | null
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

export type UpdateOtherIncomeInput = {
  id: string
  income_at?: string
  amount_cents?: number
  category_id?: string | null
  payment_method?: PaymentMethod | null
  cash_register_id?: string | null
  comment?: string | null
}

export function useUpdateOtherIncome(salonId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: UpdateOtherIncomeInput) => {
      const { id, ...patch } = input
      const { error } = await supabase.from('other_incomes').update(patch).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['other-incomes', salonId] })
      qc.invalidateQueries({ queryKey: ['register-balances', salonId] })
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
