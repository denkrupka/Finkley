/**
 * Клиент KSeF API 2.0 (Krajowy System e-Faktur).
 *
 * Источник: https://github.com/CIRFMF/ksef-api
 *
 * Auth flow (token-based):
 *   1) GET  /api/v2/security/public-key-certificates → выбираем сертификат
 *      usage="KsefTokenEncryption" с самой свежей validFrom (на проде топ-левел
 *      массив, не объект с обёрткой)
 *   2) POST /api/v2/auth/challenge (empty body) → { challenge, timestamp (ms) }
 *   3) Шифруем `<token>|<timestampMs>` через RSA-OAEP-SHA256 публичным
 *      ключом сертификата, base64
 *   4) POST /api/v2/auth/ksef-token { challenge, encryptedToken, contextIdentifier }
 *      → { authenticationToken.token (JWT), referenceNumber }
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
 * Тестовые/demo окружения не используем.
 *
 * Базовый URL включает префикс `/api/v2` — реальные endpoints на проде
 * именно под ним (например, `/api/v2/security/public-key-certificates`),
 * хотя в docs на GitHub пути показаны без префикса.
 */
const PROD_BASE = 'https://api.ksef.mf.gov.pl/api/v2'

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
  certificate: string // base64 X.509 DER
  validFrom: string
  validTo: string
  usage: string[] | string
}

async function fetchEncryptionKey(): Promise<{ ok: true; cert: Uint8Array } | KsefError> {
  const url = `${baseUrl()}/security/public-key-certificates`
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json' } })
    if (!res.ok) {
      const body = await res.text()
      return {
        ok: false,
        code: 'KEYGEN',
        status: res.status,
        message: `HTTP ${res.status} from ${url}: ${body.slice(0, 200)}`,
      }
    }
    const raw = await res.json()
    // KSeF 2.0 prod возвращает top-level массив сертификатов.
    // На всякий случай поддерживаем и обёртку { publicKeyCertificates: [...] }.
    const all: PublicKeyCert[] = Array.isArray(raw)
      ? (raw as PublicKeyCert[])
      : (((raw as { publicKeyCertificates?: PublicKeyCert[] }).publicKeyCertificates ??
          []) as PublicKeyCert[])

    const now = Date.now()
    const eligible = all
      .filter((k) => {
        const u = k.usage as unknown
        if (typeof u === 'string') return u === 'KsefTokenEncryption'
        if (Array.isArray(u)) return u.includes('KsefTokenEncryption')
        return false
      })
      .filter((k) => {
        const from = new Date(k.validFrom).getTime()
        const to = new Date(k.validTo).getTime()
        return isFinite(from) && isFinite(to) && from <= now && now <= to
      })
      .sort((a, b) => new Date(b.validFrom).getTime() - new Date(a.validFrom).getTime())
    const chosen = eligible[0]
    if (!chosen) {
      return {
        ok: false,
        code: 'KEYGEN',
        message: `no_valid_encryption_cert (got ${all.length} certs from ${url})`,
      }
    }
    const certBytes = Uint8Array.from(atob(chosen.certificate), (c) => c.charCodeAt(0))
    return { ok: true, cert: certBytes }
  } catch (e) {
    return {
      ok: false,
      code: 'NETWORK',
      message: `${e instanceof Error ? e.message : String(e)} (url=${url})`,
    }
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
  const ch = challengeRes.data as {
    challenge?: string
    timestamp?: number | string
    timestampMs?: number | string
  }
  if (!ch.challenge) {
    return { ok: false, code: 'CHALLENGE', message: 'missing_challenge' }
  }
  // KSeF API 2.0 (на проде с 2026-05-21): timestamp — ISO-строка
  // ("2026-05-21T00:01:11.671+00:00"), а ms-эквивалент лежит отдельно
  // в timestampMs. Старый формат (timestamp как ms-число) тоже поддерживаем.
  let timestampMs: number = NaN
  if (typeof ch.timestampMs === 'number') timestampMs = ch.timestampMs
  else if (typeof ch.timestampMs === 'string') timestampMs = Number(ch.timestampMs)
  if (!isFinite(timestampMs) && ch.timestamp != null) {
    if (typeof ch.timestamp === 'number') timestampMs = ch.timestamp
    else if (/^\d+$/.test(ch.timestamp)) timestampMs = Number(ch.timestamp)
    else timestampMs = new Date(ch.timestamp).getTime()
  }
  if (!isFinite(timestampMs)) {
    return {
      ok: false,
      code: 'CHALLENGE',
      message: `invalid_timestamp:ts=${ch.timestamp}:tsMs=${ch.timestampMs}`,
    }
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

  // Step 4: submit ksef-token. publicKeyId не передаём — KSeF API 2.0 prod
  // не возвращает его в /security/public-key-certificates (только cert + usage
  // + validity). Сертификат сам по себе содержит идентификатор внутри.
  // Endpoint возвращает 202 Accepted — auth обрабатывается асинхронно.
  const submitRes = await authPostJson('/auth/ksef-token', {
    challenge: ch.challenge,
    encryptedToken,
    contextIdentifier: { type: 'nip', value: nip },
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

  // Step 4b: poll auth status — иначе redeem вернёт 400 «status 100».
  // KSeF меняет status 100 (in progress) → 200 (success) асинхронно.
  let authStatus: number | null = null
  for (let i = 0; i < 30; i++) {
    try {
      const stRes = await fetch(`${baseUrl()}/auth/${encodeURIComponent(referenceNumber)}`, {
        headers: { Authorization: `Bearer ${authToken}`, Accept: 'application/json' },
      })
      if (stRes.ok) {
        const stData = (await stRes.json()) as {
          status?: { code?: number; description?: string }
        }
        const code = stData.status?.code
        if (code === 200) {
          authStatus = 200
          break
        }
        if (typeof code === 'number' && code >= 400) {
          return {
            ok: false,
            code: 'AUTH',
            message: `auth_failed_status_${code}:${stData.status?.description ?? ''}`,
          }
        }
      }
    } catch {
      // network blip — retry
    }
    await new Promise((r) => setTimeout(r, 800))
  }
  if (authStatus !== 200) {
    return { ok: false, code: 'AUTH', message: 'auth_timeout_status_100' }
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
  opts: {
    dateFrom: string
    dateTo: string
    subjectType: 'subject1' | 'subject2'
    /** 'Invoicing' = по дате выставления, 'Acquisition' = по дате получения в KSeF (рекомендуется для импорта). */
    dateType?: 'Invoicing' | 'Acquisition'
  },
): Promise<{ ok: true; invoices: KsefInvoiceListItem[]; debug?: string[] } | KsefError> {
  // KSeF 2.0: POST /invoices/query/metadata. С 2026 фильтры на top-level
  // (не в обёртке invoiceQueryFilters): subjectType + dateRange прямо в body.
  // E2E проверено с реальным токеном — обёртка filters/invoiceQueryFilters
  // даёт 400 "filters.subjectType must not be empty".
  //
  // Owner-feedback 05.06: «есть новодобавленные фактуры в KSeF — не
  // затянуло». KSeF API не принимает 'Acquisition' ('Nieczytelna treść').
  // Документация называет enum InvoiceQueryDateType по-разному. Ретраим
  // несколько имён, дедупим по ksefNumber → так захватываем фактуры
  // независимо от того что серверу нравится сейчас.
  // Only 'Invoicing' is accepted by KSeF API right now. Acquisition /
  // PermanentStorage / Hidden return 400 'Nieczytelna treść' (unknown
  // enum value).
  const dateTypesToTry: string[] = opts.dateType ? [opts.dateType] : ['Invoicing']
  const allMap = new Map<string, Record<string, unknown>>()
  // 05.06: debug — собираем диагностику pagination что вернул KSeF
  // (видно через last_sync_stats.pagination_debug)
  const paginationDebug: string[] = []
  // Owner-feedback 05.06: api_returned=10 при том что в KSeF UI видно >20
  // фактур за окно. Корень — pagination сломана: я предполагал что
  // pageSize=100 даст max 100, но KSeF возвращает 10 на page (или меньше).
  // Старая логика `if (pageList.length < pageSize) break` останавливалась
  // после первой страницы → только 10 первых (старейших) фактур.
  // Фикс: continue пока pageList.length > 0, увеличиваем pageOffset на
  // фактическое pageList.length. Safety cap 200 страниц = 20000 фактур.
  const pageSize = 100
  let lastError: KsefError | null = null
  let anySuccess = false
  for (const dt of dateTypesToTry) {
    let pageOffset = 0
    let dtSuccess = false
    let pages = 0
    let emptyStreak = 0
    for (let i = 0; i < 200; i++) {
      pages++
      // CIRFMF/ksef-api docs: pageOffset/pageSize идут как URL query params,
      // НЕ в body. Body содержит только InvoiceQueryFilters. Также
      // указываем sortOrder=Desc чтобы новые фактуры (июнь) пришли первыми.
      const body = {
        subjectType: opts.subjectType === 'subject1' ? 'Subject1' : 'Subject2',
        dateRange: {
          dateType: dt,
          from: `${opts.dateFrom}T00:00:00.000Z`,
          to: `${opts.dateTo}T23:59:59.999Z`,
        },
      }
      try {
        const url = `${baseUrl()}/invoices/query/metadata?pageOffset=${pageOffset}&pageSize=${pageSize}&sortOrder=Desc`
        const res = await fetch(url, {
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
          if (res.status === 401) {
            return { ok: false, code: 'AUTH', status: res.status, message: text.slice(0, 500) }
          }
          if (!dtSuccess) {
            lastError = {
              ok: false,
              code: 'HTTP',
              status: res.status,
              message: `dateType=${dt}: ${text.slice(0, 400)}`,
            }
          }
          break // следующий dateType
        }
        dtSuccess = true
        anySuccess = true
        const json = (await res.json()) as {
          invoiceHeaderList?: Array<Record<string, unknown>>
          invoices?: Array<Record<string, unknown>>
          hasMore?: boolean
          totalCount?: number
          pagination?: Record<string, unknown>
        }
        const pageList = json.invoices ?? json.invoiceHeaderList ?? []
        // Capture top-level keys + pagination meta для диагностики
        if (paginationDebug.length < 5) {
          const topKeys = Object.keys(json).join(',')
          paginationDebug.push(
            `p${pages}(off=${pageOffset}): keys=${topKeys} count=${pageList.length} hasMore=${json.hasMore} total=${json.totalCount}`,
          )
        }
        if (pageList.length === 0) {
          emptyStreak++
          if (emptyStreak >= 2) break
          pageOffset += pageSize
          continue
        }
        emptyStreak = 0
        const beforeAdd = allMap.size
        for (const row of pageList) {
          const k =
            (typeof row.ksefNumber === 'string' ? row.ksefNumber : null) ??
            (typeof row.ksefReferenceNumber === 'string' ? row.ksefReferenceNumber : null) ??
            ''
          if (k && !allMap.has(k)) allMap.set(k, row)
        }
        const newAdded = allMap.size - beforeAdd
        // Если все возвращённые фактуры — дубликаты предыдущих страниц,
        // значит KSeF игнорирует pagination (отдаёт ту же страницу).
        // Также break если hasMore=false в response.
        if (newAdded === 0) break
        if (json.hasMore === false) break
        pageOffset += pageList.length
        // Bug 02.07: здесь стоял `pageNumber++` с необъявленной переменной —
        // ReferenceError улетал в catch ниже и обрывал пагинацию после
        // первой страницы (фактуры со 2-й страницы не импортировались).
      } catch (e) {
        if (!dtSuccess) {
          lastError = {
            ok: false,
            code: 'NETWORK',
            status: 0,
            message: e instanceof Error ? e.message : String(e),
          }
        }
        break
      }
    }
    void pages
    if (dtSuccess) {
      lastError = null
      break
    }
  }
  const allInvoices = Array.from(allMap.values())
  if (!anySuccess && allInvoices.length === 0 && lastError) return lastError
  // Передаём накопленный список в существующую обработку (не меняем mapping).
  try {
    const list = allInvoices
    const invoices: KsefInvoiceListItem[] = list.map((row) => {
      // Новый формат (2026+): seller/buyer прямо на корне с {nip, name} или
      // {identifier:{type, value}, name}. Legacy форматы (subject1/subject2)
      // на всякий случай поддерживаем как fallback.
      const ksefNum =
        (typeof row.ksefNumber === 'string' ? row.ksefNumber : null) ??
        (typeof row.ksefReferenceNumber === 'string' ? row.ksefReferenceNumber : null) ??
        ''
      const seller = (row.seller ?? row.subject1 ?? {}) as Record<string, unknown>
      const buyer = (row.buyer ?? row.subject2 ?? {}) as Record<string, unknown>
      const sellerIdent = (seller.identifier ?? {}) as { value?: string; identifier?: string }
      const buyerIdent = (buyer.identifier ?? {}) as { value?: string; identifier?: string }
      const sellerNip =
        (typeof seller.nip === 'string' ? seller.nip : null) ??
        sellerIdent.value ??
        sellerIdent.identifier ??
        null
      const buyerNip =
        (typeof buyer.nip === 'string' ? buyer.nip : null) ??
        buyerIdent.value ??
        buyerIdent.identifier ??
        null
      const gross =
        typeof row.grossAmount === 'number'
          ? row.grossAmount
          : typeof row.grossAmount === 'string'
            ? parseFloat(row.grossAmount)
            : typeof row.gross === 'number'
              ? row.gross
              : typeof row.gross === 'string'
                ? parseFloat(row.gross)
                : typeof row.totalGross === 'number'
                  ? row.totalGross
                  : null
      const issueDate =
        typeof row.issueDate === 'string'
          ? row.issueDate.slice(0, 10)
          : typeof row.invoicingDate === 'string'
            ? row.invoicingDate.slice(0, 10)
            : null
      const acquisitionDate =
        typeof row.acquisitionDate === 'string'
          ? row.acquisitionDate.slice(0, 10)
          : typeof row.acquisitionTimestamp === 'string'
            ? row.acquisitionTimestamp.slice(0, 10)
            : null
      return {
        ksefReferenceNumber: ksefNum,
        invoiceNumber: typeof row.invoiceNumber === 'string' ? row.invoiceNumber : null,
        issueDate,
        acquisitionDate,
        sellerNip,
        sellerName: typeof seller.name === 'string' ? seller.name : null,
        buyerNip,
        totalGross: typeof gross === 'number' && isFinite(gross) ? gross : null,
        currency: typeof row.currency === 'string' ? row.currency.toUpperCase() : 'PLN',
      }
    })
    return {
      ok: true,
      invoices: invoices.filter((i) => !!i.ksefReferenceNumber),
      debug: paginationDebug,
    }
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
  // KSeF rate limit для invoiceDownload: 8 req/s, 16 req/min, 64 req/h.
  // При 45 фактурах за один sync мы превышаем minute-limit → 429 для
  // большинства. Делаем retry с exponential backoff на 429 + ждём
  // 5 секунд между запросами (соблюдаем 16 req/min).
  const maxRetries = 3
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(
        `${baseUrl()}/invoices/ksef/${encodeURIComponent(ksefReferenceNumber)}`,
        {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: 'application/xml',
          },
        },
      )
      if (res.ok) {
        const buf = new Uint8Array(await res.arrayBuffer())
        if (buf.byteLength === 0) return { ok: false, code: 'EMPTY' }
        return { ok: true, bytes: buf }
      }
      // 429 = rate limit, retry с backoff. 21165 = «not yet available»,
      // retry тоже. Иначе fail.
      const text = await res.text()
      const isRateLimit = res.status === 429
      const isNotReady = res.status === 400 && text.includes('21165')
      if ((isRateLimit || isNotReady) && attempt < maxRetries) {
        const wait = 5000 * Math.pow(2, attempt) // 5s, 10s, 20s
        await new Promise((r) => setTimeout(r, wait))
        continue
      }
      return { ok: false, code: 'HTTP', status: res.status, message: text.slice(0, 200) }
    } catch (e) {
      if (attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, 5000))
        continue
      }
      return { ok: false, code: 'NETWORK', message: e instanceof Error ? e.message : String(e) }
    }
  }
  return { ok: false, code: 'HTTP', status: 0, message: 'retries exhausted' }
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
  /** Адрес продавца — для создания counterparty. */
  sellerAddress: string | null
  buyerNip: string | null
  /** Описание сводно — для legacy callers (P_7). */
  description: string | null
  /** Список позиций (P_7 каждой строки) — для UI «через запятую». */
  items: string[]
  /** IBAN счёта продавца (NrRBPL/NrRB в FA(2)/FA(1)). Для bulk-перевода. */
  sellerIban: string | null
  /** Форма оплаты: 1=gotówka, 2=karta, 3=przelew, 4=czek, 5=weksel, 6=kompensata. */
  paymentMethod: 'cash' | 'card' | 'transfer' | null
  /** Срок оплаты (TerminPlatnosci). YYYY-MM-DD. */
  paymentDeadline: string | null
  /** Дата оплаты (DataZaplaty) — если уже оплачена. YYYY-MM-DD. */
  paidAt: string | null
  /** Полностью оплачено? Проверяется по DataZaplaty / Zaplacono. */
  isPaid: boolean
  /** Преобладающая ставка VAT (%) из P_13_x/P_14_x. NULL если не извлечена. */
  vatRatePct: number | null
  /** Сумма нетто (PLN) по всем ставкам. NULL если не извлечена. */
  totalNet: number | null
} | null {
  const xml = new TextDecoder('utf-8').decode(xmlBytes)
  if (!xml.includes('<Faktura') && !xml.includes(':Faktura')) return null

  const grab = (re: RegExp): string | null => {
    const m = xml.match(re)
    return m ? m[1].trim() : null
  }
  // ISO 13616 mod-97 (зеркало apps/web/src/lib/banking/iban.ts isIbanValid).
  const isValidIban = (iban: string): boolean => {
    if (!/^[A-Z]{2}\d{2}[A-Z0-9]{1,30}$/.test(iban)) return false
    const rearranged = iban.slice(4) + iban.slice(0, 4)
    const digits = rearranged.replace(/[A-Z]/g, (ch) => String(ch.charCodeAt(0) - 55))
    let rem = 0
    for (const d of digits) rem = (rem * 10 + Number(d)) % 97
    return rem === 1
  }
  const grabAll = (re: RegExp): string[] => {
    const out: string[] = []
    let m: RegExpExecArray | null
    const r = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g')
    while ((m = r.exec(xml)) !== null) out.push(m[1].trim())
    return out
  }

  const grossStr = grab(/<P_15[^>]*>([^<]+)<\/P_15>/)
  const issueDate = grab(/<P_1[^>]*>([^<]+)<\/P_1>/)
  const invoiceNumber = grab(/<P_2[^>]*>([^<]+)<\/P_2>/)
  const seller = xml.match(/<Podmiot1>[\s\S]*?<\/Podmiot1>/)?.[0] ?? ''
  const buyer = xml.match(/<Podmiot2>[\s\S]*?<\/Podmiot2>/)?.[0] ?? ''
  const sellerNip = seller.match(/<NIP[^>]*>([^<]+)<\/NIP>/)?.[1] ?? null
  const sellerName = seller.match(/<Nazwa[^>]*>([^<]+)<\/Nazwa>/)?.[1] ?? null
  // Адрес продавца — собираем компоненты (улица, дом, город, индекс).
  const sellerAddressParts: string[] = []
  for (const tag of ['Ulica', 'NrDomu', 'NrLokalu', 'KodPocztowy', 'Miejscowosc']) {
    const m = seller.match(new RegExp(`<${tag}[^>]*>([^<]+)</${tag}>`))
    if (m) sellerAddressParts.push(m[1].trim())
  }
  // FA(2)/FA(3): адрес — свободные строки AdresL1/AdresL2 (структурных
  // Ulica/NrDomu в этих схемах нет). Без fallback'а контрагент создавался
  // без адреса — жалоба юзера 02.07.
  if (sellerAddressParts.length === 0) {
    for (const tag of ['AdresL1', 'AdresL2']) {
      const m = seller.match(new RegExp(`<${tag}[^>]*>([^<]+)</${tag}>`))
      if (m) sellerAddressParts.push(m[1].trim())
    }
  }
  const sellerAddress = sellerAddressParts.length > 0 ? sellerAddressParts.join(', ') : null
  const buyerNip = buyer.match(/<NIP[^>]*>([^<]+)<\/NIP>/)?.[1] ?? null
  const description = grab(/<P_7[^>]*>([^<]+)<\/P_7>/)

  // Позиции (line items) — каждая <FaWiersz> содержит <P_7>. Собираем все.
  const lineItems: string[] = []
  const wierszRe = /<FaWiersz>[\s\S]*?<\/FaWiersz>/g
  let wm: RegExpExecArray | null
  while ((wm = wierszRe.exec(xml)) !== null) {
    const name = wm[0].match(/<P_7[^>]*>([^<]+)<\/P_7>/)?.[1]?.trim()
    if (name) lineItems.push(name)
  }
  const items = lineItems.length > 0 ? lineItems : description ? [description] : []

  // KSeF FA(2): счета продавца. NrRBPL для PL, NrRB как fallback.
  const ibanMatch =
    xml.match(/<NrRBPL[^>]*>([^<]+)<\/NrRBPL>/)?.[1] ??
    xml.match(/<NrRB[^>]*>([^<]+)<\/NrRB>/)?.[1] ??
    null
  // Нормализация: KSeF обычно отдаёт голый 26-значный NRB без 'PL', а
  // колонки bank_account_iban ожидают полный IBAN (isIbanValid в
  // BankExportDialog и elixir-o отвергают NRB без префикса — платёж
  // помечался бы «(нет IBAN)»). Невалидный счёт не пишем вовсе: patch
  // контрагента заполняет только ПУСТОЕ поле, самовосстановления нет.
  let sellerIban: string | null = ibanMatch
    ? ibanMatch.trim().replace(/\s+/g, '').toUpperCase()
    : null
  if (sellerIban && /^\d{26}$/.test(sellerIban)) sellerIban = 'PL' + sellerIban
  if (sellerIban && !isValidIban(sellerIban)) sellerIban = null

  // VAT-извлечение. KSeF FA(2) хранит суммы по ставкам в P_13_x/P_14_x:
  //   P_13_1 — суммарная netто по ставке podstawowa (23%)
  //   P_14_1 — суммарный VAT по ставке podstawowa
  //   P_13_2 — netто по obniżona1 (8%), P_14_2 — VAT
  //   P_13_3 — netто по obniżona2 (5%), P_14_3 — VAT
  //   P_13_6 — netто по zwolnione/0%
  // Если в фактуре одна ставка — берём её. Если несколько — преобладающую
  // по netto (для UI это всё равно один rate в expense.vat_rate_pct).
  const rateMap: Record<string, number> = {
    P_13_1: 23,
    P_13_2: 8,
    P_13_3: 5,
    P_13_4: 0,
    P_13_6: 0,
  }
  let dominantNet = 0
  let dominantRate: number | null = null
  let totalNet = 0
  for (const [tag, rate] of Object.entries(rateMap)) {
    const m = xml.match(new RegExp(`<${tag}[^>]*>([^<]+)</${tag}>`))
    if (!m) continue
    const v = parseFloat(m[1].trim())
    if (!isFinite(v) || v <= 0) continue
    totalNet += v
    if (v > dominantNet) {
      dominantNet = v
      dominantRate = rate
    }
  }
  // Fallback: если P_13_x не нашлись, считаем effective rate от total.
  if (dominantRate === null && grossStr) {
    const gross = parseFloat(grossStr)
    if (isFinite(gross) && gross > 0) {
      // Эвристика: пробуем стандартные ставки, ищем целочисленное net
      for (const r of [23, 8, 5, 0]) {
        const candidate = gross / (1 + r / 100)
        if (Math.abs(candidate - Math.round(candidate * 100) / 100) < 0.01) {
          dominantRate = r
          totalNet = Math.round(candidate * 100) / 100
          break
        }
      }
    }
  }

  // FormaPlatnosci: KSeF код 1..6. Маппим в наш payment_method.
  const formaCode = grab(/<FormaPlatnosci[^>]*>([^<]+)<\/FormaPlatnosci>/)
  let paymentMethod: 'cash' | 'card' | 'transfer' | null = null
  if (formaCode === '1') paymentMethod = 'cash'
  else if (formaCode === '2') paymentMethod = 'card'
  else if (formaCode === '3' || formaCode === '6') paymentMethod = 'transfer'

  // FA(2)/FA(3): TerminPlatnosci — сложный узел с дочерним <Termin> (дата).
  // Старый regex ([^<]+ сразу после тега) на таких фактурах не матчился и
  // срок оплаты терялся. Берём <Termin> (точное имя тега, не TerminPlatnosci)
  // с fallback на legacy-вариант «дата текстом прямо в TerminPlatnosci».
  const paymentDeadline =
    grab(/<Termin(?:\s[^>]*)?>([^<]+)<\/Termin>/) ??
    grab(/<TerminPlatnosci(?:\s[^>]*)?>([^<]+)<\/TerminPlatnosci>/)
  // KSeF: <Zaplacono>1</Zaplacono> или наличие <DataZaplaty>YYYY-MM-DD</DataZaplaty>
  // ⇒ фактура оплачена.
  const paidAt = grab(/<DataZaplaty[^>]*>([^<]+)<\/DataZaplaty>/)
  const zaplacono = grab(/<Zaplacono[^>]*>([^<]+)<\/Zaplacono>/)
  const isPaid = !!paidAt || zaplacono === '1' || zaplacono?.toLowerCase() === 'true'

  void grabAll // используется только если в будущем нужны множественные tags

  const gross = grossStr ? parseFloat(grossStr) : null

  return {
    totalGross: isFinite(gross ?? NaN) ? gross : null,
    issueDate: issueDate ? issueDate.slice(0, 10) : null,
    invoiceNumber,
    sellerNip,
    sellerName,
    sellerAddress,
    buyerNip,
    description,
    items,
    sellerIban,
    paymentMethod,
    paymentDeadline: paymentDeadline ? paymentDeadline.slice(0, 10) : null,
    paidAt: paidAt ? paidAt.slice(0, 10) : null,
    isPaid,
    vatRatePct: dominantRate,
    totalNet: totalNet > 0 ? totalNet : null,
  }
}
