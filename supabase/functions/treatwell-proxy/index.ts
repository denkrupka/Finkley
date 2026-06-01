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

async function login(loginField: string, password: string): Promise<AuthOk> {
  // Treatwell API teraz wymaga `{user, password, isPersistentLogin}` (monolit
  // wahanda backend). Старые `{email/username}` отвергаются с
  // 'Cannot build AuthenticationInput, some of required attributes are not set
  // [user, isPersistentLogin]'. Пробуем новый формат первым, fallback на
  // старые для legacy endpoints.
  const bodies = [
    JSON.stringify({ user: loginField, password, isPersistentLogin: true }),
    JSON.stringify({ user: loginField, password, isPersistentLogin: false }),
    JSON.stringify({ email: loginField, password }),
    JSON.stringify({ username: loginField, password }),
  ]
  let lastStatus = 0
  let lastText = ''
  let cookies = ''
  let txt = ''
  for (const body of bodies) {
    const r = await fetch(`${TREATWELL_BASE}/api/authentication.json`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        'x-requested-with': 'XMLHttpRequest',
        origin: TREATWELL_BASE,
        referer: `${TREATWELL_BASE}/login`,
        'user-agent': UA,
      },
      body,
    })
    txt = await r.text()
    lastStatus = r.status
    lastText = txt
    const setCookies = r.headers.get('set-cookie') ?? ''
    const c = extractCookies(setCookies)
    if (r.ok && c) {
      cookies = c
      break
    }
  }
  if (!cookies) {
    throw new Error(
      `treatwell_login_failed: HTTP ${lastStatus}${lastText ? ': ' + lastText.slice(0, 300) : ''}. Проверь email/пароль или 2FA.`,
    )
  }

  // Получаем venueId — пробуем несколько endpoints. HAR показал что body
  // у extranet-settings часто пустой/без venueId, поэтому добавляем
  // fallback'и + рекурсивный поиск.
  let venueId = ''
  const tryEndpoints = [
    '/api/extranet-settings.json',
    '/api/role-permissions.json',
    '/api/treatments.json',
  ]
  const fetched: Array<{ path: string; body: unknown }> = []
  for (const path of tryEndpoints) {
    try {
      const res = await fetch(`${TREATWELL_BASE}${path}`, {
        headers: { accept: 'application/json', cookie: cookies, 'user-agent': UA },
      })
      if (!res.ok) continue
      const data = await res.json().catch(() => null)
      if (!data) continue
      fetched.push({ path, body: data })
      const id = deepFindNumberField(data, 'venueId') ?? deepFindNumberField(data, 'venue_id')
      if (id) {
        venueId = String(id)
        break
      }
    } catch {
      /* try next */
    }
  }
  // Auth-response тоже проверяем
  if (!venueId) {
    try {
      const authJson = JSON.parse(txt)
      const id =
        deepFindNumberField(authJson, 'venueId') ?? deepFindNumberField(authJson, 'venue_id')
      if (id) venueId = String(id)
    } catch {
      /* ignore */
    }
  }
  if (!venueId) {
    const diag = fetched
      .map((f) => `${f.path}: ${JSON.stringify(f.body).slice(0, 200)}`)
      .join(' | ')
    throw new Error(
      `treatwell_no_venueid: не удалось извлечь venueId из API. Диагностика: ${diag.slice(0, 500)}`,
    )
  }
  return { sessionCookies: cookies, venueId }
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
