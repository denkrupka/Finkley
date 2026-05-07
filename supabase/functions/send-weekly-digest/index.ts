/**
 * send-weekly-digest — собирает KPI прошлой недели для конкретного салона
 * и отправляет дайджест-email юзеру, который дёрнул endpoint.
 *
 * Триггеры:
 *   1) Ручной из Settings UI: { salon_id } + Authorization: Bearer <user_jwt>.
 *      Проверяем что юзер — член салона + что у салона `weekly_digest_enabled=true`.
 *   2) Будущий cron (TODO): X-Finkley-Secret + опциональный salon_id для broadcast.
 *      Пока не активен — нужна разовая настройка vault для service_role JWT.
 *
 * Auth: verify-jwt: true в платформе. Внутри дополнительно валидируем
 * membership через RLS-aware userClient.
 *
 * ENV:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   FUNCTION_INTERNAL_SECRET    — для notify.sendEmail
 *   APP_URL                     — куда вести из письма
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'

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

function deltaPercent(
  current: number,
  previous: number,
): {
  text: string
  color: string
} {
  if (previous === 0) {
    return { text: current === 0 ? '— без изменений' : 'новая неделя', color: '#64748b' }
  }
  const pct = ((current - previous) / Math.abs(previous)) * 100
  const sign = pct >= 0 ? '+' : ''
  const color = pct >= 0 ? '#047857' : '#dc2626'
  return { text: `${sign}${pct.toFixed(1)}% к прошлой`, color }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return preflight()
  if (req.method !== 'POST') return jsonResponse({ error: 'method_not_allowed' }, 405)
  if (!SUPABASE_URL || !SERVICE_KEY) {
    return jsonResponse({ error: 'function_not_configured' }, 500)
  }

  // Auth — JWT юзера
  const authHeader = req.headers.get('Authorization') ?? ''
  if (!authHeader.startsWith('Bearer ')) {
    return jsonResponse({ error: 'unauthorized' }, 401)
  }
  const userJwt = authHeader.slice('Bearer '.length)

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

  let body: { salon_id?: string }
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: 'bad_request' }, 400)
  }

  if (!body.salon_id) {
    return jsonResponse({ error: 'salon_id_required' }, 400)
  }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  // Проверяем membership через user-client (RLS гарантирует privacy)
  const { data: salon, error: salonErr } = await userClient
    .from('salons')
    .select('id, name, currency, weekly_digest_enabled')
    .eq('id', body.salon_id)
    .maybeSingle()

  if (salonErr || !salon) {
    return jsonResponse({ error: 'salon_not_found_or_no_access' }, 403)
  }
  if (!salon.weekly_digest_enabled) {
    return jsonResponse({ error: 'digest_disabled' }, 409)
  }

  // KPI через RPC (admin client — функция security invoker, но нам не нужно
  // RLS-фильтрацию здесь, потому что мы уже проверили доступ выше)
  const { data: kpis, error: kpiErr } = await admin
    .rpc('weekly_digest_kpis', { p_salon_id: body.salon_id })
    .single()
  if (kpiErr || !kpis) {
    return jsonResponse({ error: 'kpi_failed', message: kpiErr?.message }, 500)
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
  const k = kpis as KpiRow
  const currency = salon.currency ?? 'PLN'

  const revDelta = deltaPercent(Number(k.revenue_cents), Number(k.prev_revenue_cents))

  // Соберём «top performers» секцию
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

  await sendEmail('weekly_digest', userEmail, {
    full_name: userName,
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
    app_url: `${APP_URL}${body.salon_id}/reports`,
  })

  return jsonResponse({
    ok: true,
    salon_id: body.salon_id,
    sent_to: userEmail,
    period: { start: k.period_start, end: k.period_end },
  })
})
