import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { supabase } from '@/lib/supabase/client'

export type CashTransfer = {
  id: string
  salon_id: string
  from_register_id: string
  to_register_id: string
  amount_cents: number
  comment: string | null
  transferred_at: string
  created_by: string | null
  created_at: string
  reversal_of: string | null
  deleted_at: string | null
  deleted_by: string | null
  deleted_reason: string | null
}

export type RegisterBalance = {
  register_id: string
  balance_cents: number
}

export const cashTransfersKeys = (salonId: string) => ['cash-transfers', salonId] as const
export const registerBalancesKeys = (salonId: string) => ['register-balances', salonId] as const

/**
 * Все балансы активных касс салона одним вызовом (RPC
 * compute_all_register_balances). Используется в карточках касс наверху
 * модалки трансфера и в табе /finance → Касса.
 */
export function useRegisterBalances(salonId: string | undefined) {
  return useQuery<RegisterBalance[]>({
    queryKey: salonId ? registerBalancesKeys(salonId) : ['register-balances', 'noop'],
    queryFn: async () => {
      if (!salonId) return []
      const { data, error } = await supabase.rpc('compute_all_register_balances', {
        p_salon_id: salonId,
      })
      if (error) throw error
      return (data ?? []) as RegisterBalance[]
    },
    enabled: !!salonId,
    staleTime: 30_000,
  })
}

export type CashTransferFilters = {
  start?: Date | null
  end?: Date | null
  /** Любая сторона: from OR to. Для общего фильтра «по этой кассе». */
  registerId?: string | null
  /** Только источник. */
  fromRegisterId?: string | null
  /** Только назначение. */
  toRegisterId?: string | null
  userId?: string | null
  minAmountCents?: number | null
  maxAmountCents?: number | null
}

/**
 * История трансферов с фильтрами + пагинацией. По умолчанию — все за
 * последние 90 дней без фильтров. Soft-deleted записи возвращаем (они
 * нужны для визуализации «удалено»), но визуально помечаем в UI.
 */
export function useCashTransfers(
  salonId: string | undefined,
  filters: CashTransferFilters = {},
  page: number = 1,
  pageSize: number = 50,
) {
  const startISO = filters.start ? filters.start.toISOString() : null
  const endISO = filters.end ? filters.end.toISOString() : null
  return useQuery<{ rows: CashTransfer[]; total: number }>({
    queryKey: [
      ...cashTransfersKeys(salonId ?? 'noop'),
      'list',
      startISO,
      endISO,
      filters.registerId ?? null,
      filters.fromRegisterId ?? null,
      filters.toRegisterId ?? null,
      filters.userId ?? null,
      filters.minAmountCents ?? null,
      filters.maxAmountCents ?? null,
      page,
      pageSize,
    ],
    queryFn: async () => {
      if (!salonId) return { rows: [], total: 0 }
      let q = supabase
        .from('cash_transfers')
        .select('*', { count: 'exact' })
        .eq('salon_id', salonId)
      if (startISO) q = q.gte('transferred_at', startISO)
      if (endISO) q = q.lte('transferred_at', endISO)
      if (filters.registerId) {
        q = q.or(
          `from_register_id.eq.${filters.registerId},to_register_id.eq.${filters.registerId}`,
        )
      }
      if (filters.fromRegisterId) q = q.eq('from_register_id', filters.fromRegisterId)
      if (filters.toRegisterId) q = q.eq('to_register_id', filters.toRegisterId)
      if (filters.userId) q = q.eq('created_by', filters.userId)
      if (typeof filters.minAmountCents === 'number') {
        q = q.gte('amount_cents', filters.minAmountCents)
      }
      if (typeof filters.maxAmountCents === 'number') {
        q = q.lte('amount_cents', filters.maxAmountCents)
      }
      q = q
        .order('transferred_at', { ascending: false })
        .range((page - 1) * pageSize, page * pageSize - 1)
      const { data, error, count } = await q
      if (error) throw error
      return { rows: (data ?? []) as CashTransfer[], total: count ?? 0 }
    },
    enabled: !!salonId,
    staleTime: 10_000,
  })
}

/**
 * Создать трансфер. RPC проверяет баланс источника атомарно.
 */
export function useCreateCashTransfer(salonId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: {
      from: string
      to: string
      amountCents: number
      comment?: string | null
      transferredAt?: Date | null
    }) => {
      const { data, error } = await supabase.rpc('cash_transfer_create', {
        p_salon_id: salonId,
        p_from: input.from,
        p_to: input.to,
        p_amount_cents: input.amountCents,
        p_comment: input.comment ?? null,
        p_transferred_at: input.transferredAt ? input.transferredAt.toISOString() : null,
      })
      if (error) throw error
      return data as CashTransfer
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: cashTransfersKeys(salonId) })
      void qc.invalidateQueries({ queryKey: registerBalancesKeys(salonId) })
    },
  })
}

/**
 * Откатить трансфер (создаёт обратную запись reversal_of=id). Для
 * undo-toast «Откатить (8 сек)».
 */
export function useReverseCashTransfer(salonId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase.rpc('cash_transfer_reverse', { p_id: id })
      if (error) throw error
      return data as CashTransfer
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: cashTransfersKeys(salonId) })
      void qc.invalidateQueries({ queryKey: registerBalancesKeys(salonId) })
    },
  })
}

/**
 * Soft-delete с указанием причины. Только owner/admin (enforce в RPC).
 */
export function useSoftDeleteCashTransfer(salonId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: { id: string; reason: string }) => {
      const { data, error } = await supabase.rpc('cash_transfer_soft_delete', {
        p_id: input.id,
        p_reason: input.reason,
      })
      if (error) throw error
      return data as CashTransfer
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: cashTransfersKeys(salonId) })
      void qc.invalidateQueries({ queryKey: registerBalancesKeys(salonId) })
    },
  })
}
