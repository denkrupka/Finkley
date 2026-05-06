/**
 * telegram-auth edge function
 *
 * Принимает payload от Telegram Login Widget, валидирует HMAC-подпись,
 * создаёт (или находит) Supabase auth-user с fake email
 * `tg_<telegram_id>@telegram.finkley.eu` и возвращает access/refresh tokens.
 *
 * Клиент (TelegramLoginWidget.tsx) делает `supabase.auth.setSession(...)`
 * и пользователь оказывается залогинен.
 *
 * См. ADR-009 и docs/09_INTEGRATIONS.md.
 *
 * ENV (Supabase secrets):
 *   - TELEGRAM_BOT_TOKEN  — токен бота из @BotFather
 *   - SUPABASE_URL        — авто-инжектится Supabase
 *   - SUPABASE_SERVICE_ROLE_KEY — авто-инжектится Supabase
 *
 * Деплой:
 *   supabase functions deploy telegram-auth --no-verify-jwt --project-ref <ref>
 *   (--no-verify-jwt потому что юзер ЕЩЁ не залогинен в момент вызова)
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.6'
import { corsHeaders, preflight } from '../_shared/cors.ts'

type TelegramPayload = {
  id: number
  first_name: string
  last_name?: string
  username?: string
  photo_url?: string
  auth_date: number
  hash: string
}

const BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN')
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

if (!BOT_TOKEN) {
  console.warn('TELEGRAM_BOT_TOKEN not set — telegram-auth will reject all requests')
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'content-type': 'application/json' },
  })
}

/**
 * Валидация подписи Telegram согласно
 * https://core.telegram.org/widgets/login#checking-authorization
 *
 * data_check_string = sorted("key=value\n" for each field except `hash`)
 * secret_key = SHA256(bot_token)        ← НЕ HMAC, обычный SHA256
 * expected = HMAC_SHA256(data_check_string, secret_key)
 */
async function verifyTelegramSignature(payload: TelegramPayload): Promise<boolean> {
  if (!BOT_TOKEN) return false
  const { hash, ...rest } = payload
  const dataCheckString = Object.entries(rest)
    .filter(([, v]) => v !== undefined && v !== null)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n')

  const enc = new TextEncoder()
  const secretKey = await crypto.subtle.digest('SHA-256', enc.encode(BOT_TOKEN))
  const key = await crypto.subtle.importKey(
    'raw',
    secretKey,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(dataCheckString))
  const computed = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
  return computed === hash
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return preflight()
  if (req.method !== 'POST') return jsonResponse({ error: 'method_not_allowed' }, 405)

  if (!BOT_TOKEN || !SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return jsonResponse({ error: 'function_not_configured' }, 500)
  }

  let payload: TelegramPayload
  try {
    payload = (await req.json()) as TelegramPayload
  } catch {
    return jsonResponse({ error: 'invalid_json' }, 400)
  }

  // 1. Валидация HMAC
  const valid = await verifyTelegramSignature(payload)
  if (!valid) return jsonResponse({ error: 'invalid_signature' }, 401)

  // 2. Защита от replay — auth_date не старше 5 минут
  const ageSec = Math.floor(Date.now() / 1000) - Number(payload.auth_date)
  if (Number.isNaN(ageSec) || ageSec > 300 || ageSec < -60) {
    return jsonResponse({ error: 'stale_auth_date', age_sec: ageSec }, 401)
  }

  const tgId = Number(payload.id)
  const fakeEmail = `tg_${tgId}@telegram.finkley.eu`
  const fullName = [payload.first_name, payload.last_name].filter(Boolean).join(' ').trim()

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  // 3. Существует ли уже пользователь с этим telegram_id?
  const { data: existing, error: lookupErr } = await admin
    .from('profiles')
    .select('id')
    .eq('telegram_id', tgId)
    .maybeSingle()
  if (lookupErr) {
    console.error('profiles lookup failed', lookupErr)
    return jsonResponse({ error: 'lookup_failed' }, 500)
  }

  let userId: string
  if (existing) {
    userId = existing.id
  } else {
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email: fakeEmail,
      email_confirm: true,
      user_metadata: { full_name: fullName, telegram_username: payload.username ?? null },
    })
    if (createErr || !created.user) {
      console.error('createUser failed', createErr)
      return jsonResponse({ error: 'create_user_failed' }, 500)
    }
    userId = created.user.id

    // handle_new_user-триггер уже создал profile; обновляем telegram_id и имя
    const { error: updErr } = await admin
      .from('profiles')
      .update({
        telegram_id: tgId,
        full_name: fullName || null,
        avatar_url: payload.photo_url ?? null,
      })
      .eq('id', userId)
    if (updErr) {
      console.error('profile update failed', updErr)
      // не фейлим — юзер создан, профиль можно дозаполнить позже
    }
  }

  // 4. Получаем валидную пару tokens. `generateLink` с типом `magiclink`
  //    возвращает hashed_token (одноразовый), который мы здесь же verify'ем
  //    через `verifyOtp`, чтобы получить session.
  const { data: link, error: linkErr } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email: fakeEmail,
  })
  if (linkErr || !link?.properties?.hashed_token) {
    console.error('generateLink failed', linkErr)
    return jsonResponse({ error: 'generate_link_failed' }, 500)
  }

  const { data: verified, error: verifyErr } = await admin.auth.verifyOtp({
    type: 'magiclink',
    token_hash: link.properties.hashed_token,
  })
  if (verifyErr || !verified.session) {
    console.error('verifyOtp failed', verifyErr)
    return jsonResponse({ error: 'verify_otp_failed' }, 500)
  }

  return jsonResponse({
    access_token: verified.session.access_token,
    refresh_token: verified.session.refresh_token,
    expires_at: verified.session.expires_at,
    user_id: userId,
  })
})
