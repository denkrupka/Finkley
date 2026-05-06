/**
 * send-email — обёртка над Postmark `withTemplate` API.
 *
 * Принимает `{ template, to, vars }` и шлёт через шаблон Postmark.
 * Шаблоны (alias) создаются в Postmark Dashboard → Templates:
 *   - welcome
 *   - trial_ending
 *   - payment_succeeded
 *   - payment_failed
 *   - subscription_canceled
 *
 * Каждый принимает свой набор переменных (см. docs/email-templates/).
 *
 * ENV:
 *   POSTMARK_SERVER_TOKEN
 *   POSTMARK_FROM (опц., default 'hello@finkley.app')
 *
 * Auth: verify-jwt: true. Юзер дёргает только для своего аккаунта.
 * Также может вызываться со service-role-key из других edge functions
 * (stripe-webhook → payment_succeeded, например).
 */

import { corsHeaders, preflight } from '../_shared/cors.ts'

const POSTMARK_TOKEN = Deno.env.get('POSTMARK_SERVER_TOKEN') ?? ''
const POSTMARK_FROM = Deno.env.get('POSTMARK_FROM') ?? 'hello@finkley.app'
// Стрим Postmark. Default `outbound` для дефолтного стрима транзакционных
// серверов; если на проекте стрим называется иначе (например, `finklay` —
// известная опечатка, см. setup-доку) — переопределяется через env.
const POSTMARK_STREAM = Deno.env.get('POSTMARK_MESSAGE_STREAM') ?? 'outbound'
// Shared secret для server-to-server вызовов. Деплоится --no-verify-jwt,
// поэтому собственная проверка обязательна. Любой вызывающий (stripe-webhook,
// scheduled cron-job) должен прислать `X-Finkley-Secret` с тем же значением.
const FUNCTION_SECRET = Deno.env.get('FUNCTION_INTERNAL_SECRET') ?? ''

const ALLOWED_TEMPLATES = new Set([
  'welcome',
  'trial_ending',
  'payment_succeeded',
  'payment_failed',
  'subscription_canceled',
])

type SendInput = {
  template: string
  to: string
  vars?: Record<string, string | number | null>
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'content-type': 'application/json' },
  })
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return preflight()
  if (req.method !== 'POST') return jsonResponse({ error: 'method_not_allowed' }, 405)

  if (!POSTMARK_TOKEN || !FUNCTION_SECRET) {
    return jsonResponse({ error: 'function_not_configured' }, 500)
  }

  // Auth: shared secret в заголовке X-Finkley-Secret. Constant-time-ish сравнение.
  const got = req.headers.get('x-finkley-secret') || req.headers.get('X-Finkley-Secret') || ''
  if (got.length !== FUNCTION_SECRET.length) {
    return jsonResponse({ error: 'unauthorized' }, 401)
  }
  let diff = 0
  for (let i = 0; i < got.length; i++) {
    diff |= got.charCodeAt(i) ^ FUNCTION_SECRET.charCodeAt(i)
  }
  if (diff !== 0) {
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

  const res = await fetch('https://api.postmarkapp.com/email/withTemplate', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-Postmark-Server-Token': POSTMARK_TOKEN,
    },
    body: JSON.stringify({
      From: POSTMARK_FROM,
      To: body.to,
      TemplateAlias: body.template,
      TemplateModel: body.vars ?? {},
      MessageStream: POSTMARK_STREAM,
    }),
  })

  const json = (await res.json()) as { ErrorCode?: number; Message?: string; MessageID?: string }
  if (!res.ok || json.ErrorCode) {
    console.error('postmark error', json)
    return jsonResponse(
      { error: 'postmark_error', message: json.Message ?? `HTTP ${res.status}` },
      502,
    )
  }

  return jsonResponse({ ok: true, message_id: json.MessageID })
})
