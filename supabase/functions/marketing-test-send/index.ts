/**
 * marketing-test-send — отправка тестового сообщения owner'у салона
 * для предпросмотра как будет выглядеть реальная рассылка у клиента.
 *
 * Использует _shared/broadcast-templates — те же шаблоны, что и
 * send-review-request / client-overdue-push. Owner получает 1-в-1 то же,
 * что клиент, с dummy-данными (анна, маникюр, 45 дней).
 *
 * Body:
 *   { salon_id, kind: 'marketing'|'visit_reminder'|'review_request',
 *     channel: 'sms'|'email', to: string }
 *
 * Для SMS — через sendSmsForSalon (списывается баланс салона). Для email —
 * напрямую через Resend.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.6'

import { getSalonMembership, getUserFromRequest } from '../_shared/auth.ts'
import {
  buildMarketingSampleEmail,
  buildMarketingSampleSms,
  buildReviewRequestEmail,
  buildReviewRequestSms,
  buildVisitReminderEmail,
  buildVisitReminderSms,
  pickLocale,
  type Locale,
} from '../_shared/broadcast-templates.ts'
import { corsHeaders, preflight } from '../_shared/cors.ts'
import { sendSmsForSalon } from '../_shared/sms-billing.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? ''
const RESEND_FROM = Deno.env.get('RESEND_FROM') ?? 'Finkley <noreply@finkley.app>'
const APP_URL = Deno.env.get('APP_URL') ?? 'https://finkley.app/app/'

type Kind = 'marketing' | 'visit_reminder' | 'review_request'

// Dummy данные для тестовой отправки — чтобы шаблоны имели чем подставиться.
const DUMMY = {
  ru: { client_name: 'Анна', category: 'маникюр', days_since: 45 },
  pl: { client_name: 'Anna', category: 'manicure', days_since: 45 },
  en: { client_name: 'Anna', category: 'manicure', days_since: 45 },
} as const

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'content-type': 'application/json' },
  })
}

function buildTestMessage(
  kind: Kind,
  channel: 'sms' | 'email',
  salonName: string,
  salonId: string,
  locale: Locale,
): { text?: string; subject?: string; html?: string } {
  const d = DUMMY[locale]
  const reviewUrl = `${APP_URL}review/TEST-PREVIEW-TOKEN`
  const bookUrl = `${APP_URL}${salonId}/visits`

  if (kind === 'review_request') {
    if (channel === 'sms') return { text: buildReviewRequestSms(reviewUrl, locale) }
    const e = buildReviewRequestEmail(salonName, reviewUrl, locale)
    return { subject: e.subject, html: e.html }
  }
  if (kind === 'visit_reminder') {
    if (channel === 'sms') {
      return { text: buildVisitReminderSms(salonName, d.category, bookUrl, locale) }
    }
    const e = buildVisitReminderEmail(
      salonName,
      d.client_name,
      d.days_since,
      d.category,
      bookUrl,
      locale,
    )
    return { subject: e.subject, html: e.html }
  }
  // marketing
  if (channel === 'sms') return { text: buildMarketingSampleSms(salonName, locale) }
  const e = buildMarketingSampleEmail(salonName, locale)
  return { subject: e.subject, html: e.html, text: e.text }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return preflight()
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)
  if (!SUPABASE_URL || !SERVICE_ROLE) return json({ error: 'function_not_configured' }, 500)

  const user = await getUserFromRequest(req, SUPABASE_URL, SERVICE_ROLE)
  if (!user) return json({ error: 'unauthorized' }, 401)

  let body: { salon_id?: string; kind?: Kind; channel?: 'sms' | 'email'; to?: string }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'invalid_json' }, 400)
  }
  const { salon_id, kind, channel, to } = body
  if (!salon_id || !kind || !channel || !to) return json({ error: 'missing_fields' }, 400)
  if (kind !== 'marketing' && kind !== 'visit_reminder' && kind !== 'review_request') {
    return json({ error: 'invalid_kind' }, 400)
  }
  if (channel !== 'sms' && channel !== 'email') return json({ error: 'invalid_channel' }, 400)

  const membership = await getSalonMembership(SUPABASE_URL, SERVICE_ROLE, user.userId, salon_id)
  if (!membership || membership.role !== 'owner') return json({ error: 'forbidden' }, 403)

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data: salonRow } = await admin
    .from('salons')
    .select('name, locale, country_code')
    .eq('id', salon_id)
    .maybeSingle()
  const salon = salonRow as {
    name: string | null
    locale: string | null
    country_code: string | null
  } | null
  const salonName = salon?.name ?? 'Finkley'
  const locale = pickLocale(salon?.locale ?? null, salon?.country_code ?? null)

  const msg = buildTestMessage(kind, channel, salonName, salon_id, locale)

  if (channel === 'sms') {
    if (!msg.text) return json({ error: 'no_template' }, 500)
    const r = await sendSmsForSalon(admin, {
      salonId: salon_id,
      to,
      text: msg.text,
      messageType: 'manual',
      clientId: null,
    })
    if (!r.ok) {
      return json({ error: 'sms_failed', status: r.status, reason: r.error ?? null }, 400)
    }
    return json({ ok: true, channel, newBalance: r.newBalance })
  }

  // Email через Resend.
  if (!RESEND_API_KEY) return json({ error: 'resend_not_configured' }, 503)
  if (!msg.subject || !msg.html) return json({ error: 'no_template' }, 500)
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: RESEND_FROM,
      to: [to],
      subject: msg.subject,
      html: msg.html,
      text: msg.text ?? undefined,
    }),
  })
  if (!r.ok) {
    const txt = await r.text()
    return json({ error: 'email_failed', message: txt.slice(0, 200) }, 502)
  }
  return json({ ok: true, channel })
})
