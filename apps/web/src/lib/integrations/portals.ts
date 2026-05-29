/**
 * Каталог бухгалтерских порталов которые юзер выбирает в Settings →
 * Accounting и в онбординг шаге «Бухгалтерия».
 *
 * Единый источник истины — раньше дублировался в AccountingSettingsCard
 * (Settings) и в онбординге (см. RETRO Batch 9 «Известные хвосты»).
 * При добавлении нового провайдера правь ТОЛЬКО этот файл — обе
 * страницы подхватят автоматически.
 */

export type AccountingPortalValue = 'wfirma' | 'fakturownia' | 'infakt' | 'ksef' | 'other'

export type AccountingPortalOption = {
  value: AccountingPortalValue
  label: string
  /** ID интеграции в `salon_integrations.provider` (если есть инлайн-
   *  подключение в UI). Для `'other'` остаётся undefined — юзер
   *  указывает название текстом. */
  integration_provider?: string
}

export const ACCOUNTING_PORTAL_OPTIONS: AccountingPortalOption[] = [
  { value: 'wfirma', label: 'wFirma', integration_provider: 'wfirma' },
  { value: 'fakturownia', label: 'Fakturownia', integration_provider: 'fakturownia' },
  { value: 'infakt', label: 'inFakt', integration_provider: 'infakt' },
  { value: 'ksef', label: 'KSeF (Krajowy System e-Faktur)', integration_provider: 'ksef' },
  { value: 'other', label: 'Другой портал (укажу название)' },
]

export function findAccountingPortal(value?: string | null): AccountingPortalOption | null {
  if (!value) return null
  return ACCOUNTING_PORTAL_OPTIONS.find((p) => p.value === value) ?? null
}
