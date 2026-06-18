/**
 * Тарифные планы для edge functions (T7). Маппинг plan ↔ Stripe price id
 * через env. Цены создаются в Stripe Dashboard; их id кладутся в секреты:
 *   STRIPE_PRICE_T19 / STRIPE_PRICE_T49 / STRIPE_PRICE_T69 / STRIPE_PRICE_T99
 *
 * Клиентский эквивалент логики планов — apps/web/src/lib/entitlements.ts.
 */

export type Plan = 'demo' | 'free' | 't19' | 't49' | 't69' | 't99'

export const ALL_PLANS: Plan[] = ['demo', 'free', 't19', 't49', 't69', 't99']

function envPriceMap(): Record<Plan, string | undefined> {
  return {
    demo: undefined,
    free: undefined,
    t19: Deno.env.get('STRIPE_PRICE_T19'),
    t49: Deno.env.get('STRIPE_PRICE_T49'),
    t69: Deno.env.get('STRIPE_PRICE_T69'),
    t99: Deno.env.get('STRIPE_PRICE_T99'),
  }
}

/** plan → Stripe price id. null если для плана нет цены (demo/free/не настроен). */
export function priceIdForPlan(plan: string): string | null {
  const m = envPriceMap()
  return (m as Record<string, string | undefined>)[plan] ?? null
}

/** Stripe price id → plan (для webhook). Legacy single-price → t69. */
export function planForPriceId(priceId: string | null | undefined): Plan {
  if (!priceId) return 'demo'
  const m = envPriceMap()
  for (const plan of ALL_PLANS) {
    if (m[plan] && m[plan] === priceId) return plan
  }
  if (Deno.env.get('STRIPE_PRICE_ID') === priceId) return 't69'
  return 'demo'
}

export function isValidPaidPlan(plan: unknown): plan is Plan {
  return plan === 't19' || plan === 't49' || plan === 't69' || plan === 't99'
}
