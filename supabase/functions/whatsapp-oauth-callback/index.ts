/**
 * whatsapp-oauth-callback — OAuth flow для подключения WhatsApp Business
 * без manual копипаста токенов. Юзер жмёт «Continue with Facebook» —
 * мы получаем access_token, авто-discovery WABA + phone_number_id,
 * сохраняем в messenger_integrations.
 *
 * Два режима:
 *
 * 1) ?action=start&salon_id=<uuid>  (Authorization: Bearer <user-jwt>)
 *    → JSON { authorize_url } для редиректа на FB OAuth.
 *
 * 2) ?code=<...>&state=<...>
 *    → code → long-lived token → GET /me/businesses → берём первый
 *      → GET /{biz}/owned_whatsapp_business_accounts → берём первый WABA
 *      → GET /{waba}/phone_numbers → берём первый phone
 *      → шифруем token → upsert messenger_integrations (channel=whatsapp,
 *        status=connected, external_account_id=phone_number_id).
 *
 * Env: META_FB_APP_ID, META_FB_APP_SECRET, MESSENGER_SECRETS_KEY, APP_URL.
 *
 * NOTE: для production требуется одобрение Meta App Review для permissions
 * whatsapp_business_management + whatsapp_business_messaging. До одобрения
 * OAuth работает только для test users и admin'ов FB-приложения.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.6'

import { getSalonMembership, getUserFromRequest } from '../_shared/auth.ts'
import { corsHeaders, preflight } from '../_shared/cors.ts'
import { encryptSecret } from '../_shared/crypto-aes.ts'
import { signOAuthState, verifyOAuthState } from '../_shared/oauth-state.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const APP_ID = Deno.env.get('META_FB_APP_ID') ?? ''
const APP_SECRET = Deno.env.get('META_FB_APP_SECRET') ?? ''
const APP_URL = Deno.env.get('APP_URL') ?? 'http://localhost:5173'

const REDIRECT_URI = `${SUPABASE_URL}/functions/v1/whatsapp-oauth-callback`

// Scopes для WhatsApp Embedded Signup-like flow:
// - whatsapp_business_messaging — отправка messages (templates + sessions)
// - whatsapp_business_management — управление phone_numbers + templates
// - business_management — доступ к /me/businesses для discovery
const SCOPES = [
  'whatsapp_business_messaging',
  'whatsapp_business_management',
  'business_management',
].join(',')

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'content-type': 'application/json' },
  })
}

function redirect(url: string): Response {
  return new Response(null, { status: 302, headers: { ...corsHeaders, location: url } })
}

function appUrl(salonId: string, params: Record<string, string>): string {
  const qs = new URLSearchParams(params).toString()
  return `${APP_URL}/${salonId}/settings/integrations?${qs}`
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return preflight()

  const url = new URL(req.url)
  const action = url.searchParams.get('action')
  const code = url.searchParams.get('code')
  const stateRaw = url.searchParams.get('state')
  const errorParam = url.searchParams.get('error')

  // ---------------------------------------------------------------------------
  // Mode 1: start
  // ---------------------------------------------------------------------------
  if (action === 'start') {
    const salonId = url.searchParams.get('salon_id')
    if (!salonId) return jsonResponse({ error: 'missing_salon_id' }, 400)

    const user = await getUserFromRequest(req, SUPABASE_URL, SERVICE_KEY)
    if (!user) return jsonResponse({ error: 'unauthorized' }, 401)

    const membership = await getSalonMembership(SUPABASE_URL, SERVICE_KEY, user.userId, salonId)
    if (!membership || !['owner', 'admin'].includes(membership.role)) {
      return jsonResponse({ error: 'forbidden' }, 403)
    }

    if (!APP_ID) return jsonResponse({ error: 'app_id_not_configured' }, 500)

    const state = await signOAuthState({ salon_id: salonId, user_id: user.userId })
    const authorize = new URL('https://www.facebook.com/v21.0/dialog/oauth')
    authorize.searchParams.set('client_id', APP_ID)
    authorize.searchParams.set('redirect_uri', REDIRECT_URI)
    authorize.searchParams.set('response_type', 'code')
    authorize.searchParams.set('scope', SCOPES)
    authorize.searchParams.set('state', state)

    return jsonResponse({ authorize_url: authorize.toString() })
  }

  // ---------------------------------------------------------------------------
  // Mode 2: callback
  // ---------------------------------------------------------------------------
  if (!stateRaw) return jsonResponse({ error: 'missing_state' }, 400)
  const statePayload = await verifyOAuthState(stateRaw)
  if (!statePayload) return jsonResponse({ error: 'invalid_state' }, 400)

  if (errorParam) {
    const reason = url.searchParams.get('error_description') ?? errorParam
    return redirect(appUrl(statePayload.salon_id, { wa: 'error', reason: reason.slice(0, 200) }))
  }

  if (!code) {
    return redirect(appUrl(statePayload.salon_id, { wa: 'error', reason: 'missing_code' }))
  }

  if (!APP_ID || !APP_SECRET) {
    return jsonResponse({ error: 'oauth_misconfigured' }, 500)
  }

  // --- code → short-lived user token ----------------------------------
  let shortUserToken: string
  try {
    const u = new URL('https://graph.facebook.com/v21.0/oauth/access_token')
    u.searchParams.set('client_id', APP_ID)
    u.searchParams.set('client_secret', APP_SECRET)
    u.searchParams.set('redirect_uri', REDIRECT_URI)
    u.searchParams.set('code', code)
    const r = await fetch(u.toString())
    const j = (await r.json()) as { access_token?: string; error?: { message: string } }
    if (!r.ok || !j.access_token) {
      throw new Error(j.error?.message ?? `code exchange failed (HTTP ${r.status})`)
    }
    shortUserToken = j.access_token
  } catch (e) {
    return redirect(
      appUrl(statePayload.salon_id, {
        wa: 'error',
        reason: `code_exchange: ${(e as Error).message.slice(0, 150)}`,
      }),
    )
  }

  // --- short user → long-lived user token ------------------------------
  let longUserToken: string
  try {
    const u = new URL('https://graph.facebook.com/v21.0/oauth/access_token')
    u.searchParams.set('grant_type', 'fb_exchange_token')
    u.searchParams.set('client_id', APP_ID)
    u.searchParams.set('client_secret', APP_SECRET)
    u.searchParams.set('fb_exchange_token', shortUserToken)
    const r = await fetch(u.toString())
    const j = (await r.json()) as { access_token?: string; error?: { message: string } }
    if (!r.ok || !j.access_token) {
      throw new Error(j.error?.message ?? `long exchange failed (HTTP ${r.status})`)
    }
    longUserToken = j.access_token
  } catch (e) {
    return redirect(
      appUrl(statePayload.salon_id, {
        wa: 'error',
        reason: `long_exchange: ${(e as Error).message.slice(0, 150)}`,
      }),
    )
  }

  // --- discover Business → WABA → Phone Numbers -----------------------
  type IdName = { id: string; name?: string }
  type PhoneRow = {
    id: string
    display_phone_number?: string
    verified_name?: string
    quality_rating?: string
  }

  let businessId: string | null = null
  try {
    const u = new URL('https://graph.facebook.com/v21.0/me/businesses')
    u.searchParams.set('access_token', longUserToken)
    const r = await fetch(u.toString())
    const j = (await r.json()) as { data?: IdName[]; error?: { message: string } }
    if (!r.ok || !j.data) {
      throw new Error(j.error?.message ?? `list businesses failed (HTTP ${r.status})`)
    }
    if (j.data.length === 0) throw new Error('no_businesses')
    businessId = j.data[0].id
  } catch (e) {
    return redirect(
      appUrl(statePayload.salon_id, {
        wa: 'error',
        reason: `discover_business: ${(e as Error).message.slice(0, 150)}`,
      }),
    )
  }

  let wabaId: string | null = null
  let wabaName: string | undefined
  try {
    const u = new URL(
      `https://graph.facebook.com/v21.0/${businessId}/owned_whatsapp_business_accounts`,
    )
    u.searchParams.set('access_token', longUserToken)
    const r = await fetch(u.toString())
    const j = (await r.json()) as { data?: IdName[]; error?: { message: string } }
    if (!r.ok || !j.data) {
      throw new Error(j.error?.message ?? `list WABAs failed (HTTP ${r.status})`)
    }
    if (j.data.length === 0) throw new Error('no_waba')
    wabaId = j.data[0].id
    wabaName = j.data[0].name
  } catch (e) {
    return redirect(
      appUrl(statePayload.salon_id, {
        wa: 'error',
        reason: `discover_waba: ${(e as Error).message.slice(0, 150)}`,
      }),
    )
  }

  let phone: PhoneRow | null = null
  try {
    const u = new URL(`https://graph.facebook.com/v21.0/${wabaId}/phone_numbers`)
    u.searchParams.set('access_token', longUserToken)
    const r = await fetch(u.toString())
    const j = (await r.json()) as { data?: PhoneRow[]; error?: { message: string } }
    if (!r.ok || !j.data) {
      throw new Error(j.error?.message ?? `list phones failed (HTTP ${r.status})`)
    }
    if (j.data.length === 0) throw new Error('no_phones')
    phone = j.data[0]
  } catch (e) {
    return redirect(
      appUrl(statePayload.salon_id, {
        wa: 'error',
        reason: `discover_phones: ${(e as Error).message.slice(0, 150)}`,
      }),
    )
  }

  // --- subscribe WABA to webhook -------------------------------------
  try {
    const body = new URLSearchParams()
    body.set('access_token', longUserToken)
    await fetch(`https://graph.facebook.com/v21.0/${wabaId}/subscribed_apps`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    })
  } catch {
    // не блокирует — webhook можно подписать позже вручную в Meta
  }

  // --- generate verify_token + encrypt + upsert ---------------------
  const verifyToken = crypto.randomUUID().replace(/-/g, '')
  const credsEncrypted = await encryptSecret(
    JSON.stringify({
      access_token: longUserToken,
      verify_token: verifyToken,
      waba_id: wabaId,
      business_id: businessId,
    }),
  )

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const displayName = phone.verified_name
    ? `${phone.verified_name} · ${phone.display_phone_number ?? phone.id}`
    : (phone.display_phone_number ?? wabaName ?? `WA · ${phone.id.slice(-4)}`)

  const { error: dbErr } = await admin.from('messenger_integrations').upsert(
    {
      salon_id: statePayload.salon_id,
      channel: 'whatsapp',
      external_account_id: phone.id,
      display_name: displayName,
      status: 'connected',
      credentials: {
        access_enc: credsEncrypted,
        phone_number_id: phone.id,
        waba_id: wabaId,
        business_id: businessId,
        flow: 'oauth_embedded',
      },
      last_synced_at: new Date().toISOString(),
      last_error: null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'salon_id,channel' },
  )

  if (dbErr) {
    return redirect(
      appUrl(statePayload.salon_id, {
        wa: 'error',
        reason: `db: ${dbErr.message.slice(0, 150)}`,
      }),
    )
  }

  return redirect(appUrl(statePayload.salon_id, { wa: 'connected', phone: phone.id }))
})
