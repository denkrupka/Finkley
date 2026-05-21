/**
 * client-overdue-push — cron каждое утро, шлёт push клиентам которые
 * пропустили ожидаемый период возвращаемости (RPC client_visit_regularity).
 *
 * Логика:
 *   1. Берём всех клиентов с days_overdue > 0.
 *   2. Если у клиента ещё не было overdue_push в последние 7 дней — шлём.
 *   3. Email + SMS (если есть телефон + SMS_PROVIDER настроен).
 *
 * Anti-spam: review_requests.client_id is null in this flow; используем
 * отдельную таблицу client_overdue_pushes для tracking когда был последний push.
 */

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'

import { getBroadcastChannels } from '../_shared/broadcast-prefs.ts'
import {
  buildVisitReminderEmail,
  buildVisitReminderSms,
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

type RegularityRow = {
  client_id: string
  client_name: string
  client_phone: string | null
  client_email: string | null
  category_id: string
  category_name: string
  expected_period_days: number
  last_visit_at: string
  days_since_last: number
  days_overdue: number
}

// Шаблоны вынесены в _shared/broadcast-templates.ts — общий источник истины
// для send-review-request, client-overdue-push и marketing-test-send.
const pickLocale = pickLocaleShared

async function sendResend(to: string, subject: string, html: string): Promise<boolean> {
  const key = Deno.env.get('RESEND_API_KEY') ?? ''
  if (!key) return false
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
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

async function processOneSalon(admin: SupabaseClient, salonId: string): Promise<{ sent: number }> {
  const stats = { sent: 0 }
  // 1-day grace: грейс=1 — push клиентам кто пропустил день. В Reports/Регулярность
  // показываем с grace=3, т.е. админ видит только тех кто не реагировал на push.
  const { data: rows } = await admin.rpc('client_visit_regularity', {
    p_salon_id: salonId,
    p_grace_days: 1,
  })
  if (!rows || rows.length === 0) return stats

  const { data: salon } = await admin
    .from('salons')
    .select('id, name, locale, country_code')
    .eq('id', salonId)
    .maybeSingle()
  if (!salon) return stats
  const salonName = (salon as { name: string | null }).name ?? 'Finkley'
  const locale = pickLocale(
    (salon as { locale: string | null }).locale,
    (salon as { country_code: string | null }).country_code,
  )
  const bookUrl = `${APP_URL}${salonId}/visits`

  // Какие каналы включены в /marketing → Рассылки для visit_reminder.
  const channels = await getBroadcastChannels(admin, salonId, 'visit_reminder')
  if (!channels.email && !channels.sms) return stats

  for (const row of rows as RegularityRow[]) {
    if (!row.client_email && !row.client_phone) continue
    // anti-spam: не слали ли push клиенту за последние 7 дней?
    const { data: recent } = await admin
      .from('client_overdue_pushes')
      .select('id')
      .eq('client_id', row.client_id)
      .eq('category_id', row.category_id)
      .gte('sent_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
      .limit(1)
      .maybeSingle()
    if (recent) continue

    let sent = false
    if (channels.email && row.client_email) {
      const { subject, html } = buildVisitReminderEmail(
        salonName,
        row.client_name,
        row.days_since_last,
        row.category_name,
        bookUrl,
        locale,
      )
      if (await sendResend(row.client_email, subject, html)) sent = true
    }
    if (channels.sms && row.client_phone) {
      const sms = buildVisitReminderSms(salonName, row.category_name, bookUrl, locale)
      const r = await sendSmsForSalon(admin, {
        salonId,
        to: row.client_phone,
        text: sms,
        messageType: 'visit_reminder',
        clientId: row.client_id,
      })
      if (r.ok) sent = true
    }
    if (sent) {
      await admin.from('client_overdue_pushes').insert({
        salon_id: salonId,
        client_id: row.client_id,
        category_id: row.category_id,
        days_overdue: row.days_overdue,
      })
      stats.sent += 1
    }
  }
  return stats
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

  const expectedSecret = Deno.env.get('CLIENT_OVERDUE_CRON_SECRET') ?? ''
  if (expectedSecret && body.token !== expectedSecret) {
    return jsonResponse({ error: 'unauthorized' }, 401)
  }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  // Все активные салоны (где есть хотя бы 1 category с return_period_days).
  const { data: salons } = await admin.from('salons').select('id').is('blocked_at', null)
  if (!salons) return jsonResponse({ ok: true, processed: 0 })

  let totalSent = 0
  for (const s of salons as Array<{ id: string }>) {
    const r = await processOneSalon(admin, s.id)
    totalSent += r.sent
  }

  return jsonResponse({ ok: true, salons: salons.length, sent: totalSent })
})
