import { useMemo } from 'react'

import { useFinancialSettings } from './useFinancialSettings'

export type CashRegisterOption = {
  id: string
  label: string
}

/**
 * Активные кассы салона (financial_settings.cash_registers.items[]) для
 * выбора в формах визита/продажи/расхода. Архивные отфильтрованы.
 *
 * По запросу владельца (#51, image #82): эти кассы заменяют payment_methods
 * в picker'ах форм. payment_method остаётся в схеме для аналитики, но
 * юзер видит названия касс, а не системные коды cash/card/transfer.
 */
export function useCashRegisters(salonId: string | undefined): {
  data: CashRegisterOption[]
  isLoading: boolean
} {
  const { data: settings, isLoading } = useFinancialSettings(salonId)
  const options = useMemo<CashRegisterOption[]>(() => {
    if (!settings) return []
    return settings.cash_registers.items
      .filter((it) => !it.archived)
      .map((it) => ({ id: it.id, label: it.label }))
  }, [settings])
  return { data: options, isLoading }
}
