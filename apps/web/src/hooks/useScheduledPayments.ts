import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { supabase } from '@/lib/supabase/client'

export type ScheduledPaymentRow = {
  id: string
  salon_id: string
  category_id: string | null
  due_date: string
  amount_cents: number
  vendor_name: string | null
  invoice_number: string | null
  comment: string | null
  status: 'pending' | 'paid'
  paid_at: string | null
  paid_expense_id: string | null
  source: string
  external_id: string | null
  created_at: string
  updated_at: string
  deleted_at: string | null
}

export function useScheduledPayments(salonId: string | undefined) {
  return useQuery<ScheduledPaymentRow[]>({
    queryKey: ['scheduled-payments', salonId],
    queryFn: async () => {
      if (!salonId) return []
      const { data, error } = await supabase
        .from('scheduled_payments')
        .select('*')
        .eq('salon_id', salonId)
        .is('deleted_at', null)
        .order('due_date')
      if (error) throw error
      return (data ?? []) as ScheduledPaymentRow[]
    },
    enabled: !!salonId,
  })
}

export type CreateScheduledPaymentInput = {
  salon_id: string
  due_date: string
  amount_cents: number
  vendor_name: string | null
  invoice_number: string | null
  category_id: string | null
  comment: string | null
}

export function useCreateScheduledPayment(salonId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: CreateScheduledPaymentInput) => {
      const { data, error } = await supabase
        .from('scheduled_payments')
        .insert({ ...input, source: 'manual' })
        .select('id')
        .single()
      if (error) throw error
      return data as { id: string }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['scheduled-payments', salonId] })
    },
  })
}

/**
 * Помечает scheduled_payment как оплаченный. Опционально создаёт expense
 * за эту оплату (createExpense=true) — нужно когда юзер фактически
 * перевёл деньги и хочет чтобы это отразилось в ДДС.
 */
export function useMarkPaymentPaid(salonId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: { id: string; createExpense: boolean }) => {
      const { data: pmt, error: e1 } = await supabase
        .from('scheduled_payments')
        .select('*')
        .eq('id', input.id)
        .single()
      if (e1) throw e1
      let expenseId: string | null = null
      if (input.createExpense) {
        const { data: exp, error: e2 } = await supabase
          .from('expenses')
          .insert({
            salon_id: pmt.salon_id,
            category_id: pmt.category_id,
            expense_at: new Date().toISOString().slice(0, 10),
            amount_cents: pmt.amount_cents,
            payment_method: 'transfer',
            comment: pmt.comment,
            contractor_name: pmt.vendor_name,
            invoice_number: pmt.invoice_number,
            source: 'manual',
          })
          .select('id')
          .single()
        if (e2) throw e2
        expenseId = exp.id
      }
      const { error: e3 } = await supabase
        .from('scheduled_payments')
        .update({
          status: 'paid',
          paid_at: new Date().toISOString(),
          paid_expense_id: expenseId,
        })
        .eq('id', input.id)
      if (e3) throw e3
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['scheduled-payments', salonId] })
      qc.invalidateQueries({ queryKey: ['expenses', salonId] })
    },
  })
}

export function useDeleteScheduledPayment(salonId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('scheduled_payments')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['scheduled-payments', salonId] })
    },
  })
}
