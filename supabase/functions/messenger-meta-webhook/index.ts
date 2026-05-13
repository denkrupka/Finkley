/**
 * messenger-meta-webhook — приёмник Meta Webhooks для Facebook Messenger
 * и Instagram Direct Messaging (оба flow: Messenger API for Instagram + Instagram Login API).
 *
 * Endpoint URL (production):
 *   https://zjihgyaukpxtplzeubog.functions.supabase.co/messenger-meta-webhook
 *
 * Verify Token: значение env META_WEBHOOK_VERIFY_TOKEN. Meta при настройке
 * webhook'а делает GET-запрос с `hub.verify_token` — мы возвращаем
 * `hub.challenge` если токен совпал. Дальше Meta шлёт POST-события.
 *
 * Поддерживаемые объекты и форматы:
 *   - object='page'      (FB Messenger)              — entry[].messaging[]
 *   - object='instagram' (IG via FB Page, flow A)    — entry[].messaging[]
 *   - object='instagram' (IG Login API,   flow B)    — entry[].changes[].value
 *
 * Для каждого события находим messenger_integrations по external_account_id
 * (Page ID / IG Business Account ID / IG User ID), создаём conversation
 * (upsert) и вставляем сообщение в messenger_messages. Дедуп — по external_message_id.
 */

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.6'

import { corsHeaders, preflight } from '../_shared/cors.ts'
import { decryptSecret } from './crypto.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const VERIFY_TOKEN = Deno.env.get('META_WEBHOOK_VERIFY_TOKEN') ?? ''

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'content-type': 'application/json' },
  })
}

type MetaSender = { id: string; name?: string; username?: string }
type MetaMessage = {
  mid?: string
  text?: string
  sticker_id?: number
  attachments?: Array<{
    type: 'image' | 'video' | 'audio' | 'file' | 'fallback' | string
    payload?: { url?: string; sticker_id?: number; title?: string }
  }>
  is_echo?: boolean
}
type MessagingEvent = {
  sender: MetaSender
  recipient: { id: string }
  timestamp?: number
  message?: MetaMessage
}
type ChangeEvent = {
  field: string
  value: MessagingEvent
}
type MetaEntry = {
  id: string
  time?: number
  messaging?: MessagingEvent[]
  changes?: ChangeEvent[]
}
type MetaWebhookPayload = {
  object: 'page' | 'instagram'
  entry: MetaEntry[]
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return preflight()

  const url = new URL(req.url)

  // ---------------------------------------------------------------------------
  // GET — Meta webhook verification handshake
  // ---------------------------------------------------------------------------
  if (req.method === 'GET') {
    const mode = url.searchParams.get('hub.mode')
    const token = url.searchParams.get('hub.verify_token')
    const challenge = url.searchParams.get('hub.challenge')

    if (mode === 'subscribe' && token === VERIFY_TOKEN && challenge) {
      return new Response(challenge, {
        status: 200,
        headers: { ...corsHeaders, 'content-type': 'text/plain' },
      })
    }
    return new Response('verification_failed', {
      status: 403,
      headers: { ...corsHeaders, 'content-type': 'text/plain' },
    })
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'method_not_allowed' }, 405)
  }

  // ---------------------------------------------------------------------------
  // POST — Meta event payload
  // ---------------------------------------------------------------------------
  if (!SUPABASE_URL || !SERVICE_KEY) {
    return jsonResponse({ error: 'server_misconfigured' }, 500)
  }

  let payload: MetaWebhookPayload
  let rawText: string
  try {
    rawText = await req.text()
    payload = JSON.parse(rawText) as MetaWebhookPayload
  } catch {
    return jsonResponse({ error: 'invalid_json' }, 400)
  }

  // Дебаг — пишем raw payload в logs (Supabase Dashboard → Edge Functions → Logs).
  // Полезно для отладки новых flow; можно отключить после стабилизации.
  console.log('[webhook] object=', payload.object, ' raw=', rawText.slice(0, 2000))

  if (!payload?.entry?.length) {
    return jsonResponse({ ok: true })
  }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const channel = payload.object === 'instagram' ? 'instagram' : 'facebook'

  for (const entry of payload.entry) {
    const accountId = entry.id

    // Унифицируем разные payload-форматы в единый список MessagingEvent[].
    // - flow A FB/IG: entry.messaging[]
    // - flow B IG Login: entry.changes[].value (только где field='messages')
    const events: MessagingEvent[] = []
    if (entry.messaging?.length) events.push(...entry.messaging)
    if (entry.changes?.length) {
      for (const ch of entry.changes) {
        if (ch.field === 'messages' && ch.value) events.push(ch.value)
      }
    }
    if (events.length === 0) continue

    // Находим интеграцию салона по external_account_id = accountId
    const { data: integ } = await admin
      .from('messenger_integrations')
      .select('salon_id, channel, status, credentials')
      .eq('channel', channel)
      .eq('external_account_id', accountId)
      .maybeSingle()
    if (!integ?.salon_id) {
      console.log(`[webhook] no integration for ${channel}/${accountId} — skip`)
      continue
    }

    // Расшифровка provider token'а — для подтягивания профиля.
    // Flow A (page/IG-via-Page): credentials.page_access_enc → FB Page Token → graph.facebook.com
    // Flow B (IG Login):         credentials.ig_access_enc   → IG User Token → graph.instagram.com
    let providerToken: string | null = null
    let providerKind: 'page' | 'ig' | null = null
    const creds = (integ.credentials ?? {}) as Record<string, unknown>
    if (creds.page_access_enc) {
      try {
        providerToken = await decryptSecret(creds.page_access_enc as string)
        providerKind = 'page'
      } catch (e) {
        console.warn('decrypt page token failed:', (e as Error).message)
      }
    } else if (creds.ig_access_enc) {
      try {
        providerToken = await decryptSecret(creds.ig_access_enc as string)
        providerKind = 'ig'
      } catch (e) {
        console.warn('decrypt ig token failed:', (e as Error).message)
      }
    }

    for (const ev of events) {
      if (!ev.message) continue
      await ingestMessage(
        admin,
        integ.salon_id,
        channel,
        ev,
        accountId,
        providerToken,
        providerKind,
      )
    }
  }

  return jsonResponse({ ok: true })
})

async function ingestMessage(
  admin: SupabaseClient,
  salonId: string,
  channel: 'facebook' | 'instagram',
  ev: MessagingEvent,
  accountId: string,
  providerToken: string | null,
  providerKind: 'page' | 'ig' | null,
): Promise<void> {
  if (!ev.message) return

  // direction='out' если отправитель — сама страница/IG-бизнес (echo).
  // is_echo приходит в message при включённом subscription на echoes.
  const isEcho = ev.message.is_echo === true || ev.sender.id === accountId
  const direction = isEcho ? 'out' : 'in'
  const externalUserId = direction === 'out' ? ev.recipient.id : ev.sender.id

  let displayName: string =
    ev.sender.name ?? ev.sender.username ?? `User ${externalUserId.slice(-6)}`
  let avatarUrl: string | null = null

  // Профиль клиента: разный endpoint в зависимости от flow.
  if (providerToken && direction === 'in') {
    try {
      if (providerKind === 'page') {
        // FB Messenger Profile API через Page Token: только базовые поля
        // first_name,last_name,profile_pic. Дополнительные поля (name/username)
        // требуют расширенных permission и могут заваливать весь запрос.
        const profUrl = `https://graph.facebook.com/v21.0/${externalUserId}?fields=first_name,last_name,profile_pic&access_token=${encodeURIComponent(providerToken)}`
        const profResp = await fetch(profUrl)
        const prof = (await profResp.json()) as {
          first_name?: string
          last_name?: string
          profile_pic?: string
          error?: { message: string; code?: number }
        }
        if (profResp.ok && !prof.error) {
          const fullName = [prof.first_name, prof.last_name].filter(Boolean).join(' ').trim()
          if (fullName) displayName = fullName
          if (prof.profile_pic) avatarUrl = prof.profile_pic
        } else if (prof.error) {
          console.warn(
            `[webhook] FB profile fetch failed for ${externalUserId}: ${prof.error.message}`,
          )
        }
      } else if (providerKind === 'ig') {
        // IG User Token → graph.instagram.com. Endpoint для профиля собеседника
        // (другого IG-юзера, который писал в DM нашему бизнесу):
        // GET /{ig-user-id}?fields=name,username,profile_pic
        const profUrl = `https://graph.instagram.com/v21.0/${externalUserId}?fields=name,username,profile_pic&access_token=${encodeURIComponent(providerToken)}`
        const profResp = await fetch(profUrl)
        if (profResp.ok) {
          const prof = (await profResp.json()) as {
            name?: string
            username?: string
            profile_pic?: string
            error?: { message: string }
          }
          if (!prof.error) {
            if (prof.name) displayName = prof.name
            else if (prof.username) displayName = `@${prof.username}`
            if (prof.profile_pic) avatarUrl = prof.profile_pic
          }
        }
      }
    } catch (e) {
      console.warn('fetch user profile failed:', (e as Error).message)
    }
  }

  const { data: convo } = await admin
    .from('messenger_conversations')
    .upsert(
      {
        salon_id: salonId,
        channel,
        external_user_id: externalUserId,
        display_name: displayName,
        avatar_url: avatarUrl,
      },
      { onConflict: 'salon_id,channel,external_user_id' },
    )
    .select('id')
    .single()
  if (!convo) return

  let text: string | null = ev.message.text ?? null
  let mediaKind: string | null = null
  let mediaPath: string | null = null
  const att = ev.message.attachments?.[0]
  if (att) {
    const stickerId = att.payload?.sticker_id ?? ev.message.sticker_id
    if (stickerId) {
      mediaKind = 'sticker'
      if (!text) text = '🎭 Стикер'
    } else if (att.type === 'image') {
      mediaKind = 'image'
    } else if (att.type === 'video') {
      mediaKind = 'video'
    } else if (att.type === 'audio') {
      mediaKind = 'audio'
    } else if (att.type === 'file') {
      mediaKind = 'file'
    }

    // Скачиваем media и сохраняем в bucket `messenger-media`. URL от Meta —
    // temporary signed (TTL ~1 час), нам нужно сразу скопировать к себе.
    const url = att.payload?.url
    if (url && mediaKind && mediaKind !== 'sticker') {
      try {
        const mResp = await fetch(url)
        if (mResp.ok) {
          const buf = new Uint8Array(await mResp.arrayBuffer())
          const mime = mResp.headers.get('content-type') ?? 'application/octet-stream'
          const ext = mime.split('/')[1]?.split(';')[0]?.split('+')[0] ?? 'bin'
          const fname = `${salonId}/incoming/${crypto.randomUUID()}.${ext}`
          const { error: upErr } = await admin.storage
            .from('messenger-media')
            .upload(fname, buf, { contentType: mime, upsert: false })
          if (!upErr) {
            mediaPath = fname
          } else {
            console.warn('[webhook] media upload failed:', upErr.message)
          }
        } else {
          console.warn('[webhook] media fetch failed:', mResp.status)
        }
      } catch (e) {
        console.warn('[webhook] media download error:', (e as Error).message)
      }
    }

    // Если файл не удалось скачать — пишем хотя бы текстовый label,
    // чтобы было видно что был attachment.
    if (!mediaPath && !text) {
      const labels: Record<string, string> = {
        image: '📷 Изображение',
        video: '🎥 Видео',
        audio: '🎙 Аудио',
        file: '📎 Файл',
      }
      text = labels[mediaKind ?? ''] ?? null
    }
  }

  const createdAt = ev.timestamp ? new Date(ev.timestamp).toISOString() : new Date().toISOString()
  const externalMessageId = ev.message.mid ?? null

  const insertPayload: Record<string, unknown> = {
    conversation_id: convo.id,
    salon_id: salonId,
    direction,
    text,
    media_kind: mediaKind,
    media_path: mediaPath,
    external_message_id: externalMessageId,
    created_at: createdAt,
  }
  await admin.from('messenger_messages').insert(insertPayload)
}
