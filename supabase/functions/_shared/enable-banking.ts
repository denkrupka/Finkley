/**
 * Клиент для Enable Banking API (PSD2 AIS).
 *
 * Auth: каждый запрос подписан JWT (RS256), который мы генерим сами с
 * помощью RSA private key (выдан EB при регистрации приложения). EB
 * валидирует подпись по public key, который мы загрузили в их dashboard
 * (не наш вопрос — это owner делал руками при регистрации).
 *
 * Базовая инфа:
 *   API base:        https://api.enablebanking.com
 *   Auth scheme:     Authorization: Bearer <signed_jwt>
 *   Algorithm:       RS256 (RSA-PKCS1-v1_5 + SHA-256)
 *   Header:          { alg: "RS256", kid: APPLICATION_ID, typ: "JWT" }
 *   Claims:          { iss: "enablebanking.com", aud: "api.enablebanking.com",
 *                      exp, iat }
 *
 * Доки: https://enablebanking.com/docs/api/reference/
 *
 * ENV в edge functions:
 *   ENABLE_BANKING_APP_ID       — UUID приложения
 *   ENABLE_BANKING_PRIVATE_KEY  — содержимое .pem (PKCS#8 или PKCS#1)
 *   ENABLE_BANKING_REDIRECT_URL — куда EB редиректит после bank-auth.
 *                                  Должен ТОЧНО совпадать с тем, что
 *                                  зарегистрировано в Enable Banking dashboard.
 *                                  Сейчас в EB whitelist:
 *                                  https://finkley.app/banking/callback
 *                                  (bridge в public/404.html переадресует на
 *                                  SPA /app/banking/callback).
 */

const EB_API = 'https://api.enablebanking.com'
const EB_AUDIENCE = 'api.enablebanking.com'
const EB_ISSUER = 'enablebanking.com'

// =============================================================================
// JWT signing
// =============================================================================

function base64UrlEncode(input: ArrayBuffer | Uint8Array | string): string {
  let bytes: Uint8Array
  if (typeof input === 'string') {
    bytes = new TextEncoder().encode(input)
  } else if (input instanceof ArrayBuffer) {
    bytes = new Uint8Array(input)
  } else {
    bytes = input
  }
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!)
  return btoa(bin).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')
}

function pemToArrayBuffer(pem: string): ArrayBuffer {
  // Поддерживаем как PKCS#8 ("BEGIN PRIVATE KEY"), так и PKCS#1
  // ("BEGIN RSA PRIVATE KEY"). WebCrypto принимает только PKCS#8 при
  // importKey('pkcs8'); для PKCS#1 потребуется конвертация (см. ниже).
  const stripped = pem
    .replace(/-----BEGIN [^-]+-----/g, '')
    .replace(/-----END [^-]+-----/g, '')
    .replace(/\s+/g, '')
  const bin = atob(stripped)
  const buf = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i)
  return buf.buffer
}

function isPkcs1(pem: string): boolean {
  return pem.includes('BEGIN RSA PRIVATE KEY')
}

/**
 * Конвертирует PKCS#1 RSAPrivateKey ASN.1 в PKCS#8 PrivateKeyInfo.
 * Делается путём оборачивания PKCS#1 в дополнительный SEQUENCE с
 * AlgorithmIdentifier (1.2.840.113549.1.1.1, NULL params). WebCrypto
 * Deno (как и в браузере) не поддерживает PKCS#1 напрямую — только PKCS#8.
 */
function pkcs1ToPkcs8(pkcs1: ArrayBuffer): ArrayBuffer {
  // PKCS#8 PrivateKeyInfo:
  //   SEQUENCE {
  //     INTEGER 0  (version)
  //     SEQUENCE { OID 1.2.840.113549.1.1.1, NULL }  (algorithm)
  //     OCTET STRING { <pkcs1 content> }             (privateKey)
  //   }
  const pkcs1Bytes = new Uint8Array(pkcs1)
  // pre-вычисленная статичная преамбула для rsaEncryption + version 0:
  //   30 LEN  -- OUTER SEQUENCE
  //   02 01 00 -- INTEGER 0
  //   30 0D 06 09 2A 86 48 86 F7 0D 01 01 01 05 00 -- ALG SEQUENCE
  //   04 LEN <pkcs1>  -- OCTET STRING wrapping pkcs1
  const algId = new Uint8Array([
    0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00,
  ])
  const version = new Uint8Array([0x02, 0x01, 0x00])

  // Нужно префиксы длины OCTET STRING + OUTER SEQUENCE
  function asn1Length(n: number): Uint8Array {
    if (n < 0x80) return new Uint8Array([n])
    if (n < 0x100) return new Uint8Array([0x81, n])
    if (n < 0x10000) return new Uint8Array([0x82, (n >> 8) & 0xff, n & 0xff])
    return new Uint8Array([0x83, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff])
  }

  const octetLen = asn1Length(pkcs1Bytes.length)
  const octetHeader = new Uint8Array([0x04, ...octetLen])
  const inner = new Uint8Array(
    version.length + algId.length + octetHeader.length + pkcs1Bytes.length,
  )
  let off = 0
  inner.set(version, off)
  off += version.length
  inner.set(algId, off)
  off += algId.length
  inner.set(octetHeader, off)
  off += octetHeader.length
  inner.set(pkcs1Bytes, off)

  const outerLen = asn1Length(inner.length)
  const outer = new Uint8Array(1 + outerLen.length + inner.length)
  outer[0] = 0x30
  outer.set(outerLen, 1)
  outer.set(inner, 1 + outerLen.length)
  return outer.buffer
}

let cachedKey: CryptoKey | null = null
async function importKey(pem: string): Promise<CryptoKey> {
  if (cachedKey) return cachedKey
  let buf = pemToArrayBuffer(pem)
  if (isPkcs1(pem)) buf = pkcs1ToPkcs8(buf)
  cachedKey = await crypto.subtle.importKey(
    'pkcs8',
    buf,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  return cachedKey
}

export async function signEnableBankingJwt(
  appId: string,
  privateKeyPem: string,
  ttlSeconds = 3600,
): Promise<string> {
  const header = { alg: 'RS256', kid: appId, typ: 'JWT' }
  const now = Math.floor(Date.now() / 1000)
  const payload = {
    iss: EB_ISSUER,
    aud: EB_AUDIENCE,
    exp: now + ttlSeconds,
    iat: now,
  }
  const encHeader = base64UrlEncode(JSON.stringify(header))
  const encPayload = base64UrlEncode(JSON.stringify(payload))
  const signingInput = `${encHeader}.${encPayload}`

  const key = await importKey(privateKeyPem)
  const sig = await crypto.subtle.sign(
    { name: 'RSASSA-PKCS1-v1_5' },
    key,
    new TextEncoder().encode(signingInput),
  )
  return `${signingInput}.${base64UrlEncode(sig)}`
}

// =============================================================================
// HTTP client
// =============================================================================

export type EbConfig = {
  appId: string
  privateKeyPem: string
}

export class EbApiError extends Error {
  status: number
  body: string
  constructor(status: number, body: string) {
    super(`Enable Banking ${status}: ${body.slice(0, 200)}`)
    this.status = status
    this.body = body
  }
}

async function ebFetch<T = unknown>(
  cfg: EbConfig,
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<T> {
  const jwt = await signEnableBankingJwt(cfg.appId, cfg.privateKeyPem)
  const res = await fetch(`${EB_API}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${jwt}`,
      'content-type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  if (!res.ok) throw new EbApiError(res.status, text)
  if (!text) return {} as T
  try {
    return JSON.parse(text) as T
  } catch {
    return text as unknown as T
  }
}

// =============================================================================
// Доменные обёртки
// =============================================================================

/**
 * Стартовать auth-сессию: возвращает url, на который нужно редиректнуть юзера.
 * После авторизации в банке EB сделает редирект на наш `redirect_url`
 * с параметром `?code=...`, который мы обмениваем через `createSession`.
 */
export async function createAuth(
  cfg: EbConfig,
  input: {
    aspspName: string // "Bank Millennium"
    aspspCountry: string // "PL"
    redirectUrl: string // https://finkley.app/banking/callback (bridge → /app/...)
    state?: string // CSRF-стейт; вернётся как ?state=… к нам
    psuType?: 'business' | 'personal'
    validUntil?: string // ISO datetime, до 180 дней
  },
): Promise<{ url: string; auth_id: string }> {
  return await ebFetch<{ url: string; auth_id: string }>(cfg, 'POST', '/auth', {
    access: {
      valid_until:
        input.validUntil ?? new Date(Date.now() + 180 * 24 * 60 * 60 * 1000).toISOString(),
    },
    aspsp: { name: input.aspspName, country: input.aspspCountry },
    state: input.state ?? crypto.randomUUID(),
    redirect_url: input.redirectUrl,
    psu_type: input.psuType ?? 'business',
  })
}

/** Обменять `code` (получен в callback после bank-auth) на session. */
export async function createSession(
  cfg: EbConfig,
  code: string,
): Promise<{
  session_id: string
  access: { valid_until: string }
  accounts: Array<{
    uid: string
    account_id?: { iban?: string; other?: { identification?: string } }
    name?: string
    currency?: string
    product?: string
  }>
  aspsp: { name: string; country: string }
}> {
  return await ebFetch(cfg, 'POST', '/sessions', { code })
}

/** Получить текущее состояние сессии (для проверки validity). */
export async function getSession(
  cfg: EbConfig,
  sessionId: string,
): Promise<{
  session_id: string
  status: string
  access: { valid_until: string }
  accounts: Array<{ uid: string; account_id?: { iban?: string }; name?: string; currency?: string }>
}> {
  return await ebFetch(cfg, 'GET', `/sessions/${sessionId}`)
}

/** Удалить сессию (revoke consent). */
export async function deleteSession(cfg: EbConfig, sessionId: string): Promise<void> {
  await ebFetch(cfg, 'DELETE', `/sessions/${sessionId}`)
}

/**
 * Транзакции по аккаунту. EB API пагинирует через `continuation_key`.
 * Возвращаем ВСЕ страницы сложенные в один массив (вызывающая сторона
 * сама контролирует range через date_from/date_to).
 */
export type EbTransaction = {
  entry_reference?: string
  transaction_id?: string
  // Сумма со знаком: для расходов — отрицательное число (EB возвращает строкой)
  transaction_amount: { amount: string; currency: string }
  credit_debit_indicator: 'CRDT' | 'DBIT'
  status: 'BOOK' | 'PDNG' | string
  booking_date?: string // YYYY-MM-DD
  value_date?: string
  transaction_date?: string
  remittance_information?: string[]
  creditor?: { name?: string }
  debtor?: { name?: string }
  remittance_information_unstructured?: string
}

export async function listTransactions(
  cfg: EbConfig,
  accountId: string,
  range: { dateFrom: string; dateTo?: string },
): Promise<EbTransaction[]> {
  const all: EbTransaction[] = []
  let continuation: string | null = null
  for (let page = 0; page < 50; page++) {
    const qs = new URLSearchParams()
    qs.set('date_from', range.dateFrom)
    if (range.dateTo) qs.set('date_to', range.dateTo)
    // strategy='all' включает booked + pending (PDNG). Дальше banking-sync
    // фильтрует BOOK для записи в bank_transactions, а pending'и считает —
    // чтобы UI мог показать «N транзакций ещё не подтверждены банком».
    // Раньше было 'default' (только booked), из-за чего юзер не видел даже
    // намёка на свежее поступление, и думал что синк сломан.
    qs.set('strategy', 'all')
    if (continuation) qs.set('continuation_key', continuation)
    const data = await ebFetch<{
      transactions: EbTransaction[]
      continuation_key?: string | null
    }>(cfg, 'GET', `/accounts/${accountId}/transactions?${qs.toString()}`)
    all.push(...(data.transactions ?? []))
    if (!data.continuation_key) break
    continuation = data.continuation_key
  }
  return all
}

/**
 * Хелпер для парсинга суммы EB. Возвращает amount_cents (положительный)
 * и type ('debit'/'credit'). EB возвращает amount как string ("123.45")
 * и indicator отдельно.
 */
export function parseAmount(tx: EbTransaction): { amountCents: number; type: 'debit' | 'credit' } {
  const raw = tx.transaction_amount.amount
  // Иногда сумма приходит со знаком ('-123.45'), иногда без — берём abs.
  const num = Math.abs(Number(raw))
  const cents = Math.round(num * 100)
  const type = tx.credit_debit_indicator === 'CRDT' ? 'credit' : 'debit'
  return { amountCents: cents, type }
}

export function transactionDate(tx: EbTransaction): string {
  return (
    tx.booking_date ?? tx.transaction_date ?? tx.value_date ?? new Date().toISOString().slice(0, 10)
  )
}

export function transactionExternalId(tx: EbTransaction): string {
  // Предпочитаем стабильные id; иначе хеш по дате+сумме+описанию.
  if (tx.transaction_id) return tx.transaction_id
  if (tx.entry_reference) return tx.entry_reference
  const bits = [
    transactionDate(tx),
    tx.transaction_amount.amount,
    tx.transaction_amount.currency,
    tx.credit_debit_indicator,
    (tx.remittance_information ?? []).join('|'),
    tx.remittance_information_unstructured ?? '',
    tx.creditor?.name ?? '',
    tx.debtor?.name ?? '',
  ].join('::')
  // Простой синхронный хеш (FNV-1a 64bit-ish). Этого достаточно для unique
  // dedupe в рамках одного аккаунта; коллизии на 2-3 годах истории крайне
  // маловероятны. Криптостойкость не требуется.
  let h1 = 0x811c9dc5
  let h2 = 0x9e3779b9
  for (let i = 0; i < bits.length; i++) {
    const c = bits.charCodeAt(i)
    h1 = (h1 ^ c) >>> 0
    h1 = Math.imul(h1, 0x01000193) >>> 0
    h2 = (h2 ^ c) >>> 0
    h2 = Math.imul(h2, 0x85ebca6b) >>> 0
  }
  return `synth-${h1.toString(16)}${h2.toString(16)}`
}

export function transactionDescription(tx: EbTransaction): string {
  if (tx.remittance_information_unstructured) return tx.remittance_information_unstructured
  if (tx.remittance_information && tx.remittance_information.length > 0) {
    return tx.remittance_information.join(' ')
  }
  return tx.creditor?.name ?? tx.debtor?.name ?? ''
}

export function counterpartyName(tx: EbTransaction): string | null {
  if (tx.credit_debit_indicator === 'DBIT') return tx.creditor?.name ?? null
  return tx.debtor?.name ?? null
}
