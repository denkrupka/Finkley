/**
 * daily-notifications — операционные уведомления (не-финансовые).
 *
 * Текущий объём:
 *   - low_inventory: позиции inventory_items с current_stock <= min_stock,
 *     если notification_prefs.low_inventory !== false.
 *   - calendar_conflicts: TODO — двойные брони у одного мастера на пересекающемся
 *     visit_at. Сложная логика, пока не реализована.
 *   - booksy_new_visits: TODO — лучше через push real-time из booksy-proxy
 *     после успешного импорта (не ждать 24 часа).
 *
 * Каналы: Telegram + Email (Resend) — как в payment-reminders.
 * Auth: rendezvous token (daily_notifications_triggers).
 */

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'

import { corsHeaders, preflight } from '../_shared/cors.ts'
import { sendTelegramToUser } from '../_shared/notify.ts'
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
): Promise<number> {
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
  const lines = lowList.map((it) => {
    const unit = it.unit ?? ''
    return `• ${it.name}: ${it.current_stock} ${unit} (порог ${it.min_stock} ${unit})`
  })
  const text = `📦 Низкие остатки на складе (${salonName})\n\n${lines.join('\n')}`
  const html =
    `<h2 style="font-size:18px;margin:0 0 12px 0;color:#1A1A2E">📦 Низкие остатки на складе (${salonName})</h2>` +
    `<ul style="padding-left:20px;color:#1A1A2E;font-size:14px;line-height:1.6">` +
    lowList
      .map(
        (it) =>
          `<li><strong>${it.name}</strong>: ${it.current_stock} ${it.unit ?? ''} (порог ${it.min_stock} ${it.unit ?? ''})</li>`,
      )
      .join('') +
    `</ul>` +
    `<p style="color:#6b7280;font-size:12px;margin-top:16px">Открой <a href="https://finkley.app/app/">Finkley → Склад</a> чтобы оприходовать закупку.</p>`
  let sent = 0
  try {
    const pushed = await sendPushToUser(admin, owner.user_id, {
      title: `Низкие остатки — ${salonName}`,
      body: lines.slice(0, 3).join('\n'),
      url: '/inventory',
      tag: 'low-inventory',
    })
    sent += pushed
  } catch (e) {
    console.warn(`push failed: ${e instanceof Error ? e.message : String(e)}`)
  }
  if (owner.telegram_id) {
    if (await sendTelegramToUser(owner.telegram_id, text)) sent++
  }
  if (owner.email) {
    const r = await sendEmail(owner.email, `Низкие остатки — ${salonName}`, html)
    if (r.ok) sent++
  }
  return sent
}

async function processOneSalon(admin: SupabaseClient, salon: SalonRow): Promise<{ sent: number }> {
  const stats = { sent: 0 }
  // Owner
  const { data: ownerRow } = await admin
    .from('salon_members')
    .select('user_id, profiles!inner(email, telegram_id)')
    .eq('salon_id', salon.id)
    .eq('role', 'owner')
    .limit(1)
    .maybeSingle()
  type OwnerRaw = {
    user_id: string
    profiles: { email?: string; telegram_id?: number | null } | null
  }
  const owner = ownerRow as OwnerRaw | null
  if (!owner) return stats
  const ownerData = {
    user_id: owner.user_id,
    email: owner.profiles?.email ?? null,
    telegram_id: owner.profiles?.telegram_id ?? null,
  }
  stats.sent += await processLowInventory(admin, salon, ownerData)
  return stats
}

Deno.serve(async (req: Request) => {
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
})
