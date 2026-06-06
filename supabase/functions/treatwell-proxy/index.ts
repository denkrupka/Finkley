/**
 * treatwell-proxy — интеграция с Treatwell Connect (https://connect.treatwell.de).
 *
 * Auth: cookie-based session. POST /api/authentication.json → Set-Cookie.
 *
 * Endpoints (из HAR `connect.treatwell.de.har`):
 *   POST /api/authentication.json
 *   GET  /api/extranet-settings.json                          — venueId
 *   GET  /api/venue/{venueId}/employees.json?active=true&takes-appointments=true
 *   GET  /api/venue/{venueId}/menu.json                       — offers (services)
 *   GET  /api/venue/{venueId}/customers.json?count=100&start=N
 *   GET  /api/venue/{venueId}/calendar.json?date=YYYY-MM-DD   — appointments по дню
 *
 * Credentials хранятся в `salon_integrations.credentials` (jsonb). RLS уже
 * запрещает чтение этой колонки клиенту, edge-функция читает через
 * service-role-key. Encryption — TODO в отдельной миграции через _shared/
 * crypto-helper (ADR-002), пока plaintext в credentials.
 *
 * Body:
 *   { action: 'connect',    salon_id, login, password }
 *   { action: 'sync',       salon_id, days?: number }  — sync staff/services/clients/visits
 *   { action: 'disconnect', salon_id }
 */

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'

import { corsHeaders, preflight } from '../_shared/cors.ts'
import { loadVatContext, vatFieldsForVisit } from '../_shared/vat.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const TREATWELL_BASE = Deno.env.get('TREATWELL_BASE') ?? 'https://connect.treatwell.de'
const CAPSOLVER_API_KEY = Deno.env.get('CAPSOLVER_API_KEY') ?? ''

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'content-type': 'application/json' },
  })
}

type AuthOk = { sessionCookies: string; venueId: string; supplierId?: string }

/** Извлекает значения Set-Cookie (Deno fetch объединяет в headers.get('set-cookie')) */
function extractCookies(setCookieHeader: string): string {
  // "JSESSIONID=abc; Path=/; HttpOnly, AWSALB=xyz; ..." → "JSESSIONID=abc; AWSALB=xyz"
  return setCookieHeader
    .split(/,(?=\s*[A-Za-z0-9_-]+=)/)
    .map((c) => c.split(';')[0]!.trim())
    .filter(Boolean)
    .join('; ')
}

/** Рекурсивный поиск числового поля по имени в произвольном JSON-объекте. */
function deepFindNumberField(obj: unknown, name: string): number | undefined {
  if (!obj || typeof obj !== 'object') return undefined
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (k === name && (typeof v === 'number' || (typeof v === 'string' && /^\d+$/.test(v)))) {
      return Number(v)
    }
    if (v && typeof v === 'object') {
      const found = deepFindNumberField(v, name)
      if (found !== undefined) return found
    }
  }
  return undefined
}

/**
 * Решает Cloudflare Turnstile через Capsolver.
 * Возвращает token (cf-turnstile-response value), который нужно
 * передать в body логина. null если решить не удалось.
 *
 * Capsolver type=AntiTurnstileTaskProxyLess работает для widget-режима
 * (зелёная капча "Успешно" в браузере). Для JS-challenge (cf_clearance
 * cookie) нужен AntiCloudflareTask + прокси — это отдельный сценарий.
 */
async function solveCloudflareTurnstile(pageUrl: string, siteKey: string): Promise<string | null> {
  if (!CAPSOLVER_API_KEY) return null
  try {
    // Создаём task
    const createR = await fetch('https://api.capsolver.com/createTask', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        clientKey: CAPSOLVER_API_KEY,
        task: {
          type: 'AntiTurnstileTaskProxyLess',
          websiteURL: pageUrl,
          websiteKey: siteKey,
        },
      }),
    })
    const createJson = (await createR.json()) as {
      taskId?: string
      errorId?: number
      errorDescription?: string
    }
    if (createJson.errorId || !createJson.taskId) {
      console.error('Capsolver createTask failed', createJson)
      return null
    }
    const taskId = createJson.taskId

    // Polling до 60 секунд (12 × 5s)
    for (let i = 0; i < 12; i++) {
      await new Promise((res) => setTimeout(res, 5000))
      const r = await fetch('https://api.capsolver.com/getTaskResult', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ clientKey: CAPSOLVER_API_KEY, taskId }),
      })
      const j = (await r.json()) as {
        status?: 'processing' | 'ready'
        solution?: { token?: string }
        errorId?: number
        errorDescription?: string
      }
      if (j.errorId) {
        console.error('Capsolver getTaskResult failed', j)
        return null
      }
      if (j.status === 'ready' && j.solution?.token) return j.solution.token
    }
    return null
  } catch (e) {
    console.error('Capsolver call exception', e)
    return null
  }
}

/**
 * Sitekey-мапа из официального bundle `/assets/connect-app-*.js`
 * (export `SITE_WIDGETS`). 05.06: Treatwell НЕ кладёт sitekey в HTML
 * (data-sitekey) — она зашита в JS, выбирается по hostname в
 * `getSitekey(window.location.hostname)`. Раньше мы ловили sitekey из
 * HTML и она всегда возвращалась null → Capsolver не вызывался → login
 * получал `NOT_VERIFIED_CAPTCHA`.
 *
 * Backend ожидает токен в поле `turnstileToken` (export
 * `BE_TURNSTILE_TOKEN_NAME` из того же модуля).
 */
const SITE_WIDGETS: Array<{ key: string; domains: string[] }> = [
  { key: '0x4AAAAAABgnlBz83RjqFbqR', domains: ['twbox.io', 'twtest.io'] },
  {
    key: '0x4AAAAAABgnyMs1otzyQX5B',
    domains: [
      'treatwell.at',
      'treatwell.be',
      'treatwell.de',
      'treatwell.es',
      'treatwell.fr',
      'treatwell.it',
      'treatwell.lt',
      'treatwell.nl',
      'treatwell.co.uk',
      'treatwell.dk',
      'treatwell.lv',
      'treatwell.pt',
    ],
  },
  { key: '0x4AAAAAABgnydbWugkFafO_', domains: ['treatwell.ie', 'treatwell.ch'] },
]

function getTurnstileSitekeyForHost(host: string): string | null {
  for (const w of SITE_WIDGETS) {
    if (w.domains.some((d) => host.endsWith(d))) return w.key
  }
  return null
}

/**
 * Fallback: пытаемся достать sitekey из HTML (если когда-то поменяют
 * и положат туда). На 05.06 не используется.
 */
function extractTurnstileSitekey(html: string): string | null {
  const m = html.match(/data-sitekey\s*=\s*["']([^"']+)["']/i)
  return m ? m[1] : null
}

async function login(loginField: string, password: string): Promise<AuthOk> {
  // Treatwell API на 02.06 требует `{user, password, isPersistentLogin}`
  // (monolit wahanda backend). Старые `{email/username}` отвергаются с
  // 'Cannot build AuthenticationInput, some of required attributes are not set'.
  //
  // Иногда падает даже с правильным JSON — возможно endpoint меняется или
  // нужен preflight GET за CSRF. Пробуем матрицу: 3 endpoints × 4 формата
  // тела × content-type. Первый успешный → cookies.
  if (!loginField || !password) {
    throw new Error('treatwell_login_failed: empty credentials')
  }

  // Preflight: GET /login чтобы получить session cookies (csrf). Sitekey
  // берём из hardcoded мапы по hostname (05.06 — Treatwell не кладёт её
  // в HTML).
  let preflightCookies = ''
  try {
    const p = await fetch(`${TREATWELL_BASE}/login`, {
      method: 'GET',
      headers: { accept: 'text/html', 'user-agent': UA },
    })
    preflightCookies = extractCookies(p.headers.get('set-cookie') ?? '')
    // Не читаем тело — sitekey всё равно из мапы; экономим память.
    await p.text().catch(() => '')
  } catch {
    // ignore — попробуем без preflight cookies
  }
  const baseHost = new URL(TREATWELL_BASE).hostname
  // Fallback на HTML парсинг: если когда-то добавят data-sitekey, оставим
  // как safety net (но обычно из мапы).
  const turnstileSiteKey =
    getTurnstileSitekeyForHost(baseHost) ??
    (await fetch(`${TREATWELL_BASE}/login`, {
      headers: { accept: 'text/html', 'user-agent': UA },
    })
      .then((r) => r.text())
      .then(extractTurnstileSitekey)
      .catch(() => null))

  // Решаем Cloudflare Turnstile через Capsolver если sitekey найден.
  let turnstileToken: string | null = null
  if (turnstileSiteKey && CAPSOLVER_API_KEY) {
    turnstileToken = await solveCloudflareTurnstile(`${TREATWELL_BASE}/login`, turnstileSiteKey)
  }
  // Детальный лог для дебага invalid_credentials (owner 04.06).
  console.log('treatwell auth attempt:', {
    capsolver_configured: !!CAPSOLVER_API_KEY,
    sitekey_found: !!turnstileSiteKey,
    sitekey: turnstileSiteKey,
    turnstile_token_received: !!turnstileToken,
    turnstile_token_len: turnstileToken?.length ?? 0,
    has_preflight_cookies: !!preflightCookies,
    login_field: loginField,
  })

  const endpoints = [
    '/api/authentication.json',
    '/api/v2/authentication.json',
    '/api/login.json',
    '/extranet-public/api/authentication.json',
  ]
  // Если решили Turnstile — добавляем токен в body под всеми известными
  // именами (Treatwell мог поменять — пробуем максимум).
  const tsField = turnstileToken
    ? {
        'cf-turnstile-response': turnstileToken,
        cfTurnstileResponse: turnstileToken,
        cfTurnstileToken: turnstileToken,
        turnstileToken: turnstileToken,
        captchaToken: turnstileToken,
      }
    : {}
  // 05.06: Treatwell ожидает поле `persistentLogin` (без `is`). Раньше
  // отправляли `isPersistentLogin` — API всегда возвращал
  // `JSON parse error: ... required attributes are not set
  // [isPersistentLogin]` и 400. Из bundle также видно что капча-токен
  // приходит в поле `turnstileToken` (см. BE_TURNSTILE_TOKEN_NAME).
  // form-urlencoded не поддерживается (415 Content-Type) — оставляем
  // только JSON.
  const jsonBodies = [
    JSON.stringify({ user: loginField, password, persistentLogin: true, ...tsField }),
    JSON.stringify({ user: loginField, password, persistentLogin: false, ...tsField }),
    JSON.stringify({
      user: loginField,
      password,
      persistentLogin: true,
      email: loginField,
      ...tsField,
    }),
  ]

  type Attempt = { url: string; body: string; contentType: string }
  const attempts: Attempt[] = []
  for (const ep of endpoints) {
    for (const b of jsonBodies) {
      attempts.push({ url: TREATWELL_BASE + ep, body: b, contentType: 'application/json' })
    }
    // form-urlencoded не пробуем — Treatwell отвечает 415 Content-Type
    // not supported.
  }

  let lastStatus = 0
  let lastText = ''
  let cookies = ''
  let sawNotAuthenticated = false
  let sawCaptchaRejected = false
  for (const a of attempts) {
    try {
      const r = await fetch(a.url, {
        method: 'POST',
        headers: {
          'content-type': a.contentType,
          accept: 'application/json, text/plain, */*',
          'accept-language': 'de-DE,de;q=0.9,en;q=0.8,ru;q=0.7',
          'accept-encoding': 'gzip, deflate, br',
          'x-requested-with': 'XMLHttpRequest',
          origin: TREATWELL_BASE,
          referer: `${TREATWELL_BASE}/login`,
          'user-agent': UA,
          'sec-ch-ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
          'sec-ch-ua-mobile': '?0',
          'sec-ch-ua-platform': '"macOS"',
          'sec-fetch-dest': 'empty',
          'sec-fetch-mode': 'cors',
          'sec-fetch-site': 'same-origin',
          ...(preflightCookies ? { cookie: preflightCookies } : {}),
        },
        body: a.body,
      })
      const txt = await r.text()
      lastStatus = r.status
      lastText = txt
      // Детальный лог каждого attempt — чтобы понять что Treatwell
      // возвращает (owner 04.06: credentials точно правильные).
      console.log('treatwell attempt:', {
        url: a.url,
        contentType: a.contentType,
        status: r.status,
        textPreview: txt.slice(0, 400),
      })
      // Treatwell 200 + body {"result":"NOT_VERIFIED_CAPTCHA"} — токен
      // капчи отсутствует / истёк / fingerprint браузера отвергнут.
      // Это НЕ invalid_credentials — отдельная ветка для UI.
      if (r.ok && /NOT_VERIFIED_CAPTCHA/i.test(txt)) {
        sawCaptchaRejected = true
        continue
      }
      // Treatwell 200 + body {"result":"NOT_AUTHENTICATED"} — endpoint
      // работает, формат принят, но credentials отклонены. Запоминаем
      // флаг чтобы выдать специфичный код ошибки.
      if (r.ok && /NOT_AUTHENTICATED|invalidCredentials|"errorCode"\s*:/i.test(txt)) {
        sawNotAuthenticated = true
        continue
      }
      const setCookies = r.headers.get('set-cookie') ?? ''
      const c = extractCookies(setCookies)
      if (r.ok && c) {
        cookies = preflightCookies ? `${preflightCookies}; ${c}` : c
        break
      }
    } catch {
      // network error — пробуем следующий endpoint
    }
  }
  if (!cookies) {
    if (sawCaptchaRejected) {
      // Capsolver токен не прошёл / sitekey неверный / Capsolver вернул
      // expired-token. Это РАЗНОЕ от invalid_credentials — отдельная ошибка.
      if (!CAPSOLVER_API_KEY) {
        throw new Error('treatwell_solver_not_configured')
      }
      throw new Error('treatwell_solver_failed')
    }
    if (sawNotAuthenticated) {
      // Owner-feedback 04.06: дифференцируем NOT_AUTHENTICATED:
      //  - если CAPSOLVER_API_KEY не задан в secrets — solver не настроен,
      //    Cloudflare turnstile не решён → отдельный код для UI.
      //  - если задан и turnstile-токен получен, но всё равно
      //    NOT_AUTHENTICATED — это либо неверный пароль, либо anti-bot
      //    отверг даже с solved токеном (fingerprint).
      if (!CAPSOLVER_API_KEY) {
        throw new Error('treatwell_solver_not_configured')
      }
      if (turnstileSiteKey && !turnstileToken) {
        throw new Error('treatwell_solver_failed')
      }
      throw new Error('treatwell_invalid_credentials')
    }
    throw new Error(
      `treatwell_login_failed: HTTP ${lastStatus}${lastText ? ': ' + lastText.slice(0, 300) : ''}. Проверь email/пароль или 2FA.`,
    )
  }

  // Получаем venueId. Bug 06.06: у части аккаунтов ни extranet-settings,
  // ни role-permissions, ни treatments не содержат поля venueId/venue_id
  // (ответ — только account.id + permissions). Расширяем стратегию:
  //   1. Больше endpoints — venue/list/me/businesses/dashboard/HTML home
  //   2. Больше имён полей — currentVenueId, businessId, supplierId,
  //      partnerId, defaultVenueId, accountVenues[].id, venues[].id
  //   3. HTML-парсинг главной (часто venueId зашит в JSON-stringify рядом
  //      с initial state)
  //   4. Fallback: account.id (если такого поля везде нет — Treatwell
  //      использует account как venue в single-venue режиме)
  let venueId = ''
  const tryEndpoints = [
    '/api/extranet-settings.json',
    '/api/me.json',
    '/api/venue.json',
    '/api/venues.json',
    '/api/venue/list.json',
    '/api/business.json',
    '/api/businesses.json',
    '/api/dashboard.json',
    '/api/extranet.json',
    '/api/role-permissions.json',
    '/api/treatments.json',
  ]
  const fieldNames = [
    'venueId',
    'venue_id',
    'currentVenueId',
    'current_venue_id',
    'defaultVenueId',
    'default_venue_id',
    'venuesId',
    'businessId',
    'business_id',
    'supplierId',
    'supplier_id',
    'partnerId',
    'partner_id',
  ]
  const fetched: Array<{ path: string; body: unknown }> = []

  function findVenueIdAnywhere(data: unknown): string | null {
    for (const name of fieldNames) {
      const id = deepFindNumberField(data, name)
      if (id) return String(id)
    }
    // Также пробуем достать через вложенные объекты: venue.id, currentVenue.id,
    // venues[0].id, accountVenues[0].id.
    const nested = deepFindNestedId(data, [
      'venue',
      'currentVenue',
      'current_venue',
      'business',
      'supplier',
      'partner',
    ])
    if (nested) return String(nested)
    const arr = deepFindArrayFirstId(data, ['venues', 'accountVenues', 'businesses', 'suppliers'])
    if (arr) return String(arr)
    return null
  }

  for (const path of tryEndpoints) {
    try {
      const res = await fetch(`${TREATWELL_BASE}${path}`, {
        headers: { accept: 'application/json', cookie: cookies, 'user-agent': UA },
      })
      if (!res.ok) continue
      const data = await res.json().catch(() => null)
      if (!data) continue
      fetched.push({ path, body: data })
      const found = findVenueIdAnywhere(data)
      if (found) {
        venueId = found
        break
      }
    } catch {
      /* try next */
    }
  }
  // Auth-response тоже проверяем (последний body successful login).
  if (!venueId && lastText) {
    try {
      const authJson = JSON.parse(lastText)
      const found = findVenueIdAnywhere(authJson)
      if (found) venueId = found
    } catch {
      /* ignore */
    }
  }
  // Last-ditch: пробуем парсить HTML главной (initial state часто содержит
  // window.__INITIAL_STATE__ = {... venueId: 12345 ...}).
  if (!venueId) {
    try {
      const r = await fetch(`${TREATWELL_BASE}/`, {
        headers: { accept: 'text/html', cookie: cookies, 'user-agent': UA },
      })
      if (r.ok) {
        const html = await r.text()
        for (const name of fieldNames) {
          const m = new RegExp(`["']${name}["']\\s*:\\s*["']?(\\d+)`).exec(html)
          if (m && m[1]) {
            venueId = m[1]
            break
          }
        }
      }
    } catch {
      /* ignore */
    }
  }
  // Crash-fallback: используем account.id как venueId. У single-venue
  // аккаунтов Treatwell часто account.id ≡ venueId.
  if (!venueId) {
    for (const f of fetched) {
      const acc = (f.body as { account?: { id?: number | string } } | null)?.account?.id
      if (acc && (typeof acc === 'number' || (typeof acc === 'string' && /^\d+$/.test(acc)))) {
        venueId = String(acc)
        break
      }
    }
  }
  if (!venueId) {
    const diag = fetched
      .map((f) => `${f.path}: ${JSON.stringify(f.body).slice(0, 400)}`)
      .join(' | ')
    throw new Error(
      `treatwell_no_venueid: не удалось извлечь venueId из API. Диагностика: ${diag.slice(0, 1500)}`,
    )
  }
  return { sessionCookies: cookies, venueId }
}

/** Ищет поле id внутри одного из named объектов (venue.id, currentVenue.id ...). */
function deepFindNestedId(obj: unknown, parentNames: string[]): number | undefined {
  if (!obj || typeof obj !== 'object') return undefined
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (parentNames.includes(k) && v && typeof v === 'object') {
      const id = (v as { id?: number | string }).id
      if (typeof id === 'number') return id
      if (typeof id === 'string' && /^\d+$/.test(id)) return Number(id)
    }
    if (v && typeof v === 'object') {
      const found = deepFindNestedId(v, parentNames)
      if (found !== undefined) return found
    }
  }
  return undefined
}

/** Ищет первый элемент массива с .id внутри одного из named массивов. */
function deepFindArrayFirstId(obj: unknown, arrayNames: string[]): number | undefined {
  if (!obj || typeof obj !== 'object') return undefined
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (arrayNames.includes(k) && Array.isArray(v) && v.length > 0) {
      const first = v[0] as { id?: number | string }
      const id = first?.id
      if (typeof id === 'number') return id
      if (typeof id === 'string' && /^\d+$/.test(id)) return Number(id)
    }
    if (v && typeof v === 'object') {
      const found = deepFindArrayFirstId(v, arrayNames)
      if (found !== undefined) return found
    }
  }
  return undefined
}

async function api<T>(cookies: string, path: string): Promise<T> {
  const r = await fetch(`${TREATWELL_BASE}${path}`, {
    headers: {
      accept: 'application/json',
      cookie: cookies,
      'x-requested-with': 'XMLHttpRequest',
      'user-agent': UA,
    },
  })
  if (!r.ok) throw new Error(`treatwell ${path} ${r.status}: ${(await r.text()).slice(0, 100)}`)
  return (await r.json()) as T
}

// ── Маппинг ──

type TwEmployee = {
  id: number
  name: string
  emailAddress?: string | null
  phone?: string | null
  jobTitle?: string | null
  active?: boolean
}
type TwOffer = {
  id: number
  name: string
  groupId: number
  employees?: Array<{ employeeId: number; name?: string }>
  pricing?: { from?: number | null; to?: number | null; currencyCode?: string }
  durationMinutes?: number
  active?: boolean
}
type TwCustomer = {
  id: number
  firstName?: string
  lastName?: string
  emailAddress?: string | null
  phone?: string | null
  mobile?: string | null
  notes?: string | null
}
type TwAppointment = {
  id: number
  startTime: string
  endTime?: string
  customerId?: number | null
  employeeId?: number | null
  offerId?: number | null
  status?: string
  price?: { amount?: number; currencyCode?: string } | null
  priceAmount?: number | null
}

async function syncStaff(
  admin: SupabaseClient,
  salonId: string,
  cookies: string,
  venueId: string,
): Promise<number> {
  const data = await api<{ employees: TwEmployee[] }>(
    cookies,
    `/api/venue/${venueId}/employees.json?active=true&takes-appointments=true`,
  )
  const rows = data.employees.map((e) => ({
    salon_id: salonId,
    external_source: 'treatwell',
    external_id: String(e.id),
    full_name: e.name?.trim() || 'Без имени',
    email: e.emailAddress ?? null,
    phone: e.phone ?? null,
    job_title: e.jobTitle ?? null,
    is_active: e.active !== false,
  }))
  if (rows.length === 0) return 0
  const { error } = await admin
    .from('staff')
    .upsert(rows, { onConflict: 'salon_id,external_source,external_id' })
  if (error) throw new Error(`upsert staff: ${error.message}`)
  return rows.length
}

async function syncServices(
  admin: SupabaseClient,
  salonId: string,
  cookies: string,
  venueId: string,
): Promise<number> {
  const data = await api<{ offers: TwOffer[] }>(cookies, `/api/venue/${venueId}/menu.json`)
  const rows = data.offers
    .filter((o) => o.active !== false)
    .map((o) => {
      const from = o.pricing?.from ?? 0
      const to = o.pricing?.to ?? from
      const avgCents = Math.round(((from + to) / 2) * 100)
      return {
        salon_id: salonId,
        external_source: 'treatwell',
        external_id: String(o.id),
        title: o.name?.trim() || 'Услуга',
        price_cents: avgCents,
        duration_minutes: o.durationMinutes ?? 60,
        is_active: true,
      }
    })
  if (rows.length === 0) return 0
  const { error } = await admin
    .from('services')
    .upsert(rows, { onConflict: 'salon_id,external_source,external_id' })
  if (error) throw new Error(`upsert services: ${error.message}`)
  return rows.length
}

async function syncClients(
  admin: SupabaseClient,
  salonId: string,
  cookies: string,
  venueId: string,
): Promise<number> {
  let total = 0
  for (let start = 0; start < 100_000; start += 100) {
    const data = await api<{ customers: TwCustomer[] }>(
      cookies,
      `/api/venue/${venueId}/customers.json?count=100&start=${start}`,
    )
    if (data.customers.length === 0) break
    const rows = data.customers.map((c) => ({
      salon_id: salonId,
      external_source: 'treatwell',
      external_id: String(c.id),
      name: `${c.firstName ?? ''} ${c.lastName ?? ''}`.trim() || 'Клиент',
      email: c.emailAddress ?? null,
      phone: c.mobile ?? c.phone ?? null,
      notes: c.notes ?? null,
    }))
    const { error } = await admin
      .from('clients')
      .upsert(rows, { onConflict: 'salon_id,external_source,external_id' })
    if (error) throw new Error(`upsert clients: ${error.message}`)
    total += rows.length
    if (data.customers.length < 100) break
  }
  return total
}

async function syncVisits(
  admin: SupabaseClient,
  salonId: string,
  cookies: string,
  venueId: string,
  daysBack: number,
): Promise<number> {
  // Treatwell calendar.json возвращает день. Тянем по дням от today-daysBack до
  // today+7. Maps appointments в visits.
  const today = new Date()
  const start = new Date(today.getTime() - daysBack * 86400_000)
  const end = new Date(today.getTime() + 7 * 86400_000)

  // Достаём существующие staff/services по external_id для FK-маппинга
  const { data: staffRows } = await admin
    .from('staff')
    .select('id, external_id')
    .eq('salon_id', salonId)
    .eq('external_source', 'treatwell')
  const { data: serviceRows } = await admin
    .from('services')
    .select('id, external_id')
    .eq('salon_id', salonId)
    .eq('external_source', 'treatwell')
  const { data: clientRows } = await admin
    .from('clients')
    .select('id, external_id')
    .eq('salon_id', salonId)
    .eq('external_source', 'treatwell')

  const staffMap = new Map((staffRows ?? []).map((r) => [r.external_id, r.id]))
  const serviceMap = new Map((serviceRows ?? []).map((r) => [r.external_id, r.id]))
  const clientMap = new Map((clientRows ?? []).map((r) => [r.external_id, r.id]))
  const vatCtx = await loadVatContext(admin, salonId)

  let total = 0
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const dateStr = d.toISOString().slice(0, 10)
    let data: { appointments: TwAppointment[] }
    try {
      data = await api<{ appointments: TwAppointment[] }>(
        cookies,
        `/api/venue/${venueId}/calendar.json?date=${dateStr}`,
      )
    } catch (e) {
      console.warn(`treatwell calendar ${dateStr} failed:`, (e as Error).message)
      continue
    }
    const rows = (data.appointments ?? [])
      .map((a) => {
        const priceCents = Math.round((a.price?.amount ?? a.priceAmount ?? 0) * 100)
        const status = a.status === 'CANCELLED' ? 'cancelled' : 'paid'
        const vatFields = vatFieldsForVisit(vatCtx, priceCents)
        return {
          salon_id: salonId,
          external_source: 'treatwell',
          external_id: String(a.id),
          visit_at: new Date(a.startTime).toISOString(),
          staff_id: a.employeeId ? (staffMap.get(String(a.employeeId)) ?? null) : null,
          client_id: a.customerId ? (clientMap.get(String(a.customerId)) ?? null) : null,
          service_id: a.offerId ? (serviceMap.get(String(a.offerId)) ?? null) : null,
          amount_cents: priceCents,
          discount_cents: 0,
          tip_cents: 0,
          paid_amount_cents: status === 'paid' ? priceCents : 0,
          status,
          kind: 'visit',
          ...(vatFields.vat_rate_pct != null ? vatFields : {}),
        }
      })
      .filter((r) => r.amount_cents > 0 || r.client_id || r.staff_id)
    if (rows.length === 0) continue
    const { error } = await admin
      .from('visits')
      .upsert(rows, { onConflict: 'salon_id,source,external_id' })
    if (error) {
      console.warn(`upsert visits ${dateStr}: ${error.message}`)
      continue
    }
    total += rows.length
  }
  return total
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return preflight()
  if (!SUPABASE_URL || !SERVICE_KEY) return jsonResponse({ error: 'not_configured' }, 500)
  if (req.method !== 'POST') return jsonResponse({ error: 'method_not_allowed' }, 405)

  const body = (await req.json().catch(() => null)) as {
    action?: 'connect' | 'sync' | 'disconnect'
    salon_id?: string
    login?: string
    password?: string
    days?: number
    token?: string
  } | null
  if (!body?.action || !body.salon_id) return jsonResponse({ error: 'bad_request' }, 400)

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  // Cron-token валидация: если есть token — атомарно помечаем used.
  if (body.token) {
    const { data: trigger, error: tokenErr } = await admin
      .from('treatwell_sync_triggers')
      .update({ used_at: new Date().toISOString() })
      .eq('token', body.token)
      .is('used_at', null)
      .gte('expires_at', new Date().toISOString())
      .select('salon_id')
      .single()
    if (tokenErr || !trigger || trigger.salon_id !== body.salon_id) {
      return jsonResponse({ error: 'invalid_or_used_token' }, 401)
    }
  }

  try {
    if (body.action === 'connect') {
      if (!body.login || !body.password) return jsonResponse({ error: 'creds_missing' }, 400)
      const auth = await login(body.login, body.password)
      await admin.from('salon_integrations').upsert(
        {
          salon_id: body.salon_id,
          provider: 'treatwell',
          status: 'connected',
          external_account_id: auth.venueId,
          credentials: {
            login: body.login,
            password: body.password,
            venueId: auth.venueId,
          },
        },
        { onConflict: 'salon_id,provider' },
      )
      return jsonResponse({ ok: true, venue_id: auth.venueId })
    }

    if (body.action === 'disconnect') {
      await admin
        .from('salon_integrations')
        .update({ status: 'disconnected' })
        .eq('salon_id', body.salon_id)
        .eq('provider', 'treatwell')
      return jsonResponse({ ok: true })
    }

    if (body.action === 'sync') {
      const { data: integ, error: integErr } = await admin
        .from('salon_integrations')
        .select('credentials, external_account_id')
        .eq('salon_id', body.salon_id)
        .eq('provider', 'treatwell')
        .maybeSingle()
      if (integErr || !integ) return jsonResponse({ ok: false, error: 'not_connected' }, 404)
      const creds = integ.credentials as { login?: string; password?: string; venueId?: string }
      if (!creds.login || !creds.password)
        return jsonResponse({ ok: false, error: 'creds_missing' }, 400)
      const auth = await login(creds.login, creds.password)
      const venueId = creds.venueId ?? auth.venueId
      const staffN = await syncStaff(admin, body.salon_id, auth.sessionCookies, venueId)
      const serviceN = await syncServices(admin, body.salon_id, auth.sessionCookies, venueId)
      const clientN = await syncClients(admin, body.salon_id, auth.sessionCookies, venueId)
      const visitN = await syncVisits(
        admin,
        body.salon_id,
        auth.sessionCookies,
        venueId,
        body.days ?? 30,
      )
      await admin
        .from('salon_integrations')
        .update({
          last_sync_at: new Date().toISOString(),
          last_sync_stats: {
            staff: staffN,
            services: serviceN,
            clients: clientN,
            visits: visitN,
          },
        })
        .eq('salon_id', body.salon_id)
        .eq('provider', 'treatwell')
      return jsonResponse({
        ok: true,
        stats: { staff: staffN, services: serviceN, clients: clientN, visits: visitN },
      })
    }
  } catch (e) {
    // Возвращаем 200 + ok:false + читаемое сообщение, иначе invoke-клиент
    // получает generic «non-2xx status code» и юзер не видит причины.
    const msg = (e as Error).message ?? 'unknown_error'
    console.error('treatwell-proxy error:', msg, (e as Error).stack)
    return jsonResponse({ ok: false, error: msg }, 200)
  }

  return jsonResponse({ error: 'unknown_action' }, 400)
})
