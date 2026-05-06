/**
 * send-email — отправка транзакционных писем через Resend API.
 *
 * Принимает `{ template, to, vars }` и рендерит соответствующий шаблон
 * (см. ./templates.ts) с подстановкой переменных, шлёт через Resend.
 *
 * Шаблоны:
 *   - welcome
 *   - trial_ending
 *   - payment_succeeded
 *   - payment_failed
 *   - subscription_canceled
 *
 * ENV:
 *   RESEND_API_KEY — send-only ключ (re_...)
 *   RESEND_FROM    — From-адрес (default 'Finkley <hello@finkley.app>')
 *   FUNCTION_INTERNAL_SECRET — shared secret для server-to-server вызовов
 *
 * Auth: deploy --no-verify-jwt, проверка через X-Finkley-Secret заголовок.
 * Любой вызывающий (stripe-webhook, notify-welcome, scheduled cron) должен
 * прислать X-Finkley-Secret с тем же значением.
 */

import { corsHeaders, preflight } from '../_shared/cors.ts'
import {
  ALLOWED_TEMPLATES,
  render,
  TEMPLATES,
  type TemplateAlias,
} from './templates.ts'

const RESEND_KEY = Deno.env.get('RESEND_API_KEY') ?? ''
const RESEND_FROM = Deno.env.get('RESEND_FROM') ?? 'Finkley <hello@finkley.app>'
const FUNCTION_SECRET = Deno.env.get('FUNCTION_INTERNAL_SECRET') ?? ''

type SendInput = {
  template: TemplateAlias
  to: string
  vars?: Record<string, string | number | null>
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'content-type': 'application/json' },
  })
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return diff === 0
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return preflight()
  if (req.method !== 'POST') return jsonResponse({ error: 'method_not_allowed' }, 405)

  if (!RESEND_KEY || !FUNCTION_SECRET) {
    return jsonResponse({ error: 'function_not_configured' }, 500)
  }

  const got = req.headers.get('x-finkley-secret') || req.headers.get('X-Finkley-Secret') || ''
  if (!timingSafeEqual(got, FUNCTION_SECRET)) {
    return jsonResponse({ error: 'unauthorized' }, 401)
  }

  let body: SendInput
  try {
    body = (await req.json()) as SendInput
  } catch {
    return jsonResponse({ error: 'invalid_json' }, 400)
  }

  if (!body.template || !ALLOWED_TEMPLATES.has(body.template)) {
    return jsonResponse({ error: 'unknown_template' }, 400)
  }
  if (!body.to || !/.+@.+\..+/.test(body.to)) {
    return jsonResponse({ error: 'invalid_to' }, 400)
  }

  const tpl = TEMPLATES[body.template]
  const vars = body.vars ?? {}
  const subject = render(tpl.subject, vars)
  const html = render(tpl.html, vars)

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${RESEND_KEY}`,
    },
    body: JSON.stringify({
      from: RESEND_FROM,
      to: [body.to],
      subject,
      html,
      tags: [{ name: 'template', value: body.template }],
    }),
  })

  const json = (await res.json()) as { id?: string; name?: string; message?: string }
  if (!res.ok) {
    console.error('resend error', json)
    return jsonResponse(
      { error: 'resend_error', message: json.message ?? `HTTP ${res.status}` },
      502,
    )
  }

  return jsonResponse({ ok: true, message_id: json.id })
})
