/**
 * instagram-deauthorize — Meta вызывает этот URL когда пользователь удаляет
 * наше приложение из Instagram → Settings → Apps and Websites.
 *
 * Тело: form-urlencoded `signed_request=<b64url(payload)>.<b64url(sig)>`
 * payload (JSON): { algorithm:'HMAC-SHA256', issued_at, user_id }
 * sig = HMAC-SHA256(payload_b64, APP_SECRET)
 *
 * Действия:
 *   1. Валидируем подпись.
 *   2. По user_id находим messenger_integrations.credentials.ig_user_id,
 *      помечаем status='disconnected', чистим credentials.
 *   3. Возвращаем 200 OK (Meta не парсит тело).
 *
 * Env: META_IG_LOGIN_APP_SECRET, MESSENGER_SECRETS_KEY.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.6'

import { corsHeaders, preflight } from '../_shared/cors.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const APP_SECRET = Deno.env.get('META_IG_LOGIN_APP_SECRET') ?? ''

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
    // Иногда Meta присылает как JSON — на всякий случай
    try {
      const j = (await req.json()) as { signed_request?: string }
      signedRequest = j.signed_request ?? ''
    } catch {
      // ignore
    }
  }
  if (!signedRequest) {
    return new Response('missing_signed_request', { status: 400, headers: corsHeaders })
  }

  const parsed = await parseSignedRequest(signedRequest)
  if (!parsed) {
    return new Response('invalid_signature', { status: 400, headers: corsHeaders })
  }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  // Помечаем интеграцию disconnected. ig_user_id хранится в credentials.ig_user_id,
  // используем нативный JSONB-фильтр.
  const { error } = await admin
    .from('messenger_integrations')
    .update({
      status: 'disconnected',
      last_error: 'User revoked via Instagram Apps and Websites',
      updated_at: new Date().toISOString(),
    })
    .eq('channel', 'instagram')
    .eq('external_account_id', parsed.user_id)

  if (error) {
    console.warn('deauthorize update failed:', error.message)
  }

  return new Response('OK', { status: 200, headers: corsHeaders })
})
