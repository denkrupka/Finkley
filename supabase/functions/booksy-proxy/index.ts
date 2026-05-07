/**
 * booksy-proxy — интеграция с Booksy (PL marketplace бронирования).
 *
 * Auth-flow:
 *   1) Юзер вводит email/password в нашу форму
 *   2) Edge function решает hCaptcha через 2captcha.com (sitekey=2a8dae97-…)
 *   3) POST на pl.booksy.com/core/v2/business_api/account/login с x-api-key,
 *      x-fingerprint, x-hcaptcha-token + email/password в body
 *   4) Получаем access_token + account info → сохраняем в salon_integrations
 *
 * Sync-flow:
 *   - 'sync' action: GET /me/businesses → /me/businesses/{id}/resources (staff),
 *     service_categories (services), calendar (visits) → upsert в наши таблицы
 *
 * ENV:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   TWOCAPTCHA_API_KEY  — ключ от 2captcha.com (~$2/1000 решений)
 */

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'

import { corsHeaders, preflight } from '../_shared/cors.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const CAPSOLVER_KEY = Deno.env.get('CAPSOLVER_API_KEY') ?? ''
const TWOCAPTCHA_KEY = Deno.env.get('TWOCAPTCHA_API_KEY') ?? ''

// Статичные данные Booksy (вытащены из HAR-анализа их веб-кабинета)
const BOOKSY_API = 'https://pl.booksy.com/core/v2/business_api'
const BOOKSY_X_API_KEY = 'frontdesk-76661e2b-25f0-49b4-b33a-9d78957a58e3'
const BOOKSY_X_APP_VERSION = '3.0'
const HCAPTCHA_SITEKEY = '2a8dae97-de60-44fe-b289-b775a2616846'
const HCAPTCHA_PAGEURL = 'https://booksy.com/'
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'content-type': 'application/json' },
  })
}

// =============================================================================
// hCaptcha solving — capsolver primary, 2captcha fallback
// =============================================================================

async function solveViaCapsolver(): Promise<string> {
  if (!CAPSOLVER_KEY) throw new Error('capsolver_not_configured')
  // 1) Create task
  const createRes = await fetch('https://api.capsolver.com/createTask', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      clientKey: CAPSOLVER_KEY,
      task: {
        type: 'HCaptchaTaskProxyless',
        websiteURL: HCAPTCHA_PAGEURL,
        websiteKey: HCAPTCHA_SITEKEY,
      },
    }),
  })
  const createData = (await createRes.json()) as {
    errorId: number
    errorCode?: string
    errorDescription?: string
    taskId?: string
  }
  if (createData.errorId !== 0 || !createData.taskId) {
    throw new Error(
      `capsolver_create_failed: ${createData.errorDescription ?? createData.errorCode}`,
    )
  }

  // 2) Poll до ready (typical 15-30 sec)
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 3000))
    const r = await fetch('https://api.capsolver.com/getTaskResult', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ clientKey: CAPSOLVER_KEY, taskId: createData.taskId }),
    })
    const d = (await r.json()) as {
      errorId: number
      errorDescription?: string
      status?: string
      solution?: { gRecaptchaResponse?: string }
    }
    if (d.errorId !== 0) throw new Error(`capsolver_failed: ${d.errorDescription}`)
    if (d.status === 'ready' && d.solution?.gRecaptchaResponse) {
      return d.solution.gRecaptchaResponse
    }
  }
  throw new Error('capsolver_timeout')
}

async function solveVia2captcha(): Promise<string> {
  if (!TWOCAPTCHA_KEY) throw new Error('twocaptcha_not_configured')
  const inUrl = new URL('https://2captcha.com/in.php')
  inUrl.searchParams.set('key', TWOCAPTCHA_KEY)
  inUrl.searchParams.set('method', 'hcaptcha')
  inUrl.searchParams.set('sitekey', HCAPTCHA_SITEKEY)
  inUrl.searchParams.set('pageurl', HCAPTCHA_PAGEURL)
  inUrl.searchParams.set('json', '1')
  const inRes = await fetch(inUrl.toString())
  const inData = (await inRes.json()) as { status: number; request: string }
  if (inData.status !== 1) throw new Error(`2captcha_in_failed: ${inData.request}`)
  const resUrl = new URL('https://2captcha.com/res.php')
  resUrl.searchParams.set('key', TWOCAPTCHA_KEY)
  resUrl.searchParams.set('action', 'get')
  resUrl.searchParams.set('id', inData.request)
  resUrl.searchParams.set('json', '1')
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 3000))
    const r = await fetch(resUrl.toString())
    const d = (await r.json()) as { status: number; request: string }
    if (d.status === 1) return d.request
    if (d.request !== 'CAPCHA_NOT_READY') throw new Error(`2captcha_failed: ${d.request}`)
  }
  throw new Error('2captcha_timeout')
}

/**
 * Решаем hCaptcha через capsolver (быстрее/дешевле), с автоматическим
 * fallback на 2captcha если capsolver упал. Если оба не сконфигурены — error.
 */
async function solveHCaptcha(): Promise<string> {
  if (CAPSOLVER_KEY) {
    try {
      return await solveViaCapsolver()
    } catch (e) {
      console.warn('capsolver failed, fallback to 2captcha:', e instanceof Error ? e.message : e)
      if (!TWOCAPTCHA_KEY) throw e
    }
  }
  return solveVia2captcha()
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
    'x-fingerprint': crypto.randomUUID(),
    ...(extra ?? {}),
  }
  if (accessToken) h['authorization'] = `Bearer ${accessToken}`
  return h
}

type BooksyLoginResponse = {
  access_token: string
  account: {
    id: number
    email: string
    first_name: string
    last_name: string
    cell_phone?: string
  }
  access_rights: { access_level: string }
  password_change_required?: boolean
}

async function booksyLogin(
  email: string,
  password: string,
  hcaptchaToken: string,
): Promise<BooksyLoginResponse> {
  const res = await fetch(`${BOOKSY_API}/account/login`, {
    method: 'POST',
    headers: booksyHeaders(undefined, { 'x-hcaptcha-token': hcaptchaToken }),
    body: JSON.stringify({ email, password }),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`booksy_login_failed: HTTP ${res.status}: ${text.slice(0, 300)}`)
  return JSON.parse(text) as BooksyLoginResponse
}

async function booksyGet<T = unknown>(path: string, accessToken: string): Promise<T> {
  const res = await fetch(`${BOOKSY_API}${path}`, { headers: booksyHeaders(accessToken) })
  if (!res.ok) {
    const t = await res.text()
    throw new Error(`booksy_${path}_failed: HTTP ${res.status}: ${t.slice(0, 200)}`)
  }
  return (await res.json()) as T
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

  // 1) Staff (resources)
  type ResourcesResp = { resources?: { id: number; name: string; is_active?: boolean }[] }
  const resourcesData = await booksyGet<ResourcesResp>(
    `/me/businesses/${businessId}/resources`,
    accessToken,
  )
  for (const r of resourcesData.resources ?? []) {
    const externalId = `booksy:${r.id}`
    // Upsert по (salon_id, source, external_id) — добавим source-mapping в будущем,
    // сейчас простой findOrCreate by name.
    const { data: existing } = await admin
      .from('staff')
      .select('id')
      .eq('salon_id', salonId)
      .eq('full_name', r.name)
      .is('deleted_at', null)
      .maybeSingle()
    if (!existing) {
      await admin.from('staff').insert({
        salon_id: salonId,
        full_name: r.name,
        payout_scheme: 'percent_revenue',
        payout_percent: 40,
        is_active: r.is_active !== false,
      })
      stats.staff_synced++
    }
  }

  // 2) Services
  type SvcResp = {
    service_categories?: {
      id: number
      name: string
      services?: { id: number; name: string; price?: { amount?: number }; duration?: number }[]
    }[]
  }
  const svcData = await booksyGet<SvcResp>(
    `/me/businesses/${businessId}/service_categories`,
    accessToken,
  )
  for (const cat of svcData.service_categories ?? []) {
    for (const s of cat.services ?? []) {
      const { data: existing } = await admin
        .from('services')
        .select('id')
        .eq('salon_id', salonId)
        .eq('name', s.name)
        .eq('is_archived', false)
        .maybeSingle()
      if (!existing) {
        await admin.from('services').insert({
          salon_id: salonId,
          name: s.name,
          default_price_cents: Math.round((s.price?.amount ?? 0) * 100),
          default_duration_min: s.duration ?? null,
        })
        stats.services_synced++
      }
    }
  }

  // 3) Visits — через calendar endpoint. Параметры endpoint'а из HAR не видны;
  // для MVP синкаем только factal расписание следующего шага. TODO: уточнить
  // формат фильтров по датам когда будет 2-й HAR с открытым календарём.
  // Пока: помечаем что эту часть надо добиться отдельно.

  return stats
}

// =============================================================================
// Action handlers
// =============================================================================

async function handleLogin(
  admin: SupabaseClient,
  userId: string,
  salonId: string,
  email: string,
  password: string,
): Promise<Response> {
  // Membership check
  const { data: membership } = await admin
    .from('salon_members')
    .select('role')
    .eq('salon_id', salonId)
    .eq('user_id', userId)
    .maybeSingle()
  if (!membership) return jsonResponse({ error: 'forbidden' }, 403)

  // 1) Solve hCaptcha
  let hcaptchaToken: string
  try {
    hcaptchaToken = await solveHCaptcha()
  } catch (e) {
    return jsonResponse(
      { error: 'captcha_failed', message: e instanceof Error ? e.message : String(e) },
      502,
    )
  }

  // 2) Booksy login
  let login: BooksyLoginResponse
  try {
    login = await booksyLogin(email, password, hcaptchaToken)
  } catch (e) {
    return jsonResponse(
      { error: 'booksy_login_failed', message: e instanceof Error ? e.message : String(e) },
      401,
    )
  }

  // 3) Get businesses (нужен business_id для дальнейших запросов)
  type BusinessesResp = { businesses?: { id: number; name: string }[] }
  let businesses: BusinessesResp
  try {
    businesses = await booksyGet<BusinessesResp>('/me/businesses', login.access_token)
  } catch (e) {
    return jsonResponse(
      { error: 'businesses_failed', message: e instanceof Error ? e.message : String(e) },
      502,
    )
  }
  const business = businesses.businesses?.[0]
  if (!business) return jsonResponse({ error: 'no_businesses_in_account' }, 400)

  // 4) Save in salon_integrations
  const credentials = {
    access_token: login.access_token,
    business_id: business.id,
    business_name: business.name,
    account_id: login.account.id,
    account_email: login.account.email,
    access_level: login.access_rights?.access_level,
    last_token_at: new Date().toISOString(),
  }
  const { error: upsertErr } = await admin.from('salon_integrations').upsert(
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
  if (upsertErr) return jsonResponse({ error: 'upsert_failed', message: upsertErr.message }, 500)

  return jsonResponse({
    ok: true,
    business: { id: business.id, name: business.name },
    account: { email: login.account.email, name: `${login.account.first_name}` },
  })
}

async function handleSync(
  admin: SupabaseClient,
  userId: string,
  salonId: string,
): Promise<Response> {
  const { data: membership } = await admin
    .from('salon_members')
    .select('role')
    .eq('salon_id', salonId)
    .eq('user_id', userId)
    .maybeSingle()
  if (!membership) return jsonResponse({ error: 'forbidden' }, 403)

  const { data: integration } = await admin
    .from('salon_integrations')
    .select('credentials')
    .eq('salon_id', salonId)
    .eq('provider', 'booksy')
    .maybeSingle()
  if (!integration) return jsonResponse({ error: 'not_connected' }, 404)

  const creds = integration.credentials as {
    access_token: string
    business_id: number
  }

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
    return jsonResponse({ error: 'sync_failed', message: msg }, 502)
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
  if (req.method !== 'POST') return jsonResponse({ error: 'method_not_allowed' }, 405)
  if (!SUPABASE_URL || !SERVICE_KEY) {
    return jsonResponse({ error: 'function_not_configured' }, 500)
  }

  // Auth — JWT юзера
  const authHeader = req.headers.get('Authorization') ?? ''
  if (!authHeader.startsWith('Bearer ')) return jsonResponse({ error: 'unauthorized' }, 401)
  const userJwt = authHeader.slice('Bearer '.length)

  const userClient = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${userJwt}` } },
  })
  const { data: userRes, error: userErr } = await userClient.auth.getUser()
  if (userErr || !userRes?.user) {
    return jsonResponse({ error: 'invalid_token', message: userErr?.message }, 401)
  }
  const userId = userRes.user.id

  let body: { action?: string; salon_id?: string; email?: string; password?: string }
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: 'bad_request' }, 400)
  }

  if (!body.salon_id) return jsonResponse({ error: 'salon_id_required' }, 400)

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  switch (body.action) {
    case 'login':
      if (!body.email || !body.password) {
        return jsonResponse({ error: 'email_password_required' }, 400)
      }
      return handleLogin(admin, userId, body.salon_id, body.email, body.password)
    case 'sync':
      return handleSync(admin, userId, body.salon_id)
    default:
      return jsonResponse({ error: 'unknown_action' }, 400)
  }
})
