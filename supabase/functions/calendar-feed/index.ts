/**
 * calendar-feed — RFC 5545 iCal feed для подписки в Google/Apple Calendar/Outlook.
 *
 * URL: https://...functions.supabase.co/calendar-feed?token=<token>
 * Метод: GET (только)
 * Auth: уникальный непредсказуемый token из calendar_feed_tokens.
 *       Никакого user JWT — внешние календари не умеют отправлять Authorization.
 *
 * Возвращает text/calendar с визитами на 90 дней назад + 90 вперёд.
 * Cache-Control: max-age=900 (15 минут) — клиенты обычно опрашивают 1-3 раза в день.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'

import { withSentry } from '../_shared/sentry.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

function textResponse(body: string, status = 200, contentType = 'text/calendar') {
  return new Response(body, {
    status,
    headers: {
      'Content-Type': `${contentType}; charset=utf-8`,
      'Cache-Control': 'public, max-age=900',
      'Access-Control-Allow-Origin': '*',
    },
  })
}

/** Эскейпим строку для iCal: \\ \, \n */
function ic(s: string): string {
  return (s ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;')
    .replace(/\n/g, '\\n')
}

/** UTC ISO → ICS DATE-TIME 20260508T123000Z */
function icsTime(iso: string): string {
  const d = new Date(iso)
  const y = d.getUTCFullYear()
  const mo = String(d.getUTCMonth() + 1).padStart(2, '0')
  const da = String(d.getUTCDate()).padStart(2, '0')
  const h = String(d.getUTCHours()).padStart(2, '0')
  const mi = String(d.getUTCMinutes()).padStart(2, '0')
  const s = String(d.getUTCSeconds()).padStart(2, '0')
  return `${y}${mo}${da}T${h}${mi}${s}Z`
}

/** Wrap длинных строк в 75-октет lines (RFC 5545). */
function fold(line: string): string {
  if (line.length <= 75) return line
  const chunks: string[] = []
  let i = 0
  while (i < line.length) {
    chunks.push((i === 0 ? '' : ' ') + line.slice(i, i + 73))
    i += 73
  }
  return chunks.join('\r\n')
}

Deno.serve(
  withSentry('calendar-feed', async (req: Request) => {
    if (req.method !== 'GET') {
      return textResponse('Method Not Allowed', 405, 'text/plain')
    }
  if (!SUPABASE_URL || !SERVICE_KEY) {
    return textResponse('Service unavailable', 503, 'text/plain')
  }

  const url = new URL(req.url)
  const token = url.searchParams.get('token')
  if (!token) {
    return textResponse('Missing token', 401, 'text/plain')
  }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data: feed } = await admin
    .from('calendar_feed_tokens')
    .select('id, user_id, salon_id, revoked_at')
    .eq('token', token)
    .maybeSingle()
  if (!feed || feed.revoked_at) {
    return textResponse('Invalid or revoked token', 403, 'text/plain')
  }

  // Touch last_accessed_at — ленивый, без блокировки ответа
  admin
    .from('calendar_feed_tokens')
    .update({ last_accessed_at: new Date().toISOString() })
    .eq('id', feed.id)
    .then(() => undefined)

  // Salon + role-based scope. Owner/admin/accountant → видит весь салон
  // и платежи. Мастер → только свои визиты.
  const [{ data: salon }, { data: member }] = await Promise.all([
    admin.from('salons').select('name, timezone').eq('id', feed.salon_id).single(),
    admin
      .from('salon_members')
      .select('role, staff_id')
      .eq('salon_id', feed.salon_id)
      .eq('user_id', feed.user_id)
      .maybeSingle(),
  ])
  const salonName = salon?.name ?? 'Salon'
  type Member = { role?: string; staff_id?: string | null }
  const memberData = member as Member | null
  const role = memberData?.role ?? 'owner'
  const isAdmin = role === 'owner' || role === 'admin' || role === 'accountant'
  const myStaffId = memberData?.staff_id ?? null

  // Визиты ±90 дней с client/staff/service для DESCRIPTION
  const now = new Date()
  const start = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000)
  const end = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000)

  let visitsQuery = admin
    .from('visits')
    .select(
      'id, visit_at, duration_min, amount_cents, status, service_name_snapshot, staff_id, client_id',
    )
    .eq('salon_id', feed.salon_id)
    .is('deleted_at', null)
    .gte('visit_at', start.toISOString())
    .lt('visit_at', end.toISOString())
    .order('visit_at', { ascending: true })
    .limit(2000)
  if (!isAdmin && myStaffId) {
    // Мастер видит только свои визиты
    visitsQuery = visitsQuery.eq('staff_id', myStaffId)
  } else if (!isAdmin) {
    // У юзера нет привязки к staff и он не admin — отдадим пустой календарь
    visitsQuery = visitsQuery.eq('staff_id', '00000000-0000-0000-0000-000000000000')
  }
  const { data: visits } = await visitsQuery

  // Pre-fetch staff/clients map для скорости
  const staffIds = [...new Set((visits ?? []).map((v) => v.staff_id).filter(Boolean))]
  const clientIds = [...new Set((visits ?? []).map((v) => v.client_id).filter(Boolean))]

  const [{ data: staff }, { data: clients }] = await Promise.all([
    staffIds.length
      ? admin
          .from('staff')
          .select('id, full_name')
          .in('id', staffIds as string[])
      : Promise.resolve({ data: [] }),
    clientIds.length
      ? admin
          .from('clients')
          .select('id, name, phone')
          .in('id', clientIds as string[])
      : Promise.resolve({ data: [] }),
  ])
  const staffMap = new Map((staff ?? []).map((s) => [s.id, s.full_name]))
  const clientMap = new Map((clients ?? []).map((c) => [c.id, { name: c.name, phone: c.phone }]))

  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:-//Finkley//${ic(salonName)}//RU`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${ic(`Finkley · ${salonName}`)}`,
    `X-WR-TIMEZONE:${ic(salon?.timezone ?? 'Europe/Warsaw')}`,
  ]

  for (const v of visits ?? []) {
    const startTs = new Date(v.visit_at)
    // Длительность из visits.duration_min (если задано) или 60 мин fallback
    const durMs =
      typeof v.duration_min === 'number' && v.duration_min > 0
        ? v.duration_min * 60_000
        : 60 * 60_000
    const endTs = new Date(startTs.getTime() + durMs)
    const staffName = v.staff_id ? (staffMap.get(v.staff_id) ?? '') : ''
    const client = v.client_id ? clientMap.get(v.client_id) : null
    const service = v.service_name_snapshot ?? ''
    const title = [client?.name, service].filter(Boolean).join(' · ') || 'Визит'
    const descParts: string[] = []
    if (staffName) descParts.push(`Мастер: ${staffName}`)
    if (client?.name) descParts.push(`Клиент: ${client.name}`)
    if (client?.phone) descParts.push(`Тел.: ${client.phone}`)
    if (service) descParts.push(`Услуга: ${service}`)
    descParts.push(`Сумма: ${(v.amount_cents / 100).toFixed(2)}`)
    descParts.push(`Статус: ${v.status === 'paid' ? 'оплачен' : v.status}`)

    lines.push('BEGIN:VEVENT')
    lines.push(`UID:${v.id}@finkley.app`)
    lines.push(`DTSTAMP:${icsTime(new Date().toISOString())}`)
    lines.push(`DTSTART:${icsTime(startTs.toISOString())}`)
    lines.push(`DTEND:${icsTime(endTs.toISOString())}`)
    lines.push(fold(`SUMMARY:${ic(title)}${v.status === 'pending' ? ' (предстоящий)' : ''}`))
    if (descParts.length) {
      lines.push(fold(`DESCRIPTION:${ic(descParts.join('\\n'))}`))
    }
    lines.push(`STATUS:${v.status === 'cancelled' ? 'CANCELLED' : 'CONFIRMED'}`)
    lines.push('END:VEVENT')
  }

  // Платежи из платёжного календаря (only admin) — all-day events
  if (isAdmin) {
    const today = new Date().toISOString().slice(0, 10)
    const horizon = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    const { data: payments } = await admin
      .from('scheduled_payments')
      .select('id, due_date, amount_cents, vendor_name, invoice_number, status')
      .eq('salon_id', feed.salon_id)
      .eq('status', 'pending')
      .is('deleted_at', null)
      .gte('due_date', today)
      .lte('due_date', horizon)
      .order('due_date', { ascending: true })
      .limit(500)
    for (const p of payments ?? []) {
      const dueDate = p.due_date.replace(/-/g, '')
      const nextDay = (() => {
        const d = new Date(`${p.due_date}T00:00:00Z`)
        d.setUTCDate(d.getUTCDate() + 1)
        return d.toISOString().slice(0, 10).replace(/-/g, '')
      })()
      const amount = `${(p.amount_cents / 100).toFixed(2)}`
      const who = p.vendor_name?.trim() || '—'
      const num = p.invoice_number ? ` №${p.invoice_number}` : ''
      const title = `💸 Оплатить: ${amount} — ${who}${num}`
      const descParts = [
        `Сумма: ${amount}`,
        who !== '—' ? `Поставщик: ${who}` : null,
        p.invoice_number ? `№ фактуры: ${p.invoice_number}` : null,
        `Срок: ${p.due_date}`,
      ].filter(Boolean) as string[]
      lines.push('BEGIN:VEVENT')
      lines.push(`UID:pay-${p.id}@finkley.app`)
      lines.push(`DTSTAMP:${icsTime(new Date().toISOString())}`)
      lines.push(`DTSTART;VALUE=DATE:${dueDate}`)
      lines.push(`DTEND;VALUE=DATE:${nextDay}`)
      lines.push(fold(`SUMMARY:${ic(title)}`))
      lines.push(fold(`DESCRIPTION:${ic(descParts.join('\\n'))}`))
      // Будильник за 24 часа до due_date
      lines.push('BEGIN:VALARM')
      lines.push('TRIGGER:-P1D')
      lines.push('ACTION:DISPLAY')
      lines.push(fold(`DESCRIPTION:${ic(`Платёж завтра: ${title}`)}`))
      lines.push('END:VALARM')
      lines.push('END:VEVENT')
    }
  }

  lines.push('END:VCALENDAR')
  return textResponse(lines.join('\r\n') + '\r\n')
  }),
)
