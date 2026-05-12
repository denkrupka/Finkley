/**
 * send-push — отправляет Web Push уведомление одному юзеру (всем его
 * подпискам со всех браузеров/девайсов).
 *
 * Архитектура: VAPID + RFC 8291 (aes128gcm content encoding). Реализуем
 * через Web Crypto API в Deno — без зависимостей.
 *
 * Auth:
 *   - Прямой вызов: action='send' через service_role (rendezvous-token
 *     pattern), используется будущим cron-сценарием
 *   - Subscribe action: 'subscribe', user JWT, сохраняет subscription
 *   - Unsubscribe: 'unsubscribe', user JWT
 *   - Test: 'test', user JWT, шлёт тестовое уведомление текущему юзеру
 *
 * ENV:
 *   VAPID_PUBLIC_KEY  — base64url uncompressed P-256 (66 chars)
 *   VAPID_PRIVATE_KEY — base64url scalar (~43 chars)
 *   VAPID_SUBJECT     — mailto: или https:// для contact (RFC 8292)
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'

import { corsHeaders, preflight } from '../_shared/cors.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const VAPID_PUB = Deno.env.get('VAPID_PUBLIC_KEY') ?? ''
const VAPID_PRIV = Deno.env.get('VAPID_PRIVATE_KEY') ?? ''
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:support@finkley.app'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'content-type': 'application/json' },
  })
}

// =============================================================================
// Base64url helpers
// =============================================================================

function b64urlToBytes(str: string): Uint8Array {
  const b64 = str
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .padEnd(Math.ceil(str.length / 4) * 4, '=')
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

function bytesToB64url(bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

// =============================================================================
// VAPID JWT signing (ES256, P-256)
// =============================================================================

async function importVapidPrivateKey(): Promise<CryptoKey> {
  // VAPID private = scalar (32 bytes). Web Crypto requires JWK.
  const d = b64urlToBytes(VAPID_PRIV)
  // Расшифровываем VAPID public для x/y координат
  const pub = b64urlToBytes(VAPID_PUB) // 0x04 || X (32) || Y (32)
  if (pub.length !== 65 || pub[0] !== 0x04) {
    throw new Error('VAPID_PUBLIC_KEY must be uncompressed P-256 (65 bytes, 0x04-prefixed)')
  }
  const x = pub.slice(1, 33)
  const y = pub.slice(33, 65)
  const jwk: JsonWebKey = {
    kty: 'EC',
    crv: 'P-256',
    x: bytesToB64url(x),
    y: bytesToB64url(y),
    d: bytesToB64url(d),
    ext: true,
  }
  return crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, [
    'sign',
  ])
}

async function buildVapidJwt(audience: string): Promise<string> {
  const header = { typ: 'JWT', alg: 'ES256' }
  const payload = {
    aud: audience,
    exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60, // 12h max per RFC
    sub: VAPID_SUBJECT,
  }
  const enc = new TextEncoder()
  const headerB64 = bytesToB64url(enc.encode(JSON.stringify(header)))
  const payloadB64 = bytesToB64url(enc.encode(JSON.stringify(payload)))
  const signingInput = `${headerB64}.${payloadB64}`
  const key = await importVapidPrivateKey()
  const sigDer = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    enc.encode(signingInput),
  )
  // Web Crypto sign returns IEEE-P1363 (raw r||s 64 bytes), что и требует JWS ES256
  return `${signingInput}.${bytesToB64url(new Uint8Array(sigDer))}`
}

// =============================================================================
// Payload encryption (RFC 8291 / aes128gcm)
// =============================================================================

async function hkdfExtractExpand(
  ikm: Uint8Array,
  salt: Uint8Array,
  info: Uint8Array,
  length: number,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', ikm, { name: 'HKDF' }, false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt, info },
    key,
    length * 8,
  )
  return new Uint8Array(bits)
}

async function encryptPayload(
  payload: string,
  recipientP256dh: string,
  authSecret: string,
): Promise<{ body: Uint8Array; serverPublicKey: string; salt: string }> {
  const enc = new TextEncoder()
  // 1) Generate ephemeral ECDH keypair
  const serverKey = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
    'deriveBits',
  ])) as CryptoKeyPair
  const serverPubRaw = new Uint8Array(await crypto.subtle.exportKey('raw', serverKey.publicKey))

  // 2) Import recipient public key (raw uncompressed)
  const recipPub = b64urlToBytes(recipientP256dh)
  const recipKey = await crypto.subtle.importKey(
    'raw',
    recipPub,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  )

  // 3) ECDH shared secret
  const sharedBits = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: recipKey },
    serverKey.privateKey,
    256,
  )
  const ecdhSecret = new Uint8Array(sharedBits)

  // 4) HKDF derive PRK_key + content key per RFC 8291
  const auth = b64urlToBytes(authSecret)
  const keyInfo = new Uint8Array([...enc.encode('WebPush: info\0'), ...recipPub, ...serverPubRaw])
  const ikm = await hkdfExtractExpand(ecdhSecret, auth, keyInfo, 32)

  // 5) Salt random + nonce derive
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const cek = await hkdfExtractExpand(
    ikm,
    salt,
    new Uint8Array([...enc.encode('Content-Encoding: aes128gcm\0')]),
    16,
  )
  const nonce = await hkdfExtractExpand(
    ikm,
    salt,
    new Uint8Array([...enc.encode('Content-Encoding: nonce\0')]),
    12,
  )

  // 6) Build encryption-content-coding header (RFC 8188):
  //    salt(16) || rs(4) || idlen(1) || keyid(idlen=server pubkey len)
  const rs = 4096
  const header = new Uint8Array(16 + 4 + 1 + serverPubRaw.length)
  header.set(salt, 0)
  new DataView(header.buffer).setUint32(16, rs, false)
  header[20] = serverPubRaw.length
  header.set(serverPubRaw, 21)

  // 7) Plaintext: payload || 0x02 (last record padding delimiter)
  const plaintext = new Uint8Array(payload.length + 1)
  plaintext.set(enc.encode(payload), 0)
  plaintext[payload.length] = 0x02

  // 8) AES-128-GCM encrypt
  const aesKey = await crypto.subtle.importKey(
    'raw',
    cek,
    { name: 'AES-GCM', length: 128 },
    false,
    ['encrypt'],
  )
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce, tagLength: 128 }, aesKey, plaintext),
  )

  // 9) Final body = header || ciphertext
  const body = new Uint8Array(header.length + ct.length)
  body.set(header, 0)
  body.set(ct, header.length)
  return {
    body,
    serverPublicKey: bytesToB64url(serverPubRaw),
    salt: bytesToB64url(salt),
  }
}

// =============================================================================
// Web Push send
// =============================================================================

type Subscription = {
  endpoint: string
  p256dh: string
  auth_key: string
}

async function sendOnePush(
  sub: Subscription,
  payloadJson: string,
): Promise<{ ok: boolean; status: number; error?: string }> {
  const url = new URL(sub.endpoint)
  const audience = `${url.protocol}//${url.host}`
  const jwt = await buildVapidJwt(audience)

  const enc = await encryptPayload(payloadJson, sub.p256dh, sub.auth_key)

  const res = await fetch(sub.endpoint, {
    method: 'POST',
    headers: {
      Authorization: `vapid t=${jwt}, k=${VAPID_PUB}`,
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: '86400',
      Urgency: 'normal',
    },
    body: enc.body,
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    return { ok: false, status: res.status, error: text.slice(0, 200) }
  }
  return { ok: true, status: res.status }
}

// =============================================================================
// Action handlers
// =============================================================================

async function handleSubscribe(
  userClient: ReturnType<typeof createClient>,
  userId: string,
  body: { endpoint?: string; p256dh?: string; auth?: string; userAgent?: string },
): Promise<Response> {
  if (!body.endpoint || !body.p256dh || !body.auth) {
    return jsonResponse({ ok: false, error: 'subscription_incomplete' }, 400)
  }
  const { error } = await userClient.from('push_subscriptions').upsert(
    {
      user_id: userId,
      endpoint: body.endpoint,
      p256dh: body.p256dh,
      auth_key: body.auth,
      user_agent: body.userAgent ?? null,
      last_used_at: new Date().toISOString(),
    },
    { onConflict: 'endpoint' },
  )
  if (error)
    return jsonResponse({ ok: false, error: 'persist_failed', message: error.message }, 500)
  return jsonResponse({ ok: true })
}

async function handleUnsubscribe(
  userClient: ReturnType<typeof createClient>,
  userId: string,
  body: { endpoint?: string },
): Promise<Response> {
  if (!body.endpoint) return jsonResponse({ ok: false, error: 'endpoint_required' }, 400)
  await userClient
    .from('push_subscriptions')
    .delete()
    .eq('user_id', userId)
    .eq('endpoint', body.endpoint)
  return jsonResponse({ ok: true })
}

async function handleTest(
  admin: ReturnType<typeof createClient>,
  userId: string,
): Promise<Response> {
  if (!VAPID_PUB || !VAPID_PRIV) {
    return jsonResponse({ ok: false, error: 'vapid_not_configured' }, 500)
  }
  const { data: subs } = await admin
    .from('push_subscriptions')
    .select('endpoint, p256dh, auth_key')
    .eq('user_id', userId)
  if (!subs || subs.length === 0) {
    return jsonResponse({ ok: false, error: 'no_subscriptions' }, 404)
  }
  const payload = JSON.stringify({
    title: 'Finkley',
    body: 'Тестовое уведомление — push работает 🎉',
    url: '/',
  })
  const results = await Promise.all(subs.map((s) => sendOnePush(s as Subscription, payload)))
  // Удаляем мёртвые подписки (404/410 от push сервиса)
  const dead = subs.filter((_, i) => {
    const r = results[i]
    return r && !r.ok && (r.status === 404 || r.status === 410)
  })
  for (const d of dead) {
    await admin.from('push_subscriptions').delete().eq('endpoint', d.endpoint)
  }
  return jsonResponse({
    ok: true,
    sent: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    dead: dead.length,
  })
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return preflight()
  if (req.method !== 'POST') return jsonResponse({ ok: false, error: 'method_not_allowed' }, 405)
  if (!SUPABASE_URL || !SERVICE_KEY) {
    return jsonResponse({ ok: false, error: 'function_not_configured' }, 500)
  }
  // Раннее предупреждение: если VAPID не настроен — sub/test всё равно
  // упадут, лучше показать понятную ошибку сразу.
  if (!VAPID_PUB || !VAPID_PRIV) {
    console.warn('send-push: VAPID env not configured — subscribe/test будут возвращать ошибку')
  }

  const authHeader = req.headers.get('Authorization') ?? ''
  if (!authHeader.startsWith('Bearer ')) {
    return jsonResponse({ ok: false, error: 'unauthorized' }, 401)
  }
  const userJwt = authHeader.slice('Bearer '.length)

  const userClient = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${userJwt}` } },
  })
  const { data: userRes, error: userErr } = await userClient.auth.getUser()
  if (userErr || !userRes?.user) {
    return jsonResponse({ ok: false, error: 'invalid_token' }, 401)
  }
  const userId = userRes.user.id

  let body: {
    action?: string
    endpoint?: string
    p256dh?: string
    auth?: string
    userAgent?: string
  }
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ ok: false, error: 'bad_request' }, 400)
  }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  switch (body.action) {
    case 'subscribe':
      return handleSubscribe(userClient, userId, body)
    case 'unsubscribe':
      return handleUnsubscribe(userClient, userId, body)
    case 'test':
      return handleTest(admin, userId)
    default:
      return jsonResponse({ ok: false, error: 'unknown_action' }, 400)
  }
})
