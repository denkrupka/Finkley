/**
 * create-portal-session — открывает Stripe Customer Portal для управления
 * подпиской (отмена, обновление карты, история счетов).
 *
 * Юзер должен быть owner салона. Customer ID берётся из salon_subscriptions.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.6'
import { getSalonMembership, getUserFromRequest } from '../_shared/auth.ts'
import { corsHeaders, preflight } from '../_shared/cors.ts'
import { createPortalSession } from '../_shared/stripe.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const STRIPE_KEY = Deno.env.get('STRIPE_SECRET_KEY') ?? ''
const APP_URL = Deno.env.get('APP_URL') ?? 'https://finkley.eu/app/'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'content-type': 'application/json' },
  })
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return preflight()
  if (req.method !== 'POST') return jsonResponse({ error: 'method_not_allowed' }, 405)

  if (!STRIPE_KEY || !SUPABASE_URL || !SERVICE_ROLE) {
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

  const membership = await getSalonMembership(SUPABASE_URL, SERVICE_ROLE, user.userId, salonId)
  if (!membership || membership.role !== 'owner') {
    return jsonResponse({ error: 'forbidden' }, 403)
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data: sub } = await admin
    .from('salon_subscriptions')
    .select('stripe_customer_id')
    .eq('salon_id', salonId)
    .maybeSingle()

  if (!sub?.stripe_customer_id) {
    return jsonResponse({ error: 'no_subscription' }, 404)
  }

  try {
    const portal = await createPortalSession(STRIPE_KEY, {
      customerId: sub.stripe_customer_id,
      returnUrl: `${APP_URL}${salonId}/settings`,
    })
    return jsonResponse({ url: portal.url })
  } catch (err) {
    console.error('portal session failed', err)
    return jsonResponse(
      { error: 'stripe_error', message: err instanceof Error ? err.message : String(err) },
      500,
    )
  }
})
