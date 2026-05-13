import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { supabase } from '@/lib/supabase/client'

/**
 * Финансовые вводные параметры салона (owner-input). Хранятся в
 * salons.financial_settings (jsonb). Используются для будущих
 * финансовых расчётов: cash-flow, PnL, break-even, ROI.
 *
 * Все денежные значения — в центах (cents/копейки). Проценты — 0..100.
 */

export type CustomItem = { id: string; label: string; amount_cents: number; active: boolean }
export type CustomPctItem = { id: string; label: string; pct: number; active: boolean }

export type CashRegisters = {
  director_cents: number
  safe_cents: number
  gotowka_cents: number
  bank_karta_cents: number
  karta_terminal_cents: number
  custom?: CustomItem[]
}

export type FixedExpenses = {
  payroll_management_cents: number
  payroll_admin_cents: number
  zus_cents: number
  rent_cents: number
  electricity_cents: number
  ad_budget_cents: number
  smm_cents: number
  internet_cents: number
  services_subscription_cents: number
  cleaning_cents: number
  household_cents: number
  leasing_cents: number
  repair_equipment_cents: number
  bank_services_cents: number
  accounting_cents: number
  fuel_cents: number
  other_cents: number
  /** Кастомные позиции добавленные владельцем. Архив (active=false) сохраняет
   *  историю — если позиция использовалась в фин. отчёте за прошлые периоды,
   *  расчёт не ломается. Legacy: поле monthly_cents оставлено для обратной
   *  совместимости и читается параллельно с amount_cents в UI. */
  custom?: Array<
    CustomItem & {
      /** @deprecated используется amount_cents — оставлено для существующих записей */
      monthly_cents?: number
    }
  >
}

export type VariableExpenses = {
  /** % от выручки */
  admin_payroll_pct: number
  bank_commission_pct: number
  ad_budget_pct: number
  bonuses_pct: number
  custom?: CustomPctItem[]
}

export type OtherIncomePlanned = {
  monthly_cents: number
  custom?: CustomItem[]
}

export type Taxes = {
  pit36_cents: number
  vat_cents: number
  cit_cents: number
  pit3_cents: number
  custom?: CustomItem[]
}

export type Investments = {
  franchise_fee_cents: number
  first_rent_cents: number
  renovation_cents: number
  equipment_cents: number
  inventory_cents: number
  furniture_cents: number
  other_cents: number
  custom?: CustomItem[]
}

export type MoneyFlows = {
  dividends_cents: number
  owner_contributions_cents: number
  owner_loans_cents: number
  other_loans_cents: number
  custom?: CustomItem[]
}

export type FinancialSettings = {
  cash_registers: CashRegisters
  fixed: FixedExpenses
  variable: VariableExpenses
  other_income: OtherIncomePlanned
  taxes: Taxes
  investments: Investments
  flows: MoneyFlows
}

export const DEFAULT_FINANCIAL_SETTINGS: FinancialSettings = {
  cash_registers: {
    director_cents: 0,
    safe_cents: 0,
    gotowka_cents: 0,
    bank_karta_cents: 0,
    karta_terminal_cents: 0,
    custom: [],
  },
  fixed: {
    payroll_management_cents: 0,
    payroll_admin_cents: 0,
    zus_cents: 0,
    rent_cents: 0,
    electricity_cents: 0,
    ad_budget_cents: 0,
    smm_cents: 0,
    internet_cents: 0,
    services_subscription_cents: 0,
    cleaning_cents: 0,
    household_cents: 0,
    leasing_cents: 0,
    repair_equipment_cents: 0,
    bank_services_cents: 0,
    accounting_cents: 0,
    fuel_cents: 0,
    other_cents: 0,
    custom: [],
  },
  variable: {
    admin_payroll_pct: 0,
    bank_commission_pct: 0,
    ad_budget_pct: 0,
    bonuses_pct: 0,
    custom: [],
  },
  other_income: {
    monthly_cents: 0,
    custom: [],
  },
  taxes: {
    pit36_cents: 0,
    vat_cents: 0,
    cit_cents: 0,
    pit3_cents: 0,
    custom: [],
  },
  investments: {
    franchise_fee_cents: 0,
    first_rent_cents: 0,
    renovation_cents: 0,
    equipment_cents: 0,
    inventory_cents: 0,
    furniture_cents: 0,
    other_cents: 0,
    custom: [],
  },
  flows: {
    dividends_cents: 0,
    owner_contributions_cents: 0,
    owner_loans_cents: 0,
    other_loans_cents: 0,
    custom: [],
  },
}

/** Глубокий merge stored + defaults — если в БД partial-объект, недостающие поля
 *  возьмутся из дефолтов. */
function mergeWithDefaults(stored: unknown): FinancialSettings {
  const s = (stored ?? {}) as Partial<FinancialSettings>
  return {
    cash_registers: { ...DEFAULT_FINANCIAL_SETTINGS.cash_registers, ...(s.cash_registers ?? {}) },
    fixed: { ...DEFAULT_FINANCIAL_SETTINGS.fixed, ...(s.fixed ?? {}) },
    variable: { ...DEFAULT_FINANCIAL_SETTINGS.variable, ...(s.variable ?? {}) },
    other_income: { ...DEFAULT_FINANCIAL_SETTINGS.other_income, ...(s.other_income ?? {}) },
    taxes: { ...DEFAULT_FINANCIAL_SETTINGS.taxes, ...(s.taxes ?? {}) },
    investments: { ...DEFAULT_FINANCIAL_SETTINGS.investments, ...(s.investments ?? {}) },
    flows: { ...DEFAULT_FINANCIAL_SETTINGS.flows, ...(s.flows ?? {}) },
  }
}

export function useFinancialSettings(salonId: string | undefined) {
  return useQuery<FinancialSettings>({
    queryKey: ['financial-settings', salonId],
    queryFn: async () => {
      if (!salonId) return DEFAULT_FINANCIAL_SETTINGS
      const { data, error } = await supabase
        .from('salons')
        .select('financial_settings')
        .eq('id', salonId)
        .single()
      if (error) throw error
      return mergeWithDefaults(data?.financial_settings)
    },
    enabled: !!salonId,
    staleTime: 30_000,
  })
}

export function useUpdateFinancialSettings(salonId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (next: FinancialSettings) => {
      if (!salonId) throw new Error('no_salon')
      const { error } = await supabase
        .from('salons')
        .update({ financial_settings: next })
        .eq('id', salonId)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['financial-settings', salonId] })
      qc.invalidateQueries({ queryKey: ['salon', salonId] })
    },
  })
}
