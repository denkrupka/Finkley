/**
 * email-channel-oauth-callback — обработка Google OAuth redirect.
 *
 * Flow:
 *   1. EmailConnectDialog → email-channel action='oauth_start' → returns
 *      consent URL → browser редиректит на accounts.google.com.
 *   2. Юзер approve scopes → Google редиректит сюда с ?code=...&state=<salon_id>.
 *   3. Здесь обмениваем code на {access_token, refresh_token, expires_in}
 *      через oauth2.googleapis.com/token.
 *   4. Сохраняем в messenger_integrations.credentials.oauth.
 *   5. Редиректим юзера на /salon/<salon_id>/settings/integrations?email=connected.
 *
 * ENV:
 *   GOOGLE_OAUTH_CLIENT_ID      — из Google Cloud Console
 *   GOOGLE_OAUTH_CLIENT_SECRET  — из Google Cloud Console
 *   GOOGLE_OAUTH_REDIRECT_URI   — должен совпадать с URL в Google Cloud
 *   APP_BASE_URL                — куда редиректить после успеха (например
 *                                 https://finkley.app или landing-домен).
 *                                 Default: 'https://finkley.app'.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const CLIENT_ID = Deno.env.get('GOOGLE_OAUTH_CLIENT_ID') ?? ''
const CLIENT_SECRET = Deno.env.get('GOOGLE_OAUTH_CLIENT_SECRET') ?? ''
const REDIRECT_URI = Deno.env.get('GOOGLE_OAUTH_REDIRECT_URI') ?? ''
const APP_BASE_URL = Deno.env.get('APP_BASE_URL') ?? 'https://finkley.app'

function htmlRedirect(url: string, _message: string): Response {
  // HTTP 302 Location — чистый redirect без HTML body. Браузер сразу
  // перейдёт на target URL, никакого rendering / charset-проблем.
  // Раньше использовался HTML с meta-refresh, но Supabase gateway
  // иногда перезаписывает Content-Type и Chrome показывал raw HTML +
  // ломал кириллицу в abrakadabra.
  return new Response(null, {
    status: 302,
    headers: { Location: url },
  })
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'GET') {
    return new Response('method_not_allowed', { status: 405 })
  }
  if (!SUPABASE_URL || !SERVICE_KEY || !CLIENT_ID || !CLIENT_SECRET || !REDIRECT_URI) {
    return new Response('oauth_not_configured: missing env vars', { status: 500 })
  }

  const url = new URL(req.url)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state') // = salon_id
  const errorParam = url.searchParams.get('error')

  if (errorParam) {
    // User denied consent / closed popup.
    return htmlRedirect(
      `${APP_BASE_URL}/?email_oauth_error=${encodeURIComponent(errorParam)}`,
      `Подключение отменено: ${errorParam}`,
    )
  }
  if (!code || !state) {
    return new Response('missing_code_or_state', { status: 400 })
  }

  // Exchange code → tokens
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri: REDIRECT_URI,
      grant_type: 'authorization_code',
    }).toString(),
  })

  if (!tokenRes.ok) {
    const errText = await tokenRes.text()
    console.error('google token exchange failed:', errText)
    return htmlRedirect(
      `${APP_BASE_URL}/?email_oauth_error=token_exchange_failed`,
      'Google отказал в обмене кода на токен. Попробуй ещё раз.',
    )
  }

  const tokens = (await tokenRes.json()) as {
    access_token: string
    refresh_token?: string
    expires_in: number
    scope: string
    token_type: string
    id_token?: string
  }

  // Достаём email юзера из userinfo endpoint — для display_name в integrations.
  let emailAddress: string | null = null
  try {
    const userInfo = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    })
    if (userInfo.ok) {
      const ui = (await userInfo.json()) as { email?: string }
      emailAddress = ui.email ?? null
    }
  } catch {
    // ignore — email pull это nice-to-have
  }

  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString()

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  // Сохраняем oauth credentials. SMTP/IMAP оставляем если уже были —
  // юзер может комбинировать: OAuth для send, IMAP для receive.
  const { data: existing } = await admin
    .from('messenger_integrations')
    .select('credentials')
    .eq('salon_id', state)
    .eq('channel', 'email')
    .maybeSingle()

  const existingCreds = (existing?.credentials ?? {}) as Record<string, unknown>

  const oauthCreds: Record<string, unknown> = {
    access_token: tokens.access_token,
    expires_at: expiresAt,
    scope: tokens.scope,
    email: emailAddress,
  }
  // refresh_token присылается только в первый раз (или если prompt=consent).
  // Если повторный коннект без consent — Google не пришлёт. Сохраняем старый
  // если есть, иначе новый.
  if (tokens.refresh_token) {
    oauthCreds.refresh_token = tokens.refresh_token
  } else {
    const oldOauth = (existingCreds.oauth ?? {}) as Record<string, unknown>
    if (oldOauth.refresh_token) {
      oauthCreds.refresh_token = oldOauth.refresh_token
    }
  }

  const { error: upsertErr } = await admin.from('messenger_integrations').upsert(
    {
      salon_id: state,
      channel: 'email',
      status: 'connected',
      external_account_id: emailAddress ?? 'gmail-oauth',
      display_name: emailAddress ?? 'Gmail (OAuth)',
      credentials: {
        ...existingCreds,
        oauth: oauthCreds,
      },
    },
    { onConflict: 'salon_id,channel' },
  )

  if (upsertErr) {
    console.error('save integration failed:', upsertErr.message)
    return htmlRedirect(
      `${APP_BASE_URL}/?email_oauth_error=save_failed`,
      'Не удалось сохранить интеграцию. Свяжись с поддержкой.',
    )
  }

  // Успех — назад в Finkley. Юзер был на /salon/<id>/settings/integrations
  // или /onboarding. Редиректим на общую settings, SPA подхватит query param.
  return htmlRedirect(
    `${APP_BASE_URL}/salon/${state}/settings/integrations?email=connected`,
    'Gmail подключён. Возвращаемся в Finkley...',
  )
})
