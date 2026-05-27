/**
 * messenger-telegram-webhook — приёмник входящих Telegram-апдейтов.
 *
 * URL: https://<project>.functions.supabase.co/messenger-telegram-webhook?salon=<uuid>
 *
 * Telegram присылает POST с заголовком X-Telegram-Bot-Api-Secret-Token =
 * webhook_secret, который мы установили при connect. Валидируем его, далее
 * нормализуем update → upsert conversation + insert message.
 *
 * Для надёжности дедупа external_message_id = `${chat_id}:${message_id}`.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.6'

import { corsHeaders, preflight } from '../_shared/cors.ts'
import { dispatchNotification } from '../_shared/notify.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'content-type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return preflight()
  if (req.method !== 'POST') return jsonResponse({ error: 'method_not_allowed' }, 405)

  const url = new URL(req.url)
  const salonId = url.searchParams.get('salon')
  if (!salonId) return jsonResponse({ error: 'salon_required' }, 400)

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  // Достаём webhook_secret из БД, сравниваем с заголовком
  const { data: integ } = await admin
    .from('messenger_integrations')
    .select('id, webhook_secret, status')
    .eq('salon_id', salonId)
    .eq('channel', 'telegram')
    .maybeSingle()
  if (!integ) return jsonResponse({ error: 'not_connected' }, 404)

  const headerSecret = req.headers.get('x-telegram-bot-api-secret-token')
  if (integ.webhook_secret && headerSecret !== integ.webhook_secret) {
    return jsonResponse({ error: 'secret_mismatch' }, 401)
  }

  type TgMessage = {
    message_id: number
    from?: { id: number; username?: string; first_name?: string; last_name?: string }
    chat: { id: number; type: string }
    text?: string
    photo?: Array<{ file_id: string }>
    voice?: { file_id: string }
    document?: { file_id: string }
    date?: number
  }
  type TgUpdate = { update_id: number; message?: TgMessage; edited_message?: TgMessage }

  let update: TgUpdate
  try {
    update = (await req.json()) as TgUpdate
  } catch {
    return jsonResponse({ error: 'invalid_json' }, 400)
  }

  const msg = update.message ?? update.edited_message
  if (!msg) return jsonResponse({ ok: true })

  const chatId = String(msg.chat.id)
  const displayName =
    [msg.from?.first_name, msg.from?.last_name].filter(Boolean).join(' ') ||
    (msg.from?.username ? `@${msg.from.username}` : `chat:${chatId}`)

  // Upsert conversation
  const { data: convo, error: convErr } = await admin
    .from('messenger_conversations')
    .upsert(
      {
        salon_id: salonId,
        channel: 'telegram',
        external_user_id: chatId,
        display_name: displayName,
      },
      { onConflict: 'salon_id,channel,external_user_id' },
    )
    .select('id')
    .single()
  if (convErr || !convo) return jsonResponse({ error: 'upsert_failed' }, 500)

  // Insert message (idempotent by uq_msg_external)
  const mediaKind = msg.photo ? 'image' : msg.voice ? 'audio' : msg.document ? 'file' : null

  await admin.from('messenger_messages').insert({
    conversation_id: convo.id,
    salon_id: salonId,
    direction: 'in',
    text: msg.text ?? null,
    media_kind: mediaKind,
    external_message_id: `${chatId}:${msg.message_id}`,
    created_at: msg.date ? new Date(msg.date * 1000).toISOString() : new Date().toISOString(),
  })

  // T40 — уведомление владельца о входящем Telegram-сообщении.
  try {
    const { data: ownerRow } = await admin
      .from('salon_members')
      .select('user_id')
      .eq('salon_id', salonId)
      .eq('role', 'owner')
      .limit(1)
      .maybeSingle()
    if (ownerRow) {
      const senderName =
        [msg.from?.first_name, msg.from?.last_name].filter(Boolean).join(' ') ||
        msg.from?.username ||
        'Клиент'
      const preview = msg.text || (mediaKind ? `[${mediaKind}]` : '')
      await dispatchNotification({
        salonId,
        userId: (ownerRow as { user_id: string }).user_id,
        type: 'messenger_new_message',
        payload: { sender: senderName, channel: 'telegram', preview: preview.slice(0, 280) },
      })
    }
  } catch (e) {
    console.warn(`messenger-telegram notify failed: ${e instanceof Error ? e.message : String(e)}`)
  }

  return jsonResponse({ ok: true })
})
