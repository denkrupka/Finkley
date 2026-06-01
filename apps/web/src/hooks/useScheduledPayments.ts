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
  /** IBAN получателя для bulk-экспорта в банк. Auto-fill из контрагента. */
  bank_account_iban: string | null
  /** FK на counterparty — для cross-fill IBAN. NULL для legacy записей. */
  counterparty_id: string | null
  /** VAT-разбивка (миграция 20260602000001). KSeF-импорт писал сюда из FA(2)
   *  P_13_x/P_14_x. P&L FinancialReportTab использует через
   *  vatBreakdownFor для строки «НДС к оплате». */
  amount_net_cents: number | null
  vat_rate_pct: number | null
  vat_skipped: boolean | null
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
