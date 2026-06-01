/**
 * VAT-разбивка для расходов: нетто ↔ брутто двусторонний пересчёт + ставки
 * адаптируются под страну салона.
 *
 * Контракт:
 *   computeGross(net, rate) → net × (1 + rate/100), округление до копейки
 *   computeNet(gross, rate) → gross / (1 + rate/100), округление до копейки
 *
 * `rate` в %. Поддерживаются дробные (8.5%). Все суммы в копейках/центах.
 */

export type VatRate = {
  /** Ставка в % (0, 5, 8, 23). 0 включает «zw.» (освобождён). */
  pct: number
  /** Локализуемая метка («23%», «zw.», etc.). */
  label: string
  /** True если ставка по умолчанию для своей страны. */
  isDefault?: boolean
}

const RATES_BY_COUNTRY: Record<string, VatRate[]> = {
  // Польша (стандарт + льготные + нулевая + освобождение).
  PL: [
    { pct: 23, label: '23%', isDefault: true },
    { pct: 8, label: '8%' },
    { pct: 5, label: '5%' },
    { pct: 0, label: '0%' },
    { pct: 0, label: 'zw.' }, // освобождён от НДС
  ],
  // Германия: 19% стандарт, 7% льгота, 0%.
  DE: [
    { pct: 19, label: '19%', isDefault: true },
    { pct: 7, label: '7%' },
    { pct: 0, label: '0%' },
  ],
  // Украина: 20% стандарт, 7% (медицина/лекарства), 14% (сельхоз), 0%.
  UA: [
    { pct: 20, label: '20%', isDefault: true },
    { pct: 14, label: '14%' },
    { pct: 7, label: '7%' },
    { pct: 0, label: '0%' },
  ],
  // Чехия: 21%/15%/10%/0%.
  CZ: [
    { pct: 21, label: '21%', isDefault: true },
    { pct: 15, label: '15%' },
    { pct: 10, label: '10%' },
    { pct: 0, label: '0%' },
  ],
  // Литва: 21%/9%/5%/0%.
  LT: [
    { pct: 21, label: '21%', isDefault: true },
    { pct: 9, label: '9%' },
    { pct: 5, label: '5%' },
    { pct: 0, label: '0%' },
  ],
}

const FALLBACK_RATES: VatRate[] = [{ pct: 0, label: '0%', isDefault: true }]

/** Возвращает список доступных ставок VAT для страны (по ISO коду). */
export function vatRatesFor(countryCode: string | null | undefined): VatRate[] {
  const code = (countryCode ?? 'PL').toUpperCase()
  return RATES_BY_COUNTRY[code] ?? FALLBACK_RATES
}

/** Дефолтная ставка для страны (для prefill при создании). */
export function defaultVatRate(countryCode: string | null | undefined): number {
  const rates = vatRatesFor(countryCode)
  return rates.find((r) => r.isDefault)?.pct ?? rates[0]?.pct ?? 0
}

/** netCents × (1 + rate/100) → grossCents (округление к копейке). */
export function computeGross(netCents: number, ratePct: number): number {
  if (!isFinite(netCents) || !isFinite(ratePct)) return 0
  return Math.round(netCents * (1 + ratePct / 100))
}

/** grossCents ÷ (1 + rate/100) → netCents (округление к копейке). */
export function computeNet(grossCents: number, ratePct: number): number {
  if (!isFinite(grossCents) || !isFinite(ratePct) || ratePct <= -100) return 0
  return Math.round(grossCents / (1 + ratePct / 100))
}

/** vatCents = gross − net. */
export function computeVatAmount(netCents: number, grossCents: number): number {
  return Math.max(0, grossCents - netCents)
}

/**
 * Семантика «расчёта VAT для одной транзакции» с учётом флагов:
 *   isVatPayer=false → нетто=брутто, vat=0 (не плательщик)
 *   vatSkipped=true  → нетто=брутто, vat=0 (фактически без документа)
 *   ratePct=null     → нетто=брутто, vat=0 (старая запись без разбивки)
 *
 * Возвращает {netCents, vatCents}. grossCents всегда = amount_cents строки.
 */
export function vatBreakdownFor(args: {
  grossCents: number
  netCents: number | null | undefined
  ratePct: number | null | undefined
  isVatPayer: boolean
  vatSkipped?: boolean
}): { netCents: number; vatCents: number; ratePct: number } {
  if (!args.isVatPayer || args.vatSkipped || args.ratePct == null) {
    return { netCents: args.grossCents, vatCents: 0, ratePct: 0 }
  }
  const net = args.netCents ?? computeNet(args.grossCents, args.ratePct)
  return {
    netCents: net,
    vatCents: Math.max(0, args.grossCents - net),
    ratePct: args.ratePct,
  }
}

/**
 * Итоговый VAT-баланс за период:
 *   vatOnIncome  — НДС со всех доходов (визиты + продажи + прочие доходы)
 *   vatOnExpense — НДС со всех расходов (фактуры/чеки + auto-commissions)
 *   vatPayable   — vatOnIncome − vatOnExpense
 *
 * Если vatPayable > 0 → надо заплатить в гос-бюджет (категория «Налоги»).
 * Если vatPayable < 0 → переплата, переносится на следующий месяц.
 */
export function computeVatPayable(args: { vatOnIncomeCents: number; vatOnExpenseCents: number }): {
  vatPayableCents: number
  isOverpayment: boolean
} {
  const diff = args.vatOnIncomeCents - args.vatOnExpenseCents
  return {
    vatPayableCents: diff,
    isOverpayment: diff < 0,
  }
}
