/**
 * instagram-oauth-callback — OAuth flow для подключения IG-аккаунта клиента-салона.
 * Использует «Instagram API with Instagram Login» (flow B).
 *
 * Два режима по query-параметрам:
 *
 * 1) ?action=start&salon_id=<uuid>    (требует Authorization: Bearer <user-jwt>)
 *    → Проверяет membership юзера в салоне (owner/admin), генерирует HMAC-state,
 *      возвращает JSON { authorize_url } для редиректа на Instagram OAuth.
 *
 * 2) ?code=<...>&state=<...>          (вызывается браузером после Meta-OAuth)
 *    → Проверяет state, обменивает code на short-lived → long-lived token,
 *      достаёт user_id/username, шифрует, пишет messenger_integrations,
 *      редиректит на /{salon}/settings/integrations?ig=connected.
 *
 * 3) ?error=...&state=...             (юзер отменил или ошибка)
 *    → Редирект на /{salon}/settings/integrations?ig=error&reason=...
 *
 * Env:
 *   META_IG_LOGIN_APP_ID         — App ID FINKLEY Direct-IG
 *   META_IG_LOGIN_APP_SECRET     — App Secret
 *   FUNCTION_INTERNAL_SECRET     — HMAC ключ для state
 *   MESSENGER_SECRETS_KEY        — AES ключ для шифрования IG token
 *   APP_URL                      — base URL FinSalon (для финального редиректа)
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.6'

import { getSalonMembership, getUserFromRequest } from '../_shared/auth.ts'
import { corsHeaders, preflight } from '../_shared/cors.ts'
import { encryptSecret } from '../_shared/crypto-aes.ts'
import { signOAuthState, verifyOAuthState } from '../_shared/oauth-state.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const APP_ID = Deno.env.get('META_IG_LOGIN_APP_ID') ?? ''
const APP_SECRET = Deno.env.get('META_IG_LOGIN_APP_SECRET') ?? ''
const APP_URL = Deno.env.get('APP_URL') ?? 'http://localhost:5173'

const REDIRECT_URI = `${SUPABASE_URL.replace('.supabase.co', '.supabase.co')}/functions/v1/instagram-oauth-callback`

const SCOPES = [
  'instagram_business_basic',
  'instagram_business_manage_messages',
  'instagram_business_manage_comments',
].join(',')

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'content-type': 'application/json' },
  })
}

function redirect(url: string): Response {
  return new Response(null, {
    status: 302,
    headers: { ...corsHeaders, location: url },
  })
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

  // -------------------------------------------------------------------------
  // Mode 1: start — выдаём authorize URL для редиректа на Meta
  // -------------------------------------------------------------------------
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
    const authorize = new URL('https://www.instagram.com/oauth/authorize')
    authorize.searchParams.set('client_id', APP_ID)
    authorize.searchParams.set('redirect_uri', REDIRECT_URI)
    authorize.searchParams.set('response_type', 'code')
    authorize.searchParams.set('scope', SCOPES)
    authorize.searchParams.set('state', state)

    return jsonResponse({ authorize_url: authorize.toString() })
  }

  // -------------------------------------------------------------------------
  // Mode 2/3: OAuth callback — code или error в query
  // -------------------------------------------------------------------------
  if (!stateRaw) return jsonResponse({ error: 'missing_state' }, 400)
  const statePayload = await verifyOAuthState(stateRaw)
  if (!statePayload) return jsonResponse({ error: 'invalid_state' }, 400)

  if (errorParam) {
    const reason = url.searchParams.get('error_description') ?? errorParam
    return redirect(appUrl(statePayload.salon_id, { ig: 'error', reason: reason.slice(0, 200) }))
  }

  if (!code) {
    return redirect(appUrl(statePayload.salon_id, { ig: 'error', reason: 'missing_code' }))
  }

  if (!APP_ID || !APP_SECRET) {
    return jsonResponse({ error: 'oauth_misconfigured' }, 500)
  }

  // --- Exchange code → short-lived token --------------------------------
  let shortToken: string
  let igUserId: string
  try {
    const form = new URLSearchParams()
    form.set('client_id', APP_ID)
    form.set('client_secret', APP_SECRET)
    form.set('grant_type', 'authorization_code')
    form.set('redirect_uri', REDIRECT_URI)
    form.set('code', code)
    const r = await fetch('https://api.instagram.com/oauth/access_token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    })
    const j = (await r.json()) as {
      access_token?: string
      user_id?: string | number
      error_message?: string
      error_type?: string
    }
    if (!r.ok || !j.access_token || !j.user_id) {
      throw new Error(j.error_message ?? `code exchange failed (HTTP ${r.status})`)
    }
    shortToken = j.access_token
    igUserId = String(j.user_id)
  } catch (e) {
    return redirect(
      appUrl(statePayload.salon_id, {
        ig: 'error',
        reason: `code_exchange: ${(e as Error).message.slice(0, 150)}`,
      }),
    )
  }

  // --- Exchange short → long-lived token --------------------------------
  let longToken: string
  try {
    const u = new URL('https://graph.instagram.com/access_token')
    u.searchParams.set('grant_type', 'ig_exchange_token')
    u.searchParams.set('client_secret', APP_SECRET)
    u.searchParams.set('access_token', shortToken)
    const r = await fetch(u.toString())
    const j = (await r.json()) as {
      access_token?: string
      token_type?: string
      expires_in?: number
      error?: { message: string }
    }
    if (!r.ok || !j.access_token) {
      throw new Error(j.error?.message ?? `long exchange failed (HTTP ${r.status})`)
    }
    longToken = j.access_token
  } catch (e) {
    return redirect(
      appUrl(statePayload.salon_id, {
        ig: 'error',
        reason: `long_exchange: ${(e as Error).message.slice(0, 150)}`,
      }),
    )
  }

  // --- Fetch user profile (username, name, LEGACY user_id) -------------
  // КРИТИЧНО: /me?fields=user_id возвращает 17-значный legacy IG Business
  // user_id (17841...), который Meta присылает в webhook entry.id. Scoped
  // id (27260...) что приходит на oauth/access_token — другой, для него
  // webhook'и НЕ ищутся. Храним legacy в external_account_id для матча.
  let username = ''
  let name = ''
  let legacyUserId: string | null = null
  try {
    const u = new URL('https://graph.instagram.com/v21.0/me')
    u.searchParams.set('fields', 'user_id,username,name')
    u.searchParams.set('access_token', longToken)
    const r = await fetch(u.toString())
    const j = (await r.json()) as {
      user_id?: string | number
      username?: string
      name?: string
    }
    username = j.username ?? ''
    name = j.name ?? ''
    if (j.user_id) legacyUserId = String(j.user_id)
  } catch {
    // не критично
  }

  // --- Subscribe app to webhook for this user ---------------------------
  // ВАЖНО: используем /me/subscribed_apps (не /{id}/subscribed_apps), т.к.
  // scoped id из oauth/access_token отличается от того, что возвращает /me
  // — обращение по сохранённому id даёт 404 и подписка фейлится молча.
  try {
    const subUrl = `https://graph.instagram.com/v21.0/me/subscribed_apps`
    const subBody = new URLSearchParams()
    subBody.set('subscribed_fields', 'messages,messaging_postbacks')
    subBody.set('access_token', longToken)
    const subResp = await fetch(subUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: subBody.toString(),
    })
    if (!subResp.ok) {
      console.warn(`[ig-oauth] subscribed_apps failed: ${subResp.status} ${await subResp.text()}`)
    }
  } catch (e) {
    console.warn('[ig-oauth] subscribe exception:', (e as Error).message)
  }

  // --- Encrypt & upsert messenger_integrations --------------------------
  const igAccessEnc = await encryptSecret(longToken)
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  // Для external_account_id ОБЯЗАТЕЛЬНО используем legacy user_id (17841...)
  // если он есть — это то, что Meta присылает в webhook entry.id. Если /me
  // упал и legacy не получен, fallback на scoped id (но тогда webhook'и
  // не будут матчиться — это видно в last_error).
  const externalId = legacyUserId ?? igUserId
  const { error: upErr } = await admin.from('messenger_integrations').upsert(
    {
      salon_id: statePayload.salon_id,
      channel: 'instagram',
      external_account_id: externalId,
      display_name: name || (username ? `@${username}` : `IG ${externalId.slice(-6)}`),
      status: 'connected',
      credentials: {
        ig_access_enc: igAccessEnc,
        ig_user_id: legacyUserId ?? igUserId,
        ig_user_id_scoped: igUserId,
        flow: 'instagram_login',
      },
      last_synced_at: new Date().toISOString(),
      last_error: legacyUserId
        ? null
        : 'legacy user_id not resolved — webhook events may not match',
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'salon_id,channel' },
  )
  if (upErr) {
    return redirect(
      appUrl(statePayload.salon_id, {
        ig: 'error',
        reason: `db: ${upErr.message.slice(0, 150)}`,
      }),
    )
  }

  return redirect(
    appUrl(statePayload.salon_id, {
      ig: 'connected',
      account: username || igUserId,
    }),
  )
})
