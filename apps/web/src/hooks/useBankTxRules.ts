import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { supabase } from '@/lib/supabase/client'

export type BankTxRule = {
  id: string
  salon_id: string
  counterparty_pattern: string
  action: 'auto_create' | 'ignore'
  category_id: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

/**
 * Bug 03.06 (Денис): правила обработки банковских транзакций.
 * - auto_create: при появлении tx с counterparty match → создаём expense
 *   с привязанной категорией. Дубль чек через AI/fuzzy match.
 * - ignore: личные траты (SMYK, Biedronka). Не создаём expense, помечаем
 *   bank_tx.is_personal=true и показываем тег "Личное" в UI.
 */
export function useBankTxRules(salonId: string | undefined) {
  return useQuery({
    queryKey: ['bank-tx-rules', salonId],
    queryFn: async (): Promise<BankTxRule[]> => {
      if (!salonId) return []
      const { data, error } = await supabase
        .from('bank_tx_rules')
        .select('*')
        .eq('salon_id', salonId)
        .order('created_at', { ascending: true })
      if (error) throw error
      return (data ?? []) as BankTxRule[]
    },
    enabled: !!salonId,
  })
}

export function useCreateBankTxRule(salonId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: {
      counterparty_pattern: string
      action: 'auto_create' | 'ignore'
      category_id?: string | null
    }) => {
      if (!salonId) throw new Error('no salon')
      const { data, error } = await supabase
        .from('bank_tx_rules')
        .insert({
          salon_id: salonId,
          counterparty_pattern: input.counterparty_pattern.trim(),
          action: input.action,
          category_id: input.action === 'auto_create' ? (input.category_id ?? null) : null,
        })
        .select('*')
        .single()
      if (error) throw error
      return data as BankTxRule
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['bank-tx-rules', salonId] }),
  })
}

export function useDeleteBankTxRule(salonId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('bank_tx_rules').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['bank-tx-rules', salonId] }),
  })
}
