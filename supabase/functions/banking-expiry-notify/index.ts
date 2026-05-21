/**
 * banking-expiry-notify — рассылает email-нотификации владельцам салонов,
 * у которых PSD2-consent на банковское подключение истекает в ближайшие
 * 14 дней.
 *
 * Auth: --no-verify-jwt + rendezvous-token из banking_expiry_triggers.
 * Вызывается только из cron'а (см. 20260509000004_banking_expiry_notify.sql).
 *
 * Logic:
 *   1. Валидируем token из body (one-shot из banking_expiry_triggers,
 *      not used_at, not expired).
 *   2. Выбираем bank_connections где:
 *      - status = 'connected'
 *      - valid_until ∈ [now, now + 14 days]
 *      - expiry_email_sent_at IS NULL
 *   3. Для каждой строки шлём письмо bank_consent_expiring через send-email.
 *   4. Проставляем expiry_email_sent_at = now().
 *
 * Idempotent: повторный вызов не отправит дубликаты — флажок
 * expiry_email_sent_at защищает.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.6'

import { corsHeaders, preflight } from '../_shared/cors.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const INTERNAL_SECRET = Deno.env.get('FUNCTION_INTERNAL_SECRET') ?? ''
const APP_URL = Deno.env.get('APP_URL') ?? 'https://finkley.app'
const FUNCTIONS_URL = SUPABASE_URL.replace(
  /^https:\/\/([a-z0-9]+)\.supabase\.co\/?$/,
  'https://$1.functions.supabase.co',
)

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'content-type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return preflight()
  if (req.method !== 'POST') return jsonResponse({ error: 'method_not_allowed' }, 405)
  if (!INTERNAL_SECRET) return jsonResponse({ error: 'function_not_configured' }, 500)

  let body: { token?: string }
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: 'bad_request' }, 400)
  }
  if (!body.token) return jsonResponse({ error: 'missing_token' }, 400)

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  // Валидация rendezvous-token
  const { data: trig } = await admin
    .from('banking_expiry_triggers')
    .select('token, used_at, expires_at')
    .eq('token', body.token)
    .maybeSingle()
  if (!trig || trig.used_at || new Date(trig.expires_at as string) < new Date()) {
    return jsonResponse({ error: 'invalid_token' }, 401)
  }
  await admin
    .from('banking_expiry_triggers')
    .update({ used_at: new Date().toISOString() })
    .eq('token', body.token)

  // Выбираем connection'ы у которых пора слать письмо
  const inFourteenDays = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString()
  const now = new Date().toISOString()
  const { data: rows, error: rowsErr } = await admin
    .from('bank_connections')
    .select('id, salon_id, bank_name, bank_aspsp_name, valid_until, created_by, salons!inner(name)')
    .eq('status', 'connected')
    .not('valid_until', 'is', null)
    .gte('valid_until', now)
    .lte('valid_until', inFourteenDays)
    .is('expiry_email_sent_at', null)
  if (rowsErr) {
    console.error('select bank_connections', rowsErr)
    return jsonResponse({ error: 'db_error', detail: rowsErr.message }, 500)
  }

  type Row = {
    id: string
    salon_id: string
    bank_name: string | null
    bank_aspsp_name: string | null
    valid_until: string
    created_by: string | null
    salons: { name: string } | null
  }
  const conns = (rows ?? []) as Row[]
  if (conns.length === 0) {
    return jsonResponse({ ok: true, sent: 0, message: 'no_connections_to_notify' })
  }

  // Подгрузим email'ы и locale юзеров одним батчем.
  const userIds = Array.from(
    new Set(conns.map((r) => r.created_by).filter((u): u is string => !!u)),
  )
  const userEmails = new Map<string, string>()
  const userLocales = new Map<string, string>()
  for (const uid of userIds) {
    const { data: u } = await admin.auth.admin.getUserById(uid)
    if (u?.user?.email) userEmails.set(uid, u.user.email)
  }
  if (userIds.length > 0) {
    const { data: profiles } = await admin.from('profiles').select('id, locale').in('id', userIds)
    for (const p of (profiles ?? []) as Array<{ id: string; locale: string | null }>) {
      if (p.locale) userLocales.set(p.id, p.locale)
    }
  }

  let sent = 0
  let failed = 0
  for (const c of conns) {
    if (!c.created_by) continue
    const email = userEmails.get(c.created_by)
    if (!email) continue
    const validUntil = new Date(c.valid_until)
    const daysLeft = Math.max(
      0,
      Math.ceil((validUntil.getTime() - Date.now()) / (24 * 60 * 60 * 1000)),
    )

    const locale = userLocales.get(c.created_by) ?? 'ru'
    const localeBase = locale.split('-')[0]?.toLowerCase() ?? 'ru'
    const dtLocale = localeBase === 'pl' ? 'pl-PL' : localeBase === 'en' ? 'en-US' : 'ru-RU'
    const bankFallback = localeBase === 'pl' ? 'bank' : localeBase === 'en' ? 'bank' : 'банк'
    try {
      const res = await fetch(`${FUNCTIONS_URL}/send-email`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'X-Finkley-Secret': INTERNAL_SECRET,
        },
        body: JSON.stringify({
          template: 'bank_consent_expiring',
          to: email,
          vars: {
            bank_name: c.bank_name ?? c.bank_aspsp_name ?? bankFallback,
            salon_name: c.salons?.name ?? '',
            days_left: daysLeft,
            valid_until: validUntil.toLocaleDateString(dtLocale, {
              day: 'numeric',
              month: 'long',
              year: 'numeric',
            }),
            reconnect_url: `${APP_URL}/${c.salon_id}/settings?tab=integrations`,
          },
          locale,
        }),
      })
      if (!res.ok) {
        failed++
        console.warn('send-email failed', c.id, res.status, await res.text())
        continue
      }
      await admin
        .from('bank_connections')
        .update({ expiry_email_sent_at: new Date().toISOString() })
        .eq('id', c.id)
      sent++
    } catch (e) {
      failed++
      console.error('send notify', c.id, e)
    }
  }

  return jsonResponse({ ok: true, total: conns.length, sent, failed })
})
