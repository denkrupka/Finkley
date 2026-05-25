/**
 * fb-oauth-callback — OAuth flow для подключения FB Page + (опционально) IG-via-Page.
 * Использует «Facebook Login» (flow A для FB Messenger + Instagram).
 *
 * Два режима:
 *
 * 1) ?action=start&salon_id=<uuid>  (Authorization: Bearer <user-jwt>)
 *    → JSON { authorize_url } для редиректа на FB OAuth.
 *
 * 2) ?code=<...>&state=<...>
 *    → Обмен code на user token → long-lived user token → list pages →
 *      берём первую Page → шифруем page token → upsert messenger_integrations
 *      (channel=facebook). Если у Page есть IG Business Account — дублируем
 *      запись с channel=instagram + тот же page token.
 *      Редирект на /{salon}/settings/integrations?fb=connected.
 *
 * Env: META_FB_APP_ID, META_FB_APP_SECRET, FUNCTION_INTERNAL_SECRET,
 *      MESSENGER_SECRETS_KEY, APP_URL.
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

const REDIRECT_URI = `${SUPABASE_URL}/functions/v1/fb-oauth-callback`

// Только Page-scopes. Для Instagram используется отдельный flow через
// `instagram-oauth-callback` (Instagram Login API) — новый путь, который
// заменил deprecated `instagram_basic` + `instagram_manage_messages`.
// Старые IG scopes удалены чтобы Meta App Review видел консистентный
// список — без дубликатов «old IG via FB Page» + «new IG Login».
const SCOPES = [
  'pages_show_list',
  'pages_messaging',
  'pages_manage_metadata',
  'pages_read_engagement',
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
  // Mode 1: start
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
    const authorize = new URL('https://www.facebook.com/v21.0/dialog/oauth')
    authorize.searchParams.set('client_id', APP_ID)
    authorize.searchParams.set('redirect_uri', REDIRECT_URI)
    authorize.searchParams.set('response_type', 'code')
    authorize.searchParams.set('scope', SCOPES)
    authorize.searchParams.set('state', state)

    return jsonResponse({ authorize_url: authorize.toString() })
  }

  // -------------------------------------------------------------------------
  // Mode 2/3: callback
  // -------------------------------------------------------------------------
  if (!stateRaw) return jsonResponse({ error: 'missing_state' }, 400)
  const statePayload = await verifyOAuthState(stateRaw)
  if (!statePayload) return jsonResponse({ error: 'invalid_state' }, 400)

  if (errorParam) {
    const reason = url.searchParams.get('error_description') ?? errorParam
    return redirect(appUrl(statePayload.salon_id, { fb: 'error', reason: reason.slice(0, 200) }))
  }

  if (!code) {
    return redirect(appUrl(statePayload.salon_id, { fb: 'error', reason: 'missing_code' }))
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
    const j = (await r.json()) as {
      access_token?: string
      error?: { message: string }
    }
    if (!r.ok || !j.access_token) {
      throw new Error(j.error?.message ?? `code exchange failed (HTTP ${r.status})`)
    }
    shortUserToken = j.access_token
  } catch (e) {
    return redirect(
      appUrl(statePayload.salon_id, {
        fb: 'error',
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
        fb: 'error',
        reason: `long_exchange: ${(e as Error).message.slice(0, 150)}`,
      }),
    )
  }

  // --- list pages (now with long-lived page tokens) -------------------
  type FbPage = {
    id: string
    name: string
    access_token: string
    instagram_business_account?: { id: string; name?: string; username?: string }
  }
  let pages: FbPage[] = []
  try {
    const u = new URL('https://graph.facebook.com/v21.0/me/accounts')
    u.searchParams.set('access_token', longUserToken)
    u.searchParams.set(
      'fields',
      'id,name,access_token,instagram_business_account{id,name,username}',
    )
    const r = await fetch(u.toString())
    const j = (await r.json()) as { data?: FbPage[]; error?: { message: string } }
    if (!r.ok || !j.data) {
      throw new Error(j.error?.message ?? `list pages failed (HTTP ${r.status})`)
    }
    pages = j.data
  } catch (e) {
    return redirect(
      appUrl(statePayload.salon_id, {
        fb: 'error',
        reason: `list_pages: ${(e as Error).message.slice(0, 150)}`,
      }),
    )
  }

  if (pages.length === 0) {
    return redirect(appUrl(statePayload.salon_id, { fb: 'error', reason: 'no_pages' }))
  }

  // MVP: автоматически подключаем первую Page. UX выбора между несколькими —
  // отдельная фича (TODO: ?fb=choose с list serialized в URL).
  const page = pages[0]

  // --- subscribe page to messenger webhook ----------------------------
  try {
    const body = new URLSearchParams()
    body.set('subscribed_fields', 'messages,messaging_postbacks,message_deliveries,message_reads')
    body.set('access_token', page.access_token)
    await fetch(`https://graph.facebook.com/v21.0/${page.id}/subscribed_apps`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    })
  } catch {
    // не блокирует
  }

  // --- encrypt + upsert FB integration --------------------------------
  const pageTokenEnc = await encryptSecret(page.access_token)
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { error: fbErr } = await admin.from('messenger_integrations').upsert(
    {
      salon_id: statePayload.salon_id,
      channel: 'facebook',
      external_account_id: page.id,
      display_name: page.name,
      status: 'connected',
      credentials: { page_access_enc: pageTokenEnc, page_id: page.id, flow: 'page_messaging' },
      last_synced_at: new Date().toISOString(),
      last_error: null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'salon_id,channel' },
  )
  if (fbErr) {
    return redirect(
      appUrl(statePayload.salon_id, {
        fb: 'error',
        reason: `db_fb: ${fbErr.message.slice(0, 150)}`,
      }),
    )
  }

  // NOTE: НЕ создаём автоматически IG-integration через Page Token. Старый
  // flow=page_messaging не подписывает IG-аккаунт на webhook (Meta deprecated
  // routing IG DMs через Page), поэтому DM от клиентов не приходили бы.
  // IG подключается отдельной кнопкой → instagram-oauth-callback → правильно
  // зовёт POST /{ig-user-id}/subscribed_apps и flow=instagram_login.

  return redirect(appUrl(statePayload.salon_id, { fb: 'connected', page: page.name }))
})
