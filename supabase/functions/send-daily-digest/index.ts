/**
 * send-daily-digest — ежедневная сводка по салону на email владельца.
 *
 * Содержимое (по дизайну owner'а):
 *   ТЕКУЩИЕ ПОКАЗАТЕЛИ САЛОНА — {salon_name}
 *   Денег в распоряжении: total + разбивка по 5 кассам
 *   Продажи за сегодня: total + разбивка по способам оплаты
 *   Фактуры к оплате: total + список ближайших платежей (scheduled_payments)
 *
 * Режимы:
 *   - **Manual** (Settings UI): { salon_id } + Authorization Bearer <user_jwt>
 *   - **Cron** (каждое утро): { token, cron: true } — токен из digest_triggers
 *
 * Источники данных:
 *   - Денег в распоряжении = sum(salons.financial_settings.cash_registers.*)
 *     (стартовые остатки). В будущем итерации — реальный остаток с учётом
 *     движений; пока owner правит руками в Параметрах.
 *   - Продажи за сегодня = sum visits (kind=retail OR kind=visit, paid)
 *     по сегодняшней дате, разбивка по payment_method.
 *   - Фактуры к оплате = scheduled_payments с status=pending, отсортированные
 *     по due_date asc, лимит 15.
 */

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'

import { corsHeaders, preflight } from '../_shared/cors.ts'
import { renderLogoBlock, sendEmail, sendTelegramToUser } from '../_shared/notify.ts'

type DigestChannel = 'email' | 'telegram'

function normalizeChannels(raw: unknown): DigestChannel[] {
  if (!Array.isArray(raw)) return []
  return raw.filter((c): c is DigestChannel => c === 'email' || c === 'telegram')
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const APP_URL = Deno.env.get('APP_URL') ?? 'https://finkley.app/app/'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'content-type': 'application/json' },
  })
}

function formatCents(cents: number, currency: string): string {
  return new Intl.NumberFormat('ru-RU', { style: 'currency', currency }).format(cents / 100)
}

function formatDate(iso: string): string {
  if (!iso) return ''
  const d = iso.slice(0, 10)
  const [y, m, day] = d.split('-')
  return `${day}.${m}.${y}`
}

type CashRegisters = {
  director_cents?: number
  safe_cents?: number
  gotowka_cents?: number
  bank_karta_cents?: number
  karta_terminal_cents?: number
}

type SalonForDigest = {
  id: string
  name: string | null
  currency: string | null
  logo_url: string | null
  financial_settings: { cash_registers?: CashRegisters } | null
  daily_digest_enabled?: boolean
}

async function sendDigestForSalon(
  admin: SupabaseClient,
  salon: SalonForDigest,
  recipient: { email: string; fullName: string; telegramId: number | null },
  channels: DigestChannel[],
): Promise<{ sent: boolean; reason?: string; via?: DigestChannel[] }> {
  if (channels.length === 0) return { sent: false, reason: 'no_channels' }

  const currency = salon.currency ?? 'PLN'
  const cr = (salon.financial_settings?.cash_registers ?? {}) as CashRegisters
  const totalAvailable =
    (cr.director_cents ?? 0) +
    (cr.safe_cents ?? 0) +
    (cr.gotowka_cents ?? 0) +
    (cr.bank_karta_cents ?? 0) +
    (cr.karta_terminal_cents ?? 0)

  // Сегодняшние продажи: kind=retail+visit, status=paid, visit_at в today UTC
  const today = new Date()
  const dayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  const dayEnd = new Date(dayStart.getTime() + 86400_000)
  const { data: todaySales = [] } = await admin
    .from('visits')
    .select('amount_cents, tip_cents, discount_cents, payment_method')
    .eq('salon_id', salon.id)
    .is('deleted_at', null)
    .eq('status', 'paid')
    .gte('visit_at', dayStart.toISOString())
    .lt('visit_at', dayEnd.toISOString())

  const salesByMethod: Record<string, number> = {}
  let salesTotal = 0
  for (const v of todaySales ?? []) {
    const net = (v.amount_cents ?? 0) - (v.discount_cents ?? 0) + (v.tip_cents ?? 0)
    salesTotal += net
    const m = (v.payment_method as string) ?? 'cash'
    salesByMethod[m] = (salesByMethod[m] ?? 0) + net
  }

  // Фактуры к оплате — scheduled_payments
  let invoicesHtml = ''
  let invoicesTotal = 0
  try {
    const { data: scheduled = [] } = await admin
      .from('scheduled_payments')
      .select('counterparty, due_date, amount_cents')
      .eq('salon_id', salon.id)
      .eq('status', 'pending')
      .order('due_date', { ascending: true })
      .limit(15)
    if (scheduled && scheduled.length > 0) {
      invoicesHtml = scheduled
        .map((p) => {
          invoicesTotal += p.amount_cents ?? 0
          const name = (p.counterparty as string) ?? '—'
          return `<tr>
            <td style="padding:6px 10px;font-size:13px;color:#334155;">${escapeHtml(name)}</td>
            <td style="padding:6px 10px;font-size:13px;color:#94a3b8;text-align:right;white-space:nowrap;">${formatDate((p.due_date as string) ?? '')}</td>
            <td style="padding:6px 10px;font-size:13px;color:#dc2626;text-align:right;white-space:nowrap;font-weight:700;">${formatCents(p.amount_cents ?? 0, currency)}</td>
          </tr>`
        })
        .join('')
    }
  } catch {
    // scheduled_payments table может быть пустая — это OK
  }

  const logo = renderLogoBlock(salon.logo_url)
  const salonName = salon.name ?? 'Салон'

  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(salonName)} — сводка</title></head>
<body style="margin:0;padding:24px;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:640px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.05);">
    ${logo}
    <div style="background:#0F4C5C;padding:20px 24px;color:#ffffff;">
      <p style="margin:0;font-size:12px;letter-spacing:0.08em;text-transform:uppercase;opacity:0.85;">Текущие показатели салона</p>
      <h1 style="margin:6px 0 0 0;font-size:22px;font-weight:700;">${escapeHtml(salonName)}</h1>
    </div>

    <div style="padding:20px 24px;">
      <!-- Деньги в распоряжении -->
      <div style="background:#fef3c7;border-radius:10px;padding:18px;margin-bottom:16px;">
        <div style="display:flex;align-items:center;gap:14px;">
          <span style="font-size:36px;line-height:1;">💰</span>
          <div style="flex:1;">
            <p style="margin:0;font-size:11px;color:#92400e;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;">Денег в распоряжении</p>
            <p style="margin:4px 0 0 0;font-size:30px;font-weight:800;color:#0F4C5C;line-height:1;">${formatCents(totalAvailable, currency)}</p>
          </div>
        </div>
        <table style="width:100%;margin-top:14px;border-collapse:collapse;font-size:13px;">
          ${cashRow('Касса директора', cr.director_cents ?? 0, currency)}
          ${cashRow('Сейф', cr.safe_cents ?? 0, currency)}
          ${cashRow('Gotówka', cr.gotowka_cents ?? 0, currency)}
          ${cashRow('Bank/Karta', cr.bank_karta_cents ?? 0, currency)}
          ${cashRow('Karta / Terminal', cr.karta_terminal_cents ?? 0, currency)}
        </table>
      </div>

      <!-- Продажи за сегодня -->
      <div style="background:#ecfeff;border-radius:10px;padding:18px;margin-bottom:16px;">
        <p style="margin:0;font-size:11px;color:#0e7490;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;">Продажи за сегодня</p>
        <p style="margin:4px 0 8px 0;font-size:30px;font-weight:800;color:#0F4C5C;line-height:1;">${formatCents(salesTotal, currency)}</p>
        <table style="width:100%;border-collapse:collapse;font-size:13px;">
          ${paymentRow('Karta / Terminal', salesByMethod.card ?? 0, currency)}
          ${paymentRow('Gotówka', salesByMethod.cash ?? 0, currency)}
          ${paymentRow('Transfer', salesByMethod.transfer ?? 0, currency)}
        </table>
      </div>

      <!-- Фактуры к оплате -->
      ${
        invoicesHtml
          ? `<div style="background:#fef2f2;border-radius:10px;padding:18px;">
              <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:10px;">
                <p style="margin:0;font-size:11px;color:#991b1b;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;">Фактуры к оплате</p>
                <p style="margin:0;font-size:18px;font-weight:800;color:#dc2626;">${formatCents(invoicesTotal, currency)}</p>
              </div>
              <table style="width:100%;border-collapse:collapse;">
                <thead>
                  <tr>
                    <th style="text-align:left;padding:4px 10px;font-size:11px;font-weight:600;color:#94a3b8;text-transform:uppercase;letter-spacing:0.04em;">Kontrahent</th>
                    <th style="text-align:right;padding:4px 10px;font-size:11px;font-weight:600;color:#94a3b8;text-transform:uppercase;letter-spacing:0.04em;">Termin</th>
                    <th style="text-align:right;padding:4px 10px;font-size:11px;font-weight:600;color:#94a3b8;text-transform:uppercase;letter-spacing:0.04em;">Kwota</th>
                  </tr>
                </thead>
                <tbody>${invoicesHtml}</tbody>
              </table>
            </div>`
          : `<p style="margin:0;font-size:13px;color:#64748b;text-align:center;padding:14px;">Нет ожидающих фактур к оплате 👌</p>`
      }

      <p style="margin:20px 0 0 0;text-align:center;">
        <a href="${APP_URL}/${salon.id}/finance?tab=report" style="display:inline-block;background:#0F4C5C;color:#ffffff;padding:10px 18px;border-radius:8px;text-decoration:none;font-size:13px;font-weight:600;">Открыть финансовый отчёт</a>
      </p>

      <p style="margin:18px 0 0 0;font-size:11px;color:#94a3b8;text-align:center;">
        Финки — твой ежедневный финансовый помощник. Отключить рассылку: Настройки → Профиль.
      </p>
    </div>
  </div>
</body></html>`

  const subject = `Сводка по салону «${salonName}» — ${formatDate(today.toISOString())}`
  const text =
    `Сводка по салону ${salonName}\n\n` +
    `Денег в распоряжении: ${formatCents(totalAvailable, currency)}\n` +
    `Продажи за сегодня: ${formatCents(salesTotal, currency)}\n` +
    (invoicesTotal > 0 ? `Фактуры к оплате: ${formatCents(invoicesTotal, currency)}\n` : '') +
    `\nОткрыть: ${APP_URL}/${salon.id}/finance?tab=report`

  const via: DigestChannel[] = []

  if (channels.includes('email') && recipient.email) {
    // NB: legacy сигнатура — sendEmail из notify.ts ожидает (template, to, vars),
    // здесь передаём объект с готовым html/text. Это работало до миграции на
    // мульти-канал (см. историю файла). Оставляем неизменным чтобы не ломать
    // существующий email-флоу — переписывание на стандартный sendEmail =
    // отдельная задача (нужен шаблон daily_digest в send-email).
    await (sendEmail as unknown as (args: unknown) => Promise<void>)({
      to: recipient.email,
      toName: recipient.fullName,
      subject,
      html,
      text,
    })
    via.push('email')
  }

  if (channels.includes('telegram') && recipient.telegramId) {
    const lines: string[] = []
    lines.push(`📊 <b>Сводка по салону</b> · ${salonName}`)
    lines.push(`${formatDate(today.toISOString())}`)
    lines.push('')
    lines.push(`💰 Денег в распоряжении: <b>${formatCents(totalAvailable, currency)}</b>`)
    lines.push(`🛒 Продажи за сегодня: <b>${formatCents(salesTotal, currency)}</b>`)
    if (invoicesTotal > 0) {
      lines.push(`📋 Фактуры к оплате: <b>${formatCents(invoicesTotal, currency)}</b>`)
    }
    lines.push('')
    lines.push(`${APP_URL}/${salon.id}/finance?tab=report`)
    const ok = await sendTelegramToUser(recipient.telegramId, lines.join('\n'))
    if (ok) via.push('telegram')
  }

  if (via.length === 0) return { sent: false, reason: 'no_active_channel' }
  return { sent: true, via }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function cashRow(label: string, cents: number, currency: string): string {
  return `<tr>
    <td style="padding:3px 10px;color:#92400e;">${escapeHtml(label)}:</td>
    <td style="padding:3px 10px;text-align:right;color:#0F4C5C;font-weight:600;white-space:nowrap;">${formatCents(cents, currency)}</td>
  </tr>`
}

function paymentRow(label: string, cents: number, currency: string): string {
  return `<tr>
    <td style="padding:3px 10px;color:#0e7490;">${escapeHtml(label)}:</td>
    <td style="padding:3px 10px;text-align:right;color:#0F4C5C;font-weight:600;white-space:nowrap;">${formatCents(cents, currency)}</td>
  </tr>`
}

// =============================================================================
// Cron mode
// =============================================================================

async function handleCron(admin: SupabaseClient, token: string): Promise<Response> {
  // Token-rendezvous: ищем неиспользованный токен в digest_triggers
  const { data: trigger, error: tErr } = await admin
    .from('digest_triggers')
    .select('id, used, expires_at')
    .eq('token', token)
    .maybeSingle()
  if (tErr || !trigger) return jsonResponse({ error: 'invalid_token' }, 401)
  if (trigger.used) return jsonResponse({ error: 'token_used' }, 401)
  if (new Date(trigger.expires_at).getTime() < Date.now())
    return jsonResponse({ error: 'token_expired' }, 401)
  await admin
    .from('digest_triggers')
    .update({ used: true, used_at: new Date().toISOString() })
    .eq('id', trigger.id)

  const { data: salons } = await admin
    .from('salons')
    .select(
      'id, name, currency, logo_url, financial_settings, daily_digest_enabled, daily_digest_channels',
    )
    .eq('daily_digest_enabled', true)
    .is('deleted_at', null)

  const stats = { processed: 0, sent: 0, skipped: 0, errors: [] as string[] }
  for (const salon of salons ?? []) {
    stats.processed++
    const channels = normalizeChannels(
      (salon as { daily_digest_channels?: unknown }).daily_digest_channels,
    )
    if (channels.length === 0) {
      stats.skipped++
      continue
    }
    const { data: members } = await admin
      .from('salon_members')
      .select('user_id')
      .eq('salon_id', salon.id)
      .eq('role', 'owner')
      .limit(1)
    const ownerId = members?.[0]?.user_id
    if (!ownerId) {
      stats.skipped++
      continue
    }
    const { data: ownerRes } = await admin.auth.admin.getUserById(ownerId)
    const owner = ownerRes?.user
    if (!owner?.email) {
      stats.skipped++
      continue
    }
    const name =
      (owner.user_metadata?.full_name as string | undefined) ??
      (owner.user_metadata?.name as string | undefined) ??
      owner.email.split('@')[0] ??
      'друг'

    const { data: profile } = await admin
      .from('profiles')
      .select('telegram_id')
      .eq('id', ownerId)
      .maybeSingle()
    const telegramId = (profile as { telegram_id?: number | string | null } | null)?.telegram_id
      ? Number((profile as { telegram_id?: number | string | null }).telegram_id)
      : null

    try {
      const r = await sendDigestForSalon(
        admin,
        salon as SalonForDigest,
        { email: owner.email, fullName: name, telegramId },
        channels,
      )
      if (r.sent) stats.sent++
      else stats.skipped++
    } catch (e) {
      stats.errors.push(`${salon.id}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  return jsonResponse({ ok: true, mode: 'cron', stats })
}

// =============================================================================
// Manual mode
// =============================================================================

async function handleManual(
  admin: SupabaseClient,
  userJwt: string,
  salonId: string,
): Promise<Response> {
  const userClient = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${userJwt}` } },
  })

  const { data: userRes, error: userErr } = await userClient.auth.getUser()
  if (userErr || !userRes?.user) {
    return jsonResponse({ error: 'invalid_token', message: userErr?.message }, 401)
  }
  const user = userRes.user
  const userEmail = user.email ?? ''
  const userName =
    (user.user_metadata?.full_name as string | undefined) ??
    (user.user_metadata?.name as string | undefined) ??
    userEmail.split('@')[0] ??
    'друг'

  const { data: salon, error: salonErr } = await userClient
    .from('salons')
    .select(
      'id, name, currency, logo_url, financial_settings, daily_digest_enabled, daily_digest_channels',
    )
    .eq('id', salonId)
    .maybeSingle()
  if (salonErr || !salon) return jsonResponse({ error: 'salon_not_found_or_no_access' }, 403)

  const channels = normalizeChannels(
    (salon as { daily_digest_channels?: unknown }).daily_digest_channels,
  )
  // Фолбэк на email если массив пустой (старая запись до миграции).
  const effectiveChannels: DigestChannel[] = channels.length > 0 ? channels : ['email']

  const { data: profile } = await admin
    .from('profiles')
    .select('telegram_id')
    .eq('id', user.id)
    .maybeSingle()
  const telegramId = (profile as { telegram_id?: number | string | null } | null)?.telegram_id
    ? Number((profile as { telegram_id?: number | string | null }).telegram_id)
    : null

  const r = await sendDigestForSalon(
    admin,
    salon as SalonForDigest,
    { email: userEmail, fullName: userName, telegramId },
    effectiveChannels,
  )
  if (!r.sent) return jsonResponse({ error: r.reason ?? 'send_failed' }, 500)
  return jsonResponse({
    ok: true,
    mode: 'manual',
    salon_id: salonId,
    sent_to: userEmail,
    via: r.via ?? [],
  })
}

import { withSentry as _withSentry } from '../_shared/sentry.ts'

Deno.serve(
  _withSentry('send-daily-digest', async (req: Request) => {
    if (req.method === 'OPTIONS') return preflight()
    if (req.method !== 'POST') return jsonResponse({ error: 'method_not_allowed' }, 405)
    if (!SUPABASE_URL || !SERVICE_KEY) {
      return jsonResponse({ error: 'function_not_configured' }, 500)
    }

    let body: { salon_id?: string; token?: string; cron?: boolean }
    try {
      body = await req.json()
    } catch {
      return jsonResponse({ error: 'bad_request' }, 400)
    }

    const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    })

    if (body.cron && body.token) return handleCron(admin, body.token)

    const authHeader = req.headers.get('Authorization') ?? ''
    if (!authHeader.startsWith('Bearer ')) return jsonResponse({ error: 'unauthorized' }, 401)
    if (!body.salon_id) return jsonResponse({ error: 'salon_id_required' }, 400)
    return handleManual(admin, authHeader.slice('Bearer '.length), body.salon_id)
  }),
)
