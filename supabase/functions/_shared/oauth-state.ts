/**
 * OAuth state — HMAC-подпись + exp для one-shot токенов state в OAuth-флоу.
 * Используется в instagram-oauth-callback и fb-oauth-callback.
 *
 * Формат: base64url(payload).hex(hmac_sha256(payload, SECRET))
 * payload = JSON.stringify({ salon_id, user_id, nonce, exp })
 *
 * SECRET берётся из FUNCTION_INTERNAL_SECRET env (32 байта hex).
 */

const SECRET = Deno.env.get('FUNCTION_INTERNAL_SECRET') ?? ''

async function hmacSha256(key: string, msg: string): Promise<string> {
  const enc = new TextEncoder()
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  )
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, enc.encode(msg))
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

function base64UrlEncode(s: string): string {
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function base64UrlDecode(s: string): string {
  const pad = s.length % 4 === 2 ? '==' : s.length % 4 === 3 ? '=' : ''
  return atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad)
}

export type OAuthStatePayload = {
  salon_id: string
  user_id: string
  nonce: string
  exp: number
}

export async function signOAuthState(
  payload: Omit<OAuthStatePayload, 'nonce' | 'exp'>,
): Promise<string> {
  if (!SECRET) throw new Error('FUNCTION_INTERNAL_SECRET not set')
  const full: OAuthStatePayload = {
    ...payload,
    nonce: crypto.randomUUID(),
    exp: Math.floor(Date.now() / 1000) + 10 * 60,
  }
  const json = JSON.stringify(full)
  const b64 = base64UrlEncode(json)
  const sig = await hmacSha256(SECRET, b64)
  return `${b64}.${sig}`
}

export async function verifyOAuthState(state: string): Promise<OAuthStatePayload | null> {
  if (!SECRET) return null
  const parts = state.split('.')
  if (parts.length !== 2) return null
  const [b64, sig] = parts
  const expected = await hmacSha256(SECRET, b64)
  if (expected !== sig) return null
  try {
    const json = base64UrlDecode(b64)
    const payload = JSON.parse(json) as OAuthStatePayload
    if (!payload.salon_id || !payload.user_id || !payload.exp) return null
    if (payload.exp < Math.floor(Date.now() / 1000)) return null
    return payload
  } catch {
    return null
  }
}
