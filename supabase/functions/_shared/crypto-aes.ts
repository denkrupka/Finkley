/**
 * AES-256-GCM encrypt/decrypt для access tokens мессенджер-интеграций.
 * Общий модуль для edge functions: messenger-meta-webhook, messenger-send,
 * instagram-oauth-callback, fb-oauth-callback.
 *
 * Env: MESSENGER_SECRETS_KEY — 32 байта base64.
 * Формат payload (base64): IV(12) || ciphertext || tag(16).
 */

const KEY_NAME = 'MESSENGER_SECRETS_KEY'

let cachedKey: CryptoKey | null = null

async function getKey(): Promise<CryptoKey> {
  if (cachedKey) return cachedKey
  const raw = Deno.env.get(KEY_NAME)
  if (!raw) throw new Error(`${KEY_NAME} env var not set`)
  const bin = Uint8Array.from(atob(raw), (c) => c.charCodeAt(0))
  if (bin.length !== 32) {
    throw new Error(`${KEY_NAME} must decode to 32 bytes (got ${bin.length})`)
  }
  cachedKey = await crypto.subtle.importKey('raw', bin, { name: 'AES-GCM' }, false, [
    'encrypt',
    'decrypt',
  ])
  return cachedKey
}

function base64ToBytes(s: string): Uint8Array {
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0))
}

function bytesToBase64(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s)
}

export async function encryptSecret(plaintext: string): Promise<string> {
  const key = await getKey()
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(plaintext),
  )
  const out = new Uint8Array(iv.length + ct.byteLength)
  out.set(iv, 0)
  out.set(new Uint8Array(ct), iv.length)
  return bytesToBase64(out)
}

export async function decryptSecret(payload: string): Promise<string> {
  const key = await getKey()
  const all = base64ToBytes(payload)
  if (all.length < 12 + 16) throw new Error('encrypted payload too short')
  const iv = all.slice(0, 12)
  const ct = all.slice(12)
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct)
  return new TextDecoder().decode(pt)
}
