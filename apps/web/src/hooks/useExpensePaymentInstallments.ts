import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { supabase } from '@/lib/supabase/client'

export type ExpensePaymentInstallmentRow = {
  id: string
  expense_id: string
  paid_at: string // timestamptz ISO
  amount_cents: number
  payment_method: string | null
  cash_register_id: string | null
  bank_transaction_id: string | null
  comment: string | null
  created_by: string | null
  created_at: string
}

export function expenseInstallmentsKey(expenseId: string | undefined) {
  return ['expense-installments', expenseId] as const
}

export function useExpensePaymentInstallments(expenseId: string | undefined) {
  return useQuery<ExpensePaymentInstallmentRow[]>({
    queryKey: expenseInstallmentsKey(expenseId),
    queryFn: async () => {
      if (!expenseId) return []
      const { data, error } = await supabase
        .from('expense_payment_installments')
        .select('*')
        .eq('expense_id', expenseId)
        .order('paid_at', { ascending: true })
      if (error) throw new Error(error.message)
      return (data ?? []) as ExpensePaymentInstallmentRow[]
    },
    enabled: !!expenseId,
    staleTime: 10_000,
  })
}

export type CreateInstallmentInput = {
  expense_id: string
  paid_at?: string
  amount_cents: number
  payment_method?: string | null
  cash_register_id?: string | null
  bank_transaction_id?: string | null
  comment?: string | null
}

export function useCreateExpenseInstallment(salonId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: CreateInstallmentInput) => {
      const { error } = await supabase.from('expense_payment_installments').insert({
        expense_id: input.expense_id,
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
      // Trigger в БД пересчитает expenses.paid_amount_cents — инвалидируем
      // expenses и список installments этого расхода.
      qc.invalidateQueries({ queryKey: expenseInstallmentsKey(vars.expense_id) })
      qc.invalidateQueries({ queryKey: ['expenses', salonId] })
    },
  })
}

export function useDeleteExpenseInstallment(salonId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: { id: string; expense_id: string }) => {
      const { error } = await supabase
        .from('expense_payment_installments')
        .delete()
        .eq('id', args.id)
      if (error) throw new Error(error.message)
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: expenseInstallmentsKey(vars.expense_id) })
      qc.invalidateQueries({ queryKey: ['expenses', salonId] })
    },
  })
}
