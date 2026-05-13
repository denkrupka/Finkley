/**
 * instagram-data-deletion — Meta вызывает этот URL когда юзер запрашивает
 * удаление своих данных через Instagram → Settings → Apps and Websites.
 *
 * Тело: form-urlencoded `signed_request=<b64url(payload)>.<b64url(sig)>`
 * (тот же формат, что и deauthorize).
 *
 * Действия:
 *   1. Валидируем подпись.
 *   2. По user_id ищем:
 *      a) messenger_integrations.external_account_id  → бизнес-салон удаляет IG-интеграцию
 *         → удаляем интеграцию + conversations/messages этого канала
 *      b) messenger_conversations.external_user_id    → клиент салона пишет в DM
 *         → удаляем conversations + messages с этим external_user_id
 *   3. Возвращаем JSON { url, confirmation_code } — Meta показывает юзеру.
 *
 * Env: META_IG_LOGIN_APP_SECRET, LANDING_URL.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.6'

import { corsHeaders, preflight } from '../_shared/cors.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const APP_SECRET = Deno.env.get('META_IG_LOGIN_APP_SECRET') ?? ''
const LANDING_URL = Deno.env.get('LANDING_URL') ?? 'https://finkley.io'

function b64UrlDecode(s: string): Uint8Array {
  const pad = s.length % 4 === 2 ? '==' : s.length % 4 === 3 ? '=' : ''
  const std = s.replace(/-/g, '+').replace(/_/g, '/') + pad
  return Uint8Array.from(atob(std), (c) => c.charCodeAt(0))
}

async function hmacSha256Raw(secret: string, msg: string): Promise<Uint8Array> {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(msg))
  return new Uint8Array(sig)
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i]
  return diff === 0
}

async function parseSignedRequest(signedRequest: string): Promise<{ user_id: string } | null> {
  if (!APP_SECRET) return null
  const [sigB64, payloadB64] = signedRequest.split('.')
  if (!sigB64 || !payloadB64) return null
  const expectedSig = await hmacSha256Raw(APP_SECRET, payloadB64)
  const gotSig = b64UrlDecode(sigB64)
  if (!bytesEqual(expectedSig, gotSig)) return null
  try {
    const json = new TextDecoder().decode(b64UrlDecode(payloadB64))
    const obj = JSON.parse(json) as { algorithm?: string; user_id?: string }
    if (obj.algorithm !== 'HMAC-SHA256' || !obj.user_id) return null
    return { user_id: String(obj.user_id) }
  } catch {
    return null
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return preflight()
  if (req.method !== 'POST') {
    return new Response('method_not_allowed', { status: 405, headers: corsHeaders })
  }

  let signedRequest = ''
  const ct = req.headers.get('content-type') ?? ''
  if (ct.includes('application/x-www-form-urlencoded')) {
    const form = await req.formData()
    signedRequest = String(form.get('signed_request') ?? '')
  } else {
    try {
      const j = (await req.json()) as { signed_request?: string }
      signedRequest = j.signed_request ?? ''
    } catch {
      // ignore
    }
  }
  if (!signedRequest) {
    return new Response(JSON.stringify({ error: 'missing_signed_request' }), {
      status: 400,
      headers: { ...corsHeaders, 'content-type': 'application/json' },
    })
  }

  const parsed = await parseSignedRequest(signedRequest)
  if (!parsed) {
    return new Response(JSON.stringify({ error: 'invalid_signature' }), {
      status: 400,
      headers: { ...corsHeaders, 'content-type': 'application/json' },
    })
  }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  // Деление 1 — бизнес-салон удалил приложение
  const { data: integs } = await admin
    .from('messenger_integrations')
    .select('id, salon_id')
    .eq('channel', 'instagram')
    .eq('external_account_id', parsed.user_id)
  for (const integ of integs ?? []) {
    await admin
      .from('messenger_messages')
      .delete()
      .eq('salon_id', integ.salon_id)
      .in(
        'conversation_id',
        (
          await admin
            .from('messenger_conversations')
            .select('id')
            .eq('salon_id', integ.salon_id)
            .eq('channel', 'instagram')
        ).data?.map((c) => c.id) ?? [],
      )
    await admin
      .from('messenger_conversations')
      .delete()
      .eq('salon_id', integ.salon_id)
      .eq('channel', 'instagram')
    await admin.from('messenger_integrations').delete().eq('id', integ.id)
  }

  // Деление 2 — IG-клиент салона (тот, кто писал в DM)
  const { data: convos } = await admin
    .from('messenger_conversations')
    .select('id')
    .eq('channel', 'instagram')
    .eq('external_user_id', parsed.user_id)
  for (const c of convos ?? []) {
    await admin.from('messenger_messages').delete().eq('conversation_id', c.id)
    await admin.from('messenger_conversations').delete().eq('id', c.id)
  }

  const confirmationCode = crypto.randomUUID()
  const statusUrl = `${LANDING_URL}/data-deletion-status?id=${confirmationCode}`

  return new Response(
    JSON.stringify({
      url: statusUrl,
      confirmation_code: confirmationCode,
    }),
    {
      status: 200,
      headers: { ...corsHeaders, 'content-type': 'application/json' },
    },
  )
})
