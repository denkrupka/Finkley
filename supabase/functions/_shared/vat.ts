/**
 * VAT helpers для Edge functions (Deno). Минимальная копия логики
 * apps/web/src/lib/utils/vat.ts — Edge не может импортировать из apps/web.
 *
 * Используется booksy-proxy, treatwell-proxy и любым другим импортёром
 * visits/expenses/scheduled_payments для корректного заполнения VAT-полей.
 */

const RATES_BY_COUNTRY: Record<string, number> = {
  PL: 23,
  DE: 19,
  UA: 20,
  CZ: 21,
  LT: 21,
}

export function defaultVatRate(country: string): number {
  return RATES_BY_COUNTRY[country.toUpperCase()] ?? 23
}

/** Нетто из брутто: round-half-up чтобы совпадал с UI. */
export function computeNet(grossCents: number, ratePct: number): number {
  if (ratePct <= 0) return grossCents
  return Math.round((grossCents * 100) / (100 + ratePct))
}

/**
 * Читает vat_payer + country для салона. Возвращает контекст для импортов.
 * @param admin — supabase service-role client
 */
export async function loadVatContext(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  salonId: string,
): Promise<{ isVatPayer: boolean; country: string }> {
  const { data } = await admin
    .from('salons')
    .select('country_code, accounting_settings')
    .eq('id', salonId)
    .maybeSingle()
  const country = (data?.country_code as string | null) ?? 'PL'
  const settings = data?.accounting_settings as { vat_payer?: boolean } | null
  return {
    isVatPayer: settings?.vat_payer === true,
    country,
  }
}

/**
 * Удобный helper для импорт-flow: считает VAT-разбивку для visits-line.
 * При isVatPayer заполняет три поля; иначе возвращает все null чтобы
 * Object.assign не перетёр существующие значения.
 */
export function vatFieldsForVisit(
  ctx: { isVatPayer: boolean; country: string },
  grossCents: number,
  serviceVatRate?: number | null,
): {
  amount_net_cents: number | null
  vat_rate_pct: number | null
  vat_skipped: boolean | null
} {
  if (!ctx.isVatPayer || grossCents <= 0) {
    return { amount_net_cents: null, vat_rate_pct: null, vat_skipped: null }
  }
  const rate =
    serviceVatRate != null && serviceVatRate > 0 ? serviceVatRate : defaultVatRate(ctx.country)
  return {
    amount_net_cents: computeNet(grossCents, rate),
    vat_rate_pct: rate,
    vat_skipped: false,
  }
}
