/**
 * daily-notifications — операционные уведомления (не-финансовые).
 *
 * Текущий объём:
 *   - low_inventory: позиции inventory_items с current_stock <= min_stock,
 *     если notification_prefs.low_inventory !== false.
 *   - calendar_conflicts: визиты одного staff_id с пересекающимся интервалом
 *     по duration_min. Пара отправляется один раз (key = id1<id2).
 *
 * booksy_new_visits НЕ обрабатывается тут — это real-time push из
 * booksy-proxy::notifyBooksyNewVisits сразу после успешного импорта,
 * чтобы не ждать 24-часовой cron.
 *
 * Каналы: Push (VAPID), Telegram, Email (Resend). Auth: rendezvous token.
 */

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'

import { corsHeaders, preflight } from '../_shared/cors.ts'
import {
  bcp47,
  makeT,
  normalizeNotifLocale,
  type NotifLocale,
} from '../_shared/notifications-i18n.ts'
import { dispatchNotification, sendTelegramToUser } from '../_shared/notify.ts'
import { withSentry } from '../_shared/sentry.ts'
import { sendPushToUser } from '../_shared/web-push.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

type InventoryRow = {
  id: string
  salon_id: string
  name: string
  current_stock: number
  min_stock: number
  unit: string | null
}

type SalonRow = {
  id: string
  name: string | null
  currency: string | null
  notification_prefs: Record<string, boolean> | null
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'content-type': 'application/json' },
  })
}

function isEnabled(prefs: Record<string, boolean> | null, key: string): boolean {
  if (!prefs) return true
  return prefs[key] !== false
}

async function sendEmail(
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

async function processLowInventory(
  admin: SupabaseClient,
  salon: SalonRow,
  owner: { user_id: string; email: string | null; telegram_id: number | null },
  locale: NotifLocale,
): Promise<number> {
  const t = makeT(locale)
  if (!isEnabled(salon.notification_prefs, 'low_inventory')) return 0
  const { data: items } = await admin
    .from('inventory_items')
    .select('id, salon_id, name, current_stock, min_stock, unit')
    .eq('salon_id', salon.id)
    .eq('is_archived', false)
    .gt('min_stock', 0)
    .filter('current_stock', 'lte', 'min_stock')
  const lowList = (items ?? []) as InventoryRow[]
  if (lowList.length === 0) return 0
  const salonName = salon.name ?? 'Salon'
  const header = t('lowinv.header', { salonName })
  const lines = lowList.map((it) =>
    t('lowinv.line', {
      name: it.name,
      stock: it.current_stock,
      min: it.min_stock,
      unit: it.unit ?? '',
    }),
  )
  const text = `${header}\n\n${lines.join('\n')}`
  const html =
    `<h2 style="font-size:18px;margin:0 0 12px 0;color:#1A1A2E">${header}</h2>` +
    `<ul style="padding-left:20px;color:#1A1A2E;font-size:14px;line-height:1.6">` +
    lowList
      .map(
        (it) =>
          `<li>${t('lowinv.line', {
            name: `<strong>${it.name}</strong>`,
            stock: it.current_stock,
            min: it.min_stock,
            unit: it.unit ?? '',
          }).replace(/^•\s*/, '')}</li>`,
      )
      .join('') +
    `</ul>` +
    `<p style="color:#6b7280;font-size:12px;margin-top:16px">${t('lowinv.email_footer')}</p>`
  const pushTitle = t('lowinv.push_title', { salonName })
  let sent = 0
  try {
    const pushed = await sendPushToUser(admin, owner.user_id, {
      title: pushTitle,
      body: lines.slice(0, 3).join('\n'),
      url: `/app/${salon.id}/inventory`,
      tag: 'low-inventory',
    })
    sent += pushed
  } catch (e) {
    console.warn(`push failed: ${e instanceof Error ? e.message : String(e)}`)
  }
  // T38 — единый dispatcher: проверит prefs.low_inventory.{email,telegram,sms}
  // и отправит по нужным каналам с готовыми шаблонами. Push выше — отдельная
  // ветка (он не управляется тем же prefs-флагом, см. PushNotificationsCard).
  const dispatched = await dispatchNotification({
    salonId: salon.id,
    userId: owner.user_id,
    type: 'low_inventory',
    payload: {
      items: lowList.map((it) => ({
        name: it.name,
        current: it.current_stock,
        min: it.min_stock,
        unit: it.unit ?? '',
      })),
    },
  })
  if (dispatched) sent++
  // Mute неиспользуемые legacy-переменные: оставляем text/html для fallback
  // если в будущем dispatchNotification вернётся к direct-send.
  void text
  void html
  void pushTitle
  return sent
}

async function processCalendarConflicts(
  admin: SupabaseClient,
  salon: SalonRow,
  owner: { user_id: string; email: string | null; telegram_id: number | null },
  locale: NotifLocale,
): Promise<number> {
  const t = makeT(locale)
  if (!isEnabled(salon.notification_prefs, 'calendar_conflicts')) return 0
  // Берём БУДУЩИЕ визиты на 14 дней вперёд — этого окна достаточно для
  // утреннего предупреждения, дальше юзер сам корректирует.
  const nowIso = new Date().toISOString()
  const horizonIso = new Date(Date.now() + 14 * 86400000).toISOString()
  const { data: visits } = await admin
    .from('visits')
    .select('id, visit_at, duration_min, staff_id, service_name_snapshot, client_id')
    .eq('salon_id', salon.id)
    .is('deleted_at', null)
    .neq('status', 'cancelled')
    .not('staff_id', 'is', null)
    .gte('visit_at', nowIso)
    .lt('visit_at', horizonIso)
    .order('staff_id', { ascending: true })
    .order('visit_at', { ascending: true })
  if (!visits || visits.length === 0) return 0

  type V = {
    id: string
    visit_at: string
    duration_min: number | null
    staff_id: string | null
    service_name_snapshot: string | null
  }
  // Парами по тому же staff_id — overlap если start_b < end_a.
  const conflicts: Array<{ a: V; b: V }> = []
  const byStaff = new Map<string, V[]>()
  for (const v of visits as V[]) {
    if (!v.staff_id) continue
    const arr = byStaff.get(v.staff_id) ?? []
    arr.push(v)
    byStaff.set(v.staff_id, arr)
  }
  for (const arr of byStaff.values()) {
    for (let i = 0; i < arr.length - 1; i++) {
      const a = arr[i]!
      const b = arr[i + 1]!
      const aStart = new Date(a.visit_at).getTime()
      const aEnd = aStart + (a.duration_min ?? 60) * 60_000
      const bStart = new Date(b.visit_at).getTime()
      if (bStart < aEnd) conflicts.push({ a, b })
    }
  }
  if (conflicts.length === 0) return 0

  // Имена staff для message
  const staffIds = [...new Set(conflicts.map((c) => c.a.staff_id!).filter(Boolean))]
  const { data: staffRows } = await admin.from('staff').select('id, full_name').in('id', staffIds)
  const staffName = new Map<string, string>(
    (staffRows ?? []).map((s) => [s.id as string, s.full_name as string]),
  )

  const salonName = salon.name ?? 'Salon'
  const dash = t('common.dash')
  const dtLocale = bcp47(locale)
  const fmt = (iso: string) =>
    new Date(iso).toLocaleString(dtLocale, {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
  const lineVars = (c: { a: V; b: V }) => ({
    staff: staffName.get(c.a.staff_id!) ?? dash,
    aTime: fmt(c.a.visit_at),
    aService: c.a.service_name_snapshot ?? dash,
    bTime: fmt(c.b.visit_at),
    bService: c.b.service_name_snapshot ?? dash,
  })
  const lines = conflicts.slice(0, 10).map((c) => t('conflict.line', lineVars(c)))
  const moreText =
    conflicts.length > 10 ? `\n${t('conflict.more', { count: conflicts.length - 10 })}` : ''
  const header = t('conflict.header', { salonName })
  const text = `${header}\n\n${lines.join('\n')}${moreText}`
  const html =
    `<h2 style="font-size:18px;margin:0 0 12px 0;color:#1A1A2E">${header}</h2>` +
    `<ul style="padding-left:20px;color:#1A1A2E;font-size:14px;line-height:1.6">` +
    conflicts
      .slice(0, 20)
      .map((c) => `<li>${t('conflict.line_html', lineVars(c))}</li>`)
      .join('') +
    `</ul>` +
    `<p style="color:#6b7280;font-size:12px;margin-top:16px">${t('conflict.email_footer')}</p>`

  let sent = 0
  try {
    const pushed = await sendPushToUser(admin, owner.user_id, {
      title: t('conflict.push_title', { salonName }),
      body: lines.slice(0, 3).join('\n'),
      url: `/app/${salon.id}/visits`,
      tag: 'calendar-conflicts',
    })
    sent += pushed
  } catch (e) {
    console.warn(`push failed: ${e instanceof Error ? e.message : String(e)}`)
  }
  // T38 — единый dispatcher с per-channel prefs.
  const dispatched = await dispatchNotification({
    salonId: salon.id,
    userId: owner.user_id,
    type: 'calendar_conflicts',
    payload: {
      conflicts: conflicts.slice(0, 20).map((c) => ({
        staff: staffName.get(c.a.staff_id!) ?? dash,
        time: fmt(c.a.visit_at),
        clients: `${c.a.service_name_snapshot ?? dash} ↔ ${c.b.service_name_snapshot ?? dash}`,
      })),
    },
  })
  if (dispatched) sent++
  void text
  void html
  return sent
}

async function processOneSalon(admin: SupabaseClient, salon: SalonRow): Promise<{ sent: number }> {
  const stats = { sent: 0 }
  // Owner — берём locale из profiles для локализации уведомлений.
  const { data: ownerRow } = await admin
    .from('salon_members')
    .select('user_id, profiles!inner(email, telegram_id, locale)')
    .eq('salon_id', salon.id)
    .eq('role', 'owner')
    .limit(1)
    .maybeSingle()
  type OwnerRaw = {
    user_id: string
    profiles: { email?: string; telegram_id?: number | null; locale?: string | null } | null
  }
  const owner = ownerRow as OwnerRaw | null
  if (!owner) return stats
  const ownerData = {
    user_id: owner.user_id,
    email: owner.profiles?.email ?? null,
    telegram_id: owner.profiles?.telegram_id ?? null,
  }
  const locale = normalizeNotifLocale(owner.profiles?.locale)
  stats.sent += await processLowInventory(admin, salon, ownerData, locale)
  stats.sent += await processCalendarConflicts(admin, salon, ownerData, locale)
  return stats
}

Deno.serve(
  withSentry('daily-notifications', async (req: Request) => {
    if (req.method === 'OPTIONS') return preflight()
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
    const { data: trig, error: trigErr } = await admin
      .from('daily_notifications_triggers')
      .update({ used_at: new Date().toISOString() })
      .eq('token', body.token)
      .is('used_at', null)
      .gt('expires_at', new Date().toISOString())
      .select('token')
      .maybeSingle()
    if (trigErr || !trig) return jsonResponse({ ok: false, error: 'invalid_or_expired_token' }, 401)

    const { data: salons } = await admin
      .from('salons')
      .select('id, name, currency, notification_prefs')
      .is('deleted_at', null)
      .is('blocked_at', null)

    let totalSent = 0
    for (const s of salons ?? []) {
      try {
        const r = await processOneSalon(admin, s as SalonRow)
        totalSent += r.sent
      } catch (e) {
        console.warn(`salon ${s.id} failed: ${e instanceof Error ? e.message : String(e)}`)
      }
    }

    return jsonResponse({ ok: true, sent: totalSent })
  }),
)
