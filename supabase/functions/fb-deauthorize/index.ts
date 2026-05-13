/**
 * fb-deauthorize — Meta вызывает когда юзер удаляет наше FB app из своих
 * Settings → Apps and Websites. Помечает messenger_integrations.status='disconnected'.
 *
 * Тело: form-urlencoded signed_request (HMAC через META_FB_APP_SECRET).
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.6'

import { corsHeaders, preflight } from '../_shared/cors.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const APP_SECRET = Deno.env.get('META_FB_APP_SECRET') ?? ''

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
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(msg)))
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i]
  return diff === 0
}

async function parseSignedRequest(s: string): Promise<{ user_id: string } | null> {
  if (!APP_SECRET) return null
  const [sigB64, payloadB64] = s.split('.')
  if (!sigB64 || !payloadB64) return null
  const expected = await hmacSha256Raw(APP_SECRET, payloadB64)
  const got = b64UrlDecode(sigB64)
  if (!bytesEqual(expected, got)) return null
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
  if ((req.headers.get('content-type') ?? '').includes('application/x-www-form-urlencoded')) {
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
    return new Response('missing_signed_request', { status: 400, headers: corsHeaders })
  }

  const parsed = await parseSignedRequest(signedRequest)
  if (!parsed) {
    return new Response('invalid_signature', { status: 400, headers: corsHeaders })
  }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  // Юзер на FB не привязан напрямую к Page — поэтому отметим все integrations
  // где этот user_id фигурирует в credentials.fb_user_id (если он там есть).
  // На MVP — просто помечаем все FB-integrations связанные с этим user_id
  // через credentials JSONB.
  await admin
    .from('messenger_integrations')
    .update({
      status: 'disconnected',
      last_error: 'User revoked via Facebook Apps and Websites',
      updated_at: new Date().toISOString(),
    })
    .in('channel', ['facebook', 'instagram'])
    .filter('credentials->>fb_user_id', 'eq', parsed.user_id)

  return new Response('OK', { status: 200, headers: corsHeaders })
})
