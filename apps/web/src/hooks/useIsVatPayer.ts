import { useAccountingSettings } from './useAccountingSettings'

/**
 * Является ли салон плательщиком VAT (PL: czynny podatnik VAT).
 *
 * Источник истины — `salons.accounting_settings.vat_payer` (jsonb).
 * Значения:
 *   true       — czynny podatnik VAT (рассчитываем НДС везде)
 *   false      — zwolnienie (VAT=0 по дефолту, нетто=брутто)
 *   undefined  — юзер ещё не указал в Бухгалтерии; в этом случае ведём
 *                себя как «не плательщик» (безопасный fallback —
 *                не показываем VAT-разбивку чтобы не путать).
 *
 * Использование:
 *   const isVatPayer = useIsVatPayer(salonId)
 *   if (isVatPayer) {
 *     // показать VAT-разбивку, dropdown ставок, считать в нетто в P&L
 *   } else {
 *     // одно поле «Сумма» (брутто), всё считается как раньше
 *   }
 */
export function useIsVatPayer(salonId: string | undefined): boolean {
  const { data: settings } = useAccountingSettings(salonId)
  return settings?.vat_payer === true
}
