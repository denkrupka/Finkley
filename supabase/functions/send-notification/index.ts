/**
 * send-notification (T37) — универсальная диспетчер-функция уведомлений.
 *
 * Принимает: { salon_id, user_id, type: NotificationType, payload }
 * Читает:
 *   - salons.notification_prefs[`${type}.${channel}`] — per-channel включён ли
 *   - auth.users.email — для email канала
 *   - profiles.phone, profiles.telegram_id — для SMS / TG
 *   - salons.name + salons.logo_url — контекст письма
 * Рендерит шаблоны (см. _shared/notify-templates.ts).
 * Шлёт по разрешённым каналам.
 *
 * Безопасность: вызов либо изнутри (Service-Role) либо с FUNCTION_INTERNAL_SECRET.
 *
 * ENV:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   FUNCTION_INTERNAL_SECRET
 *   RESEND_API_KEY, RESEND_FROM
 *   TELEGRAM_BOT_TOKEN
 *   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER
 *   APP_URL (default https://finkley.app/app)
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'

import { corsHeaders, preflight } from '../_shared/cors.ts'
import { sendSMS, sendTelegramToUser } from '../_shared/notify.ts'
import {
  normalizeLocale,
  renderEmail,
  renderSms,
  renderTelegram,
  type NotificationPayload,
  type NotificationType,
} from '../_shared/notify-templates.ts'
import { withSentry } from '../_shared/sentry.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const FUNCTION_SECRET = Deno.env.get('FUNCTION_INTERNAL_SECRET') ?? ''
const RESEND_KEY = Deno.env.get('RESEND_API_KEY') ?? ''
const RESEND_FROM = Deno.env.get('RESEND_FROM') ?? 'Finkley <info@finkley.app>'
const APP_URL = Deno.env.get('APP_URL') ?? 'https://finkley.app/app'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'content-type': 'application/json' },
  })
}

type Body = {
  salon_id?: string
  user_id?: string
  type?: NotificationType
  payload?: NotificationPayload
}

type Channel = 'email' | 'telegram' | 'sms'
const ALL_CHANNELS: Channel[] = ['email', 'telegram', 'sms']

Deno.serve(
  withSentry('send-notification', async (req: Request) => {
    if (req.method === 'OPTIONS') return preflight()
    if (req.method !== 'POST') return jsonResponse({ error: 'method_not_allowed' }, 405)

    // Shared-secret для internal-вызовов (cron, другие edge functions).
    const got = req.headers.get('x-finkley-secret') || ''
    if (!FUNCTION_SECRET || got !== FUNCTION_SECRET) {
      return jsonResponse({ error: 'unauthorized' }, 401)
    }

    let body: Body
    try {
      body = (await req.json()) as Body
    } catch {
      return jsonResponse({ error: 'invalid_json' }, 400)
    }

    const { salon_id, user_id, type, payload } = body
    if (!salon_id || !user_id || !type || !payload) {
      return jsonResponse({ error: 'missing_fields' }, 400)
    }

    const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

    // Подгружаем салон и юзера параллельно.
    const [salonRes, userRes, profileRes] = await Promise.all([
      admin
        .from('salons')
        .select('name, logo_url, notification_prefs')
        .eq('id', salon_id)
        .maybeSingle(),
      admin.auth.admin.getUserById(user_id),
      admin.from('profiles').select('phone, telegram_id, locale').eq('id', user_id).maybeSingle(),
    ])

    if (salonRes.error || !salonRes.data) {
      return jsonResponse({ error: 'salon_not_found', detail: salonRes.error?.message }, 404)
    }
    if (userRes.error || !userRes.data?.user) {
      return jsonResponse({ error: 'user_not_found', detail: userRes.error?.message }, 404)
    }

    const salon = salonRes.data as {
      name: string
      logo_url: string | null
      notification_prefs: Record<string, boolean> | null
    }
    const userEmail = userRes.data.user.email ?? null
    const phone = profileRes.data?.phone ?? null
    const telegramId = profileRes.data?.telegram_id ?? null
    const locale = normalizeLocale(profileRes.data?.locale ?? null)
    const prefs = salon.notification_prefs ?? {}

    // ────────────────────────────────────────────────────────────────────
    // Дефолты по каналу (если ключ не задан в prefs):
    //   email — true, telegram — true (если привязан), sms — false.
    // Master-disable: prefs[type] === false → все каналы выключены.
    // ────────────────────────────────────────────────────────────────────
    function isChannelEnabled(ch: Channel): boolean {
      if (prefs[type as string] === false) return false
      const key = `${type}.${ch}`
      if (key in prefs) return prefs[key] === true
      if (ch === 'email') return true
      if (ch === 'telegram') return !!telegramId
      return false
    }

    const ctx = {
      salonName: salon.name,
      logoUrl: salon.logo_url,
      baseUrl: APP_URL,
      salonId: salon_id,
      locale,
    }

    const dispatched: Record<Channel, 'sent' | 'skipped' | 'failed'> = {
      email: 'skipped',
      telegram: 'skipped',
      sms: 'skipped',
    }

    // T42 — параллельно создаём in-app запись для realtime push'а. Это не
    // блокирующий канал и не управляется prefs (юзер всегда видит toast пока
    // он в портале). Если insert упал — просто логируем, не валим dispatcher.
    try {
      await admin.from('in_app_notifications').insert({
        user_id,
        salon_id,
        type,
        payload: payload as Record<string, unknown>,
      })
    } catch (e) {
      console.warn('in_app_notifications insert failed:', e instanceof Error ? e.message : e)
    }

    for (const ch of ALL_CHANNELS) {
      if (!isChannelEnabled(ch)) continue
      try {
        if (ch === 'email') {
          if (!userEmail || !RESEND_KEY) {
            dispatched.email = 'skipped'
            continue
          }
          const { subject, html } = renderEmail(type, payload, ctx)
          const res = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
              Accept: 'application/json',
              'Content-Type': 'application/json',
              Authorization: `Bearer ${RESEND_KEY}`,
            },
            body: JSON.stringify({
              from: RESEND_FROM,
              to: [userEmail],
              subject,
              html,
              tags: [{ name: 'type', value: type as string }],
            }),
          })
          dispatched.email = res.ok ? 'sent' : 'failed'
          if (!res.ok) {
            console.warn(
              'send-notification email failed:',
              res.status,
              await res.text().catch(() => ''),
            )
          }
        } else if (ch === 'telegram') {
          if (!telegramId) {
            dispatched.telegram = 'skipped'
            continue
          }
          const text = renderTelegram(type, payload, locale)
          const ok = await sendTelegramToUser(telegramId, text)
          dispatched.telegram = ok ? 'sent' : 'failed'
        } else if (ch === 'sms') {
          if (!phone) {
            dispatched.sms = 'skipped'
            continue
          }
          const text = renderSms(type, payload, locale)
          const ok = await sendSMS(phone, text)
          dispatched.sms = ok ? 'sent' : 'failed'
        }
      } catch (e) {
        console.warn(`send-notification ${ch} exception:`, e instanceof Error ? e.message : e)
        dispatched[ch] = 'failed'
      }
    }

    return jsonResponse({ ok: true, type, dispatched })
  }),
)
