/**
 * create-checkout-session edge function
 *
 * Создаёт Stripe Checkout Session для подписки на тариф салона.
 * Юзер должен быть owner салона.
 *
 * ENV:
 *   STRIPE_SECRET_KEY
 *   STRIPE_PRICE_ID  (price_… из Stripe Dashboard, используем live или test версию)
 *   APP_URL          (https://finkley.app/app/) для success/cancel redirect'ов
 *
 * Тестирование локально:
 *   supabase functions serve --env-file ./supabase/.env
 *   curl -X POST http://localhost:54321/functions/v1/create-checkout-session \
 *     -H "Authorization: Bearer <user_jwt>" \
 *     -H "Content-Type: application/json" \
 *     -d '{"salonId":"<uuid>"}'
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.6'
import { getSalonMembership, getUserFromRequest } from '../_shared/auth.ts'
import { corsHeaders, preflight } from '../_shared/cors.ts'
import { createCheckoutSession } from '../_shared/stripe.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const STRIPE_KEY = Deno.env.get('STRIPE_SECRET_KEY') ?? ''
const STRIPE_PRICE_ID = Deno.env.get('STRIPE_PRICE_ID') ?? ''
const APP_URL = Deno.env.get('APP_URL') ?? 'https://finkley.app/app/'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'content-type': 'application/json' },
  })
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return preflight()
  if (req.method !== 'POST') return jsonResponse({ error: 'method_not_allowed' }, 405)

  if (!STRIPE_KEY || !STRIPE_PRICE_ID || !SUPABASE_URL || !SERVICE_ROLE) {
    return jsonResponse({ error: 'function_not_configured' }, 500)
  }

  const user = await getUserFromRequest(req, SUPABASE_URL, SERVICE_ROLE)
  if (!user) return jsonResponse({ error: 'unauthorized' }, 401)

  let body: { salonId?: string }
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: 'invalid_json' }, 400)
  }
  const salonId = body.salonId
  if (!salonId) return jsonResponse({ error: 'salon_id_required' }, 400)

  // Только owner может оформлять подписку
  const membership = await getSalonMembership(SUPABASE_URL, SERVICE_ROLE, user.userId, salonId)
  if (!membership || membership.role !== 'owner') {
    return jsonResponse({ error: 'forbidden' }, 403)
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  // Email для передачи в Stripe — берём из auth.users
  const { data: userData } = await admin.auth.admin.getUserById(user.userId)
  const email = userData.user?.email ?? ''

  // Если у салона уже есть stripe_customer_id — переиспользуем
  const { data: existingSub } = await admin
    .from('salon_subscriptions')
    .select('stripe_customer_id')
    .eq('salon_id', salonId)
    .maybeSingle()

  try {
    const session = await createCheckoutSession(STRIPE_KEY, {
      price: STRIPE_PRICE_ID,
      customerEmail: email,
      salonId,
      successUrl: `${APP_URL}${salonId}/settings?stripe=success`,
      cancelUrl: `${APP_URL}${salonId}/settings?stripe=cancel`,
      trialDays: 14,
      customerId: existingSub?.stripe_customer_id ?? null,
    })
    return jsonResponse({ url: session.url })
  } catch (err) {
    console.error('checkout session failed', err)
    return jsonResponse(
      { error: 'stripe_error', message: err instanceof Error ? err.message : String(err) },
      500,
    )
  }
})
