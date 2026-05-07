/**
 * booksy-proxy — интеграция с Booksy (PL marketplace бронирования).
 *
 * Auth-flow (Метод 3 — proxy form):
 *   1) SPA рендерит форму с invisible hCaptcha (sitekey того же Booksy)
 *   2) Юзер вводит email/password, hcaptcha.execute() → captcha_token
 *   3) SPA шлёт {action:'login', salon_id, email, password, captcha_token}
 *   4) Edge function проксит POST на pl.booksy.com/core/v2/business_api/account/login
 *      с x-hcaptcha-token + x-api-key + x-fingerprint
 *   5) Получаем access_token + account info → сохраняем в salon_integrations
 *
 * Fallback (если Booksy вернул request_blocked):
 *   action='login_with_token' — юзер сам вытащил access_token из DevTools и вставил.
 *
 * Sync-flow:
 *   action='sync' → /me/businesses/{biz_id}/resources, service_categories, calendar
 */

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'

import { corsHeaders, preflight } from '../_shared/cors.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

// Статичные данные Booksy frontdesk API
const BOOKSY_API = 'https://pl.booksy.com/core/v2/business_api'
const BOOKSY_X_API_KEY = 'frontdesk-76661e2b-25f0-49b4-b33a-9d78957a58e3'
const BOOKSY_X_APP_VERSION = '3.0'
// Хардкод fingerprint как у KIK (Booksy его пока не валидирует строго)
const BOOKSY_X_FINGERPRINT = 'bef920d1-c754-481e-9c13-343690248481'
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'content-type': 'application/json' },
  })
}

// =============================================================================
// Booksy API helpers
// =============================================================================

function booksyHeaders(accessToken?: string, extra?: Record<string, string>): HeadersInit {
  const h: Record<string, string> = {
    accept: 'application/json, text/plain, */*',
    'accept-language': 'pl',
    'content-type': 'application/json',
    origin: 'https://booksy.com',
    referer: 'https://booksy.com/',
    'user-agent': USER_AGENT,
    'x-api-key': BOOKSY_X_API_KEY,
    'x-app-version': BOOKSY_X_APP_VERSION,
    'x-fingerprint': BOOKSY_X_FINGERPRINT,
    ...(extra ?? {}),
  }
  if (accessToken) h['x-access-token'] = accessToken
  return h
}

type BooksyLoginResponse = {
  access_token: string
  account: {
    id: number
    email: string
    first_name: string
    last_name: string
  }
  access_rights?: { access_level: string }
}

type BooksyError = {
  errors?: { code?: string; message?: string }[]
}

/**
 * Распознаём ошибки от Booksy и переводим в человеческий статус.
 * - 401/403 + errors[0].code === 'request_blocked' → 'request_blocked'
 *   (защита Booksy сработала, нужен fallback на ручной токен)
 * - 401/403 без блокировки → 'invalid_credentials'
 * - 429 → 'rate_limited'
 */
function classifyBooksyError(status: number, body: BooksyError): string {
  if (status === 429) return 'rate_limited'
  if (status === 401 || status === 403) {
    const code = body.errors?.[0]?.code
    if (code === 'request_blocked') return 'request_blocked'
    return 'invalid_credentials'
  }
  return 'booksy_error'
}

async function booksyLogin(
  email: string,
  password: string,
  hcaptchaToken: string,
): Promise<
  { ok: true; data: BooksyLoginResponse } | { ok: false; status: number; reason: string }
> {
  const res = await fetch(`${BOOKSY_API}/account/login`, {
    method: 'POST',
    headers: booksyHeaders(undefined, { 'x-hcaptcha-token': hcaptchaToken }),
    body: JSON.stringify({ email, password }),
  })
  const text = await res.text()
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    parsed = {}
  }
  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      reason: classifyBooksyError(res.status, parsed as BooksyError),
    }
  }
  return { ok: true, data: parsed as BooksyLoginResponse }
}

async function booksyGet<T = unknown>(
  path: string,
  accessToken: string,
): Promise<{ ok: true; data: T } | { ok: false; status: number; reason: string }> {
  const res = await fetch(`${BOOKSY_API}${path}`, { headers: booksyHeaders(accessToken) })
  const text = await res.text()
  if (!res.ok) {
    let parsed: unknown = {}
    try {
      parsed = JSON.parse(text)
    } catch {
      // ignore
    }
    return {
      ok: false,
      status: res.status,
      reason: classifyBooksyError(res.status, parsed as BooksyError),
    }
  }
  return { ok: true, data: JSON.parse(text) as T }
}

// =============================================================================
// Sync logic — Booksy → Finkley
// =============================================================================

type SyncStats = {
  staff_synced: number
  services_synced: number
  visits_synced: number
}

async function syncBooksyData(
  admin: SupabaseClient,
  salonId: string,
  accessToken: string,
  businessId: number,
): Promise<SyncStats> {
  const stats: SyncStats = { staff_synced: 0, services_synced: 0, visits_synced: 0 }

  // 1) Staff (resources) — идемпотентно по external_id (resource_id из Booksy).
  //    Имя обновляем при изменении (Booksy может переименовать). Старые
  //    by-name записи (созданные до этого фикса) переживём — те пишутся
  //    параллельно и без external_id, юзер сольёт руками если надо.
  type ResourcesResp = { resources?: { id: number; name: string; is_active?: boolean }[] }
  const resourcesRes = await booksyGet<ResourcesResp>(
    `/me/businesses/${businessId}/resources`,
    accessToken,
  )
  if (!resourcesRes.ok) throw new Error(`resources_${resourcesRes.reason}`)
  for (const r of resourcesRes.data.resources ?? []) {
    const extId = String(r.id)
    let { data: existing } = await admin
      .from('staff')
      .select('id')
      .eq('salon_id', salonId)
      .eq('external_source', 'booksy')
      .eq('external_id', extId)
      .maybeSingle()
    // Fallback by-name (для записей, синканутых до введения external_id)
    if (!existing) {
      const { data: byName } = await admin
        .from('staff')
        .select('id')
        .eq('salon_id', salonId)
        .eq('full_name', r.name)
        .is('deleted_at', null)
        .is('external_id', null)
        .maybeSingle()
      if (byName) {
        await admin
          .from('staff')
          .update({ external_source: 'booksy', external_id: extId })
          .eq('id', byName.id)
        existing = byName
      }
    }
    if (existing) {
      await admin
        .from('staff')
        .update({ full_name: r.name, is_active: r.is_active !== false })
        .eq('id', existing.id)
    } else {
      await admin.from('staff').insert({
        salon_id: salonId,
        full_name: r.name,
        payout_scheme: 'percent_revenue',
        payout_percent: 40,
        is_active: r.is_active !== false,
        external_source: 'booksy',
        external_id: extId,
      })
      stats.staff_synced++
    }
  }

  // 2) Services — то же самое: lookup по external_id, апдейт цены/длительности.
  type SvcResp = {
    service_categories?: {
      id: number
      name: string
      services?: { id: number; name: string; price?: { amount?: number }; duration?: number }[]
    }[]
  }
  const svcRes = await booksyGet<SvcResp>(
    `/me/businesses/${businessId}/service_categories`,
    accessToken,
  )
  if (!svcRes.ok) throw new Error(`service_categories_${svcRes.reason}`)
  for (const cat of svcRes.data.service_categories ?? []) {
    for (const s of cat.services ?? []) {
      const extId = String(s.id)
      const priceCents = Math.round((s.price?.amount ?? 0) * 100)
      let { data: existing } = await admin
        .from('services')
        .select('id')
        .eq('salon_id', salonId)
        .eq('external_source', 'booksy')
        .eq('external_id', extId)
        .maybeSingle()
      if (!existing) {
        const { data: byName } = await admin
          .from('services')
          .select('id')
          .eq('salon_id', salonId)
          .eq('name', s.name)
          .eq('is_archived', false)
          .is('external_id', null)
          .maybeSingle()
        if (byName) {
          await admin
            .from('services')
            .update({ external_source: 'booksy', external_id: extId })
            .eq('id', byName.id)
          existing = byName
        }
      }
      if (existing) {
        await admin
          .from('services')
          .update({
            name: s.name,
            default_price_cents: priceCents,
            default_duration_min: s.duration ?? null,
          })
          .eq('id', existing.id)
      } else {
        await admin.from('services').insert({
          salon_id: salonId,
          name: s.name,
          default_price_cents: priceCents,
          default_duration_min: s.duration ?? null,
          external_source: 'booksy',
          external_id: extId,
        })
        stats.services_synced++
      }
    }
  }

  // 3) Visits — последние 30 дней + 7 вперёд через GET /calendar.
  //    Booksy возвращает один subbooking = одно "booking" в calendar response.
  //    Цены в calendar нет — берём из synced services по имени (если 0 — visit
  //    создаём с amount=0, юзер дозаполнит). Только status='F' (finished).
  await syncVisits(admin, salonId, accessToken, businessId, stats)

  return stats
}

type CalendarBooking = {
  id: number
  appointment_uid: number
  booked_from: string // "2026-05-07T10:00"
  booked_till: string
  status: string // 'F' = finished, 'A' = active, 'X' = cancelled, etc.
  type: string
  resources?: { id: number }[]
  service?: { id: number; name: string }
  customer?: { id: number; name?: string; phone?: string }
}

type CalendarResp = {
  bookings?: Record<string, CalendarBooking>
}

/**
 * Caches для резолва Booksy ID → наш UUID, чтобы не бить БД на каждый
 * booking при синке визитов. Все три таблицы — staff/services/clients —
 * имеют external_id (booksy: resource.id / service.id / customer.id).
 */
type Caches = {
  staffByExtId: Map<string, string>
  serviceByExtId: Map<string, { id: string; price: number }>
  clientByExtId: Map<string, string>
}

async function buildCaches(admin: SupabaseClient, salonId: string): Promise<Caches> {
  const caches: Caches = {
    staffByExtId: new Map(),
    serviceByExtId: new Map(),
    clientByExtId: new Map(),
  }
  const { data: staff } = await admin
    .from('staff')
    .select('id, external_id')
    .eq('salon_id', salonId)
    .eq('external_source', 'booksy')
    .not('external_id', 'is', null)
  for (const s of staff ?? []) {
    if (s.external_id) caches.staffByExtId.set(s.external_id, s.id)
  }

  const { data: services } = await admin
    .from('services')
    .select('id, external_id, default_price_cents')
    .eq('salon_id', salonId)
    .eq('external_source', 'booksy')
    .not('external_id', 'is', null)
  for (const s of services ?? []) {
    if (s.external_id) {
      caches.serviceByExtId.set(s.external_id, {
        id: s.id,
        price: s.default_price_cents ?? 0,
      })
    }
  }

  const { data: clients } = await admin
    .from('clients')
    .select('id, external_id')
    .eq('salon_id', salonId)
    .eq('external_source', 'booksy')
    .not('external_id', 'is', null)
  for (const c of clients ?? []) {
    if (c.external_id) caches.clientByExtId.set(c.external_id, c.id)
  }
  return caches
}

async function syncVisits(
  admin: SupabaseClient,
  salonId: string,
  accessToken: string,
  businessId: number,
  stats: SyncStats,
): Promise<void> {
  const caches = await buildCaches(admin, salonId)

  // Период: 30 дней назад .. 7 дней вперёд (для предстоящих)
  const now = new Date()
  const start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
  const end = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
  const fmtDate = (d: Date) => d.toISOString().slice(0, 10)

  // Resources — Booksy ставит в URL `start_date` сегодняшнего дня и идёт
  // вперёд страницами. Чтобы хапнуть месяц, итерируем по неделям.
  const seenIds = new Set<number>()
  for (let cursor = new Date(start); cursor <= end; cursor.setDate(cursor.getDate() + 7)) {
    const periodStart = fmtDate(cursor)
    const weekEnd = new Date(cursor)
    weekEnd.setDate(weekEnd.getDate() + 6)
    if (weekEnd > end) weekEnd.setTime(end.getTime())
    const periodEnd = fmtDate(weekEnd)

    const url =
      `/me/businesses/${businessId}/calendar` +
      `?start_date=${periodStart}&end_date=${periodEnd}` +
      `&include_unconfirmed=true&version=3&resources_per_page=100`
    const calRes = await booksyGet<CalendarResp>(url, accessToken)
    if (!calRes.ok) throw new Error(`calendar_${calRes.reason}`)

    const bookings = Object.values(calRes.data.bookings ?? {})
    for (const b of bookings) {
      if (seenIds.has(b.id)) continue
      seenIds.add(b.id)
      // Только завершённые визиты для KPI; будущие/отменённые пропускаем
      if (b.status !== 'F') continue
      if (!b.service?.name || !b.customer?.id) continue

      // Resolve staff: первый resource_id → external_id lookup
      let staffId: string | null = null
      const firstResId = b.resources?.[0]?.id
      if (firstResId) {
        staffId = caches.staffByExtId.get(String(firstResId)) ?? null
      }

      // Resolve service по service.id (НЕ по имени — устойчивее к переименованию)
      const svc = b.service.id ? caches.serviceByExtId.get(String(b.service.id)) : undefined
      const serviceId = svc?.id ?? null
      const amountCents = svc?.price ?? 0

      // Find or create client
      const clientExtId = String(b.customer.id)
      let clientId = caches.clientByExtId.get(clientExtId) ?? null
      if (!clientId) {
        const { data: newClient } = await admin
          .from('clients')
          .insert({
            salon_id: salonId,
            full_name: b.customer.name ?? 'Booksy client',
            phone: b.customer.phone || null,
            external_source: 'booksy',
            external_id: clientExtId,
          })
          .select('id')
          .single()
        if (newClient) {
          clientId = newClient.id
          caches.clientByExtId.set(clientExtId, clientId)
        }
      }

      // visit_at в Booksy без TZ — трактуем как Europe/Warsaw
      const visitAt = new Date(b.booked_from + ':00+02:00').toISOString()

      const { error } = await admin.from('visits').upsert(
        {
          salon_id: salonId,
          staff_id: staffId,
          client_id: clientId,
          service_id: serviceId,
          service_name_snapshot: b.service.name,
          visit_at: visitAt,
          amount_cents: amountCents,
          payment_method: 'cash',
          status: 'paid',
          source: 'booksy',
          external_id: String(b.id),
        },
        { onConflict: 'salon_id,source,external_id', ignoreDuplicates: true },
      )
      if (!error) stats.visits_synced++
    }
  }
}

// =============================================================================
// Action handlers
// =============================================================================

async function ensureMember(
  admin: SupabaseClient,
  userId: string,
  salonId: string,
): Promise<boolean> {
  const { data } = await admin
    .from('salon_members')
    .select('role')
    .eq('salon_id', salonId)
    .eq('user_id', userId)
    .maybeSingle()
  return !!data
}

async function persistConnection(
  admin: SupabaseClient,
  salonId: string,
  login: BooksyLoginResponse,
  business: { id: number; name: string },
): Promise<{ ok: true } | { ok: false; message: string }> {
  const credentials = {
    access_token: login.access_token,
    business_id: business.id,
    business_name: business.name,
    account_id: login.account.id,
    account_email: login.account.email,
    access_level: login.access_rights?.access_level,
    last_token_at: new Date().toISOString(),
  }
  const { error } = await admin.from('salon_integrations').upsert(
    {
      salon_id: salonId,
      provider: 'booksy',
      status: 'connected',
      credentials,
      last_error: null,
      connected_at: new Date().toISOString(),
    },
    { onConflict: 'salon_id,provider' },
  )
  if (error) return { ok: false, message: error.message }
  return { ok: true }
}

async function handleLogin(
  admin: SupabaseClient,
  userId: string,
  salonId: string,
  email: string,
  password: string,
  captchaToken: string,
): Promise<Response> {
  if (!(await ensureMember(admin, userId, salonId))) {
    return jsonResponse({ ok: false, error: 'forbidden' }, 403)
  }

  const loginRes = await booksyLogin(email, password, captchaToken)
  if (!loginRes.ok) {
    const httpStatus =
      loginRes.reason === 'rate_limited' ? 429 : loginRes.reason === 'request_blocked' ? 403 : 401
    return jsonResponse(
      {
        ok: false,
        error: loginRes.reason,
        message: `Booksy returned ${loginRes.status}`,
      },
      httpStatus,
    )
  }

  type BusinessesResp = { businesses?: { id: number; name: string }[] }
  const bizRes = await booksyGet<BusinessesResp>('/me/businesses', loginRes.data.access_token)
  if (!bizRes.ok) {
    return jsonResponse({ ok: false, error: 'businesses_fetch_failed', reason: bizRes.reason }, 502)
  }
  const business = bizRes.data.businesses?.[0]
  if (!business) {
    return jsonResponse({ ok: false, error: 'no_businesses_in_account' }, 400)
  }

  const persisted = await persistConnection(admin, salonId, loginRes.data, business)
  if (!persisted.ok) {
    return jsonResponse({ ok: false, error: 'persist_failed', message: persisted.message }, 500)
  }

  return jsonResponse({
    ok: true,
    business: { id: business.id, name: business.name },
    account: { email: loginRes.data.account.email, name: loginRes.data.account.first_name },
  })
}

/**
 * Fallback: юзер сам вытащил access_token из DevTools (когда Booksy
 * заблокировал прямой логин с request_blocked).
 */
async function handleLoginWithToken(
  admin: SupabaseClient,
  userId: string,
  salonId: string,
  accessToken: string,
): Promise<Response> {
  if (!(await ensureMember(admin, userId, salonId))) {
    return jsonResponse({ ok: false, error: 'forbidden' }, 403)
  }

  // Валидируем токен через /me/businesses
  type BusinessesResp = { businesses?: { id: number; name: string }[] }
  const bizRes = await booksyGet<BusinessesResp>('/me/businesses', accessToken)
  if (!bizRes.ok) {
    return jsonResponse(
      { ok: false, error: 'invalid_token', reason: bizRes.reason, message: 'Token not accepted' },
      401,
    )
  }
  const business = bizRes.data.businesses?.[0]
  if (!business) return jsonResponse({ ok: false, error: 'no_businesses_in_account' }, 400)

  // Эмулируем структуру login response
  const synthLogin: BooksyLoginResponse = {
    access_token: accessToken,
    account: {
      id: 0,
      email: 'manual-token',
      first_name: 'Manual',
      last_name: 'Token',
    },
  }
  const persisted = await persistConnection(admin, salonId, synthLogin, business)
  if (!persisted.ok) {
    return jsonResponse({ ok: false, error: 'persist_failed', message: persisted.message }, 500)
  }

  return jsonResponse({
    ok: true,
    business: { id: business.id, name: business.name },
    account: { email: 'manual-token', name: 'Manual' },
  })
}

async function handleSync(
  admin: SupabaseClient,
  userId: string,
  salonId: string,
): Promise<Response> {
  if (!(await ensureMember(admin, userId, salonId))) {
    return jsonResponse({ ok: false, error: 'forbidden' }, 403)
  }

  const { data: integration } = await admin
    .from('salon_integrations')
    .select('credentials')
    .eq('salon_id', salonId)
    .eq('provider', 'booksy')
    .maybeSingle()
  if (!integration) return jsonResponse({ ok: false, error: 'not_connected' }, 404)

  const creds = integration.credentials as { access_token: string; business_id: number }

  let stats: SyncStats
  try {
    stats = await syncBooksyData(admin, salonId, creds.access_token, creds.business_id)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    await admin
      .from('salon_integrations')
      .update({ status: 'error', last_error: msg })
      .eq('salon_id', salonId)
      .eq('provider', 'booksy')
    return jsonResponse({ ok: false, error: 'sync_failed', message: msg }, 502)
  }

  await admin
    .from('salon_integrations')
    .update({
      status: 'connected',
      last_sync_at: new Date().toISOString(),
      last_sync_stats: stats,
      last_error: null,
    })
    .eq('salon_id', salonId)
    .eq('provider', 'booksy')

  return jsonResponse({ ok: true, stats })
}

// =============================================================================
// Entry
// =============================================================================

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return preflight()
  if (req.method !== 'POST') return jsonResponse({ ok: false, error: 'method_not_allowed' }, 405)
  if (!SUPABASE_URL || !SERVICE_KEY) {
    return jsonResponse({ ok: false, error: 'function_not_configured' }, 500)
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
    return jsonResponse({ ok: false, error: 'invalid_token', message: userErr?.message }, 401)
  }
  const userId = userRes.user.id

  let body: {
    action?: string
    salon_id?: string
    email?: string
    password?: string
    captcha_token?: string
    access_token?: string
  }
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ ok: false, error: 'bad_request' }, 400)
  }

  if (!body.salon_id) return jsonResponse({ ok: false, error: 'salon_id_required' }, 400)

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  switch (body.action) {
    case 'login':
      if (!body.email || !body.password || !body.captcha_token) {
        return jsonResponse({ ok: false, error: 'email_password_captcha_required' }, 400)
      }
      return handleLogin(
        admin,
        userId,
        body.salon_id,
        body.email,
        body.password,
        body.captcha_token,
      )
    case 'login_with_token':
      if (!body.access_token) {
        return jsonResponse({ ok: false, error: 'access_token_required' }, 400)
      }
      return handleLoginWithToken(admin, userId, body.salon_id, body.access_token)
    case 'sync':
      return handleSync(admin, userId, body.salon_id)
    default:
      return jsonResponse({ ok: false, error: 'unknown_action' }, 400)
  }
})
