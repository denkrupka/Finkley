/**
 * send-weekly-digest — собирает KPI прошлой недели и отправляет дайджест-email.
 *
 * Два режима:
 *   1) **Manual** (из Settings UI): { salon_id } + Authorization: Bearer <user_jwt>.
 *      Проверяем JWT юзера, что он член салона + что digest включён.
 *      Шлём дайджест на email юзера для одного салона.
 *
 *   2) **Cron** (понедельник 09:00 UTC): { token, cron: true } БЕЗ JWT.
 *      Token — одноразовый uuid из таблицы digest_triggers, создан SQL-cron'ом
 *      перед вызовом. Валидируем (не used, не expired) → помечаем used.
 *      Перебираем ВСЕ салоны с weekly_digest_enabled=true → для каждого находим
 *      owner'а → шлём дайджест на его email.
 *
 * Auth: deploy --no-verify-jwt. Manual mode сам валидирует JWT через
 * admin.auth.getUser(jwt). Cron mode валидирует через token-rendezvous в БД.
 *
 * ENV:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   FUNCTION_INTERNAL_SECRET    — для notify.sendEmail
 *   APP_URL                     — куда вести из письма
 */

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'

import { corsHeaders, preflight } from '../_shared/cors.ts'
import { sendEmail } from '../_shared/notify.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const APP_URL = Deno.env.get('APP_URL') ?? 'https://finkley.app/app/'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'content-type': 'application/json' },
  })
}

function formatCents(cents: number, currency: string): string {
  return new Intl.NumberFormat('ru-RU', { style: 'currency', currency }).format(cents / 100)
}

function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-')
  return `${d}.${m}.${y}`
}

function deltaPercent(current: number, previous: number): { text: string; color: string } {
  if (previous === 0) {
    return { text: current === 0 ? '— без изменений' : 'новая неделя', color: '#64748b' }
  }
  const pct = ((current - previous) / Math.abs(previous)) * 100
  const sign = pct >= 0 ? '+' : ''
  const color = pct >= 0 ? '#047857' : '#dc2626'
  return { text: `${sign}${pct.toFixed(1)}% к прошлой`, color }
}

type KpiRow = {
  period_start: string
  period_end: string
  revenue_cents: number
  expense_cents: number
  profit_cents: number
  visits_count: number
  prev_revenue_cents: number
  top_staff_name: string | null
  top_staff_revenue_cents: number | null
  top_service_name: string | null
  top_service_revenue_cents: number | null
}

/**
 * Собирает дайджест и шлёт письмо для одного салона + одного получателя.
 * Возвращает { sent: bool, reason } для логирования из cron-режима.
 */
async function sendDigestForSalon(
  admin: SupabaseClient,
  salon: { id: string; name: string | null; currency: string | null },
  recipientEmail: string,
  recipientName: string,
): Promise<{ sent: boolean; reason?: string }> {
  if (!recipientEmail) return { sent: false, reason: 'no_email' }

  const { data: kpis, error: kpiErr } = await admin
    .rpc('weekly_digest_kpis', { p_salon_id: salon.id })
    .single()
  if (kpiErr || !kpis) return { sent: false, reason: kpiErr?.message ?? 'kpi_failed' }

  const k = kpis as KpiRow
  const currency = salon.currency ?? 'PLN'
  const revDelta = deltaPercent(Number(k.revenue_cents), Number(k.prev_revenue_cents))

  let topBlock = ''
  if (k.top_staff_name && Number(k.top_staff_revenue_cents) > 0) {
    topBlock += `<p style="margin:0 0 8px 0;font-size:14px;color:#334155;">🏆 Топ-мастер: <strong>${k.top_staff_name}</strong> · ${formatCents(Number(k.top_staff_revenue_cents), currency)}</p>`
  }
  if (k.top_service_name && Number(k.top_service_revenue_cents) > 0) {
    topBlock += `<p style="margin:0 0 8px 0;font-size:14px;color:#334155;">⭐ Топ-услуга: <strong>${k.top_service_name}</strong> · ${formatCents(Number(k.top_service_revenue_cents), currency)}</p>`
  }
  if (Number(k.visits_count) === 0) {
    topBlock = `<p style="margin:0 0 8px 0;font-size:14px;color:#64748b;font-style:italic;">На этой неделе визитов не было — отдыхаешь?</p>`
  }

  await sendEmail('weekly_digest', recipientEmail, {
    full_name: recipientName,
    salon_name: salon.name ?? 'Салон',
    period_start: formatDate(k.period_start),
    period_end: formatDate(k.period_end),
    revenue: formatCents(Number(k.revenue_cents), currency),
    expense: formatCents(Number(k.expense_cents), currency),
    profit: formatCents(Number(k.profit_cents), currency),
    visits_count: String(k.visits_count),
    revenue_delta: revDelta.text,
    revenue_delta_color: revDelta.color,
    top_block: topBlock,
    app_url: `${APP_URL}${salon.id}/reports`,
  })
  return { sent: true }
}

// =============================================================================
// Cron mode: token rendezvous → broadcast всем активным салонам
// =============================================================================

async function handleCron(admin: SupabaseClient, token: string): Promise<Response> {
  // Валидация токена: должен существовать, не used, не expired
  const { data: trigger, error: tErr } = await admin
    .from('digest_triggers')
    .select('token, used_at, expires_at')
    .eq('token', token)
    .maybeSingle()
  if (tErr || !trigger) return jsonResponse({ error: 'token_not_found' }, 401)
  if (trigger.used_at) return jsonResponse({ error: 'token_already_used' }, 401)
  if (new Date(trigger.expires_at) < new Date()) {
    return jsonResponse({ error: 'token_expired' }, 401)
  }
  // Помечаем used атомарно — на случай double-fire от cron (раз в неделю
  // не должен случиться, но для надёжности)
  const { error: markErr } = await admin
    .from('digest_triggers')
    .update({ used_at: new Date().toISOString() })
    .eq('token', token)
    .is('used_at', null)
  if (markErr) return jsonResponse({ error: 'token_mark_failed' }, 500)

  // Все активные салоны с включённым дайджестом
  const { data: salons, error: sErr } = await admin
    .from('salons')
    .select('id, name, currency, weekly_digest_enabled, deleted_at')
    .eq('weekly_digest_enabled', true)
    .is('deleted_at', null)
  if (sErr) return jsonResponse({ error: 'salons_query_failed', message: sErr.message }, 500)

  const stats = { total: salons?.length ?? 0, sent: 0, skipped: 0, errors: [] as string[] }

  for (const salon of salons ?? []) {
    // Owner салона — берём первого с role='owner'
    const { data: members } = await admin
      .from('salon_members')
      .select('user_id, role')
      .eq('salon_id', salon.id)
      .eq('role', 'owner')
      .limit(1)
    const ownerId = members?.[0]?.user_id
    if (!ownerId) {
      stats.skipped++
      continue
    }

    const { data: userData, error: uErr } = await admin.auth.admin.getUserById(ownerId)
    if (uErr || !userData?.user?.email) {
      stats.skipped++
      continue
    }
    const owner = userData.user
    const ownerName =
      (owner.user_metadata?.full_name as string | undefined) ??
      (owner.user_metadata?.name as string | undefined) ??
      owner.email!.split('@')[0] ??
      'друг'

    try {
      const r = await sendDigestForSalon(admin, salon, owner.email!, ownerName)
      if (r.sent) stats.sent++
      else stats.skipped++
    } catch (e) {
      stats.errors.push(`${salon.id}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  return jsonResponse({ ok: true, mode: 'cron', stats })
}

// =============================================================================
// Manual mode: user JWT + salon_id
// =============================================================================

async function handleManual(
  admin: SupabaseClient,
  userJwt: string,
  salonId: string,
): Promise<Response> {
  const userClient = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${userJwt}` } },
  })

  const { data: userRes, error: userErr } = await userClient.auth.getUser()
  if (userErr || !userRes?.user) {
    return jsonResponse({ error: 'invalid_token', message: userErr?.message }, 401)
  }
  const user = userRes.user
  const userEmail = user.email ?? ''
  const userName =
    (user.user_metadata?.full_name as string | undefined) ??
    (user.user_metadata?.name as string | undefined) ??
    userEmail.split('@')[0] ??
    'друг'

  // Membership check через user-client (RLS гарантирует privacy)
  const { data: salon, error: salonErr } = await userClient
    .from('salons')
    .select('id, name, currency, weekly_digest_enabled')
    .eq('id', salonId)
    .maybeSingle()
  if (salonErr || !salon) return jsonResponse({ error: 'salon_not_found_or_no_access' }, 403)
  if (!salon.weekly_digest_enabled) return jsonResponse({ error: 'digest_disabled' }, 409)

  const r = await sendDigestForSalon(admin, salon, userEmail, userName)
  if (!r.sent) return jsonResponse({ error: r.reason ?? 'send_failed' }, 500)
  return jsonResponse({ ok: true, mode: 'manual', salon_id: salonId, sent_to: userEmail })
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

  let body: { salon_id?: string; token?: string; cron?: boolean }
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: 'bad_request' }, 400)
  }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  // Cron mode: token-based, no JWT
  if (body.cron && body.token) {
    return handleCron(admin, body.token)
  }

  // Manual mode: JWT + salon_id
  const authHeader = req.headers.get('Authorization') ?? ''
  if (!authHeader.startsWith('Bearer ')) return jsonResponse({ error: 'unauthorized' }, 401)
  if (!body.salon_id) return jsonResponse({ error: 'salon_id_required' }, 400)
  return handleManual(admin, authHeader.slice('Bearer '.length), body.salon_id)
})
