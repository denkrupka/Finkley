/**
 * Тарифные планы для edge functions (T7). Маппинг plan ↔ Stripe price id
 * через env. Цены создаются в Stripe Dashboard; их id кладутся в секреты:
 *   месячные: STRIPE_PRICE_T19 / STRIPE_PRICE_T49 / STRIPE_PRICE_T69 / STRIPE_PRICE_T99
 *   годовые:  STRIPE_PRICE_T19_ANNUAL / _T49_ANNUAL / _T69_ANNUAL / _T99_ANNUAL
 *
 * Годовой биллинг — −15% к месяцу, цена интервала=year в Stripe (ADR-035).
 * Клиентский эквивалент логики планов — apps/web/src/lib/entitlements.ts.
 */

export type Plan = 'demo' | 'free' | 't19' | 't49' | 't69' | 't99'

/** Интервал оплаты. Месячный — дефолт (обратная совместимость). */
export type BillingInterval = 'month' | 'year'

export const ALL_PLANS: Plan[] = ['demo', 'free', 't19', 't49', 't69', 't99']

function envPriceMap(interval: BillingInterval): Record<Plan, string | undefined> {
  if (interval === 'year') {
    return {
      demo: undefined,
      free: undefined,
      t19: Deno.env.get('STRIPE_PRICE_T19_ANNUAL'),
      t49: Deno.env.get('STRIPE_PRICE_T49_ANNUAL'),
      t69: Deno.env.get('STRIPE_PRICE_T69_ANNUAL'),
      t99: Deno.env.get('STRIPE_PRICE_T99_ANNUAL'),
    }
  }
  return {
    demo: undefined,
    free: undefined,
    t19: Deno.env.get('STRIPE_PRICE_T19'),
    t49: Deno.env.get('STRIPE_PRICE_T49'),
    t69: Deno.env.get('STRIPE_PRICE_T69'),
    t99: Deno.env.get('STRIPE_PRICE_T99'),
  }
}

/**
 * plan → Stripe price id для интервала. null если для плана нет цены
 * (demo/free) или годовая цена не настроена. Дефолт interval='month' —
 * существующие вызовы не ломаются.
 */
export function priceIdForPlan(plan: string, interval: BillingInterval = 'month'): string | null {
  const m = envPriceMap(interval)
  return (m as Record<string, string | undefined>)[plan] ?? null
}

/**
 * Stripe price id → plan (для webhook). Матчит и месячные, и годовые price id
 * (annual → тот же plan). Legacy single-price → t69.
 */
export function planForPriceId(priceId: string | null | undefined): Plan {
  if (!priceId) return 'demo'
  const month = envPriceMap('month')
  const year = envPriceMap('year')
  for (const plan of ALL_PLANS) {
    if (month[plan] === priceId || year[plan] === priceId) return plan
  }
  if (Deno.env.get('STRIPE_PRICE_ID') === priceId) return 't69'
  return 'demo'
}

export function isValidPaidPlan(plan: unknown): plan is Plan {
  return plan === 't19' || plan === 't49' || plan === 't69' || plan === 't99'
}
