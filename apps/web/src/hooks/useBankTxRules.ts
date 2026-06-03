import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { supabase } from '@/lib/supabase/client'
import {
  BankTxRuleInputSchema,
  type BankTxRuleInput,
  type RuleAction,
  type RuleAppliesTo,
  type RuleCondition,
} from '@/lib/banking/bank-rule-schema'

/**
 * ADR-031: bank_tx_rules — богатая модель правил.
 *  - applies_to: 'income' | 'expense' | 'both'
 *  - conditions: массив (field, op, value), AND между ними.
 *  - actions: массив (type=set_category|set_counterparty|ignore).
 *  - enabled: тоггл вкл/выкл (свитч в списке).
 *  - sort_order: порядок применения, lower first.
 *
 * Старые колонки (counterparty_pattern, action, category_id) остаются в
 * БД как deprecated до следующей миграции, но в новых правилах не пишутся.
 */
export type BankTxRule = {
  id: string
  salon_id: string
  name: string
  enabled: boolean
  applies_to: RuleAppliesTo
  conditions: RuleCondition[]
  actions: RuleAction[]
  sort_order: number
  created_by: string | null
  created_at: string
  updated_at: string
}

const SELECT_COLS =
  'id, salon_id, name, enabled, applies_to, conditions, actions, sort_order, created_by, created_at, updated_at'

export function useBankTxRules(salonId: string | undefined) {
  return useQuery({
    queryKey: ['bank-tx-rules', salonId],
    queryFn: async (): Promise<BankTxRule[]> => {
      if (!salonId) return []
      const { data, error } = await supabase
        .from('bank_tx_rules')
        .select(SELECT_COLS)
        .eq('salon_id', salonId)
        .order('sort_order', { ascending: true })
        .order('created_at', { ascending: true })
      if (error) throw error
      return (data ?? []) as unknown as BankTxRule[]
    },
    enabled: !!salonId,
  })
}

export function useCreateBankTxRule(salonId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: BankTxRuleInput): Promise<BankTxRule> => {
      if (!salonId) throw new Error('no salon')
      const parsed = BankTxRuleInputSchema.parse(input)
      const { data, error } = await supabase
        .from('bank_tx_rules')
        .insert({
          salon_id: salonId,
          name: parsed.name,
          enabled: parsed.enabled,
          applies_to: parsed.applies_to,
          conditions: parsed.conditions,
          actions: parsed.actions,
          sort_order: parsed.sort_order,
        })
        .select(SELECT_COLS)
        .single()
      if (error) throw error
      return data as unknown as BankTxRule
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['bank-tx-rules', salonId] }),
  })
}

export function useUpdateBankTxRule(salonId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: { id: string; patch: Partial<BankTxRuleInput> }) => {
      const patch: Record<string, unknown> = { ...input.patch }
      if (Object.keys(patch).length === 0) return
      const { error } = await supabase.from('bank_tx_rules').update(patch).eq('id', input.id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['bank-tx-rules', salonId] }),
  })
}

export function useToggleBankTxRule(salonId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: { id: string; enabled: boolean }) => {
      const { error } = await supabase
        .from('bank_tx_rules')
        .update({ enabled: input.enabled })
        .eq('id', input.id)
      if (error) throw error
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
