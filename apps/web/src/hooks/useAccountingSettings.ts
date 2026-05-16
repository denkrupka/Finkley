import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { supabase } from '@/lib/supabase/client'

/**
 * Бухгалтерия (image #122). Хранится в `salons.accounting_settings` jsonb.
 * Миграция: 20260516000002_accounting_settings.sql.
 *
 * Все поля опциональны — заполняется по мере того, как юзер вводит данные
 * (NIP lookup автозаполняет name+address, остальное руками).
 */
export type AccountingSettings = {
  nip?: string
  company_name?: string
  address?: string
  vat_payer?: boolean
  legal_form?: string
  /** Ключ из catalog'а форм налогообложения (skala/liniowy/ryczalt/cit/...). */
  tax_form?: string
  tax_rate?: number
  document_delivery?: 'portal' | 'email' | 'both'
  /** Идентификатор портала: wfirma | fakturownia | infakt | ksef | other. */
  portal?: string
  /** Если portal='other' — название портала, написанное юзером. */
  portal_other_name?: string
  accountant_email?: string
}

export function useAccountingSettings(salonId: string | undefined) {
  return useQuery<AccountingSettings>({
    queryKey: ['accounting-settings', salonId],
    queryFn: async () => {
      if (!salonId) return {}
      const { data, error } = await supabase
        .from('salons')
        .select('accounting_settings')
        .eq('id', salonId)
        .single()
      if (error) {
        // Миграция могла ещё не примениться — деградируем тихо.
        return {}
      }
      return (data?.accounting_settings ?? {}) as AccountingSettings
    },
    enabled: !!salonId,
    staleTime: 60_000,
  })
}

export function useUpdateAccountingSettings(salonId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (settings: AccountingSettings) => {
      if (!salonId) throw new Error('no_salon')
      const { error } = await supabase
        .from('salons')
        .update({ accounting_settings: settings })
        .eq('id', salonId)
      if (error) throw error
      return settings
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['accounting-settings', salonId] })
    },
  })
}
