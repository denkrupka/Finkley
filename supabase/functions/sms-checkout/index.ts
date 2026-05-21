/**
 * sms-checkout — Stripe Checkout для покупки пакета SMS.
 *
 * Юзер (owner) выбирает пакет 10/30/50/100/300/500 SMS, мы создаём
 * запись в salon_sms_purchases (status='pending'), Stripe Checkout
 * в PLN с inline price_data (никаких Stripe products вручную),
 * возвращаем url. После оплаты — stripe-webhook ловит
 * checkout.session.completed с metadata.kind='sms_package' и пополняет
 * salons.sms_balance.
 *
 * Body: { salon_id: string, package_size: 10|30|50|100|300|500 }
 * Response: { url: string, purchase_id: string }
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.6'

import { getSalonMembership, getUserFromRequest } from '../_shared/auth.ts'
import { corsHeaders, preflight } from '../_shared/cors.ts'
import { createOneTimeCheckout } from '../_shared/stripe.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const STRIPE_KEY = Deno.env.get('STRIPE_SECRET_KEY') ?? ''
const APP_URL = Deno.env.get('APP_URL') ?? 'https://finkley.app/app/'

/**
 * Цены пакетов в грошах за 1 SMS. Чем больше пакет — тем дешевле штука.
 * Total = package_size × price_per_sms_grosz.
 * 10:6.00 / 30:17.40 / 50:28.00 / 100:54.00 / 300:156.00 / 500:250.00 zł.
 */
const PACKAGE_PRICES: Record<number, number> = {
  10: 60,
  30: 58,
  50: 56,
  100: 54,
  300: 52,
  500: 50,
}

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

  let body: { salon_id?: string; package_size?: number }
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: 'invalid_json' }, 400)
  }
  const salonId = body.salon_id
  const size = Number(body.package_size)
  if (!salonId) return jsonResponse({ error: 'salon_id_required' }, 400)
  const pricePerSms = PACKAGE_PRICES[size]
  if (!pricePerSms) return jsonResponse({ error: 'invalid_package_size' }, 400)

  // Только owner может покупать пакеты SMS (это деньги).
  const membership = await getSalonMembership(SUPABASE_URL, SERVICE_ROLE, user.userId, salonId)
  if (!membership || membership.role !== 'owner') {
    return jsonResponse({ error: 'forbidden' }, 403)
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const totalGrosz = size * pricePerSms

  // Записываем pending-покупку, чтобы webhook нашёл её по stripe_session_id.
  const { data: purchaseRow, error: insErr } = await admin
    .from('salon_sms_purchases')
    .insert({
      salon_id: salonId,
      package_size: size,
      price_per_sms_grosz: pricePerSms,
      total_grosz: totalGrosz,
      status: 'pending',
    })
    .select('id')
    .single()
  if (insErr || !purchaseRow) {
    console.error('sms_purchase insert failed', insErr)
    return jsonResponse({ error: 'db_error' }, 500)
  }
  const purchaseId = (purchaseRow as { id: string }).id

  // Email для предзаполнения Stripe Checkout — auth.users.email.
  const { data: userData } = await admin.auth.admin.getUserById(user.userId)
  const email = userData.user?.email ?? ''

  // Если у салона уже есть Stripe customer (от подписки) — переиспользуем,
  // tax_id/address подтянутся автоматически.
  const { data: existingSub } = await admin
    .from('salon_subscriptions')
    .select('stripe_customer_id')
    .eq('salon_id', salonId)
    .maybeSingle()

  try {
    const session = await createOneTimeCheckout(STRIPE_KEY, {
      amountMinor: totalGrosz,
      currency: 'pln',
      productName: `Pakiet ${size} SMS`,
      productDescription: `${size} SMS × ${(pricePerSms / 100).toFixed(2)} zł/szt`,
      customerEmail: email,
      customerId:
        (existingSub as { stripe_customer_id: string } | null)?.stripe_customer_id ?? null,
      salonId,
      metadata: {
        kind: 'sms_package',
        purchase_id: purchaseId,
        package_size: String(size),
      },
      successUrl: `${APP_URL}${salonId}/settings?tab=integrations&sub=sms&stripe=success`,
      cancelUrl: `${APP_URL}${salonId}/settings?tab=integrations&sub=sms&stripe=cancel`,
    })

    // Сохраняем stripe_session_id в покупке (для webhook lookup).
    await admin
      .from('salon_sms_purchases')
      .update({ stripe_session_id: session.id })
      .eq('id', purchaseId)

    return jsonResponse({ url: session.url, purchase_id: purchaseId })
  } catch (err) {
    console.error('sms-checkout: stripe failed', err)
    // Откатываем pending-запись на failed, чтобы не висела навсегда.
    await admin.from('salon_sms_purchases').update({ status: 'failed' }).eq('id', purchaseId)
    return jsonResponse(
      { error: 'stripe_error', message: err instanceof Error ? err.message : String(err) },
      500,
    )
  }
})
