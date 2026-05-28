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
import { dispatchNotification } from '../_shared/notify.ts'
import { decryptSecret } from './crypto.ts'

/**
 * T40 — уведомление владельца салона о входящем сообщении от клиента.
 * Вызывается ПОСЛЕ insert в messenger_messages для direction='in'.
 * Все ошибки тихо логируем — webhook не должен падать из-за нотификации.
 */
async function notifyOwnerOfIncomingMessage(
  admin: SupabaseClient,
  salonId: string,
  conversationId: string,
  channel: 'whatsapp' | 'facebook' | 'instagram',
  preview: string,
): Promise<void> {
  try {
    // Имя клиента — display_name из conversation; fallback на «Клиент».
    const { data: convo } = await admin
      .from('messenger_conversations')
      .select('display_name')
      .eq('id', conversationId)
      .maybeSingle()
    const sender = (convo as { display_name?: string | null } | null)?.display_name || 'Клиент'

    const { data: ownerRow } = await admin
      .from('salon_members')
      .select('user_id')
      .eq('salon_id', salonId)
      .eq('role', 'owner')
      .limit(1)
      .maybeSingle()
    if (!ownerRow) return

    await dispatchNotification({
      salonId,
      userId: (ownerRow as { user_id: string }).user_id,
      type: 'messenger_new_message',
      payload: {
        sender,
        channel,
        preview: preview.slice(0, 280),
      },
    })
  } catch (e) {
    console.warn(
      `notifyOwnerOfIncomingMessage failed: ${e instanceof Error ? e.message : String(e)}`,
    )
  }
}

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
  object: 'page' | 'instagram' | 'whatsapp_business_account'
  entry: MetaEntry[]
}

// WhatsApp Cloud API payload (object='whatsapp_business_account')
type WaContact = { profile?: { name?: string }; wa_id: string }
type WaMessage = {
  id: string
  from: string
  timestamp: string
  type: 'text' | 'image' | 'video' | 'audio' | 'document' | 'sticker' | string
  text?: { body: string }
  image?: { id: string; mime_type?: string; caption?: string }
  video?: { id: string; mime_type?: string; caption?: string }
  audio?: { id: string; mime_type?: string }
  document?: { id: string; mime_type?: string; filename?: string; caption?: string }
  sticker?: { id: string; mime_type?: string }
}
type WaChangeValue = {
  messaging_product: 'whatsapp'
  metadata: { display_phone_number: string; phone_number_id: string }
  contacts?: WaContact[]
  messages?: WaMessage[]
  statuses?: Array<{ id: string; status: string; recipient_id: string }>
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

  // WhatsApp Business Cloud API имеет совершенно другую структуру событий —
  // обрабатываем в отдельной ветке, не пытаемся уложить в MessagingEvent.
  if (payload.object === 'whatsapp_business_account') {
    for (const entry of payload.entry) {
      for (const ch of entry.changes ?? []) {
        if (ch.field !== 'messages' || !ch.value) continue
        const v = ch.value as unknown as WaChangeValue
        const phoneId = v.metadata?.phone_number_id
        if (!phoneId) continue
        const { data: integs } = await admin
          .from('messenger_integrations')
          .select('salon_id, status, credentials')
          .eq('channel', 'whatsapp')
          .eq('external_account_id', phoneId)
        if (!integs || integs.length === 0) {
          console.log(`[webhook] no WA integration for phone_id=${phoneId} — skip`)
          continue
        }
        // Карта профилей (имя) — приходит в contacts[], одна на phone_id.
        const nameByWaId = new Map<string, string>()
        for (const c of v.contacts ?? []) {
          if (c.wa_id && c.profile?.name) nameByWaId.set(c.wa_id, c.profile.name)
        }
        for (const integ of integs) {
          const creds = (integ.credentials ?? {}) as Record<string, unknown>
          let waToken: string | null = null
          const waEnc = (creds.access_token_enc ?? creds.access_enc) as string | undefined
          if (waEnc) {
            try {
              waToken = await decryptSecret(waEnc)
            } catch (e) {
              console.warn('decrypt WA token failed:', (e as Error).message)
            }
          }
          for (const m of v.messages ?? []) {
            await ingestWaMessage(admin, integ.salon_id, m, nameByWaId, waToken)
          }
        }
      }
    }
    return jsonResponse({ ok: true })
  }

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

    // Fan-out: одна Page/IG account может быть подключена к нескольким салонам
    // (например, общий бизнес-аккаунт для прод + тест-салона).
    const { data: integs } = await admin
      .from('messenger_integrations')
      .select('salon_id, channel, status, credentials')
      .eq('channel', channel)
      .eq('external_account_id', accountId)
    if (!integs || integs.length === 0) {
      console.log(`[webhook] no integration for ${channel}/${accountId} — skip`)
      continue
    }

    for (const integ of integs) {
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
        // T112 — стратегия с 3 fallback'ами. FB Messenger Profile API
        // требует pages_messaging permission, которое может быть не одобрено
        // (Development mode без тестеров → возвращает 400). Пробуем поочерёдно:
        //   1) first_name + last_name + profile_pic (Standard endpoint)
        //   2) только name (если первый упал на 100/200 «permission required»)
        //   3) /{psid}/picture?type=large&redirect=false (даёт URL аватарки
        //      даже без расширенных прав — это публичная картинка профиля)
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
            `[webhook] FB profile (first/last) failed for ${externalUserId}: code=${prof.error.code} ${prof.error.message}`,
          )
          // Fallback 2: попробовать только name (более базовое поле)
          try {
            const altUrl = `https://graph.facebook.com/v21.0/${externalUserId}?fields=name&access_token=${encodeURIComponent(providerToken)}`
            const altResp = await fetch(altUrl)
            const alt = (await altResp.json()) as {
              name?: string
              error?: { message: string; code?: number }
            }
            if (altResp.ok && !alt.error && alt.name) {
              displayName = alt.name
            } else if (alt.error) {
              console.warn(
                `[webhook] FB profile (name) fallback failed: code=${alt.error.code} ${alt.error.message}`,
              )
            }
          } catch (e) {
            console.warn('FB name fallback exception:', (e as Error).message)
          }
        }
        // Fallback 3: если аватарка ещё не получена — пробуем /picture endpoint,
        // он часто работает даже когда профиль закрыт.
        if (!avatarUrl) {
          try {
            const picUrl = `https://graph.facebook.com/v21.0/${externalUserId}/picture?type=large&redirect=false&access_token=${encodeURIComponent(providerToken)}`
            const picResp = await fetch(picUrl)
            if (picResp.ok) {
              const pic = (await picResp.json()) as {
                data?: { url?: string; is_silhouette?: boolean }
              }
              // is_silhouette=true означает дефолтный «человечек» — не сохраняем.
              if (pic.data?.url && !pic.data.is_silhouette) {
                avatarUrl = pic.data.url
              }
            }
          } catch (e) {
            console.warn('FB picture fallback exception:', (e as Error).message)
          }
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

  // Safe upsert: если conversation уже существует с нормальным display_name
  // (не дефолтным «User XXX»), не перезаписываем его — Meta может вернуть
  // пустой профиль на повторных webhook'ах, и хорошее имя терялось бы.
  const { data: existing } = await admin
    .from('messenger_conversations')
    .select('id, display_name, avatar_url')
    .eq('salon_id', salonId)
    .eq('channel', channel)
    .eq('external_user_id', externalUserId)
    .maybeSingle()

  const isFreshDefault = displayName.startsWith('User ')
  const existingIsGood = existing?.display_name && !existing.display_name.startsWith('User ')
  const finalDisplayName = existingIsGood && isFreshDefault ? existing.display_name : displayName
  const finalAvatarUrl = avatarUrl ?? existing?.avatar_url ?? null

  let convo: { id: string } | null = null
  if (existing) {
    const { data } = await admin
      .from('messenger_conversations')
      .update({ display_name: finalDisplayName, avatar_url: finalAvatarUrl })
      .eq('id', existing.id)
      .select('id')
      .single()
    convo = data ?? { id: existing.id }
  } else {
    const { data } = await admin
      .from('messenger_conversations')
      .insert({
        salon_id: salonId,
        channel,
        external_user_id: externalUserId,
        display_name: finalDisplayName,
        avatar_url: finalAvatarUrl,
      })
      .select('id')
      .single()
    convo = data
  }
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
          const mimeRaw = mResp.headers.get('content-type') ?? ''
          const mime = mimeRaw.split(';')[0].trim() || 'application/octet-stream'
          const extMap: Record<string, string> = {
            'image/jpeg': 'jpg',
            'image/png': 'png',
            'image/webp': 'webp',
            'image/gif': 'gif',
            'video/mp4': 'mp4',
            'video/quicktime': 'mov',
            'audio/mpeg': 'mp3',
            'audio/ogg': 'ogg',
            'audio/mp4': 'm4a',
            'audio/webm': 'webm',
            'application/pdf': 'pdf',
          }
          const ext = extMap[mime] ?? mediaKind
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

  // T40 — уведомить владельца о входящем сообщении от клиента.
  if (direction === 'in') {
    await notifyOwnerOfIncomingMessage(
      admin,
      salonId,
      convo.id,
      channel,
      text || (mediaKind ? `[${mediaKind}]` : ''),
    )
  }
}

/**
 * Обработка одного входящего WhatsApp-сообщения.
 *
 * - Имя клиента: contacts[].profile.name (Meta присылает один раз в каждом
 *   событии, мы кешируем в карте по wa_id и используем здесь).
 * - Media: m.{image|video|audio|document}.id → нужен отдельный GET к
 *   /v21.0/<media_id>?access_token=... чтобы получить временный URL, потом
 *   скачать с Authorization Bearer и положить в bucket messenger-media.
 */
async function ingestWaMessage(
  admin: SupabaseClient,
  salonId: string,
  m: WaMessage,
  nameByWaId: Map<string, string>,
  waToken: string | null,
): Promise<void> {
  const externalUserId = m.from
  const displayName = nameByWaId.get(externalUserId) ?? `WhatsApp ${externalUserId.slice(-4)}`

  // Safe upsert (как для FB/IG) — не перезаписываем уже хорошее имя на дефолт.
  const { data: existing } = await admin
    .from('messenger_conversations')
    .select('id, display_name')
    .eq('salon_id', salonId)
    .eq('channel', 'whatsapp')
    .eq('external_user_id', externalUserId)
    .maybeSingle()

  const isFreshDefault = displayName.startsWith('WhatsApp ')
  const existingIsGood = existing?.display_name && !existing.display_name.startsWith('WhatsApp ')
  const finalDisplayName = existingIsGood && isFreshDefault ? existing.display_name : displayName

  let convoId: string | null = null
  if (existing) {
    await admin
      .from('messenger_conversations')
      .update({ display_name: finalDisplayName })
      .eq('id', existing.id)
    convoId = existing.id
  } else {
    const { data } = await admin
      .from('messenger_conversations')
      .insert({
        salon_id: salonId,
        channel: 'whatsapp',
        external_user_id: externalUserId,
        display_name: finalDisplayName,
      })
      .select('id')
      .single()
    convoId = data?.id ?? null
  }
  if (!convoId) return

  // Текст + media
  let text: string | null = m.text?.body ?? null
  let mediaKind: string | null = null
  let mediaPath: string | null = null
  let mediaId: string | null = null
  let mediaMime: string | null = null
  if (m.type === 'image' && m.image) {
    mediaKind = 'image'
    mediaId = m.image.id
    mediaMime = m.image.mime_type ?? null
    if (!text) text = m.image.caption ?? null
  } else if (m.type === 'video' && m.video) {
    mediaKind = 'video'
    mediaId = m.video.id
    mediaMime = m.video.mime_type ?? null
    if (!text) text = m.video.caption ?? null
  } else if (m.type === 'audio' && m.audio) {
    mediaKind = 'audio'
    mediaId = m.audio.id
    mediaMime = m.audio.mime_type ?? null
  } else if (m.type === 'document' && m.document) {
    mediaKind = 'file'
    mediaId = m.document.id
    mediaMime = m.document.mime_type ?? null
    if (!text) text = m.document.caption ?? m.document.filename ?? null
  } else if (m.type === 'sticker' && m.sticker) {
    mediaKind = 'sticker'
    if (!text) text = '🎭 Стикер'
  }

  if (mediaId && waToken && mediaKind && mediaKind !== 'sticker') {
    try {
      const metaUrl = `https://graph.facebook.com/v21.0/${mediaId}?access_token=${encodeURIComponent(waToken)}`
      const metaResp = await fetch(metaUrl)
      if (metaResp.ok) {
        const j = (await metaResp.json()) as { url?: string; mime_type?: string }
        if (j.url) {
          const fileResp = await fetch(j.url, {
            headers: { Authorization: `Bearer ${waToken}` },
          })
          if (fileResp.ok) {
            const buf = new Uint8Array(await fileResp.arrayBuffer())
            const mime = mediaMime ?? j.mime_type ?? 'application/octet-stream'
            const extMap: Record<string, string> = {
              'image/jpeg': 'jpg',
              'image/png': 'png',
              'image/webp': 'webp',
              'video/mp4': 'mp4',
              'audio/ogg': 'ogg',
              'audio/mpeg': 'mp3',
              'application/pdf': 'pdf',
            }
            const ext = extMap[mime] ?? mediaKind
            const fname = `${salonId}/incoming/${crypto.randomUUID()}.${ext}`
            const { error: upErr } = await admin.storage
              .from('messenger-media')
              .upload(fname, buf, { contentType: mime, upsert: false })
            if (!upErr) {
              mediaPath = fname
            } else {
              console.warn('[webhook][wa] media upload failed:', upErr.message)
            }
          }
        }
      }
    } catch (e) {
      console.warn('[webhook][wa] media download error:', (e as Error).message)
    }
  }

  if (!mediaPath && !text && mediaKind) {
    const labels: Record<string, string> = {
      image: '📷 Изображение',
      video: '🎥 Видео',
      audio: '🎙 Аудио',
      file: '📎 Файл',
      sticker: '🎭 Стикер',
    }
    text = labels[mediaKind] ?? null
  }

  const createdAt = m.timestamp
    ? new Date(parseInt(m.timestamp, 10) * 1000).toISOString()
    : new Date().toISOString()

  await admin.from('messenger_messages').insert({
    conversation_id: convoId,
    salon_id: salonId,
    direction: 'in',
    text,
    media_kind: mediaKind,
    media_path: mediaPath,
    external_message_id: m.id,
    created_at: createdAt,
  })

  // T40 — уведомление владельца о входящем WhatsApp-сообщении.
  await notifyOwnerOfIncomingMessage(
    admin,
    salonId,
    convoId,
    'whatsapp',
    text || (mediaKind ? `[${mediaKind}]` : ''),
  )
}
