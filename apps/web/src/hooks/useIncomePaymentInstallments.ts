import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { supabase } from '@/lib/supabase/client'

export type IncomePaymentInstallmentRow = {
  id: string
  visit_id: string | null
  other_income_id: string | null
  paid_at: string
  amount_cents: number
  payment_method: string | null
  /** ID кассы из salons.financial_settings.cash_registers.items[] (text, не FK). */
  cash_register_id: string | null
  bank_transaction_id: string | null
  comment: string | null
  created_by: string | null
  created_at: string
}

export function incomeInstallmentsKey(args: {
  visit_id?: string | null
  other_income_id?: string | null
}) {
  return ['income-installments', args.visit_id ?? null, args.other_income_id ?? null] as const
}

export function useIncomePaymentInstallments(args: {
  visit_id?: string | null
  other_income_id?: string | null
}) {
  return useQuery<IncomePaymentInstallmentRow[]>({
    queryKey: incomeInstallmentsKey(args),
    queryFn: async () => {
      const id = args.visit_id ?? args.other_income_id
      if (!id) return []
      const col = args.visit_id ? 'visit_id' : 'other_income_id'
      const { data, error } = await supabase
        .from('income_payment_installments')
        .select('*')
        .eq(col, id)
        .order('paid_at', { ascending: true })
      if (error) throw new Error(error.message)
      return (data ?? []) as IncomePaymentInstallmentRow[]
    },
    enabled: !!(args.visit_id || args.other_income_id),
    staleTime: 10_000,
  })
}

export type CreateIncomeInstallmentInput = {
  visit_id?: string | null
  other_income_id?: string | null
  paid_at?: string
  amount_cents: number
  payment_method?: string | null
  cash_register_id?: string | null
  bank_transaction_id?: string | null
  comment?: string | null
}

export function useCreateIncomeInstallment(salonId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: CreateIncomeInstallmentInput) => {
      const { error } = await supabase.from('income_payment_installments').insert({
        visit_id: input.visit_id ?? null,
        other_income_id: input.other_income_id ?? null,
        paid_at: input.paid_at ?? new Date().toISOString(),
        amount_cents: input.amount_cents,
        payment_method: input.payment_method ?? null,
        cash_register_id: input.cash_register_id ?? null,
        bank_transaction_id: input.bank_transaction_id ?? null,
        comment: input.comment ?? null,
      })
      if (error) throw new Error(error.message)
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({
        queryKey: incomeInstallmentsKey({
          visit_id: vars.visit_id,
          other_income_id: vars.other_income_id,
        }),
      })
      qc.invalidateQueries({ queryKey: ['visits', salonId] })
      qc.invalidateQueries({ queryKey: ['other-incomes', salonId] })
    },
  })
}
