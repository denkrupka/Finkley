import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { supabase } from '@/lib/supabase/client'
import type { PaymentMethod } from '@/hooks/useVisits'

export type PaymentMethodRow = {
  id: string
  salon_id: string
  code: PaymentMethod
  label: string
  sort_order: number
  is_archived: boolean
  is_system: boolean
  /** ID кассы (financial_settings.cash_registers.items[].id), куда зачисляются
   *  средства при оплате этим методом. Заполняется на странице справочника
   *  методов в /settings/finance → Методы оплаты. */
  cash_register_id: string | null
  /** % комиссии метода. При оплате визита/продажи/прочего дохода методом
   *  с commission_pct > 0 — автоматически создаётся расход в системной
   *  категории «Комиссии» = paid_amount * commission_pct / 100. */
  commission_pct: number
}

/**
 * Справочник методов оплаты. Используется в:
 *   - формах визита (charge / edit)
 *   - продаже (RetailSaleForm)
 *   - прочих доходах (OtherIncomeFormModal)
 *   - фильтрах по списку визитов/продаж
 *
 * Если запросили без opts.includeArchived — отдаём только активные. Для
 * страницы справочника передаём includeArchived=true чтобы видеть и архив.
 */
export function usePaymentMethods(
  salonId: string | undefined,
  opts: { includeArchived?: boolean } = {},
) {
  return useQuery<PaymentMethodRow[]>({
    queryKey: ['payment-methods', salonId, opts.includeArchived ?? false],
    queryFn: async () => {
      if (!salonId) return []
      let q = supabase
        .from('payment_methods')
        .select(
          'id, salon_id, code, label, sort_order, is_archived, is_system, cash_register_id, commission_pct',
        )
        .eq('salon_id', salonId)
        .order('sort_order')
      if (!opts.includeArchived) q = q.eq('is_archived', false)
      const { data, error } = await q
      if (error) throw error
      type Raw = Omit<PaymentMethodRow, 'cash_register_id' | 'commission_pct'> & {
        cash_register_id?: string | null
        commission_pct?: number | string | null
      }
      return ((data ?? []) as Raw[]).map((r) => ({
        ...r,
        cash_register_id: r.cash_register_id ?? null,
        commission_pct: r.commission_pct == null ? 0 : Number(r.commission_pct),
      }))
    },
    enabled: !!salonId,
  })
}

export function useUpdatePaymentMethod(salonId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: {
      id: string
      label?: string
      is_archived?: boolean
      sort_order?: number
      cash_register_id?: string | null
      commission_pct?: number
    }) => {
      const { id, ...patch } = input
      const { error } = await supabase.from('payment_methods').update(patch).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['payment-methods', salonId] })
    },
  })
}
