/**
 * payment-reminders — ежедневное напоминание о платежах.
 *
 * Каждое утро (cron 08:00 UTC) проходим по scheduled_payments status='pending'
 * для всех салонов. Для каждого считаем дни до due_date:
 *   - 2 → notification_prefs.payment_due_2d
 *   - 1 → notification_prefs.payment_due_1d
 *   - 0 → notification_prefs.payment_due_today
 *   - <0 → notification_prefs.payment_overdue (шлётся каждый день)
 *
 * Каналы: Push (VAPID, sendPushToUser шлёт во все web-push подписки юзера),
 * Telegram (только если у владельца привязан chat в profiles.telegram_id),
 * Email (через Resend, только если у владельца есть profiles.email). Тип
 * события (bucket) гасится через notification_prefs[key] !== false; per-channel
 * gating не настраивается отдельно — определяется availability канала.
 *
 * Auth: rendezvous token из payment_reminder_triggers. Cron sql-функция
 * генерирует токен и пихает в этот endpoint через pg_net.
 */

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'

import { corsHeaders, preflight } from '../_shared/cors.ts'
import { makeT, normalizeNotifLocale, type NotifLocale } from '../_shared/notifications-i18n.ts'
import { dispatchNotification, sendTelegramToUser } from '../_shared/notify.ts'
import { withSentry } from '../_shared/sentry.ts'
import { sendPushToUser } from '../_shared/web-push.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

type NotificationPrefKey =
  | 'payment_due_2d'
  | 'payment_due_1d'
  | 'payment_due_today'
  | 'payment_overdue'

type ScheduledPaymentRow = {
  id: string
  salon_id: string
  due_date: string
  amount_cents: number
  vendor_name: string | null
  invoice_number: string | null
}

type SalonRow = {
  id: string
  name: string | null
  currency: string | null
  notification_prefs: Record<string, boolean> | null
  weekly_digest_channels?: string[] | null
}

type OwnerRow = {
  user_id: string
  email: string | null
  full_name: string | null
  telegram_id: number | null
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'content-type': 'application/json' },
  })
}

function formatCents(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat('ru-RU', { style: 'currency', currency }).format(cents / 100)
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency}`
  }
}

function dueOffset(dueDate: string, today: string): number {
  // Both are 'yyyy-mm-dd'. Compute integer day-diff (positive = future).
  const a = new Date(`${dueDate}T00:00:00Z`).getTime()
  const b = new Date(`${today}T00:00:00Z`).getTime()
  return Math.round((a - b) / 86400000)
}

function classifyOffset(offset: number): NotificationPrefKey | null {
  if (offset === 2) return 'payment_due_2d'
  if (offset === 1) return 'payment_due_1d'
  if (offset === 0) return 'payment_due_today'
  if (offset < 0) return 'payment_overdue'
  return null // другие будущие даты — игнорируем
}

function isEnabled(prefs: Record<string, boolean> | null, key: NotificationPrefKey): boolean {
  if (!prefs) return true
  return prefs[key] !== false
}

const BUCKET_HEADER_KEY: Record<NotificationPrefKey, string> = {
  payment_due_2d: 'payment.header.due_2d',
  payment_due_1d: 'payment.header.due_1d',
  payment_due_today: 'payment.header.due_today',
  payment_overdue: 'payment.header.overdue',
}

function buildMessage(
  salonName: string,
  payments: ScheduledPaymentRow[],
  bucket: NotificationPrefKey,
  currency: string,
  locale: NotifLocale,
): { text: string; html: string } {
  const t = makeT(locale)
  const header = t(BUCKET_HEADER_KEY[bucket], { salonName })

  // Для plain-text шлём как есть. Для HTML — заворачиваем сумму в <strong>
  // через placeholder, иначе бы пришлось дублировать шаблон в локалях.
  const AMT_TOKEN = '___AMT___'
  const renderLine = (p: ScheduledPaymentRow, amountValue: string) => {
    const vendor = p.vendor_name?.trim() || t('payment.no_vendor')
    const invoiceSuffix = p.invoice_number
      ? t('payment.invoice_suffix', { number: p.invoice_number })
      : ''
    return t('payment.line', {
      amount: amountValue,
      vendor,
      invoiceSuffix,
      dueDate: p.due_date,
    })
  }

  const text = [
    header,
    '',
    ...payments.map((p) => renderLine(p, formatCents(p.amount_cents, currency))),
  ].join('\n')

  const htmlItems = payments
    .map((p) => {
      const tmpl = renderLine(p, AMT_TOKEN)
      const amount = formatCents(p.amount_cents, currency)
      return `<li>${tmpl.replace(AMT_TOKEN, `<strong>${amount}</strong>`)}</li>`
    })
    .join('')
  const html =
    `<h2 style="font-size:18px;margin:0 0 12px 0;color:#1A1A2E">${header}</h2>` +
    `<ul style="padding-left:20px;color:#1A1A2E;font-size:14px;line-height:1.6">${htmlItems}</ul>` +
    `<p style="color:#6b7280;font-size:12px;margin-top:16px">${t('payment.email_footer')}</p>`
  return { text, html }
}

async function sendEmailReminder(
  to: string,
  subject: string,
  html: string,
): Promise<{ ok: boolean; error?: string }> {
  const resendKey = Deno.env.get('RESEND_API_KEY')
  if (!resendKey) return { ok: false, error: 'no_resend_key' }
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Finkley <noreply@finkley.app>',
        to: [to],
        subject,
        html,
      }),
    })
    if (!r.ok) {
      const t = await r.text()
      return { ok: false, error: `resend_${r.status}:${t.slice(0, 200)}` }
    }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

async function processOneSalon(
  admin: SupabaseClient,
  salon: SalonRow,
  today: string,
): Promise<{ sent: number; skipped: number }> {
  const stats = { sent: 0, skipped: 0 }
  const { data: payments } = await admin
    .from('scheduled_payments')
    .select('id, salon_id, due_date, amount_cents, vendor_name, invoice_number')
    .eq('salon_id', salon.id)
    .eq('status', 'pending')
    .is('deleted_at', null)
  if (!payments || payments.length === 0) return stats

  // Группируем по bucket (типу напоминания)
  const buckets: Record<NotificationPrefKey, ScheduledPaymentRow[]> = {
    payment_due_2d: [],
    payment_due_1d: [],
    payment_due_today: [],
    payment_overdue: [],
  }
  for (const p of payments) {
    const off = dueOffset(p.due_date, today)
    const key = classifyOffset(off)
    if (key) buckets[key].push(p)
  }

  const currency = salon.currency || 'PLN'

  // Owner получает уведомления. Берём первого owner из salon_members.
  const { data: ownerRow } = await admin
    .from('salon_members')
    .select('user_id, profiles!inner(email, full_name, telegram_id, locale)')
    .eq('salon_id', salon.id)
    .eq('role', 'owner')
    .limit(1)
    .maybeSingle()
  type OwnerRaw = {
    user_id: string
    profiles: {
      email?: string
      full_name?: string
      telegram_id?: number | null
      locale?: string | null
    } | null
  }
  const owner = ownerRow as OwnerRaw | null
  if (!owner) return stats
  const ownerData: OwnerRow = {
    user_id: owner.user_id,
    email: owner.profiles?.email ?? null,
    full_name: owner.profiles?.full_name ?? null,
    telegram_id: owner.profiles?.telegram_id ?? null,
  }
  const ownerLocale = normalizeNotifLocale(owner.profiles?.locale)
  const salonName = salon.name ?? 'Salon'

  for (const bucketKey of Object.keys(buckets) as NotificationPrefKey[]) {
    const list = buckets[bucketKey]
    if (list.length === 0) continue
    if (!isEnabled(salon.notification_prefs, bucketKey)) {
      stats.skipped += list.length
      continue
    }
    const { text, html } = buildMessage(salonName, list, bucketKey, currency, ownerLocale)
    const subject = text.split('\n')[0]

    // Push (browser/PWA) — все подписки владельца
    try {
      const pushed = await sendPushToUser(admin, ownerData.user_id, {
        title: subject,
        body: text.split('\n').slice(2).join('\n').slice(0, 200),
        url: `/app/${salon.id}/finance?tab=payments`,
        tag: `payments-${bucketKey}`,
        requireInteraction: bucketKey === 'payment_due_today' || bucketKey === 'payment_overdue',
      })
      stats.sent += pushed
    } catch (e) {
      console.warn(`push failed: ${e instanceof Error ? e.message : String(e)}`)
    }

    // T38 — единый dispatcher: per-channel prefs + единый шаблон.
    // Для каждого платежа в bucket генерируем отдельное уведомление
    // (точечная инфа: контрагент, документ, сумма). Telegram/SMS будут
    // компактными, email — детальным.
    for (const p of list) {
      const dispatched = await dispatchNotification({
        salonId: salon.id,
        userId: ownerData.user_id,
        type: bucketKey,
        payload: {
          counterparty: p.vendor_name ?? '—',
          document_number: p.invoice_number ?? '',
          amount_formatted: new Intl.NumberFormat('ru-RU', {
            style: 'currency',
            currency,
          }).format(p.amount_cents / 100),
        },
      })
      if (dispatched) stats.sent += 1
    }
    // Mute legacy: text/html/subject/sendTelegramToUser/sendEmailReminder
    // оставлены для backward-compat; push выше работает независимо от
    // dispatcher'а (push не в матрице prefs).
    void text
    void html
    void subject
    void sendTelegramToUser
    void sendEmailReminder
  }

  return stats
}

Deno.serve(
  withSentry('payment-reminders', async (req: Request) => {
    const pf = preflight(req)
    if (pf) return pf
    if (req.method !== 'POST') return jsonResponse({ ok: false, error: 'method_not_allowed' }, 405)
    if (!SUPABASE_URL || !SERVICE_KEY)
      return jsonResponse({ ok: false, error: 'function_not_configured' }, 500)

    let body: { token?: string; cron?: boolean } = {}
    try {
      body = await req.json()
    } catch {
      // ignore
    }
    if (!body.token) return jsonResponse({ ok: false, error: 'token_required' }, 401)

    const admin = createClient(SUPABASE_URL, SERVICE_KEY)

    // Валидируем rendezvous токен (одноразовый, не expired)
    const { data: trig, error: trigErr } = await admin
      .from('payment_reminder_triggers')
      .update({ used_at: new Date().toISOString() })
      .eq('token', body.token)
      .is('used_at', null)
      .gt('expires_at', new Date().toISOString())
      .select('token')
      .maybeSingle()
    if (trigErr || !trig) return jsonResponse({ ok: false, error: 'invalid_or_expired_token' }, 401)

    const today = new Date().toISOString().slice(0, 10)

    // Берём все салоны (не блокированные)
    const { data: salons } = await admin
      .from('salons')
      .select('id, name, currency, notification_prefs')
      .is('deleted_at', null)
      .is('blocked_at', null)

    let totalSent = 0
    let totalSkipped = 0
    for (const s of salons ?? []) {
      try {
        const r = await processOneSalon(admin, s as SalonRow, today)
        totalSent += r.sent
        totalSkipped += r.skipped
      } catch (e) {
        console.warn(`salon ${s.id} failed: ${e instanceof Error ? e.message : String(e)}`)
      }
    }

    return jsonResponse({ ok: true, sent: totalSent, skipped: totalSkipped })
  }),
)
