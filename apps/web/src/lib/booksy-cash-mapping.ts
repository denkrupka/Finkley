/**
 * Маппинг payment_method (cash / card / blik / transfer / other) → cash_register_id
 * по `salons.financial_settings.cash_registers.items[*].payment_method_mapping`.
 *
 * Дублирует логику supabase/functions/booksy-proxy/index.ts::cashRegisterFor и
 * historic backfill в том же файле. Чистая функция нужна для unit-тестов —
 * импортировать helper из Edge Function (Deno) в Vite-сборку нельзя.
 *
 * Archived позиции игнорируем — пользователь специально их убрал, значит туда
 * новые поступления не зачисляем (см. financial_settings UI «Кассы»).
 */
export type CashRegisterItem = {
  id?: string
  archived?: boolean | null
  payment_method_mapping?: string | null
}

export function buildCashRegisterByMethod(
  items: CashRegisterItem[] | null | undefined,
): Record<string, string> {
  const out: Record<string, string> = {}
  if (!Array.isArray(items)) return out
  for (const item of items) {
    if (item.archived) continue
    if (item.payment_method_mapping && item.id) {
      out[item.payment_method_mapping] = item.id
    }
  }
  return out
}

export function cashRegisterFor(
  byMethod: Record<string, string>,
  method: string | null | undefined,
): string | null {
  if (!method) return null
  return byMethod[method] ?? null
}
