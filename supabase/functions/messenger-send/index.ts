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

  let body: {
    salon_id?: string
    conversation_id?: string
    text?: string
    media_path?: string
    media_kind?: 'image' | 'video' | 'audio' | 'file'
  }
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: 'invalid_json' }, 400)
  }
  if (!body.salon_id || !body.conversation_id) {
    return jsonResponse({ error: 'missing_fields' }, 400)
  }
  if (!body.text && !body.media_path) {
    return jsonResponse({ error: 'empty_message' }, 400)
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

  // Для media (фото/файлы) сгенерим signed-url из bucket'а messenger-media —
  // его передаём в Meta API как attachment.url. TTL 1 час хватает на доставку.
  let mediaSignedUrl: string | null = null
  if (body.media_path) {
    const { data: signed } = await admin.storage
      .from('messenger-media')
      .createSignedUrl(body.media_path, 60 * 60)
    mediaSignedUrl = signed?.signedUrl ?? null
  }

  if (integ && integ.status === 'connected' && convo.channel === 'telegram') {
    try {
      const token = await decryptSecret(integ.credentials.bot_token_enc as string)
      let tgPath = 'sendMessage'
      let tgBody: Record<string, unknown> = {
        chat_id: convo.external_user_id,
        text: body.text ?? '',
      }
      if (mediaSignedUrl && body.media_kind === 'image') {
        tgPath = 'sendPhoto'
        tgBody = {
          chat_id: convo.external_user_id,
          photo: mediaSignedUrl,
          caption: body.text || undefined,
        }
      } else if (mediaSignedUrl) {
        tgPath = 'sendDocument'
        tgBody = {
          chat_id: convo.external_user_id,
          document: mediaSignedUrl,
          caption: body.text || undefined,
        }
      }
      const resp = await fetch(`https://api.telegram.org/bot${token}/${tgPath}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(tgBody),
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
      // Определяем flow по виду credentials:
      //   page_access_enc — FB Page Token, отправка через graph.facebook.com (flow A)
      //   ig_access_enc   — IG User Token, отправка через graph.instagram.com (flow B)
      const creds = (integ.credentials ?? {}) as Record<string, unknown>
      let endpoint: string
      let providerToken: string
      let useBearer = false
      if (creds.ig_access_enc) {
        providerToken = await decryptSecret(creds.ig_access_enc as string)
        endpoint = `https://graph.instagram.com/v21.0/me/messages`
        useBearer = true
      } else {
        providerToken = await decryptSecret(creds.page_access_enc as string)
        endpoint = `https://graph.facebook.com/v21.0/me/messages?access_token=${encodeURIComponent(providerToken)}`
      }

      // Meta: либо message.text, либо message.attachment. Если есть и то, и
      // то — отправляем 2 запроса (Meta API не поддерживает одновременно).
      const sendOne = async (msgPayload: Record<string, unknown>) => {
        const headers: Record<string, string> = { 'content-type': 'application/json' }
        if (useBearer) headers.authorization = `Bearer ${providerToken}`
        const r = await fetch(endpoint, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            recipient: { id: convo.external_user_id },
            messaging_type: 'RESPONSE',
            message: msgPayload,
          }),
        })
        const j = (await r.json()) as {
          message_id?: string
          error?: { message: string; code: number }
        }
        if (!r.ok || j.error || !j.message_id) {
          throw new Error(j.error?.message ?? `Meta sendMessage failed (HTTP ${r.status})`)
        }
        return j.message_id
      }

      let lastId: string | null = null
      if (mediaSignedUrl && body.media_kind) {
        const attachmentType =
          body.media_kind === 'image'
            ? 'image'
            : body.media_kind === 'video'
              ? 'video'
              : body.media_kind === 'audio'
                ? 'audio'
                : 'file'
        lastId = await sendOne({
          attachment: {
            type: attachmentType,
            payload: { url: mediaSignedUrl, is_reusable: false },
          },
        })
      }
      if (body.text) {
        lastId = await sendOne({ text: body.text })
      }
      externalMessageId = lastId
    } catch (e) {
      deliveryError = e instanceof Error ? e.message : String(e)
    }
  } else if (integ && integ.status === 'connected' && convo.channel === 'whatsapp') {
    try {
      const creds = (integ.credentials ?? {}) as Record<string, unknown>
      const waToken = await decryptSecret(creds.access_token_enc as string)
      const phoneId = (creds.phone_number_id as string) ?? integ.credentials?.phone_number_id
      if (!phoneId) throw new Error('phone_number_id_missing')
      const endpoint = `https://graph.facebook.com/v21.0/${phoneId}/messages`

      // WhatsApp поддерживает один тип сообщения за раз. Если есть и media,
      // и text — отправим 2 (caption внутри media-payload + отдельный text).
      const sendOne = async (msgPayload: Record<string, unknown>) => {
        const r = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${waToken}`,
          },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to: convo.external_user_id,
            ...msgPayload,
          }),
        })
        const j = (await r.json()) as {
          messages?: Array<{ id: string }>
          error?: { message: string; code: number }
        }
        if (!r.ok || j.error || !j.messages?.[0]?.id) {
          throw new Error(j.error?.message ?? `WA send failed (HTTP ${r.status})`)
        }
        return j.messages[0].id
      }

      let lastId: string | null = null
      if (mediaSignedUrl && body.media_kind) {
        const t = body.media_kind === 'file' ? 'document' : body.media_kind
        lastId = await sendOne({ type: t, [t]: { link: mediaSignedUrl } })
      }
      if (body.text) {
        lastId = await sendOne({ type: 'text', text: { body: body.text } })
      }
      externalMessageId = lastId
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
      text: body.text ?? null,
      media_path: body.media_path ?? null,
      media_kind: body.media_kind ?? null,
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
