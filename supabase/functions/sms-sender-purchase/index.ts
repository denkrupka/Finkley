/**
 * sms-sender-purchase — Stripe Checkout для покупки приватного sender name.
 *
 * Цена — 100 zł разово за каждое имя. После оплаты stripe-webhook вызывает
 * SMSAPI /sms/sendernames для регистрации имени, status переходит в
 * pending_smsapi (модерация SMSAPI ~часы-дни). После approval → active.
 *
 * Body: { salon_id: string, sender_name: string }
 * Response: { url: string, sender_id: string }
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.6'

import { getSalonMembership, getUserFromRequest } from '../_shared/auth.ts'
import { corsHeaders, preflight } from '../_shared/cors.ts'
import { validateSenderName } from '../_shared/smsapi-sender.ts'
import { createOneTimeCheckout } from '../_shared/stripe.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const STRIPE_KEY = Deno.env.get('STRIPE_SECRET_KEY') ?? ''
const APP_URL = Deno.env.get('APP_URL') ?? 'https://finkley.app/app/'

const SENDER_PRICE_GROSZ = 10000 // 100 zł

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

  let body: { salon_id?: string; sender_name?: string }
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: 'invalid_json' }, 400)
  }
  const salonId = body.salon_id
  const senderName = (body.sender_name ?? '').trim()
  if (!salonId) return jsonResponse({ error: 'salon_id_required' }, 400)

  const v = validateSenderName(senderName)
  if (!v.ok) return jsonResponse({ error: 'invalid_sender_name', reason: v.error }, 400)

  const membership = await getSalonMembership(SUPABASE_URL, SERVICE_ROLE, user.userId, salonId)
  if (!membership || membership.role !== 'owner') {
    return jsonResponse({ error: 'forbidden' }, 403)
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  // Дубль одного имени у одного салона (с учётом не-rejected) — нельзя.
  const { data: existing } = await admin
    .from('salon_sms_senders')
    .select('id, status')
    .eq('salon_id', salonId)
    .eq('sender_name', senderName)
    .neq('status', 'rejected')
    .maybeSingle()
  if (existing) {
    return jsonResponse(
      { error: 'sender_already_purchased', status: (existing as { status: string }).status },
      409,
    )
  }

  const { data: senderRow, error: insErr } = await admin
    .from('salon_sms_senders')
    .insert({
      salon_id: salonId,
      sender_name: senderName,
      status: 'pending_payment',
      price_grosz: SENDER_PRICE_GROSZ,
    })
    .select('id')
    .single()
  if (insErr || !senderRow) {
    console.error('sender insert failed', insErr)
    return jsonResponse({ error: 'db_error', message: insErr?.message }, 500)
  }
  const senderId = (senderRow as { id: string }).id

  const { data: userData } = await admin.auth.admin.getUserById(user.userId)
  const email = userData.user?.email ?? ''

  const { data: existingSub } = await admin
    .from('salon_subscriptions')
    .select('stripe_customer_id')
    .eq('salon_id', salonId)
    .maybeSingle()

  try {
    const session = await createOneTimeCheckout(STRIPE_KEY, {
      amountMinor: SENDER_PRICE_GROSZ,
      currency: 'pln',
      productName: `Prywatny SMS sender: ${senderName}`,
      productDescription: 'Jednorazowa rejestracja nadawcy SMS w SMSAPI (do 11 znaków).',
      customerEmail: email,
      customerId:
        (existingSub as { stripe_customer_id: string } | null)?.stripe_customer_id ?? null,
      salonId,
      metadata: {
        kind: 'sms_sender',
        sender_id: senderId,
        sender_name: senderName,
      },
      successUrl: `${APP_URL}${salonId}/settings?tab=integrations&sub=sms&stripe=success`,
      cancelUrl: `${APP_URL}${salonId}/settings?tab=integrations&sub=sms&stripe=cancel`,
    })

    await admin
      .from('salon_sms_senders')
      .update({ stripe_session_id: session.id })
      .eq('id', senderId)

    return jsonResponse({ url: session.url, sender_id: senderId })
  } catch (err) {
    console.error('sms-sender-purchase: stripe failed', err)
    // Откатываем pending-row на rejected с reason, чтобы юзер мог купить заново.
    await admin
      .from('salon_sms_senders')
      .update({ status: 'rejected', rejection_reason: 'stripe_session_failed' })
      .eq('id', senderId)
    return jsonResponse(
      { error: 'stripe_error', message: err instanceof Error ? err.message : String(err) },
      500,
    )
  }
})
