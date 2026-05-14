/**
 * telegram-link — привязка Telegram-аккаунта к УЖЕ залогиненному пользователю.
 *
 * В отличие от telegram-auth (логинит юзера через TG, создавая user если
 * нужно), этот endpoint:
 *   1. Требует Authorization: Bearer <JWT> (юзер уже залогинен)
 *   2. Валидирует HMAC payload от Telegram Login Widget тем же алгоритмом
 *   3. Проверяет что этот telegram_id не привязан к другому юзеру
 *   4. UPDATE profiles SET telegram_id, telegram_username для текущего юзера
 *
 * Используется в Settings → Profile → «Привязать Telegram» — после этого
 * клиент может писать баги в @finklay_dev_bot из личного чата.
 *
 * Deploy: --no-verify-jwt (мы сами проверяем JWT через getUserFromRequest)
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.6'

import { getUserFromRequest } from '../_shared/auth.ts'
import { corsHeaders, preflight } from '../_shared/cors.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN') ?? ''

type TelegramPayload = {
  id: number
  first_name: string
  last_name?: string
  username?: string
  photo_url?: string
  auth_date: number
  hash: string
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'content-type': 'application/json' },
  })
}

/**
 * Telegram Login HMAC: SHA256(bot_token) → HMAC-SHA256(data_check_string)
 * https://core.telegram.org/widgets/login#checking-authorization
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
  if (!BOT_TOKEN || !SUPABASE_URL || !SERVICE_KEY) {
    return jsonResponse({ error: 'function_not_configured' }, 500)
  }

  const user = await getUserFromRequest(req, SUPABASE_URL, SERVICE_KEY)
  if (!user) return jsonResponse({ error: 'unauthorized' }, 401)

  let payload: TelegramPayload
  try {
    payload = (await req.json()) as TelegramPayload
  } catch {
    return jsonResponse({ error: 'invalid_json' }, 400)
  }

  // HMAC + защита от replay (auth_date не старше 5 минут)
  const valid = await verifyTelegramSignature(payload)
  if (!valid) return jsonResponse({ error: 'invalid_signature' }, 401)
  const ageSec = Math.floor(Date.now() / 1000) - Number(payload.auth_date)
  if (Number.isNaN(ageSec) || ageSec > 300 || ageSec < -60) {
    return jsonResponse({ error: 'stale_auth_date', age_sec: ageSec }, 401)
  }

  const tgId = Number(payload.id)
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  // Защита: этот telegram_id уже привязан к другому юзеру? Если да — отказ.
  const { data: occupied } = await admin
    .from('profiles')
    .select('id')
    .eq('telegram_id', tgId)
    .maybeSingle()
  if (occupied && occupied.id !== user.userId) {
    return jsonResponse({ error: 'telegram_already_linked_to_other_account' }, 409)
  }

  const { error: updErr } = await admin
    .from('profiles')
    .update({
      telegram_id: tgId,
      telegram_username: payload.username ?? null,
    })
    .eq('id', user.userId)
  if (updErr) {
    console.error('profile update failed', updErr)
    return jsonResponse({ error: 'update_failed', detail: updErr.message }, 500)
  }

  return jsonResponse({
    ok: true,
    telegram_id: tgId,
    telegram_username: payload.username ?? null,
  })
})
