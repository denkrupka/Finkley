/**
 * T116 — pure helper для расчёта суммарных строк отчёта Зарплаты.
 *
 * Выделено из PayoutsPage.tsx как pure-функция, чтобы юнит-тестировать
 * формулы «Начислено» / «Остаток» без рендера компонента.
 *
 * Контракт:
 *   - Начислено  = payout + premium  (premium входит сверх договорного payout)
 *   - Остаток    = Начислено − advance  (выданные авансы)
 *   - Авансы и премии хранятся отдельно (см. ADR-027), поэтому суммируются
 *     независимо.
 */

export type PayoutRow = {
  staff_id: string
  payout_cents: number
  premium_cents: number
}

export type PayoutTotals = {
  payout: number
  premium: number
  advances: number
  /** payout + premium */
  accrued: number
  /** accrued − advances (может быть отрицательным при переплате авансов) */
  remaining: number
}

export function computePayoutTotals(
  rows: ReadonlyArray<PayoutRow>,
  advancesByStaff: ReadonlyMap<string, number>,
): PayoutTotals {
  let payout = 0
  let premium = 0
  let advances = 0
  for (const r of rows) {
    payout += r.payout_cents
    premium += r.premium_cents
    advances += advancesByStaff.get(r.staff_id) ?? 0
  }
  const accrued = payout + premium
  return {
    payout,
    premium,
    advances,
    accrued,
    remaining: accrued - advances,
  }
}

/** Per-row начислено + остаток (для рендеринга в таблице). */
export function computeRowTotals(
  row: PayoutRow,
  advance: number,
): {
  accrued: number
  remaining: number
} {
  const accrued = row.payout_cents + row.premium_cents
  return { accrued, remaining: accrued - advance }
}
