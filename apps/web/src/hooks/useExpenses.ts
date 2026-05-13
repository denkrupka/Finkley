import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { supabase } from '@/lib/supabase/client'
import type { PaymentMethod } from './useVisits'

export type ExpenseRecurrence = 'none' | 'weekly' | 'monthly'

export type ExpenseRow = {
  id: string
  salon_id: string
  category_id: string | null
  expense_at: string // date (YYYY-MM-DD)
  amount_cents: number
  payment_method: PaymentMethod | null
  comment: string | null
  source: string
  receipt_url: string | null
  recurrence: ExpenseRecurrence
  next_occurrence_at: string | null
  recurrence_parent_id: string | null
  /**
   * Произвольные метаданные jsonb. Известные ключи:
   *   ksef_id           — NumerKSeF фактуры; уникальный кросс-портал ключ
   *                       для дедупа (КСеФ, wFirma, Fakturownia, iFirma, ...)
   *   wfirma_expense_id — расход уже отправлен в wFirma (push успешен)
   *   wfirma_pushed_at  — ISO timestamp push'а
   *   wfirma_ksef_id    — legacy alias для ksef_id (1 релиз backward compat)
   *   fakturownia_id    — id в Fakturownia (после push или из импорта)
   *   infakt_id         — id в inFakt
   *   buyer_nip         — NIP nabywcy из OCR-результата
   *   vendor_nip        — NIP sprzedawcy из OCR-результата
   *   currency_original — оригинальная валюта (для импортов)
   */
  metadata: Record<string, unknown> | null
  /** Контрагент / поставщик (для ДДС-детализации). */
  contractor_name: string | null
  /** Под-статья — иерархическая детализация внутри category. */
  sub_article: string | null
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

export function useCreateExpenseCategory(salonId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: { name: string; sort_order?: number }) => {
      if (!salonId) throw new Error('no_salon')
      const { data, error } = await supabase
        .from('expense_categories')
        .insert({
          salon_id: salonId,
          name: input.name,
          sort_order: input.sort_order ?? 100,
          is_system: false,
        })
        .select('id')
        .single()
      if (error) throw error
      return data.id as string
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['expense_categories', salonId] })
    },
  })
}

export function useUpdateExpenseCategory(salonId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: { id: string; name?: string; is_archived?: boolean }) => {
      const { id, ...patch } = input
      const { error } = await supabase.from('expense_categories').update(patch).eq('id', id)
      if (error) throw error
      return id
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['expense_categories', salonId] })
      qc.invalidateQueries({ queryKey: expensesKeys(salonId) })
    },
  })
}

export function useExpenses(
  salonId: string | undefined,
  period: ExpensesPeriod,
  filters?: { categoryId?: string | null; paymentMethod?: PaymentMethod | null },
) {
  const filterKey = filters ?? {}
  return useQuery<ExpenseRow[]>({
    queryKey: [...expensesKeys(salonId), 'list', period, filterKey],
    queryFn: async () => {
      if (!salonId) return []
      let q = supabase
        .from('expenses')
        .select(
          'id, salon_id, category_id, expense_at, amount_cents, payment_method, comment, source, receipt_url, recurrence, next_occurrence_at, recurrence_parent_id, metadata, contractor_name, sub_article, created_at, updated_at, deleted_at',
        )
        .eq('salon_id', salonId)
        .is('deleted_at', null)
        .gte('expense_at', period.start)
        .lte('expense_at', period.end)
        .order('expense_at', { ascending: false })

      if (filters?.categoryId) q = q.eq('category_id', filters.categoryId)
      if (filters?.paymentMethod) q = q.eq('payment_method', filters.paymentMethod)

      const { data, error } = await q.limit(500)
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
  receipt_url?: string | null
  recurrence?: ExpenseRecurrence
  next_occurrence_at?: string | null
  /**
   * Произвольные метаданные (jsonb). Сейчас используется для wFirma push:
   * { buyer_nip?: string, vendor_nip?: string }. Edge function потом
   * сравнивает buyer_nip с подключённой компанией и решает auto-push.
   */
  metadata?: Record<string, unknown>
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

/**
 * Загружает файл чека в Storage bucket `receipts`. Возвращает path внутри bucket'а
 * (e.g. "<salon_id>/<uuid>.jpg") — его сохраняем в expenses.receipt_url.
 *
 * Path конструируется как salon_id/<uuid>.<ext>, чтобы RLS-политика
 * (storage.foldername(name))[1] = salon_id работала.
 */
export async function uploadReceipt(salonId: string, file: File): Promise<string> {
  const ext = file.name.split('.').pop()?.toLowerCase() || 'bin'
  const path = `${salonId}/${crypto.randomUUID()}.${ext}`
  const { error } = await supabase.storage.from('receipts').upload(path, file, {
    upsert: false,
    contentType: file.type || undefined,
  })
  if (error) throw error
  return path
}

/**
 * Возвращает signed URL для приватного файла в bucket `receipts`.
 * TTL — 1 час, обновляем при каждом запросе превью.
 */
export async function getReceiptSignedUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from('receipts').createSignedUrl(path, 3600)
  if (error) throw error
  return data.signedUrl
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
