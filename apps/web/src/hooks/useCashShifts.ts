import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { supabase } from '@/lib/supabase/client'

export type CashShift = {
  id: string
  salon_id: string
  opened_at: string
  opened_by_user_id: string | null
  opening_amount_cents: number
  opening_comment: string | null
  closed_at: string | null
  closed_by_user_id: string | null
  actual_cash_cents: number | null
  actual_card_cents: number | null
  expected_cash_cents: number | null
  expected_card_cents: number | null
  diff_cash_cents: number | null
  diff_card_cents: number | null
  close_comment: string | null
  discrepancy_reason: string | null
  status: 'open' | 'closed'
  created_at: string
}

/**
 * Текущая открытая смена салона. Возвращает null, если смена ещё не
 * открыта. Один салон может иметь максимум одну `open` смену (БД-индекс
 * cash_shifts_one_open_per_salon).
 */
export function useCurrentShift(salonId: string | undefined) {
  return useQuery<CashShift | null>({
    queryKey: ['cash-shifts', salonId, 'current'],
    queryFn: async () => {
      if (!salonId) return null
      const { data, error } = await supabase
        .from('cash_shifts')
        .select('*')
        .eq('salon_id', salonId)
        .eq('status', 'open')
        .maybeSingle()
      if (error) {
        // Если миграция ещё не применилась — деградируем тихо, чтобы не
        // ломать страницу Финансов.
        return null
      }
      return (data as CashShift | null) ?? null
    },
    enabled: !!salonId,
    staleTime: 10_000,
  })
}

/**
 * История закрытых смен. По умолчанию — за последние 30 дней. Используется
 * в таблице «История смен» внизу страницы Касса.
 */
export function useShiftHistory(salonId: string | undefined, daysBack = 30) {
  return useQuery<CashShift[]>({
    queryKey: ['cash-shifts', salonId, 'history', daysBack],
    queryFn: async () => {
      if (!salonId) return []
      const since = new Date(Date.now() - daysBack * 86400_000).toISOString()
      const { data, error } = await supabase
        .from('cash_shifts')
        .select('*')
        .eq('salon_id', salonId)
        .eq('status', 'closed')
        .gte('opened_at', since)
        .order('opened_at', { ascending: false })
        .limit(200)
      if (error) return []
      return (data ?? []) as CashShift[]
    },
    enabled: !!salonId,
    staleTime: 30_000,
  })
}

export function useOpenShift(salonId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: { opening_amount_cents: number; opening_comment?: string }) => {
      if (!salonId) throw new Error('no_salon')
      const { data: u } = await supabase.auth.getUser()
      const { data, error } = await supabase
        .from('cash_shifts')
        .insert({
          salon_id: salonId,
          opening_amount_cents: input.opening_amount_cents,
          opening_comment: input.opening_comment || null,
          opened_by_user_id: u?.user?.id ?? null,
          status: 'open',
        })
        .select('*')
        .single()
      if (error) throw error
      return data as CashShift
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cash-shifts', salonId] })
    },
  })
}

export type CloseShiftInput = {
  shiftId: string
  actual_cash_cents: number
  actual_card_cents: number
  expected_cash_cents: number
  expected_card_cents: number
  close_comment?: string
  discrepancy_reason?: string
}

export function useCloseShift(salonId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: CloseShiftInput) => {
      const { data: u } = await supabase.auth.getUser()
      const { data, error } = await supabase
        .from('cash_shifts')
        .update({
          actual_cash_cents: input.actual_cash_cents,
          actual_card_cents: input.actual_card_cents,
          expected_cash_cents: input.expected_cash_cents,
          expected_card_cents: input.expected_card_cents,
          diff_cash_cents: input.actual_cash_cents - input.expected_cash_cents,
          diff_card_cents: input.actual_card_cents - input.expected_card_cents,
          close_comment: input.close_comment || null,
          discrepancy_reason: input.discrepancy_reason || null,
          closed_by_user_id: u?.user?.id ?? null,
          closed_at: new Date().toISOString(),
          status: 'closed',
        })
        .eq('id', input.shiftId)
        .select('*')
        .single()
      if (error) throw error
      return data as CashShift
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cash-shifts', salonId] })
    },
  })
}

/**
 * Транзакции внутри смены — визиты и расходы, попавшие в диапазон
 * [opened_at, closed_at ?? now]. Используется для отображения списка и
 * расчёта expected cash/card на момент закрытия.
 *
 * Делаем два отдельных запроса (visits + expenses) и объединяем на клиенте —
 * это проще чем SQL union на стороне сервера, а данных за смену < сотни.
 */
export type ShiftTxn = {
  id: string
  kind: 'visit' | 'expense'
  at: string
  amount_cents: number // знак: + для дохода, − для расхода
  payment_method: string | null
  cash_register_id: string | null
  label: string // имя услуги / описание расхода
  staff_id: string | null
  category_id: string | null
  created_by: string | null
}

export function useShiftTransactions(salonId: string | undefined, shift: CashShift | null) {
  return useQuery<ShiftTxn[]>({
    queryKey: ['cash-shifts', salonId, 'txns', shift?.id, shift?.opened_at, shift?.closed_at],
    queryFn: async () => {
      if (!salonId || !shift) return []
      const startIso = shift.opened_at
      const endIso = shift.closed_at ?? new Date().toISOString()

      const [visitsResp, expensesResp] = await Promise.all([
        supabase
          .from('visits')
          .select(
            'id, visit_at, amount_cents, tip_cents, discount_cents, payment_method, cash_register_id, service_name_snapshot, staff_id, created_by',
          )
          .eq('salon_id', salonId)
          .is('deleted_at', null)
          .gte('visit_at', startIso)
          .lte('visit_at', endIso)
          .eq('status', 'paid')
          .order('visit_at', { ascending: false })
          .limit(500),
        supabase
          .from('expenses')
          .select(
            'id, expense_at, amount_cents, payment_method, cash_register_id, description, comment, category_id, created_by, created_at',
          )
          .eq('salon_id', salonId)
          .is('deleted_at', null)
          .gte('created_at', startIso)
          .lte('created_at', endIso)
          .order('created_at', { ascending: false })
          .limit(500),
      ])

      const txns: ShiftTxn[] = []
      for (const v of (visitsResp.data ?? []) as Array<{
        id: string
        visit_at: string
        amount_cents: number
        tip_cents: number
        discount_cents: number
        payment_method: string | null
        cash_register_id: string | null
        service_name_snapshot: string | null
        staff_id: string | null
        created_by: string | null
      }>) {
        txns.push({
          id: v.id,
          kind: 'visit',
          at: v.visit_at,
          amount_cents: v.amount_cents + (v.tip_cents ?? 0) - (v.discount_cents ?? 0),
          payment_method: v.payment_method,
          cash_register_id: v.cash_register_id,
          label: v.service_name_snapshot ?? '—',
          staff_id: v.staff_id,
          category_id: null,
          created_by: v.created_by,
        })
      }
      for (const e of (expensesResp.data ?? []) as Array<{
        id: string
        expense_at: string
        amount_cents: number
        payment_method: string | null
        cash_register_id: string | null
        description: string | null
        comment: string | null
        category_id: string | null
        created_by: string | null
        created_at: string
      }>) {
        txns.push({
          id: e.id,
          kind: 'expense',
          at: e.created_at,
          // Расход — отрицательный знак для итогов.
          amount_cents: -e.amount_cents,
          payment_method: e.payment_method,
          cash_register_id: e.cash_register_id,
          label: e.description || e.comment || '—',
          staff_id: null,
          category_id: e.category_id,
          created_by: e.created_by,
        })
      }
      // По убыванию времени.
      txns.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
      return txns
    },
    enabled: !!salonId && !!shift,
    staleTime: 10_000,
  })
}

/**
 * Считает ожидаемые суммы (cash/card) на основе списка транзакций смены +
 * opening_amount. Используется и для KPI «касса сейчас», и для snapshot
 * при закрытии смены.
 */
export function computeExpected(
  shift: CashShift | null,
  txns: ShiftTxn[],
): { expected_cash_cents: number; expected_card_cents: number } {
  let cash = shift?.opening_amount_cents ?? 0
  let card = 0
  for (const t of txns) {
    const method = (t.payment_method ?? '').toLowerCase()
    if (method === 'cash') cash += t.amount_cents
    else if (method === 'card' || method === 'terminal') card += t.amount_cents
    // online/transfer/mixed — не входят в наличные/карта сверку.
  }
  return { expected_cash_cents: cash, expected_card_cents: card }
}
