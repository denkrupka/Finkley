/**
 * sync.mjs — воркер синка Treatwell. Запускается на GitHub Actions (Node), НЕ
 * на Supabase Edge: с IP Supabase Cloudflare режет Capsolver-токен
 * (NOT_VERIFIED_CAPTCHA), а с раннера GitHub — принимает (проверено 08.06.2026).
 *
 * Флоу: Capsolver решает Turnstile → POST /api/authentication.json (логин/пароль
 * клиента) → session cookies → venueId из extranet-settings (venue.id) → синк
 * staff/services/clients/visits в Supabase.
 *
 * Env:
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY  — для записи (не нужны в DRY_RUN)
 *   CAPSOLVER_API_KEY                         — обязателен
 *   TREATWELL_BASE                            — опц., по умолч. connect.treatwell.de
 *   DRY_RUN=1 + TREATWELL_LOGIN/PASSWORD      — тест без БД: логин + counts
 *   ONLY_SALON=<uuid>                         — опц., синкать один салон
 */
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.SUPABASE_URL ?? ''
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
const CAPSOLVER_API_KEY = process.env.CAPSOLVER_API_KEY ?? ''
const TREATWELL_BASE = process.env.TREATWELL_BASE ?? 'https://connect.treatwell.de'
const DRY_RUN = process.env.DRY_RUN === '1'
const ONLY_SALON = process.env.ONLY_SALON || null
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const log = (...a) => console.log('[tw-sync]', ...a)

// Sitekey Turnstile по hostname (из бандла connect-app, SITE_WIDGETS).
const SITE_WIDGETS = [
  { key: '0x4AAAAAABgnlBz83RjqFbqR', domains: ['twbox.io', 'twtest.io'] },
  {
    key: '0x4AAAAAABgnyMs1otzyQX5B',
    domains: ['treatwell.at', 'treatwell.be', 'treatwell.de', 'treatwell.es', 'treatwell.fr', 'treatwell.it', 'treatwell.lt', 'treatwell.nl', 'treatwell.co.uk', 'treatwell.dk', 'treatwell.lv', 'treatwell.pt'],
  },
  { key: '0x4AAAAAABgnydbWugkFafO_', domains: ['treatwell.ie', 'treatwell.ch'] },
]
function sitekeyForHost(host) {
  for (const w of SITE_WIDGETS) if (w.domains.some((d) => host.endsWith(d))) return w.key
  return null
}

function extractCookies(sc) {
  if (!sc) return ''
  return sc
    .split(/,(?=\s*[A-Za-z0-9_-]+=)/)
    .map((c) => c.split(';')[0].trim())
    .filter(Boolean)
    .join('; ')
}

// ── venueId discovery ──
function deepFindNumberField(obj, name) {
  if (!obj || typeof obj !== 'object') return undefined
  for (const [k, v] of Object.entries(obj)) {
    if (k === name && (typeof v === 'number' || (typeof v === 'string' && /^\d+$/.test(v)))) return Number(v)
    if (v && typeof v === 'object') { const f = deepFindNumberField(v, name); if (f !== undefined) return f }
  }
  return undefined
}
function deepFindNestedId(obj, parents) {
  if (!obj || typeof obj !== 'object') return undefined
  for (const [k, v] of Object.entries(obj)) {
    if (parents.includes(k) && v && typeof v === 'object') {
      const id = v.id
      if (typeof id === 'number') return id
      if (typeof id === 'string' && /^\d+$/.test(id)) return Number(id)
    }
    if (v && typeof v === 'object') { const f = deepFindNestedId(v, parents); if (f !== undefined) return f }
  }
  return undefined
}
function findVenueId(data) {
  // Приоритет: vложенный venue.id (как у "нестандартных" аккаунтов — extranet
  // -settings.venue.id), затем поля-имена, затем массивы.
  const nested = deepFindNestedId(data, ['venue', 'currentVenue', 'current_venue'])
  if (nested) return String(nested)
  for (const name of ['venueId', 'venue_id', 'currentVenueId', 'defaultVenueId']) {
    const id = deepFindNumberField(data, name)
    if (id) return String(id)
  }
  return null
}

async function solveTurnstile(siteUrl, siteKey) {
  if (!CAPSOLVER_API_KEY) throw new Error('CAPSOLVER_API_KEY not set')
  const cr = await fetch('https://api.capsolver.com/createTask', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ clientKey: CAPSOLVER_API_KEY, task: { type: 'AntiTurnstileTaskProxyLess', websiteURL: siteUrl, websiteKey: siteKey } }),
  })
  const cj = await cr.json()
  if (cj.errorId || !cj.taskId) throw new Error('capsolver createTask: ' + JSON.stringify(cj))
  for (let i = 0; i < 30; i++) {
    await sleep(3000)
    const r = await fetch('https://api.capsolver.com/getTaskResult', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ clientKey: CAPSOLVER_API_KEY, taskId: cj.taskId }),
    })
    const j = await r.json()
    if (j.errorId) throw new Error('capsolver getTaskResult: ' + JSON.stringify(j))
    if (j.status === 'ready') return j.solution.token
  }
  throw new Error('capsolver timeout')
}

async function login(loginField, password) {
  if (!loginField || !password) throw new Error('creds_missing')
  const host = new URL(TREATWELL_BASE).hostname
  const siteKey = sitekeyForHost(host)
  if (!siteKey) throw new Error('no_sitekey_for_host:' + host)
  const token = await solveTurnstile(`${TREATWELL_BASE}/login`, siteKey)

  // preflight для session-cookie
  let cookies = ''
  try {
    const p = await fetch(`${TREATWELL_BASE}/login`, { headers: { accept: 'text/html', 'user-agent': UA } })
    cookies = extractCookies(p.headers.get('set-cookie'))
    await p.text()
  } catch {}

  const r = await fetch(`${TREATWELL_BASE}/api/authentication.json`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/plain, */*',
      'x-requested-with': 'XMLHttpRequest',
      origin: TREATWELL_BASE,
      referer: `${TREATWELL_BASE}/login`,
      'user-agent': UA,
      ...(cookies ? { cookie: cookies } : {}),
    },
    body: JSON.stringify({ user: loginField, password, persistentLogin: true, turnstileToken: token }),
  })
  const txt = await r.text()
  if (/NOT_VERIFIED_CAPTCHA/i.test(txt)) throw new Error('treatwell_captcha_rejected')
  if (/NOT_RECOGNISED|NOT_AUTHENTICATED|invalidCredentials/i.test(txt)) throw new Error('treatwell_invalid_credentials')
  const setC = extractCookies(r.headers.get('set-cookie'))
  const sessionCookies = cookies ? `${cookies}; ${setC}` : setC
  if (!/AUTHENTICATED/i.test(txt) && !setC) throw new Error('treatwell_login_failed: ' + txt.slice(0, 120))

  // venueId из extranet-settings
  const es = await apiGet(sessionCookies, '/api/extranet-settings.json')
  const venueId = findVenueId(es)
  if (!venueId) throw new Error('treatwell_no_venueid')
  return { sessionCookies, venueId, vatRates: es?.channel?.vatRates ?? [] }
}

async function apiGet(cookies, path) {
  const r = await fetch(`${TREATWELL_BASE}${path}`, {
    headers: { accept: 'application/json', cookie: cookies, 'x-requested-with': 'XMLHttpRequest', 'user-agent': UA },
  })
  if (!r.ok) throw new Error(`GET ${path} ${r.status}: ${(await r.text()).slice(0, 120)}`)
  return r.json()
}

// ── sync ──
async function fetchStaff(cookies, venueId) {
  const d = await apiGet(cookies, `/api/venue/${venueId}/employees.json?active=true&takes-appointments=true`)
  return (d.employees ?? []).map((e) => ({
    external_id: String(e.id),
    full_name: e.name?.trim() || 'Без имени',
    email: e.emailAddress ?? null,
    is_active: e.active !== false,
  }))
}
async function fetchServices(cookies, venueId) {
  const d = await apiGet(cookies, `/api/venue/${venueId}/menu.json`)
  return (d.offers ?? [])
    .filter((o) => o.active !== false)
    .map((o) => {
      const from = o.pricing?.from ?? 0
      const to = o.pricing?.to ?? from
      return {
        external_id: String(o.id),
        name: o.name?.trim() || 'Услуга',
        default_price_cents: Math.round(((from + to) / 2) * 100),
        default_duration_min: o.durationMinutes ?? 60,
      }
    })
}
async function fetchClients(cookies, venueId) {
  const out = []
  for (let start = 0; start < 100000; start += 100) {
    const d = await apiGet(cookies, `/api/venue/${venueId}/customers.json?count=100&start=${start}`)
    const cs = d.customers ?? []
    if (cs.length === 0) break
    for (const c of cs)
      out.push({
        external_id: String(c.id),
        name: `${c.firstName ?? ''} ${c.lastName ?? ''}`.trim() || 'Клиент',
        email: c.emailAddress ?? null,
        phone: c.mobile ?? c.phone ?? null,
        notes: c.notes ?? null,
      })
    if (cs.length < 100) break
  }
  return out
}
async function fetchAppointments(cookies, venueId, daysBack) {
  const today = new Date()
  const start = new Date(today.getTime() - daysBack * 86400000)
  const end = new Date(today.getTime() + 7 * 86400000)
  const out = []
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const dateStr = d.toISOString().slice(0, 10)
    let data
    try {
      data = await apiGet(cookies, `/api/venue/${venueId}/calendar.json?date=${dateStr}`)
    } catch (e) {
      continue
    }
    for (const a of data.appointments ?? []) out.push(a)
  }
  return out
}

async function syncSalon(admin, salonId, login_, password) {
  const { sessionCookies, venueId } = await login(login_, password)
  log(`salon ${salonId}: venueId=${venueId}`)

  const staff = await fetchStaff(sessionCookies, venueId)
  await upsertByExternal(admin, 'staff', salonId, staff.map((s) => ({ salon_id: salonId, external_source: 'treatwell', ...s })))

  const services = await fetchServices(sessionCookies, venueId)
  await upsertByExternal(admin, 'services', salonId, services.map((s) => ({ salon_id: salonId, external_source: 'treatwell', ...s })))

  const clients = await fetchClients(sessionCookies, venueId)
  await upsertByExternal(admin, 'clients', salonId, clients.map((c) => ({ salon_id: salonId, external_source: 'treatwell', ...c })))

  // FK-мапа
  const [{ data: staffRows }, { data: serviceRows }, { data: clientRows }] = await Promise.all([
    admin.from('staff').select('id, external_id').eq('salon_id', salonId).eq('external_source', 'treatwell'),
    admin.from('services').select('id, external_id').eq('salon_id', salonId).eq('external_source', 'treatwell'),
    admin.from('clients').select('id, external_id').eq('salon_id', salonId).eq('external_source', 'treatwell'),
  ])
  const sMap = new Map((staffRows ?? []).map((r) => [r.external_id, r.id]))
  const svMap = new Map((serviceRows ?? []).map((r) => [r.external_id, r.id]))
  const cMap = new Map((clientRows ?? []).map((r) => [r.external_id, r.id]))

  const appts = await fetchAppointments(sessionCookies, venueId, 30)
  const visitRows = appts
    .map((a) => {
      const priceCents = Math.round((a.price?.amount ?? a.priceAmount ?? 0) * 100)
      const status = a.status === 'CANCELLED' ? 'cancelled' : 'paid'
      return {
        salon_id: salonId,
        source: 'treatwell',
        external_id: String(a.id),
        visit_at: new Date(a.startTime).toISOString(),
        staff_id: a.employeeId ? sMap.get(String(a.employeeId)) ?? null : null,
        client_id: a.customerId ? cMap.get(String(a.customerId)) ?? null : null,
        service_id: a.offerId ? svMap.get(String(a.offerId)) ?? null : null,
        amount_cents: priceCents,
        discount_cents: 0,
        tip_cents: 0,
        status,
      }
    })
    .filter((r) => r.amount_cents > 0 || r.client_id || r.staff_id)
  if (visitRows.length)
    await upsert(admin, 'visits', visitRows, 'salon_id,source,external_id', true)

  return { staff: staff.length, services: services.length, clients: clients.length, visits: visitRows.length }
}

async function upsert(admin, table, rows, onConflict, ignoreDuplicates = false) {
  const { error } = await admin.from(table).upsert(rows, { onConflict, ignoreDuplicates })
  if (error) throw new Error(`upsert ${table}: ${error.message}`)
}

/**
 * Ручной upsert по (salon_id, external_source='treatwell', external_id) для
 * staff/services/clients: их unique-индексы ПАРТИАЛЬНЫЕ (where external_id is
 * not null), и PostgREST не матчит их в ON CONFLICT. Select → insert новых +
 * update существующих по id (сохраняет FK из visits).
 */
async function upsertByExternal(admin, table, salonId, rows) {
  if (!rows.length) return
  const extIds = rows.map((r) => r.external_id)
  const { data: existing, error: selErr } = await admin
    .from(table)
    .select('id, external_id')
    .eq('salon_id', salonId)
    .eq('external_source', 'treatwell')
    .in('external_id', extIds)
  if (selErr) throw new Error(`select ${table}: ${selErr.message}`)
  const byExt = new Map((existing ?? []).map((r) => [r.external_id, r.id]))
  const toInsert = rows.filter((r) => !byExt.has(r.external_id))
  if (toInsert.length) {
    const { error } = await admin.from(table).insert(toInsert)
    if (error) throw new Error(`insert ${table}: ${error.message}`)
  }
  for (const r of rows) {
    const id = byExt.get(r.external_id)
    if (!id) continue
    const { external_id, external_source, salon_id, ...patch } = r
    const { error } = await admin.from(table).update(patch).eq('id', id)
    if (error) throw new Error(`update ${table}: ${error.message}`)
  }
}

async function main() {
  if (!CAPSOLVER_API_KEY) { console.error('FATAL: CAPSOLVER_API_KEY not set'); process.exit(2) }

  if (DRY_RUN) {
    const L = process.env.TREATWELL_LOGIN, P = process.env.TREATWELL_PASSWORD
    if (!L || !P) { console.error('DRY_RUN: нужны TREATWELL_LOGIN/PASSWORD'); process.exit(2) }
    log('DRY_RUN: логин + подсчёт (без БД)')
    const { sessionCookies, venueId } = await login(L, P)
    log('venueId:', venueId)
    const staff = await fetchStaff(sessionCookies, venueId)
    const services = await fetchServices(sessionCookies, venueId)
    const clients = await fetchClients(sessionCookies, venueId)
    const appts = await fetchAppointments(sessionCookies, venueId, 30)
    log(`✅ staff=${staff.length} services=${services.length} clients=${clients.length} appointments(37д)=${appts.length}`)
    if (staff[0]) log('пример мастера:', JSON.stringify(staff[0]))
    if (services[0]) log('пример услуги:', JSON.stringify(services[0]))
    return
  }

  if (!SUPABASE_URL || !SERVICE_KEY) { console.error('FATAL: SUPABASE_URL/SERVICE_ROLE_KEY not set'); process.exit(2) }
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })

  let q = admin
    .from('salon_integrations')
    .select('salon_id, credentials, status, sync_interval_minutes, last_sync_at')
    .eq('provider', 'treatwell')
    .in('status', ['pending', 'connected'])
  if (ONLY_SALON) q = q.eq('salon_id', ONLY_SALON)
  const { data: allIntegs, error } = await q
  if (error) { console.error('select salon_integrations:', error.message); process.exit(1) }

  // ONLY_SALON (ручной запуск / dispatch при подключении) — синкаем сразу,
  // игнорируя интервал. Cron — только «просроченные» по sync_interval_minutes.
  const integs = (allIntegs ?? []).filter((it) => {
    if (ONLY_SALON || it.status === 'pending') return true
    const interval = it.sync_interval_minutes ?? 60
    if (!it.last_sync_at) return true
    return Date.now() - new Date(it.last_sync_at).getTime() >= interval * 60000
  })
  log(`салонов к синку: ${integs.length} (всего treatwell: ${allIntegs?.length ?? 0})`)

  let failures = 0
  for (const it of integs) {
    const creds = it.credentials || {}
    try {
      const stats = await syncSalon(admin, it.salon_id, creds.login, creds.password)
      await admin
        .from('salon_integrations')
        .update({ status: 'connected', last_sync_at: new Date().toISOString(), last_sync_stats: stats, last_error: null })
        .eq('salon_id', it.salon_id)
        .eq('provider', 'treatwell')
      log(`✅ ${it.salon_id}:`, JSON.stringify(stats))
    } catch (e) {
      failures++
      const msg = e?.message ?? String(e)
      console.error(`❌ ${it.salon_id}: ${msg}`)
      await admin
        .from('salon_integrations')
        .update({ status: 'error', last_error: msg })
        .eq('salon_id', it.salon_id)
        .eq('provider', 'treatwell')
    }
  }
  if (failures > 0) process.exit(1)
}

main().catch((e) => { console.error('[tw-sync] FATAL', e?.stack || e); process.exit(1) })
