import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { supabase } from '@/lib/supabase/client'

import type { StaffPayoutScheme } from './useStaff'

export type PayoutPreviewRow = {
  staff_id: string
  full_name: string
  payout_scheme: StaffPayoutScheme
  visit_count: number
  revenue_cents: number
  /** Сумма чаевых за период. Добавлено в миграции 20260521000012 — нужно
   *  отображать в /payouts отдельной колонкой (чаевые идут мастеру 100%). */
  tips_cents: number
  payout_cents: number
}

/**
 * Read-only превью зарплат за период через RPC calculate_payouts_for_period.
 * Не пишет в БД, можно дёргать сколько угодно. Используется на странице payouts.
 */
export function usePayoutsPreview(
  salonId: string | undefined,
  periodStart: string | undefined,
  periodEnd: string | undefined,
) {
  return useQuery<PayoutPreviewRow[]>({
    queryKey: ['payouts', 'preview', salonId, periodStart, periodEnd],
    queryFn: async () => {
      if (!salonId || !periodStart || !periodEnd) return []
      const { data, error } = await supabase.rpc('calculate_payouts_for_period', {
        p_salon_id: salonId,
        p_period_start: periodStart,
        p_period_end: periodEnd,
      })
      if (error) throw error
      return ((data ?? []) as PayoutPreviewRow[]).map((r) => ({
        ...r,
        // Postgres bigint → JS number (безопасно до 9 трлн копеек = 90 млрд €)
        visit_count: Number(r.visit_count),
        revenue_cents: Number(r.revenue_cents),
        tips_cents: Number(r.tips_cents ?? 0),
        payout_cents: Number(r.payout_cents),
      }))
    },
    enabled: !!salonId && !!periodStart && !!periodEnd,
    staleTime: 30_000,
  })
}

export type PayoutHistoryRow = {
  id: string
  staff_id: string
  staff_name: string | null
  period_start: string
  period_end: string
  total_revenue_cents: number
  total_payout_cents: number
  status: 'draft' | 'paid'
  paid_at: string | null
}

/** История закрытых периодов: одна строка на (мастер, период). */
export function usePayoutsHistory(salonId: string | undefined) {
  return useQuery<PayoutHistoryRow[]>({
    queryKey: ['payouts', 'history', salonId],
    queryFn: async () => {
      if (!salonId) return []
      const { data, error } = await supabase
        .from('payouts')
        .select(
          'id, staff_id, period_start, period_end, total_revenue_cents, total_payout_cents, status, paid_at, staff:staff_id(full_name)',
        )
        .eq('salon_id', salonId)
        .order('period_end', { ascending: false })
        .limit(60)
      if (error) throw error
      return (
        (data ?? []) as unknown as Array<{
          id: string
          staff_id: string
          period_start: string
          period_end: string
          total_revenue_cents: number
          total_payout_cents: number
          status: 'draft' | 'paid'
          paid_at: string | null
          staff: { full_name: string } | null
        }>
      ).map((r) => ({
        id: r.id,
        staff_id: r.staff_id,
        staff_name: r.staff?.full_name ?? null,
        period_start: r.period_start,
        period_end: r.period_end,
        total_revenue_cents: Number(r.total_revenue_cents),
        total_payout_cents: Number(r.total_payout_cents),
        status: r.status,
        paid_at: r.paid_at,
      }))
    },
    enabled: !!salonId,
    staleTime: 60_000,
  })
}

/** Закрывает период: создаёт payouts + auto-expense за зарплаты в категории "Зарплаты".
 *  cash_register_id (опц.) проставляется на обе строки — для per-register балансов (ADR-014). */
export function useClosePayoutPeriod(salonId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: {
      period_start: string
      period_end: string
      cash_register_id?: string | null
    }) => {
      if (!salonId) throw new Error('no salon')
      const { data, error } = await supabase
        .rpc('close_payout_period', {
          p_salon_id: salonId,
          p_period_start: input.period_start,
          p_period_end: input.period_end,
          p_cash_register_id: input.cash_register_id ?? null,
        })
        .single()
      if (error) throw error
      return data as { payouts_created: number; total_expense_cents: number }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['payouts', salonId] })
      qc.invalidateQueries({ queryKey: ['expenses', salonId] })
      qc.invalidateQueries({ queryKey: ['dashboard', salonId] })
      qc.invalidateQueries({ queryKey: ['register-balances', salonId] })
    },
  })
}

/**
 * Проверяет: закрыт ли уже указанный период (= хотя бы одна 'paid' строка).
 * Используется чтобы дизейблить кнопку «Закрыть период».
 */
export function useIsPeriodClosed(
  salonId: string | undefined,
  periodStart: string | undefined,
  periodEnd: string | undefined,
) {
  return useQuery<boolean>({
    queryKey: ['payouts', 'is-closed', salonId, periodStart, periodEnd],
    queryFn: async () => {
      if (!salonId || !periodStart || !periodEnd) return false
      const { count, error } = await supabase
        .from('payouts')
        .select('id', { count: 'exact', head: true })
        .eq('salon_id', salonId)
        .eq('period_start', periodStart)
        .eq('period_end', periodEnd)
        .eq('status', 'paid')
      if (error) throw error
      return (count ?? 0) > 0
    },
    enabled: !!salonId && !!periodStart && !!periodEnd,
    staleTime: 30_000,
  })
}
