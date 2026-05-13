/**
 * messenger-send — отправка исходящего сообщения через подключённый канал.
 * Записывает локально в messenger_messages и пушит во внешний API.
 *
 * Если канал ещё в status='pending' (WA/IG/FB без Meta App Review) — пишем
 * только локально и помечаем external_message_id=null, чтобы owner видел
 * отправленную реплику в UI.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.6'

import { getSalonMembership, getUserFromRequest } from '../_shared/auth.ts'
import { corsHeaders, preflight } from '../_shared/cors.ts'
import { decryptSecret } from './crypto.ts'

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

  const user = await getUserFromRequest(req, SUPABASE_URL, SERVICE_KEY)
  if (!user) return jsonResponse({ error: 'unauthorized' }, 401)

  let body: { salon_id?: string; conversation_id?: string; text?: string }
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: 'invalid_json' }, 400)
  }
  if (!body.salon_id || !body.conversation_id || !body.text) {
    return jsonResponse({ error: 'missing_fields' }, 400)
  }

  const membership = await getSalonMembership(SUPABASE_URL, SERVICE_KEY, user.userId, body.salon_id)
  if (!membership) return jsonResponse({ error: 'forbidden' }, 403)

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  // Получаем conversation + integration
  const { data: convo, error: cErr } = await admin
    .from('messenger_conversations')
    .select('id, salon_id, channel, external_user_id')
    .eq('id', body.conversation_id)
    .eq('salon_id', body.salon_id)
    .maybeSingle()
  if (cErr || !convo) return jsonResponse({ error: 'conversation_not_found' }, 404)

  const { data: integ } = await admin
    .from('messenger_integrations')
    .select('credentials, status')
    .eq('salon_id', body.salon_id)
    .eq('channel', convo.channel)
    .maybeSingle()

  let externalMessageId: string | null = null
  let deliveryError: string | null = null

  if (integ && integ.status === 'connected' && convo.channel === 'telegram') {
    try {
      const token = await decryptSecret(integ.credentials.bot_token_enc as string)
      const resp = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chat_id: convo.external_user_id, text: body.text }),
      })
      const tgJson = (await resp.json()) as {
        ok: boolean
        result?: { message_id: number; chat: { id: number } }
        description?: string
      }
      if (!tgJson.ok || !tgJson.result) {
        deliveryError = tgJson.description ?? 'Telegram sendMessage failed'
      } else {
        externalMessageId = `${tgJson.result.chat.id}:${tgJson.result.message_id}`
      }
    } catch (e) {
      deliveryError = e instanceof Error ? e.message : String(e)
    }
  } else if (
    integ &&
    integ.status === 'connected' &&
    (convo.channel === 'facebook' || convo.channel === 'instagram')
  ) {
    try {
      const pageToken = await decryptSecret(integ.credentials.page_access_enc as string)
      const resp = await fetch(
        `https://graph.facebook.com/v21.0/me/messages?access_token=${encodeURIComponent(pageToken)}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            recipient: { id: convo.external_user_id },
            messaging_type: 'RESPONSE',
            message: { text: body.text },
          }),
        },
      )
      const fbJson = (await resp.json()) as {
        message_id?: string
        recipient_id?: string
        error?: { message: string; code: number }
      }
      if (!resp.ok || fbJson.error || !fbJson.message_id) {
        deliveryError = fbJson.error?.message ?? `Meta sendMessage failed (HTTP ${resp.status})`
      } else {
        externalMessageId = fbJson.message_id
      }
    } catch (e) {
      deliveryError = e instanceof Error ? e.message : String(e)
    }
  }

  // Записываем локально (всегда)
  const { data: inserted, error: insErr } = await admin
    .from('messenger_messages')
    .insert({
      conversation_id: convo.id,
      salon_id: body.salon_id,
      direction: 'out',
      text: body.text,
      external_message_id: externalMessageId,
      sent_by_user_id: user.userId,
    })
    .select('id, created_at')
    .single()
  if (insErr) return jsonResponse({ error: 'db_insert_failed', message: insErr.message }, 500)

  return jsonResponse({
    ok: true,
    message_id: inserted.id,
    delivered: !deliveryError && !!externalMessageId,
    delivery_error: deliveryError,
  })
})
