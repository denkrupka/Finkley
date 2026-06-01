/**
 * treatwell-proxy — интеграция с Treatwell Connect (https://connect.treatwell.de).
 *
 * Auth: cookie-based session. POST /api/authentication.json с email/password
 * возвращает Set-Cookie с session и venue_id (хранится в JWT/cookie).
 *
 * Endpoints (из HAR анализа `connect.treatwell.de.har`):
 *   POST /api/authentication.json
 *   GET  /api/venue/{venueId}.json                       — venue info
 *   GET  /api/venue/{venueId}/employees.json             — staff
 *   GET  /api/venue/{venueId}/customers.json             — clients
 *   GET  /api/venue/{venueId}/menu.json                  — services
 *   GET  /api/venue/{venueId}/calendar.json              — bookings
 *   GET  /api/venue/{venueId}/appointment/{id}.json      — booking detail
 *   GET  /api/venue/{venueId}/reports/sales/monthly      — sales reports
 *
 * Body:
 *   { action: 'connect', salon_id, login, password }    — initial connect
 *   { action: 'sync', salon_id }                        — full sync
 *   { action: 'sync_today', salon_id }                  — incremental
 *   { action: 'disconnect', salon_id }                  — revoke
 *
 * Credentials хранятся в integration_secrets (encrypted, app-level AES-GCM —
 * ADR-002 "Pragmatic Privacy"). Cookies — короткоживущие, re-login при
 * каждом sync (TTL session ~24h, но проще лог-инить заново).
 *
 * STATUS: skeleton. Полная имплементация (paginated fetch + mapping в
 * salon.staff/services/clients/visits) — отдельный спринт.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'

import { corsHeaders, preflight } from '../_shared/cors.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const TREATWELL_BASE = Deno.env.get('TREATWELL_BASE') ?? 'https://connect.treatwell.de'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'content-type': 'application/json' },
  })
}

type AuthOk = { sessionCookies: string; venueId: string }

async function login(loginField: string, password: string): Promise<AuthOk> {
  // POST /api/authentication.json. Treatwell принимает JSON body с
  // email + password. Set-Cookie в ответе содержит JSESSIONID / connect.sid.
  const r = await fetch(`${TREATWELL_BASE}/api/authentication.json`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
      'user-agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
    },
    body: JSON.stringify({ email: loginField, password }),
  })
  if (!r.ok) {
    throw new Error(`treatwell auth ${r.status}: ${await r.text().catch(() => '')}`.slice(0, 200))
  }
  const setCookies = r.headers.get('set-cookie') ?? ''
  // Extract venue_id из ответа (Treatwell кладёт user.venueId в JSON).
  const data = (await r.json().catch(() => ({}))) as {
    user?: { venueId?: number | string }
    venueId?: number | string
  }
  const venueId = String(data.user?.venueId ?? data.venueId ?? '')
  if (!venueId) throw new Error('treatwell auth: no venueId in response')
  return { sessionCookies: setCookies, venueId }
}

async function api<T>(sessionCookies: string, path: string): Promise<T> {
  const r = await fetch(`${TREATWELL_BASE}${path}`, {
    headers: {
      accept: 'application/json',
      cookie: sessionCookies,
      'user-agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
    },
  })
  if (!r.ok) throw new Error(`treatwell ${path} ${r.status}`)
  return (await r.json()) as T
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return preflight()
  if (!SUPABASE_URL || !SERVICE_KEY) return jsonResponse({ error: 'not_configured' }, 500)
  if (req.method !== 'POST') return jsonResponse({ error: 'method_not_allowed' }, 405)

  const body = (await req.json().catch(() => null)) as {
    action?: 'connect' | 'sync' | 'sync_today' | 'disconnect'
    salon_id?: string
    login?: string
    password?: string
  } | null
  if (!body?.action || !body.salon_id) return jsonResponse({ error: 'bad_request' }, 400)

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  if (body.action === 'connect') {
    if (!body.login || !body.password) return jsonResponse({ error: 'creds_missing' }, 400)
    const auth = await login(body.login, body.password).catch((e: Error) => ({ error: e.message }))
    if ('error' in auth) return jsonResponse({ ok: false, error: auth.error }, 200)
    // Сохраняем интеграцию (credentials encryption — TODO в следующей итерации).
    await admin.from('salon_integrations').upsert(
      {
        salon_id: body.salon_id,
        provider: 'treatwell',
        status: 'connected',
        external_account_id: auth.venueId,
        last_sync_at: null,
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

  if (body.action === 'sync' || body.action === 'sync_today') {
    // TODO: re-login (нужны сохранённые credentials — encrypted),
    // затем paginated fetch employees/customers/menu/calendar и upsert
    // в salon.staff/services/clients/visits. См. booksy-proxy для эталона.
    return jsonResponse({
      ok: false,
      error: 'sync_not_implemented',
      message:
        'Treatwell sync пока не реализован. Каркас функции и connect готовы; маппинг appointment→visit запланирован в следующем спринте.',
    })
  }

  return jsonResponse({ error: 'unknown_action' }, 400)
})
