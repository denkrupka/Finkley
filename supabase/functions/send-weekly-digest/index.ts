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
import { renderLogoBlock, sendEmail, sendTelegramToUser } from '../_shared/notify.ts'

type DigestChannel = 'email' | 'telegram'

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
 * Собирает дайджест и шлёт его получателю по выбранным каналам
 * (email и/или telegram). Возвращает что было реально отправлено для
 * логирования из cron-режима. Если нет ни одного работающего канала —
 * sent=false с reason='no_active_channel'.
 */
// Локализованные строки для динамических блоков и Telegram. Email-каркас
// сам по себе в LOCALE_OVERRIDES в send-email/templates.ts.
type DigestLocale = 'ru' | 'pl' | 'en'

function normalizeDigestLocale(input: unknown): DigestLocale {
  if (typeof input !== 'string') return 'ru'
  const base = input.split('-')[0]?.toLowerCase()
  if (base === 'pl') return 'pl'
  if (base === 'en') return 'en'
  return 'ru'
}

const DIGEST_STRINGS = {
  ru: {
    topMaster: '🏆 Топ-мастер',
    topService: '⭐ Топ-услуга',
    noVisits: 'На этой неделе визитов не было — отдыхаешь?',
    insightLabel: '💡 AI-помощник видит',
    tgTitle: '📊 <b>Еженедельный дайджест</b>',
    tgRevenue: 'Выручка',
    tgExpense: 'Расходы',
    tgProfit: 'Прибыль',
    tgVisits: 'Визитов',
    fallbackSalon: 'Салон',
  },
  pl: {
    topMaster: '🏆 Top-mistrz',
    topService: '⭐ Top-usługa',
    noVisits: 'W tym tygodniu brak wizyt — odpoczywasz?',
    insightLabel: '💡 AI-asystent zauważa',
    tgTitle: '📊 <b>Cotygodniowy digest</b>',
    tgRevenue: 'Przychód',
    tgExpense: 'Wydatki',
    tgProfit: 'Zysk',
    tgVisits: 'Wizyt',
    fallbackSalon: 'Salon',
  },
  en: {
    topMaster: '🏆 Top master',
    topService: '⭐ Top service',
    noVisits: 'No visits this week — taking a break?',
    insightLabel: '💡 AI assistant sees',
    tgTitle: '📊 <b>Weekly digest</b>',
    tgRevenue: 'Revenue',
    tgExpense: 'Expenses',
    tgProfit: 'Profit',
    tgVisits: 'Visits',
    fallbackSalon: 'Salon',
  },
} as const

async function sendDigestForSalon(
  admin: SupabaseClient,
  salon: {
    id: string
    name: string | null
    currency: string | null
    weekly_digest_channels?: DigestChannel[] | null
  },
  recipient: {
    email: string
    fullName: string
    telegramId: number | null
    locale?: string | null
  },
  channels: DigestChannel[],
): Promise<{ sent: boolean; reason?: string; via?: DigestChannel[] }> {
  if (channels.length === 0) return { sent: false, reason: 'no_channels' }

  const { data: kpis, error: kpiErr } = await admin
    .rpc('weekly_digest_kpis', { p_salon_id: salon.id })
    .single()
  if (kpiErr || !kpis) return { sent: false, reason: kpiErr?.message ?? 'kpi_failed' }

  const k = kpis as KpiRow
  const currency = salon.currency ?? 'PLN'
  const revDelta = deltaPercent(Number(k.revenue_cents), Number(k.prev_revenue_cents))
  const locale = normalizeDigestLocale(recipient.locale)
  const s = DIGEST_STRINGS[locale]

  let topBlock = ''
  if (k.top_staff_name && Number(k.top_staff_revenue_cents) > 0) {
    topBlock += `<p style="margin:0 0 8px 0;font-size:14px;color:#334155;">${s.topMaster}: <strong>${k.top_staff_name}</strong> · ${formatCents(Number(k.top_staff_revenue_cents), currency)}</p>`
  }
  if (k.top_service_name && Number(k.top_service_revenue_cents) > 0) {
    topBlock += `<p style="margin:0 0 8px 0;font-size:14px;color:#334155;">${s.topService}: <strong>${k.top_service_name}</strong> · ${formatCents(Number(k.top_service_revenue_cents), currency)}</p>`
  }
  if (Number(k.visits_count) === 0) {
    topBlock = `<p style="margin:0 0 8px 0;font-size:14px;color:#64748b;font-style:italic;">${s.noVisits}</p>`
  }

  // Топ-инсайт текущей недели (если есть) — добавим под top_block.
  // insight.title/body генерируются в profile.locale (см. generate-insights),
  // поэтому язык там уже совпадает с recipient.
  const { data: insight } = await admin
    .from('insights')
    .select('title, body, severity')
    .eq('salon_id', salon.id)
    .is('dismissed_at', null)
    .order('severity', { ascending: false }) // critical > warning > info (Postgres enum)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const insightBlock = insight
    ? `<div style="margin:16px 0;padding:14px 16px;background:#FFF8E7;border-left:3px solid #E5C078;border-radius:6px;">
         <p style="margin:0 0 4px 0;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:#9A7A1F;">${s.insightLabel}</p>
         <p style="margin:0 0 4px 0;font-size:14px;font-weight:700;color:#0f172a;">${insight.title}</p>
         <p style="margin:0;font-size:13px;line-height:20px;color:#334155;">${insight.body}</p>
       </div>`
    : ''

  const via: DigestChannel[] = []

  if (channels.includes('email') && recipient.email) {
    await sendEmail(
      'weekly_digest',
      recipient.email,
      {
        full_name: recipient.fullName,
        salon_name: salon.name ?? s.fallbackSalon,
        logo_block: renderLogoBlock((salon as { logo_url?: string | null }).logo_url),
        period_start: formatDate(k.period_start),
        period_end: formatDate(k.period_end),
        revenue: formatCents(Number(k.revenue_cents), currency),
        expense: formatCents(Number(k.expense_cents), currency),
        profit: formatCents(Number(k.profit_cents), currency),
        visits_count: String(k.visits_count),
        revenue_delta: revDelta.text,
        revenue_delta_color: revDelta.color,
        top_block: topBlock,
        insight_block: insightBlock,
        app_url: `${APP_URL}${salon.id}/reports`,
      },
      locale,
    )
    via.push('email')
  }

  if (channels.includes('telegram') && recipient.telegramId) {
    const salonName = salon.name ?? s.fallbackSalon
    const tgText =
      `${s.tgTitle} · ${salonName}\n` +
      `${formatDate(k.period_start)} — ${formatDate(k.period_end)}\n\n` +
      `${s.tgRevenue}: <b>${formatCents(Number(k.revenue_cents), currency)}</b> (${revDelta.text})\n` +
      `${s.tgExpense}: ${formatCents(Number(k.expense_cents), currency)}\n` +
      `${s.tgProfit}: <b>${formatCents(Number(k.profit_cents), currency)}</b>\n` +
      `${s.tgVisits}: ${k.visits_count}\n\n` +
      (k.top_staff_name
        ? `${s.topMaster}: ${k.top_staff_name} · ${formatCents(Number(k.top_staff_revenue_cents ?? 0), currency)}\n`
        : '') +
      (k.top_service_name
        ? `${s.topService}: ${k.top_service_name} · ${formatCents(Number(k.top_service_revenue_cents ?? 0), currency)}\n`
        : '') +
      `\n${APP_URL}${salon.id}/reports`
    const ok = await sendTelegramToUser(recipient.telegramId, tgText)
    if (ok) via.push('telegram')
  }

  if (via.length === 0) return { sent: false, reason: 'no_active_channel' }
  return { sent: true, via }
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
    .select(
      'id, name, currency, logo_url, weekly_digest_enabled, weekly_digest_channels, deleted_at',
    )
    .eq('weekly_digest_enabled', true)
    .is('deleted_at', null)
  if (sErr) return jsonResponse({ error: 'salons_query_failed', message: sErr.message }, 500)

  const stats = { total: salons?.length ?? 0, sent: 0, skipped: 0, errors: [] as string[] }

  for (const salon of salons ?? []) {
    const channels = normalizeChannels(salon.weekly_digest_channels)
    if (channels.length === 0) {
      stats.skipped++
      continue
    }

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

    const { data: profile } = await admin
      .from('profiles')
      .select('telegram_id, locale')
      .eq('id', ownerId)
      .maybeSingle()
    type ProfileMin = { telegram_id?: number | string | null; locale?: string | null }
    const telegramId = (profile as ProfileMin | null)?.telegram_id
      ? Number((profile as ProfileMin).telegram_id)
      : null
    const ownerLocale = (profile as ProfileMin | null)?.locale ?? 'ru'

    try {
      const r = await sendDigestForSalon(
        admin,
        salon,
        { email: owner.email!, fullName: ownerName, telegramId, locale: ownerLocale },
        channels,
      )
      if (r.sent) stats.sent++
      else stats.skipped++
    } catch (e) {
      stats.errors.push(`${salon.id}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  return jsonResponse({ ok: true, mode: 'cron', stats })
}

function normalizeChannels(raw: unknown): DigestChannel[] {
  if (!Array.isArray(raw)) return []
  return raw.filter((c): c is DigestChannel => c === 'email' || c === 'telegram')
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
    .select('id, name, currency, logo_url, weekly_digest_enabled, weekly_digest_channels')
    .eq('id', salonId)
    .maybeSingle()
  if (salonErr || !salon) return jsonResponse({ error: 'salon_not_found_or_no_access' }, 403)
  if (!salon.weekly_digest_enabled) return jsonResponse({ error: 'digest_disabled' }, 409)

  const channels = normalizeChannels(salon.weekly_digest_channels)
  // Если channels пустой (старая запись до миграции) — фолбэк на email
  // чтобы кнопка «Отправить сейчас» не давала пустую отправку.
  const effectiveChannels: DigestChannel[] = channels.length > 0 ? channels : ['email']

  const { data: profile } = await admin
    .from('profiles')
    .select('telegram_id, locale')
    .eq('id', user.id)
    .maybeSingle()
  type ProfileMin = { telegram_id?: number | string | null; locale?: string | null }
  const telegramId = (profile as ProfileMin | null)?.telegram_id
    ? Number((profile as ProfileMin).telegram_id)
    : null
  const userLocale = (profile as ProfileMin | null)?.locale ?? 'ru'

  const r = await sendDigestForSalon(
    admin,
    salon,
    { email: userEmail, fullName: userName, telegramId, locale: userLocale },
    effectiveChannels,
  )
  if (!r.sent) return jsonResponse({ error: r.reason ?? 'send_failed' }, 500)
  return jsonResponse({
    ok: true,
    mode: 'manual',
    salon_id: salonId,
    sent_to: userEmail,
    via: r.via ?? [],
  })
}

// =============================================================================
// Entry
// =============================================================================

import { withSentry as _withSentry } from '../_shared/sentry.ts'

Deno.serve(
  _withSentry('send-weekly-digest', async (req: Request) => {
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
  }),
)
