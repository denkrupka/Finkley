/**
 * marketing-test-send — отправка тестового сообщения owner'у салона по
 * выбранному каналу (sms/email), чтобы он мог проверить как будет выглядеть
 * реальная рассылка.
 *
 * Вызывается из /marketing → таблица рассылок → кнопка «Тест» → модалка.
 *
 * Body:
 *   { salon_id, kind: 'marketing'|'visit_reminder'|'review_request',
 *     channel: 'sms'|'email', to: string }
 *
 * Для SMS — идёт через sendSmsForSalon (списывается баланс салона). Для email —
 * напрямую через Resend (как тестовое; в html — короткий sample-блок).
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.6'

import { getSalonMembership, getUserFromRequest } from '../_shared/auth.ts'
import { corsHeaders, preflight } from '../_shared/cors.ts'
import { sendSmsForSalon } from '../_shared/sms-billing.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? ''
const RESEND_FROM = Deno.env.get('RESEND_FROM') ?? 'Finkley <noreply@finkley.app>'

type Kind = 'marketing' | 'visit_reminder' | 'review_request'

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'content-type': 'application/json' },
  })
}

const SAMPLE_TEXTS: Record<Kind, Record<'sms' | 'email_subject' | 'email_body', string>> = {
  marketing: {
    sms: '{{salon}}: пример маркетингового сообщения. Так клиент увидит вашу акцию. — Finkley тест',
    email_subject: '[ТЕСТ] Маркетинговая рассылка — {{salon}}',
    email_body:
      'Это тестовое маркетинговое сообщение от салона {{salon}}.\n\n' +
      'Так клиент получит сообщение когда вы запустите реальную акцию.\n\n' +
      '— Finkley test',
  },
  visit_reminder: {
    sms: '{{salon}}: пример напоминания о визите. Клиент увидит ссылку на запись. — Finkley тест',
    email_subject: '[ТЕСТ] Напоминание о визите — {{salon}}',
    email_body:
      'Это тестовое напоминание о визите от {{salon}}.\n\n' +
      'Клиент получит такое сообщение если давно не приходил.\n\n' +
      '— Finkley test',
  },
  review_request: {
    sms: '{{salon}}: пример просьбы оставить отзыв. Клиент увидит короткую форму. — Finkley тест',
    email_subject: '[ТЕСТ] Просьба оставить отзыв — {{salon}}',
    email_body:
      'Это тестовая просьба оставить отзыв от {{salon}}.\n\n' +
      'Клиент получает такое сообщение через 1-7 дней после оплаченного визита.\n\n' +
      '— Finkley test',
  },
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return preflight()
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)
  if (!SUPABASE_URL || !SERVICE_ROLE) return json({ error: 'function_not_configured' }, 500)

  const user = await getUserFromRequest(req, SUPABASE_URL, SERVICE_ROLE)
  if (!user) return json({ error: 'unauthorized' }, 401)

  let body: { salon_id?: string; kind?: Kind; channel?: 'sms' | 'email'; to?: string }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'invalid_json' }, 400)
  }
  const { salon_id, kind, channel, to } = body
  if (!salon_id || !kind || !channel || !to) {
    return json({ error: 'missing_fields' }, 400)
  }
  if (!SAMPLE_TEXTS[kind]) return json({ error: 'invalid_kind' }, 400)
  if (channel !== 'sms' && channel !== 'email') return json({ error: 'invalid_channel' }, 400)

  const membership = await getSalonMembership(SUPABASE_URL, SERVICE_ROLE, user.userId, salon_id)
  if (!membership || membership.role !== 'owner') return json({ error: 'forbidden' }, 403)

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data: salon } = await admin.from('salons').select('name').eq('id', salon_id).maybeSingle()
  const salonName = (salon as { name: string | null } | null)?.name ?? 'Finkley'

  const tpl = SAMPLE_TEXTS[kind]

  if (channel === 'sms') {
    const text = tpl.sms.replaceAll('{{salon}}', salonName)
    const r = await sendSmsForSalon(admin, {
      salonId: salon_id,
      to,
      text,
      messageType: 'manual',
      clientId: null,
    })
    if (!r.ok) {
      return json({ error: 'sms_failed', status: r.status, reason: r.error ?? null }, 400)
    }
    return json({ ok: true, channel, newBalance: r.newBalance })
  }

  // Email через Resend.
  if (!RESEND_API_KEY) return json({ error: 'resend_not_configured' }, 503)
  const subject = tpl.email_subject.replaceAll('{{salon}}', salonName)
  const text = tpl.email_body.replaceAll('{{salon}}', salonName)
  const html = `<p style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;line-height:1.5">${text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/\n/g, '<br>')}</p>`

  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: RESEND_FROM,
      to: [to],
      subject,
      text,
      html,
    }),
  })
  if (!r.ok) {
    const txt = await r.text()
    return json({ error: 'email_failed', message: txt.slice(0, 200) }, 502)
  }
  return json({ ok: true, channel })
})
