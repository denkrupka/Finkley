/**
 * Web Push helper для edge functions — переиспользует логику send-push
 * (VAPID JWT + RFC 8291 aes128gcm encryption + RFC 8188 framing).
 *
 * Используется в payment-reminders / daily-notifications и т.д. чтобы
 * слать push не только из юзерского клика, но и из cron-обработчиков.
 *
 * ENV: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT.
 */

const VAPID_PUB = Deno.env.get('VAPID_PUBLIC_KEY') ?? ''
const VAPID_PRIV = Deno.env.get('VAPID_PRIVATE_KEY') ?? ''
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:support@finkley.app'

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

async function importVapidPrivateKey(): Promise<CryptoKey> {
  const d = b64urlToBytes(VAPID_PRIV)
  const pub = b64urlToBytes(VAPID_PUB)
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
    exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
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
  return `${signingInput}.${bytesToB64url(new Uint8Array(sigDer))}`
}

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
): Promise<Uint8Array> {
  const enc = new TextEncoder()
  const serverKey = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
    'deriveBits',
  ])) as CryptoKeyPair
  const serverPubRaw = new Uint8Array(await crypto.subtle.exportKey('raw', serverKey.publicKey))
  const recipPub = b64urlToBytes(recipientP256dh)
  const recipKey = await crypto.subtle.importKey(
    'raw',
    recipPub,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  )
  const sharedBits = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: recipKey },
    serverKey.privateKey,
    256,
  )
  const ecdhSecret = new Uint8Array(sharedBits)
  const auth = b64urlToBytes(authSecret)
  const keyInfo = new Uint8Array([...enc.encode('WebPush: info\0'), ...recipPub, ...serverPubRaw])
  const ikm = await hkdfExtractExpand(ecdhSecret, auth, keyInfo, 32)
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
  const rs = 4096
  const header = new Uint8Array(16 + 4 + 1 + serverPubRaw.length)
  header.set(salt, 0)
  new DataView(header.buffer).setUint32(16, rs, false)
  header[20] = serverPubRaw.length
  header.set(serverPubRaw, 21)
  const plaintext = new Uint8Array(payload.length + 1)
  plaintext.set(enc.encode(payload), 0)
  plaintext[payload.length] = 0x02
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
  const body = new Uint8Array(header.length + ct.length)
  body.set(header, 0)
  body.set(ct, header.length)
  return body
}

export type PushSubscription = {
  endpoint: string
  p256dh: string
  auth_key: string
}

export type PushPayload = {
  title: string
  body: string
  url?: string
  tag?: string
  requireInteraction?: boolean
}

/**
 * Шлёт push одной подписке. Не бросает — возвращает ok+status+error.
 * Caller должен сам удалять мёртвые subscriptions (404/410).
 */
export async function sendOnePush(
  sub: PushSubscription,
  payload: PushPayload,
): Promise<{ ok: boolean; status: number; error?: string }> {
  if (!VAPID_PUB || !VAPID_PRIV) {
    return { ok: false, status: 0, error: 'vapid_not_configured' }
  }
  try {
    const url = new URL(sub.endpoint)
    const audience = `${url.protocol}//${url.host}`
    const jwt = await buildVapidJwt(audience)
    const body = await encryptPayload(JSON.stringify(payload), sub.p256dh, sub.auth_key)
    const res = await fetch(sub.endpoint, {
      method: 'POST',
      headers: {
        Authorization: `vapid t=${jwt}, k=${VAPID_PUB}`,
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        TTL: '86400',
        Urgency: 'normal',
      },
      body,
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      return { ok: false, status: res.status, error: text.slice(0, 200) }
    }
    return { ok: true, status: res.status }
  } catch (e) {
    return { ok: false, status: 0, error: e instanceof Error ? e.message : String(e) }
  }
}

/**
 * Шлёт push всем подпискам конкретного юзера. Удаляет мёртвые
 * (404/410) из БД. Возвращает счётчик доставленных.
 */
export async function sendPushToUser(
  admin: { from: (table: string) => any },
  userId: string,
  payload: PushPayload,
): Promise<number> {
  const { data: subs } = await admin
    .from('push_subscriptions')
    .select('endpoint, p256dh, auth_key')
    .eq('user_id', userId)
  if (!subs || subs.length === 0) return 0
  const results = await Promise.all(
    (subs as PushSubscription[]).map((s) => sendOnePush(s, payload)),
  )
  let delivered = 0
  for (let i = 0; i < results.length; i++) {
    const r = results[i]!
    if (r.ok) delivered++
    else if (r.status === 404 || r.status === 410) {
      // Мёртвая подписка — удаляем
      const sub = subs[i] as PushSubscription
      await admin.from('push_subscriptions').delete().eq('endpoint', sub.endpoint)
    }
  }
  return delivered
}
