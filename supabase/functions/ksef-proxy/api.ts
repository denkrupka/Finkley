/**
 * Клиент KSeF API 2.0 (Krajowy System e-Faktur).
 *
 * Источник: https://github.com/CIRFMF/ksef-api
 *
 * Auth flow (token-based):
 *   1) GET  /security/public-key-certificates → выбираем сертификат
 *      usage="KsefTokenEncryption" с самой свежей validFrom
 *   2) POST /auth/challenge (empty body) → { challenge, timestamp (ms) }
 *   3) Шифруем `<token>|<timestampMs>` через RSA-OAEP-SHA256 публичным
 *      ключом сертификата, base64
 *   4) POST /auth/ksef-token { challenge, encryptedToken, contextIdentifier,
 *      publicKeyId } → { authenticationToken.token (JWT), referenceNumber }
 *   5) POST /auth/token/redeem (Authorization: Bearer authenticationToken)
 *      → { accessToken, refreshToken }
 *   6) Все остальные запросы — Authorization: Bearer accessToken
 *   7) При 401 на accessToken — POST /auth/token/refresh (опц., оставлено
 *      на будущее, для cron-sync проще получить новую сессию)
 *
 * Invoice endpoints:
 *   POST /invoices/query/metadata — список фактур по фильтрам
 *   GET  /invoices/ksef/{ksefNumber} — скачать одну фактуру (XML)
 *
 * Замечание про парсинг XML фактур: в Deno нет нативного DOMParser. Вместо
 * полного парсинга используем regex-выборку нужных полей из FA(2). Это
 * хрупко по сравнению с XSD-валидатором, но достаточно для расхода
 * (нужны 5 полей: P_1 дата, P_15 sum, kontrahent, NIP, описание). При
 * расхождениях — sync пропускает фактуру и логирует.
 */

/**
 * KSeF API 2.0 — только prod environment (решение владельца 2026-05-11).
 * Тестовые/demo окружения не используем: у владельца реальные фирмы с
 * реальными фактурами, тестировать смысла нет.
 */
const PROD_BASE = 'https://api.ksef.mf.gov.pl'

function baseUrl(): string {
  return PROD_BASE
}

// =============================================================================
// Public types
// =============================================================================

export type KsefSession = {
  /** Bearer-JWT для последующих запросов */
  accessToken: string
  /** Refresh JWT (на будущее) */
  refreshToken: string | null
  /** referenceNumber аутентификации — для GET /auth/{ref} статуса */
  referenceNumber: string
}

export type KsefInvoiceListItem = {
  ksefReferenceNumber: string // wewnętrzny numer KSeF (UUID-like)
  invoiceNumber: string | null
  issueDate: string | null // ISO yyyy-mm-dd
  acquisitionDate: string | null
  sellerNip: string | null
  sellerName: string | null
  buyerNip: string | null
  totalGross: number | null // PLN
  currency: string
}

export type KsefError = {
  ok: false
  code: 'NETWORK' | 'AUTH' | 'CHALLENGE' | 'KEYGEN' | 'PARSE' | 'EMPTY' | 'HTTP'
  status?: number
  message?: string
}

// =============================================================================
// Dynamic public-key fetch + RSA-OAEP wrap
// =============================================================================

type PublicKeyCert = {
  publicKeyId: string
  certificate: string // base64 X.509 DER
  validFrom: string
  validTo: string
  usage: string[]
}

async function fetchEncryptionKey(): Promise<
  { ok: true; publicKeyId: string; cert: Uint8Array } | KsefError
> {
  try {
    const res = await fetch(`${baseUrl()}/security/public-key-certificates`, {
      headers: { Accept: 'application/json' },
    })
    if (!res.ok) {
      return { ok: false, code: 'KEYGEN', status: res.status, message: await res.text() }
    }
    const json = (await res.json()) as { publicKeyCertificates?: PublicKeyCert[] }
    const all = json.publicKeyCertificates ?? []
    const now = Date.now()
    const eligible = all
      .filter((k) => k.usage?.includes('KsefTokenEncryption'))
      .filter((k) => {
        const from = new Date(k.validFrom).getTime()
        const to = new Date(k.validTo).getTime()
        return isFinite(from) && isFinite(to) && from <= now && now <= to
      })
      .sort((a, b) => new Date(b.validFrom).getTime() - new Date(a.validFrom).getTime())
    const chosen = eligible[0]
    if (!chosen) {
      return { ok: false, code: 'KEYGEN', message: 'no_valid_encryption_cert' }
    }
    const certBytes = Uint8Array.from(atob(chosen.certificate), (c) => c.charCodeAt(0))
    return { ok: true, publicKeyId: chosen.publicKeyId, cert: certBytes }
  } catch (e) {
    return { ok: false, code: 'NETWORK', message: e instanceof Error ? e.message : String(e) }
  }
}

/**
 * Извлекает SubjectPublicKeyInfo (SPKI) из X.509 DER сертификата.
 * X.509 структура (упрощённо): TBSCertificate содержит subjectPublicKeyInfo
 * как SEQUENCE. Ищем последний SEQUENCE с BIT STRING внутри (это SPKI).
 *
 * Это минимальный ASN.1 walker — без полной библиотеки. WebCrypto в Deno
 * принимает SPKI напрямую, поэтому достаточно его выделить.
 */
function extractSpkiFromX509(der: Uint8Array): Uint8Array {
  // Идём от начала: SEQUENCE (cert) → SEQUENCE (tbsCertificate) → ...
  // Структура: tbsCertificate = version, serial, sigAlg, issuer, validity,
  //   subject, subjectPublicKeyInfo (SEQUENCE), ...
  // Подход: парсим toplevel SEQUENCE, заходим в tbsCertificate, проматываем
  // первые 6 полей, читаем 7-е — оно и есть SPKI SEQUENCE.

  let pos = 0
  // Helper: читает (tag, length, contentStart, totalLength)
  function readTLV(): { tag: number; length: number; valueStart: number; total: number } {
    const tag = der[pos]
    let p = pos + 1
    let length = der[p]
    let lengthOfLength = 1
    if (length & 0x80) {
      const n = length & 0x7f
      length = 0
      for (let i = 0; i < n; i++) {
        length = (length << 8) | der[p + 1 + i]
      }
      lengthOfLength = 1 + n
    }
    return { tag, length, valueStart: p + lengthOfLength, total: 1 + lengthOfLength + length }
  }

  // Outer SEQUENCE (Certificate)
  const outer = readTLV()
  if (outer.tag !== 0x30) throw new Error('not_x509_sequence')
  pos = outer.valueStart

  // Inner SEQUENCE (tbsCertificate)
  const tbs = readTLV()
  if (tbs.tag !== 0x30) throw new Error('not_tbs_sequence')
  const tbsEnd = pos + tbs.total
  pos = tbs.valueStart

  // Skip 6 fields внутри tbsCertificate: version([0]), serial, sigAlg, issuer,
  // validity, subject. SPKI — это 7-е поле.
  const skipCount = 6
  for (let i = 0; i < skipCount && pos < tbsEnd; i++) {
    const f = readTLV()
    pos += f.total
  }
  // Теперь pos указывает на SPKI SEQUENCE — возвращаем его полностью (с tag)
  const spki = readTLV()
  if (spki.tag !== 0x30) throw new Error('not_spki_sequence')
  return der.slice(pos, pos + spki.total)
}

async function encryptTokenWithCert(certDer: Uint8Array, plaintext: string): Promise<string> {
  const spki = extractSpkiFromX509(certDer)
  const key = await crypto.subtle.importKey(
    'spki',
    spki,
    { name: 'RSA-OAEP', hash: 'SHA-256' },
    false,
    ['encrypt'],
  )
  const enc = new TextEncoder().encode(plaintext)
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, key, enc))
  let s = ''
  for (const b of ct) s += String.fromCharCode(b)
  return btoa(s)
}

// =============================================================================
// Session open: challenge → ksef-token → redeem
// =============================================================================

async function authPostJson(
  path: string,
  bodyJson: unknown,
  bearer?: string,
): Promise<{ ok: true; data: unknown } | KsefError> {
  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    }
    if (bearer) headers.Authorization = `Bearer ${bearer}`
    const res = await fetch(`${baseUrl()}${path}`, {
      method: 'POST',
      headers,
      body: bodyJson == null ? undefined : JSON.stringify(bodyJson),
    })
    if (!res.ok) {
      const text = await res.text()
      return {
        ok: false,
        code: res.status === 401 ? 'AUTH' : 'HTTP',
        status: res.status,
        message: text.slice(0, 500),
      }
    }
    const data = await res.json()
    return { ok: true, data }
  } catch (e) {
    return { ok: false, code: 'NETWORK', message: e instanceof Error ? e.message : String(e) }
  }
}

export async function openSession(
  nip: string,
  token: string,
): Promise<{ ok: true; session: KsefSession } | KsefError> {
  if (!/^\d{10}$/.test(nip)) {
    return { ok: false, code: 'AUTH', message: 'invalid_nip_format' }
  }
  if (!token || token.length < 16) {
    return { ok: false, code: 'AUTH', message: 'invalid_token_format' }
  }

  // Step 1: fetch encryption cert
  const certRes = await fetchEncryptionKey()
  if (!certRes.ok) return certRes

  // Step 2: challenge
  const challengeRes = await authPostJson('/auth/challenge', null)
  if (!challengeRes.ok) {
    return { ...challengeRes, code: 'CHALLENGE' }
  }
  const ch = challengeRes.data as { challenge?: string; timestamp?: number | string }
  if (!ch.challenge || ch.timestamp == null) {
    return { ok: false, code: 'CHALLENGE', message: 'missing_challenge_or_timestamp' }
  }
  const timestampMs = typeof ch.timestamp === 'number' ? ch.timestamp : Number(ch.timestamp)
  if (!isFinite(timestampMs)) {
    return { ok: false, code: 'CHALLENGE', message: 'invalid_timestamp' }
  }

  // Step 3: encrypt `<token>|<timestampMs>`
  const plaintext = `${token}|${timestampMs}`
  let encryptedToken: string
  try {
    encryptedToken = await encryptTokenWithCert(certRes.cert, plaintext)
  } catch (e) {
    return {
      ok: false,
      code: 'KEYGEN',
      message: `encrypt_failed:${e instanceof Error ? e.message : String(e)}`,
    }
  }

  // Step 4: submit ksef-token
  const submitRes = await authPostJson('/auth/ksef-token', {
    challenge: ch.challenge,
    encryptedToken,
    contextIdentifier: { type: 'nip', value: nip },
    publicKeyId: certRes.publicKeyId,
    authorizationPolicy: null,
  })
  if (!submitRes.ok) return submitRes
  const sub = submitRes.data as {
    authenticationToken?: { token?: string }
    referenceNumber?: string
  }
  const authToken = sub.authenticationToken?.token
  const referenceNumber = sub.referenceNumber
  if (!authToken || !referenceNumber) {
    return { ok: false, code: 'PARSE', message: 'missing_authentication_token' }
  }

  // Step 5: redeem authentication token → access/refresh
  const redeemRes = await authPostJson('/auth/token/redeem', null, authToken)
  if (!redeemRes.ok) return redeemRes
  const r = redeemRes.data as {
    accessToken?: { token?: string }
    refreshToken?: { token?: string }
  }
  const accessToken = typeof r.accessToken === 'string' ? r.accessToken : r.accessToken?.token
  const refreshToken =
    typeof r.refreshToken === 'string' ? r.refreshToken : (r.refreshToken?.token ?? null)
  if (!accessToken) {
    return { ok: false, code: 'PARSE', message: 'missing_access_token' }
  }
  return {
    ok: true,
    session: { accessToken, refreshToken, referenceNumber },
  }
}

export async function closeSession(accessToken: string): Promise<void> {
  try {
    await fetch(`${baseUrl()}/auth/token/revoke`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
    })
  } catch {
    // Best-effort
  }
}

// =============================================================================
// Query incoming invoices (subject2 = nabywca = наш салон)
// =============================================================================

export async function querySubjectInvoices(
  accessToken: string,
  opts: { dateFrom: string; dateTo: string; subjectType: 'subject1' | 'subject2' },
): Promise<{ ok: true; invoices: KsefInvoiceListItem[] } | KsefError> {
  // KSeF 2.0: POST /invoices/query/metadata, body содержит InvoiceQueryFilters.
  // pageOffset/pageSize в query string или в body — docs неявны; пробуем body.
  const body = {
    pageOffset: 0,
    pageSize: 100,
    invoiceQueryFilters: {
      subjectType: opts.subjectType === 'subject1' ? 'Subject1' : 'Subject2',
      dateRange: {
        dateType: 'Invoicing',
        from: `${opts.dateFrom}T00:00:00.000Z`,
        to: `${opts.dateTo}T23:59:59.999Z`,
      },
    },
  }
  try {
    const res = await fetch(`${baseUrl()}/invoices/query/metadata`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const text = await res.text()
      return {
        ok: false,
        code: res.status === 401 ? 'AUTH' : 'HTTP',
        status: res.status,
        message: text.slice(0, 500),
      }
    }
    const json = (await res.json()) as {
      invoiceHeaderList?: Array<Record<string, unknown>>
      invoices?: Array<Record<string, unknown>>
    }
    const list = json.invoiceHeaderList ?? json.invoices ?? []
    const invoices: KsefInvoiceListItem[] = list.map((row) => {
      const ksefNum =
        (typeof row.ksefNumber === 'string' ? row.ksefNumber : null) ??
        (typeof row.ksefReferenceNumber === 'string' ? row.ksefReferenceNumber : null) ??
        ''
      const seller = (row.subject1 ?? row.seller ?? {}) as Record<string, unknown>
      const buyer = (row.subject2 ?? row.buyer ?? {}) as Record<string, unknown>
      const sellerIdent = (seller.identifier ?? {}) as { identifier?: string }
      const buyerIdent = (buyer.identifier ?? {}) as { identifier?: string }
      const gross =
        typeof row.gross === 'number'
          ? row.gross
          : typeof row.gross === 'string'
            ? parseFloat(row.gross)
            : typeof row.totalGross === 'number'
              ? row.totalGross
              : null
      const issueDate =
        typeof row.invoicingDate === 'string'
          ? row.invoicingDate.slice(0, 10)
          : typeof row.issueDate === 'string'
            ? row.issueDate.slice(0, 10)
            : null
      const acquisitionDate =
        typeof row.acquisitionTimestamp === 'string' ? row.acquisitionTimestamp.slice(0, 10) : null
      return {
        ksefReferenceNumber: ksefNum,
        invoiceNumber: typeof row.invoiceNumber === 'string' ? row.invoiceNumber : null,
        issueDate,
        acquisitionDate,
        sellerNip: sellerIdent.identifier ?? null,
        sellerName: typeof seller.name === 'string' ? seller.name : null,
        buyerNip: buyerIdent.identifier ?? null,
        totalGross: typeof gross === 'number' && isFinite(gross) ? gross : null,
        currency: typeof row.currency === 'string' ? row.currency.toUpperCase() : 'PLN',
      }
    })
    return { ok: true, invoices: invoices.filter((i) => !!i.ksefReferenceNumber) }
  } catch (e) {
    return { ok: false, code: 'NETWORK', message: e instanceof Error ? e.message : String(e) }
  }
}

// =============================================================================
// Download single invoice (XML)
// =============================================================================

export async function getInvoiceXml(
  accessToken: string,
  ksefReferenceNumber: string,
): Promise<{ ok: true; bytes: Uint8Array } | KsefError> {
  try {
    const res = await fetch(
      `${baseUrl()}/invoices/ksef/${encodeURIComponent(ksefReferenceNumber)}`,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/octet-stream, application/xml, application/json',
        },
      },
    )
    if (!res.ok) {
      const text = await res.text()
      return { ok: false, code: 'HTTP', status: res.status, message: text.slice(0, 200) }
    }
    const buf = new Uint8Array(await res.arrayBuffer())
    if (buf.byteLength === 0) return { ok: false, code: 'EMPTY' }
    return { ok: true, bytes: buf }
  } catch (e) {
    return { ok: false, code: 'NETWORK', message: e instanceof Error ? e.message : String(e) }
  }
}

/**
 * Best-effort парсер FA(2) XML — достаёт основные поля без полного XSD.
 * Возвращает null если XML не похож на фактуру.
 */
export function parseInvoiceXml(xmlBytes: Uint8Array): {
  totalGross: number | null
  issueDate: string | null
  invoiceNumber: string | null
  sellerNip: string | null
  sellerName: string | null
  buyerNip: string | null
  description: string | null
} | null {
  const xml = new TextDecoder('utf-8').decode(xmlBytes)
  if (!xml.includes('<Faktura') && !xml.includes(':Faktura')) return null

  const grab = (re: RegExp): string | null => {
    const m = xml.match(re)
    return m ? m[1].trim() : null
  }
  const grossStr = grab(/<P_15[^>]*>([^<]+)<\/P_15>/)
  const issueDate = grab(/<P_1[^>]*>([^<]+)<\/P_1>/)
  const invoiceNumber = grab(/<P_2[^>]*>([^<]+)<\/P_2>/)
  const seller = xml.match(/<Podmiot1>[\s\S]*?<\/Podmiot1>/)?.[0] ?? ''
  const buyer = xml.match(/<Podmiot2>[\s\S]*?<\/Podmiot2>/)?.[0] ?? ''
  const sellerNip = seller.match(/<NIP[^>]*>([^<]+)<\/NIP>/)?.[1] ?? null
  const sellerName = seller.match(/<Nazwa[^>]*>([^<]+)<\/Nazwa>/)?.[1] ?? null
  const buyerNip = buyer.match(/<NIP[^>]*>([^<]+)<\/NIP>/)?.[1] ?? null
  const description = grab(/<P_7[^>]*>([^<]+)<\/P_7>/)

  const gross = grossStr ? parseFloat(grossStr) : null

  return {
    totalGross: isFinite(gross ?? NaN) ? gross : null,
    issueDate: issueDate ? issueDate.slice(0, 10) : null,
    invoiceNumber,
    sellerNip,
    sellerName,
    buyerNip,
    description,
  }
}
