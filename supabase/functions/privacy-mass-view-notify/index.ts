/**
 * privacy-mass-view-notify — alerts the salon owner that an admin (not owner)
 * has loaded the client contact list with more than 50 records in one session.
 *
 * Triggered from the SPA (Reports → Клиенты → Список) when:
 *   - the current user's role in the salon is 'admin' (not 'owner')
 *   - the list of clients with visible phone/email is > 50
 *
 * The client throttles via sessionStorage to fire at most once per session per
 * (admin_user_id, salon_id). The function additionally dedups within a single
 * UTC-day via audit_log to avoid spamming the owner when a tab is reloaded.
 *
 * Channels:
 *   - Telegram via @finkley_tg_bot (if owner has profiles.telegram_id)
 *   - Email via send-email (always — owner.email is required for signup)
 *
 * Auth: standard JWT verification (this is called from SPA with user's session).
 *
 * ENV:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   SUPABASE_ANON_KEY              — to verify JWT
 *   TELEGRAM_BOT_TOKEN             — @finkley_tg_bot
 *   FUNCTION_INTERNAL_SECRET       — to call send-email
 *   FUNCTIONS_URL                  — base URL of edge functions
 *   APP_URL                        — base URL of SPA
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'

import { corsHeaders, preflight } from '../_shared/cors.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
const BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN') ?? ''
const FUNCTION_SECRET = Deno.env.get('FUNCTION_INTERNAL_SECRET') ?? ''
const FUNCTIONS_URL = Deno.env.get('FUNCTIONS_URL') ?? `${SUPABASE_URL}/functions/v1`
const APP_URL = Deno.env.get('APP_URL') ?? 'https://finkley.app/app'

const TELEGRAM_API = `https://api.telegram.org/bot${BOT_TOKEN}`

type Body = {
  salon_id?: string
  client_count?: number
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'content-type': 'application/json' },
  })
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return preflight()
  if (req.method !== 'POST') return jsonResponse({ error: 'method_not_allowed' }, 405)

  const authHeader = req.headers.get('Authorization') || req.headers.get('authorization') || ''
  if (!authHeader.startsWith('Bearer ')) {
    return jsonResponse({ error: 'unauthorized' }, 401)
  }
  const token = authHeader.slice('Bearer '.length)

  // Authed client — to read user_id from JWT.
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  })
  const { data: userData, error: userErr } = await userClient.auth.getUser(token)
  if (userErr || !userData?.user) return jsonResponse({ error: 'unauthorized' }, 401)
  const actorId = userData.user.id

  let body: Body
  try {
    body = (await req.json()) as Body
  } catch {
    return jsonResponse({ error: 'invalid_json' }, 400)
  }
  const salonId = body.salon_id
  const count = Number(body.client_count) || 0
  if (!salonId || count < 1) return jsonResponse({ error: 'invalid_params' }, 400)

  // Admin client — bypass RLS for owner lookup and audit insert.
  const admin = createClient(SUPABASE_URL, SERVICE_KEY)

  // Caller must be admin (not owner) of the salon.
  const { data: actorRole } = await admin
    .from('salon_members')
    .select('role')
    .eq('salon_id', salonId)
    .eq('user_id', actorId)
    .maybeSingle()
  const role = (actorRole as { role: string } | null)?.role
  if (role !== 'admin') {
    // Owner viewing own client list, or non-member — nothing to notify.
    return jsonResponse({ ok: true, skipped: 'not_admin' })
  }

  // Dedup: only one alert per (admin, salon) per UTC-day.
  const dayStartIso = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z').toISOString()
  const { data: existing } = await admin
    .from('audit_log')
    .select('id')
    .eq('salon_id', salonId)
    .eq('user_id', actorId)
    .eq('action', 'privacy.mass_view_clients')
    .gte('created_at', dayStartIso)
    .limit(1)
  if ((existing ?? []).length > 0) {
    return jsonResponse({ ok: true, skipped: 'already_notified_today' })
  }

  // Find owner of the salon.
  const { data: ownerRow } = await admin
    .from('salon_members')
    .select('user_id')
    .eq('salon_id', salonId)
    .eq('role', 'owner')
    .limit(1)
    .maybeSingle()
  const ownerId = (ownerRow as { user_id: string } | null)?.user_id
  if (!ownerId) {
    return jsonResponse({ ok: true, skipped: 'no_owner' })
  }

  // Owner profile (email + telegram_id + locale).
  const { data: ownerProfile } = await admin
    .from('profiles')
    .select('email, full_name, telegram_id, locale')
    .eq('id', ownerId)
    .maybeSingle()
  type OwnerProf = {
    email: string | null
    full_name: string | null
    telegram_id: number | null
    locale: string | null
  }
  const ownerEmail = (ownerProfile as OwnerProf | null)?.email ?? null
  const ownerTgId = (ownerProfile as OwnerProf | null)?.telegram_id ?? null
  const ownerLocale = (ownerProfile as OwnerProf | null)?.locale ?? 'ru'
  const localeBase = ownerLocale.split('-')[0]?.toLowerCase() ?? 'ru'

  // Salon name (for nicer copy).
  const { data: salonRow } = await admin
    .from('salons')
    .select('name')
    .eq('id', salonId)
    .maybeSingle()
  const salonName = (salonRow as { name: string } | null)?.name ?? '—'

  // Actor profile (for copy).
  const { data: actorProfile } = await admin
    .from('profiles')
    .select('email, full_name')
    .eq('id', actorId)
    .maybeSingle()
  const actorName =
    (actorProfile as { full_name: string | null } | null)?.full_name ??
    (actorProfile as { email: string | null } | null)?.email ??
    'admin'

  // Telegram: send if linked. Локализуем по owner.locale.
  const tgTexts = {
    ru:
      `🔒 *Уведомление о приватности*\n\n` +
      `Администратор *${actorName}* открыл список клиентов салона *${salonName}* и просмотрел контактные данные более чем 50 клиентов (${count} шт.) за сегодня.\n\n` +
      `Это штатное действие для роли «администратор», но при необходимости можно пересмотреть права: ${APP_URL}/${salonId}/settings?tab=team`,
    pl:
      `🔒 *Powiadomienie o prywatności*\n\n` +
      `Administrator *${actorName}* otworzył listę klientów salonu *${salonName}* i przejrzał dane kontaktowe ponad 50 klientów (${count} szt.) dziś.\n\n` +
      `To standardowe działanie dla roli „administrator", ale w razie potrzeby możesz przejrzeć uprawnienia: ${APP_URL}/${salonId}/settings?tab=team`,
    en:
      `🔒 *Privacy notice*\n\n` +
      `Admin *${actorName}* opened the client list of salon *${salonName}* and viewed contact details of more than 50 clients (${count} total) today.\n\n` +
      `This is a standard action for the 'admin' role, but you can review permissions if needed: ${APP_URL}/${salonId}/settings?tab=team`,
  }
  if (ownerTgId && BOT_TOKEN) {
    const text = tgTexts[localeBase as 'ru' | 'pl' | 'en'] ?? tgTexts.ru
    try {
      await fetch(`${TELEGRAM_API}/sendMessage`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          chat_id: ownerTgId,
          text,
          parse_mode: 'Markdown',
          disable_web_page_preview: true,
        }),
      })
    } catch (e) {
      console.warn('telegram notify failed', e)
    }
  }

  // Email: send via send-email function.
  if (ownerEmail && FUNCTION_SECRET) {
    try {
      await fetch(`${FUNCTIONS_URL}/send-email`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'X-Finkley-Secret': FUNCTION_SECRET,
        },
        body: JSON.stringify({
          template: 'privacy_alert',
          to: ownerEmail,
          vars: {
            actor_name: actorName,
            salon_name: salonName,
            client_count: count,
            team_url: `${APP_URL}/${salonId}/settings?tab=team`,
          },
          locale: ownerLocale,
        }),
      })
    } catch (e) {
      console.warn('email notify failed', e)
    }
  }

  // Persist audit row.
  await admin.from('audit_log').insert({
    salon_id: salonId,
    user_id: actorId,
    action: 'privacy.mass_view_clients',
    entity_type: 'client_list',
    entity_id: salonId,
    payload: { client_count: count, owner_notified: true },
  })

  return jsonResponse({ ok: true, notified: true })
})
