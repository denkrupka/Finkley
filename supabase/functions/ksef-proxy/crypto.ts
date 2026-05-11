/**
 * AES-256-GCM шифрование KSeF-токенов (см. ADR-013 §C).
 *
 * KSeF authentication token из «Mój KSeF» — долгоживущий (90+ дней), даёт
 * чтение фактур юзера. Шифруется тем же паттерном, что wFirma secret_key
 * (ADR-011), но **отдельным** ключом — изоляция compromise.
 *
 * Format: base64(iv ‖ ciphertext_with_auth_tag)
 *   - iv: 12 random bytes
 *   - ciphertext_with_auth_tag: WebCrypto клеит 16-байтный GCM tag в конец
 */

const KEY_NAME = 'KSEF_SECRETS_KEY'

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

function bytesToBase64(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s)
}

function base64ToBytes(s: string): Uint8Array {
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0))
}

export async function encryptSecret(plaintext: string): Promise<string> {
  const key = await getKey()
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const enc = new TextEncoder().encode(plaintext)
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc))
  const out = new Uint8Array(iv.length + ct.length)
  out.set(iv, 0)
  out.set(ct, iv.length)
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
