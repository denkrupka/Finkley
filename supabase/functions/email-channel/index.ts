/**
 * email-channel — приём и отправка email через встроенный мессенджер.
 *
 * Стратегия (skeleton — выбор провайдера обсуждается в ADR с владельцем):
 *
 * Variant A. Универсальный SMTP/IMAP — юзер вводит host/port/username/
 * password (или app-password). IMAP polling раз в N минут читает inbox,
 * SMTP send — отправляет ответы.
 *
 * Variant B. Gmail OAuth — Google API,
 *   - users.messages.list для poll
 *   - users.messages.send для отправки
 *   - Pub/Sub watch для push-уведомлений (вместо polling).
 *
 * Для MVP — Variant A через стороннюю Deno-совместимую SMTP/IMAP библиотеку
 * (denomailer/SMTP, denoimap). Credentials шифруются через application-level
 * AES-GCM (ADR-002 "Pragmatic Privacy").
 *
 * Endpoints:
 *   POST { action: 'connect', salon_id, smtp:{host,port,user,pass},
 *                                          imap:{host,port,user,pass} }
 *   POST { action: 'send',    salon_id, conversation_id, to, subject, body }
 *   POST { action: 'poll',    salon_id }                — cron-вызываемый IMAP poll
 *   POST { action: 'disconnect', salon_id }
 *
 * STATUS: skeleton. Реальный SMTP/IMAP вызов будет в next-spring.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'

import { corsHeaders, preflight } from '../_shared/cors.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'content-type': 'application/json' },
  })
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return preflight()
  if (!SUPABASE_URL || !SERVICE_KEY) return jsonResponse({ error: 'not_configured' }, 500)
  if (req.method !== 'POST') return jsonResponse({ error: 'method_not_allowed' }, 405)

  const body = (await req.json().catch(() => null)) as {
    action?: 'connect' | 'send' | 'poll' | 'disconnect'
    salon_id?: string
    smtp?: { host: string; port: number; user: string; pass: string; secure?: boolean }
    imap?: { host: string; port: number; user: string; pass: string; secure?: boolean }
    conversation_id?: string
    to?: string
    subject?: string
    text_body?: string
  } | null
  if (!body?.action || !body.salon_id) return jsonResponse({ error: 'bad_request' }, 400)

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  if (body.action === 'connect') {
    if (!body.smtp || !body.imap) return jsonResponse({ error: 'smtp_and_imap_required' }, 400)
    // TODO: шифрование smtp/imap credentials через _shared/crypto helper.
    // Пока сохраняем в integration_secrets как plaintext-JSON (требует
    // последующей encryption-миграции).
    await admin.from('messenger_integrations').upsert(
      {
        salon_id: body.salon_id,
        channel: 'email',
        status: 'connected',
        external_account_id: body.smtp.user,
        display_name: body.smtp.user,
      },
      { onConflict: 'salon_id,channel' },
    )
    return jsonResponse({
      ok: true,
      note: 'Email-канал подключён. SMTP-отправка и IMAP-poll будут включены после реализации в следующем спринте.',
    })
  }

  if (body.action === 'disconnect') {
    await admin
      .from('messenger_integrations')
      .update({ status: 'disconnected' })
      .eq('salon_id', body.salon_id)
      .eq('channel', 'email')
    return jsonResponse({ ok: true })
  }

  if (body.action === 'send' || body.action === 'poll') {
    return jsonResponse({
      ok: false,
      error: `${body.action}_not_implemented`,
      message:
        'Email send/poll пока не реализованы. Каркас интеграции + БД готовы; выбор SMTP-провайдера и IMAP-библиотеки — следующий шаг.',
    })
  }

  return jsonResponse({ error: 'unknown_action' }, 400)
})
