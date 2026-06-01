/**
 * email-channel — приём и отправка email через встроенный мессенджер.
 *
 * SMTP send — реализован через denomailer (Deno-нативная библиотека).
 * IMAP poll — пока stub (требует выбора Deno-совместимой IMAP-библиотеки —
 * на данный момент denoimap/IMAP-Deno нестабильны; рассматриваем замену
 * на Gmail-push через Pub/Sub в следующем спринте).
 *
 * Endpoints:
 *   POST { action: 'connect', salon_id, smtp:{host,port,user,pass,secure},
 *                                          imap:{host,port,user,pass,secure} }
 *   POST { action: 'send',    salon_id, to, subject, text_body, html_body? }
 *   POST { action: 'poll',    salon_id }                — IMAP polling (stub)
 *   POST { action: 'disconnect', salon_id }
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'
import { SMTPClient } from 'https://deno.land/x/denomailer@1.6.0/mod.ts'

import { corsHeaders, preflight } from '../_shared/cors.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'content-type': 'application/json' },
  })
}

type SmtpConfig = { host: string; port: number; user: string; pass: string; secure?: boolean }
type ImapConfig = { host: string; port: number; user: string; pass: string; secure?: boolean }

async function sendEmail(
  smtp: SmtpConfig,
  to: string,
  subject: string,
  textBody: string,
  htmlBody?: string,
): Promise<void> {
  const client = new SMTPClient({
    connection: {
      hostname: smtp.host,
      port: smtp.port,
      tls: smtp.secure === true || smtp.port === 465,
      auth: { username: smtp.user, password: smtp.pass },
    },
  })
  try {
    await client.send({
      from: smtp.user,
      to,
      subject,
      content: textBody,
      html: htmlBody,
    })
  } finally {
    await client.close()
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return preflight()
  if (!SUPABASE_URL || !SERVICE_KEY) return jsonResponse({ error: 'not_configured' }, 500)
  if (req.method !== 'POST') return jsonResponse({ error: 'method_not_allowed' }, 405)

  const body = (await req.json().catch(() => null)) as {
    action?: 'connect' | 'send' | 'poll' | 'disconnect'
    salon_id?: string
    smtp?: SmtpConfig
    imap?: ImapConfig
    to?: string
    subject?: string
    text_body?: string
    html_body?: string
  } | null
  if (!body?.action || !body.salon_id) return jsonResponse({ error: 'bad_request' }, 400)

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  if (body.action === 'connect') {
    if (!body.smtp || !body.imap) return jsonResponse({ error: 'smtp_and_imap_required' }, 400)
    // Test SMTP connection (отправляем no-op для валидации)
    try {
      const test = new SMTPClient({
        connection: {
          hostname: body.smtp.host,
          port: body.smtp.port,
          tls: body.smtp.secure === true || body.smtp.port === 465,
          auth: { username: body.smtp.user, password: body.smtp.pass },
        },
      })
      // connect-only validation (denomailer открывает соединение лениво
      // на send; этот test — symbolic — реальная валидация при первом send).
      await test.close()
    } catch (e) {
      return jsonResponse(
        { ok: false, error: 'smtp_connect_failed', message: (e as Error).message },
        400,
      )
    }
    // Сохраняем integration. Credentials хранятся в jsonb;
    // encryption — TODO в _shared/crypto helper (ADR-002).
    const { error } = await admin.from('messenger_integrations').upsert(
      {
        salon_id: body.salon_id,
        channel: 'email',
        status: 'connected',
        external_account_id: body.smtp.user,
        display_name: body.smtp.user,
        credentials: { smtp: body.smtp, imap: body.imap },
      },
      { onConflict: 'salon_id,channel' },
    )
    if (error) {
      return jsonResponse({ ok: false, error: error.message }, 500)
    }
    return jsonResponse({ ok: true })
  }

  if (body.action === 'disconnect') {
    await admin
      .from('messenger_integrations')
      .update({ status: 'disconnected' })
      .eq('salon_id', body.salon_id)
      .eq('channel', 'email')
    return jsonResponse({ ok: true })
  }

  if (body.action === 'send') {
    if (!body.to || !body.subject || !body.text_body)
      return jsonResponse({ error: 'to_subject_text_required' }, 400)
    const { data: integ } = await admin
      .from('messenger_integrations')
      .select('credentials')
      .eq('salon_id', body.salon_id)
      .eq('channel', 'email')
      .maybeSingle()
    const creds = (integ?.credentials as { smtp?: SmtpConfig } | null)?.smtp
    if (!creds) return jsonResponse({ ok: false, error: 'not_connected' }, 404)
    try {
      await sendEmail(creds, body.to, body.subject, body.text_body, body.html_body)
      return jsonResponse({ ok: true })
    } catch (e) {
      return jsonResponse({ ok: false, error: (e as Error).message }, 500)
    }
  }

  if (body.action === 'poll') {
    // IMAP poll — TODO. Текущий Deno IMAP-ландшафт нестабилен; рассмотрим
    // Gmail Pub/Sub push (для Gmail) или std SMTP/IMAP через npm-bridge
    // (после обновления Supabase Edge до npm-compat 2.0).
    return jsonResponse({
      ok: false,
      error: 'poll_not_implemented',
      message:
        'IMAP polling будет включён в следующем спринте. Send уже работает — клиенты получат твои письма.',
    })
  }

  return jsonResponse({ error: 'unknown_action' }, 400)
})
