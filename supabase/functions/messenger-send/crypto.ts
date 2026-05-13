/**
 * AES-256-GCM шифрование секретов мессенджер-интеграций.
 * Shared с messenger-connect (env MESSENGER_SECRETS_KEY).
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

export async function decryptSecret(payload: string): Promise<string> {
  const key = await getKey()
  const all = base64ToBytes(payload)
  if (all.length < 12 + 16) throw new Error('encrypted payload too short')
  const iv = all.slice(0, 12)
  const ct = all.slice(12)
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct)
  return new TextDecoder().decode(pt)
}
