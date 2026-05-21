/**
 * send-review-request — cron каждые 6 часов, шлёт клиенту запрос на отзыв
 * после оплаченного визита (FlySMS-flow).
 *
 * Кому шлём:
 *   - Визиты со status='paid' за последние 24 часа.
 *   - У клиента есть email или phone.
 *   - На этот visit ещё не было review_request (anti-dup).
 *
 * Что делаем:
 *   1. Создаём review_requests row с уникальным token (UUID без дефисов).
 *   2. Шлём email клиенту с ссылкой /review/<token>.
 *   3. Если есть phone — шлём SMS (если SMS_PROVIDER настроен).
 *
 * Auth: rendezvous token из review_request_triggers (заполняется через
 * pg_cron, см. миграцию 20260521000016).
 */

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'

import { getBroadcastChannels } from '../_shared/broadcast-prefs.ts'
import {
  buildReviewRequestEmail,
  buildReviewRequestSms,
  pickLocale as pickLocaleShared,
} from '../_shared/broadcast-templates.ts'
import { corsHeaders, preflight } from '../_shared/cors.ts'
import { sendSmsForSalon } from '../_shared/sms-billing.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const APP_URL = Deno.env.get('APP_URL') ?? 'https://finkley.app/app/'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'content-type': 'application/json' },
  })
}

function makeToken(): string {
  // UUID без дефисов — короче в URL, по-прежнему 32 hex.
  const u = crypto.randomUUID()
  return u.replace(/-/g, '')
}

type VisitRow = {
  id: string
  salon_id: string
  client_id: string | null
  visit_at: string
}

type ClientRow = {
  id: string
  name: string | null
  phone: string | null
  email: string | null
}

type SalonRow = {
  id: string
  name: string | null
  locale: string | null
  country_code: string | null
}

// Шаблоны вынесены в _shared/broadcast-templates.ts — общий источник истины
// для send-review-request, client-overdue-push и marketing-test-send.
const pickLocale = pickLocaleShared

async function sendDirectResend(to: string, subject: string, html: string): Promise<boolean> {
  const resendKey = Deno.env.get('RESEND_API_KEY') ?? ''
  if (!resendKey) return false
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${resendKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        from: Deno.env.get('RESEND_FROM') ?? 'Finkley <noreply@finkley.app>',
        to: [to],
        subject,
        html,
      }),
    })
    return r.ok
  } catch {
    return false
  }
}

async function processOneVisit(admin: SupabaseClient, visit: VisitRow): Promise<boolean> {
  if (!visit.client_id) return false

  // Anti-dup — есть ли уже review_request для этого визита?
  const { data: existing } = await admin
    .from('review_requests')
    .select('id')
    .eq('visit_id', visit.id)
    .limit(1)
    .maybeSingle()
  if (existing) return false

  // Подгружаем клиента + салон (имя + локаль).
  const { data: client } = await admin
    .from('clients')
    .select('id, name, phone, email')
    .eq('id', visit.client_id)
    .maybeSingle()
  if (!client) return false
  if (!client.email && !client.phone) return false

  const { data: salon } = await admin
    .from('salons')
    .select('id, name, locale, country_code')
    .eq('id', visit.salon_id)
    .maybeSingle()
  if (!salon) return false

  const token = makeToken()
  const { error: insErr } = await admin.from('review_requests').insert({
    salon_id: visit.salon_id,
    visit_id: visit.id,
    client_id: visit.client_id,
    token,
  })
  if (insErr) {
    console.warn('insert review_request failed', insErr.message)
    return false
  }

  const reviewUrl = `${APP_URL}review/${token}`
  const locale = pickLocale((salon as SalonRow).locale, (salon as SalonRow).country_code)
  const salonName = (salon as SalonRow).name ?? 'Finkley'

  // Какие каналы включены владельцем в /marketing → Рассылки.
  const channels = await getBroadcastChannels(admin, visit.salon_id, 'review_request')

  let sent = false
  if (channels.email && (client as ClientRow).email) {
    const { subject, html } = buildReviewRequestEmail(salonName, reviewUrl, locale)
    if (await sendDirectResend((client as ClientRow).email!, subject, html)) sent = true
  }
  if (channels.sms && (client as ClientRow).phone) {
    const smsText = buildReviewRequestSms(reviewUrl, locale)
    const r = await sendSmsForSalon(admin, {
      salonId: visit.salon_id,
      to: (client as ClientRow).phone!,
      text: smsText,
      messageType: 'review_request',
      clientId: (client as ClientRow).id,
    })
    if (r.ok) sent = true
  }
  return sent
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return preflight()
  if (req.method !== 'POST') return jsonResponse({ error: 'method_not_allowed' }, 405)
  if (!SUPABASE_URL || !SERVICE_KEY) {
    return jsonResponse({ error: 'function_not_configured' }, 500)
  }

  let body: { token?: string } = {}
  try {
    body = await req.json()
  } catch {
    // pg_cron может слать без body
  }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  // Rendezvous token check (если задан в env — требуем match).
  const expectedSecret = Deno.env.get('REVIEW_REQUEST_CRON_SECRET') ?? ''
  if (expectedSecret && body.token !== expectedSecret) {
    return jsonResponse({ error: 'unauthorized' }, 401)
  }

  // Выбираем paid визиты за последние 24h без review_request.
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const { data: visits } = await admin
    .from('visits')
    .select('id, salon_id, client_id, visit_at')
    .eq('status', 'paid')
    .is('deleted_at', null)
    .gte('visit_at', since)
    .not('client_id', 'is', null)
    .limit(500)

  if (!visits || visits.length === 0) {
    return jsonResponse({ ok: true, processed: 0, sent: 0 })
  }

  let sent = 0
  for (const v of visits as VisitRow[]) {
    if (await processOneVisit(admin, v)) sent += 1
  }
  return jsonResponse({ ok: true, processed: visits.length, sent })
})
