import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { supabase } from '@/lib/supabase/client'

/**
 * Бухгалтерия (image #122). Хранится в `salons.accounting_settings` jsonb.
 * Миграция: 20260516000002_accounting_settings.sql.
 *
 * Все поля опциональны — заполняется по мере того, как юзер вводит данные
 * (NIP lookup автозаполняет name+address, остальное руками).
 */
/**
 * Расписание отправки документов бухгалтеру по email (image #135/#136).
 * Сам email берётся из аккаунта-бухгалтера в `salon_members` — здесь
 * указывается только частота. Адрес тут НЕ дублируем.
 */
export type EmailFrequency =
  | { kind: 'immediate' }
  | { kind: 'daily'; time: string }
  | { kind: 'weekly'; time: string; day_of_week: number /* 1=Пн..7=Вс */ }
  | { kind: 'monthly'; time: string; day_of_month: number /* 1..31 */ }
  | { kind: 'next_month_start'; time: string; day_of_month: number }

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
  /** Частота отправки документов по email (image #135/#136). */
  email_frequency?: EmailFrequency
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
