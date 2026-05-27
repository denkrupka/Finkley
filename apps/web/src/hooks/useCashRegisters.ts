import { useMemo } from 'react'

import { isSystemAdjustmentsRegister, useFinancialSettings } from './useFinancialSettings'

export type CashRegisterOption = {
  id: string
  label: string
}

/**
 * Активные кассы салона (financial_settings.cash_registers.items[]) для
 * выбора в формах визита/продажи/расхода. Архивные отфильтрованы.
 *
 * По умолчанию исключает системную кассу «Корректировки» (preset_key='adjustments') —
 * она доступна только в модалке «Перестановка средств». Чтобы получить её
 * (для CashTransferModal/TransfersTab) — передай `{ includeSystem: true }`.
 *
 * По запросу владельца (#51, image #82): эти кассы заменяют payment_methods
 * в picker'ах форм. payment_method остаётся в схеме для аналитики, но
 * юзер видит названия касс, а не системные коды cash/card/transfer.
 */
export function useCashRegisters(
  salonId: string | undefined,
  options: { includeSystem?: boolean } = {},
): {
  data: CashRegisterOption[]
  isLoading: boolean
} {
  const { includeSystem = false } = options
  const { data: settings, isLoading } = useFinancialSettings(salonId)
  const result = useMemo<CashRegisterOption[]>(() => {
    if (!settings) return []
    return settings.cash_registers.items
      .filter((it) => !it.archived)
      .filter((it) => includeSystem || !isSystemAdjustmentsRegister(it))
      .map((it) => ({ id: it.id, label: it.label }))
  }, [settings, includeSystem])
  return { data: result, isLoading }
}
