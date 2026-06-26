/**
 * marketing-send-broadcast — массовая ручная рассылка по сегменту клиентов.
 *
 * Owner салона выбирает в UI:
 *   - сегмент: all / new / regular / dormant / tag:<имя>
 *   - каналы: sms ?and/or email
 *   - тексты: sms_text, email_subject, email_body
 *
 * Edge function:
 *   1. Загружает клиентов салона из таблицы clients
 *   2. Фильтрует по сегменту локально (visit_count / last_visit_at / tags)
 *   3. По каждому клиенту: если channels.sms+phone → sendSmsForSalon;
 *      если channels.email+email → Resend.
 *   4. Возвращает агрегаты: total, sent_sms, sent_email, skipped_no_contact.
 *
 * Body:
 *   {
 *     salon_id: string,
 *     segment: 'all' | 'new' | 'regular' | 'dormant' | { tag: string },
 *     channels: { sms?: boolean, email?: boolean },
 *     sms_text?: string,                 // обязательное если channels.sms
 *     email_subject?: string,            // обязательное если channels.email
 *     email_body?: string                // обязательное если channels.email
 *   }
 *
 * SMS: 1 SMS = 1 списание с баланса. Email: бесплатно (Resend).
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.6'

import { getSalonMembership, getUserFromRequest } from '../_shared/auth.ts'
import { corsHeaders, preflight } from '../_shared/cors.ts'
import { sendSmsForSalon } from '../_shared/sms-billing.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? ''
const RESEND_FROM = Deno.env.get('RESEND_FROM') ?? 'Finkley <noreply@finkley.app>'

const DORMANT_DAYS = 90
const REGULAR_MIN_VISITS = 5

type ClientRow = {
  id: string
  name: string | null
  phone: string | null
  email: string | null
  visit_count: number
  last_visit_at: string | null
  tags: string[] | null
}

type Segment = 'all' | 'new' | 'regular' | 'dormant' | { tag: string } | { client_ids: string[] }

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'content-type': 'application/json' },
  })
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function filterBySegment(clients: ClientRow[], seg: Segment): ClientRow[] {
  const now = Date.now()
  return clients.filter((c) => {
    if (seg === 'all') return true
    if (seg === 'new') return c.visit_count === 1
    if (seg === 'regular') return c.visit_count >= REGULAR_MIN_VISITS
    if (seg === 'dormant') {
      if (!c.last_visit_at) return false
      const days = (now - new Date(c.last_visit_at).getTime()) / 86_400_000
      return days >= DORMANT_DAYS
    }
    if (typeof seg === 'object' && 'tag' in seg && seg.tag) {
      return Array.isArray(c.tags) && c.tags.includes(seg.tag)
    }
    if (typeof seg === 'object' && 'client_ids' in seg && Array.isArray(seg.client_ids)) {
      return seg.client_ids.includes(c.id)
    }
    return false
  })
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return preflight()
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)
  if (!SUPABASE_URL || !SERVICE_ROLE) return json({ error: 'function_not_configured' }, 500)

  const user = await getUserFromRequest(req, SUPABASE_URL, SERVICE_ROLE)
  if (!user) return json({ error: 'unauthorized' }, 401)

  let body: {
    salon_id?: string
    segment?: Segment
    channels?: { sms?: boolean; email?: boolean }
    sms_text?: string
    email_subject?: string
    email_body?: string
    dry_run?: boolean
  }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'invalid_json' }, 400)
  }
  const { salon_id, segment, channels, sms_text, email_subject, email_body } = body
  const dryRun = body.dry_run === true
  if (!salon_id || !segment || !channels) return json({ error: 'missing_fields' }, 400)
  if (!channels.sms && !channels.email) return json({ error: 'no_channel_selected' }, 400)
  if (channels.sms && !sms_text?.trim()) return json({ error: 'sms_text_required' }, 400)
  if (channels.email && (!email_subject?.trim() || !email_body?.trim())) {
    return json({ error: 'email_subject_body_required' }, 400)
  }

  const membership = await getSalonMembership(SUPABASE_URL, SERVICE_ROLE, user.userId, salon_id)
  if (!membership || membership.role !== 'owner') return json({ error: 'forbidden' }, 403)

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data: salonRow } = await admin
    .from('salons')
    .select('name')
    .eq('id', salon_id)
    .maybeSingle()
  const salonName = (salonRow as { name: string | null } | null)?.name ?? 'Finkley'

  // Подгрузка клиентов салона.
  const { data: clientsData, error: clErr } = await admin
    .from('clients')
    .select('id, name, phone, email, visit_count, last_visit_at, tags')
    .eq('salon_id', salon_id)
    .is('deleted_at', null)
  if (clErr) return json({ error: 'db_error', message: clErr.message }, 500)

  const filtered = filterBySegment((clientsData ?? []) as ClientRow[], segment)

  // Доп. фильтр: оставляем только тех у кого есть актуальный канал.
  const eligible = filtered.filter((c) => {
    if (channels.sms && c.phone) return true
    if (channels.email && c.email) return true
    return false
  })

  if (dryRun) {
    return json({
      ok: true,
      dry_run: true,
      total_in_segment: filtered.length,
      eligible: eligible.length,
      can_sms: eligible.filter((c) => !!c.phone && !!channels.sms).length,
      can_email: eligible.filter((c) => !!c.email && !!channels.email).length,
    })
  }

  let sentSms = 0
  let sentEmail = 0
  let failedSms = 0
  let failedEmail = 0
  let skippedNoBalance = 0
  let skippedPaused = 0

  /**
   * Подставляет переменные {name}, {firstName}, {salon}, {date} в текст.
   * Используется для SMS, email subject и email body.
   */
  function interpolate(text: string, client: ClientRow): string {
    const fullName = (client.name ?? '').trim()
    const firstName = fullName.split(/\s+/)[0] ?? fullName
    const today = new Date().toLocaleDateString('ru-RU', {
      day: 'numeric',
      month: 'long',
    })
    return text
      .replace(/\{name\}/g, fullName || firstName || 'клиент')
      .replace(/\{firstName\}/g, firstName || fullName || 'клиент')
      .replace(/\{salon\}/g, salonName)
      .replace(/\{date\}/g, today)
  }

  /**
   * Если текст уже содержит HTML-теги — отдаём как есть (шаблоны из rich-text
   * editor приходят с <p>/<strong>/<a>). Иначе обёртываем в простой <p> и
   * заменяем \n → <br>.
   */
  function ensureHtml(body: string): string {
    if (/<\w+[\s>]/.test(body)) return body
    return `<p style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;line-height:1.5">${escapeHtml(
      body,
    ).replace(/\n/g, '<br>')}</p>`
  }

  for (const c of eligible) {
    const personalizedSms = sms_text ? interpolate(sms_text, c) : undefined
    const personalizedSubject = email_subject ? interpolate(email_subject, c) : undefined
    const personalizedBody = email_body ? interpolate(email_body, c) : undefined

    if (channels.sms && c.phone && personalizedSms) {
      const r = await sendSmsForSalon(admin, {
        salonId: salon_id,
        to: c.phone,
        text: personalizedSms,
        messageType: 'manual',
        clientId: c.id,
      })
      if (r.ok) sentSms++
      else if (r.status === 'skipped_no_balance') {
        skippedNoBalance++
        // Дальше слать SMS бессмысленно — баланс кончился. Email продолжаем.
      } else if (r.status === 'skipped_paused') {
        skippedPaused++
      } else {
        failedSms++
      }
    }
    if (channels.email && c.email && personalizedSubject && personalizedBody && RESEND_API_KEY) {
      const html = ensureHtml(personalizedBody)
      try {
        const rEmail = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${RESEND_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: RESEND_FROM,
            to: [c.email],
            subject: personalizedSubject,
            // text-версия — без HTML, для клиентов без поддержки. Берём тот же
            // body но если он HTML — strip tags грубо.
            text: personalizedBody.replace(/<[^>]+>/g, ''),
            html,
            headers: { 'X-Finkley-Salon': salonName },
          }),
        })
        if (rEmail.ok) sentEmail++
        else failedEmail++
      } catch {
        failedEmail++
      }
    }
  }

  // Трекинг: реальная рассылка отправлена (не dry_run). Читается RPC
  // setup_progress → задача «Первая рассылка» в чек-листе «Настройка Finkley».
  // Пишем только если хоть что-то реально ушло (sms ИЛИ email), чтобы пустой
  // сегмент / нулевая отправка не засчитывались как выполненная задача.
  if (sentSms > 0 || sentEmail > 0) {
    const { error: trackErr } = await admin.from('tracking_events').insert({
      user_id: user.userId,
      salon_id: salon_id,
      event_type: 'action',
      path: 'marketing_broadcast_sent',
      metadata: {
        sent_sms: sentSms,
        sent_email: sentEmail,
        eligible: eligible.length,
      },
    })
    if (trackErr) console.warn('tracking_events insert failed:', trackErr.message)
  }

  return json({
    ok: true,
    total_in_segment: filtered.length,
    eligible: eligible.length,
    sent_sms: sentSms,
    sent_email: sentEmail,
    failed_sms: failedSms,
    failed_email: failedEmail,
    skipped_no_balance: skippedNoBalance,
    skipped_paused: skippedPaused,
  })
})
