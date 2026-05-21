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

const STRINGS = {
  ru: {
    subject: 'Соскучились! Пора заглянуть',
    intro: 'Привет, {{name}}!',
    body: 'Давно не виделись — {{days}} дней с прошлого визита ({{category}}). Записаться легко по ссылке ниже:',
    cta: 'Записаться',
    sms: '{{salon}}: давно не виделись! Запишись на {{category}}: {{url}}',
  },
  pl: {
    subject: 'Tęsknimy! Czas wpaść',
    intro: 'Cześć, {{name}}!',
    body: 'Dawno się nie widziałyśmy — {{days}} dni od ostatniej wizyty ({{category}}). Zarezerwuj łatwo poniżej:',
    cta: 'Zarezerwuj',
    sms: '{{salon}}: dawno się nie widziałyśmy! Umów {{category}}: {{url}}',
  },
  en: {
    subject: "We've missed you! Time to drop by",
    intro: 'Hi {{name}}!',
    body: "It's been a while — {{days}} days since your last visit ({{category}}). Book easily below:",
    cta: 'Book',
    sms: '{{salon}}: been a while! Book {{category}}: {{url}}',
  },
}

function pickLocale(
  locale: string | null | undefined,
  countryCode: string | null | undefined,
): 'ru' | 'pl' | 'en' {
  if (locale) {
    const base = locale.split('-')[0]?.toLowerCase()
    if (base === 'pl') return 'pl'
    if (base === 'en') return 'en'
    if (base === 'ru') return 'ru'
  }
  if (countryCode === 'PL') return 'pl'
  if (countryCode && ['GB', 'US', 'IE'].includes(countryCode)) return 'en'
  return 'ru'
}

function interpolate(tmpl: string, vars: Record<string, string | number>): string {
  return tmpl.replace(/\{\{(\w+)\}\}/g, (_, k) => String(vars[k] ?? ''))
}

function buildEmail(
  salonName: string,
  bookUrl: string,
  row: RegularityRow,
  locale: 'ru' | 'pl' | 'en',
): { subject: string; html: string } {
  const s = STRINGS[locale]
  const subject = `${s.subject} — ${salonName}`
  const html = `<!doctype html>
<html lang="${locale}"><body style="margin:0;padding:0;background:#F7F4EE;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0f172a;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#F7F4EE;padding:40px 16px;"><tr><td align="center">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:560px;background:#fff;border-radius:12px;border:1px solid #E5E1D8;overflow:hidden;">
<tr><td style="padding:40px 32px;">
  <h1 style="margin:0 0 12px 0;font-size:22px;line-height:28px;font-weight:800;color:#1A1A2E;">
    ${interpolate(s.intro, { name: row.client_name })}
  </h1>
  <p style="margin:0 0 16px 0;font-size:15px;line-height:22px;color:#334155;">
    ${interpolate(s.body, { days: row.days_since_last, category: row.category_name })}
  </p>
  <p style="margin:24px 0;">
    <a href="${bookUrl}" style="display:inline-block;background:#1A1A2E;color:#ffffff;text-decoration:none;padding:14px 32px;border-radius:8px;font-weight:600;font-size:15px;">
      ${s.cta}
    </a>
  </p>
  <p style="margin:24px 0 0 0;font-size:12px;color:#94a3b8;">${salonName} · Finkley</p>
</td></tr>
</table>
</td></tr></table>
</body></html>`
  return { subject, html }
}

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
    if (row.client_email) {
      const { subject, html } = buildEmail(salonName, bookUrl, row, locale)
      if (await sendResend(row.client_email, subject, html)) sent = true
    }
    if (row.client_phone) {
      const sms = interpolate(STRINGS[locale].sms, {
        salon: salonName,
        category: row.category_name,
        url: bookUrl,
      })
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
