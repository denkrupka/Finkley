/**
 * Pure-helpers для расчёта фактически полученной суммы по visit/other_income
 * с учётом частичных поступлений (paid_amount_cents, ADR-026).
 *
 * Вынесено из hooks/useVisits.ts и hooks/useOtherIncomes.ts чтобы тесты
 * могли импортировать чистые функции без подтягивания supabase-клиента
 * (на CI нет env vars, supabase.ts падает при импорте).
 */

export function effectiveReceivedFromVisit(
  v: Pick<
    {
      amount_cents: number
      discount_cents: number | null
      tip_cents: number | null
      paid_amount_cents: number | null
    },
    'amount_cents' | 'discount_cents' | 'tip_cents' | 'paid_amount_cents'
  >,
): number {
  const net = v.amount_cents - (v.discount_cents ?? 0) + (v.tip_cents ?? 0)
  if (v.paid_amount_cents != null && v.paid_amount_cents < net) {
    return v.paid_amount_cents
  }
  return net
}

export function effectiveReceivedFromOtherIncome(
  o: Pick<
    { amount_cents: number; paid_amount_cents: number | null },
    'amount_cents' | 'paid_amount_cents'
  >,
): number {
  if (o.paid_amount_cents != null && o.paid_amount_cents < o.amount_cents) {
    return o.paid_amount_cents
  }
  return o.amount_cents
}
