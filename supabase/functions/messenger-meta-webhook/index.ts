/**
 * messenger-meta-webhook — приёмник Meta Webhooks для Facebook Messenger
 * и Instagram Direct Messaging.
 *
 * Endpoint URL (production):
 *   https://zjihgyaukpxtplzeubog.functions.supabase.co/messenger-meta-webhook
 *
 * Verify Token: значение env META_WEBHOOK_VERIFY_TOKEN. Meta при настройке
 * webhook'а делает GET-запрос с `hub.verify_token` — мы возвращаем
 * `hub.challenge` если токен совпал. Дальше Meta шлёт POST-события.
 *
 * Поддерживаемые объекты:
 *   - object='page' (FB Messenger) — entry[].messaging[].{sender, message}
 *   - object='instagram' (IG Direct) — entry[].messaging[].{sender, message}
 *
 * Для каждого события находим messenger_integrations по external_account_id
 * (page id / IG business account id), создаём conversation (upsert) и
 * вставляем сообщение в messenger_messages. Дедуп — по external_message_id.
 */

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.6'

import { corsHeaders, preflight } from '../_shared/cors.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const VERIFY_TOKEN = Deno.env.get('META_WEBHOOK_VERIFY_TOKEN') ?? ''

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'content-type': 'application/json' },
  })
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

  type MetaSender = { id: string; name?: string }
  type MetaMessage = {
    mid?: string
    text?: string
    attachments?: Array<{ type: 'image' | 'video' | 'audio' | 'file' }>
  }
  type MetaMessagingEvent = {
    sender: MetaSender
    recipient: { id: string }
    timestamp?: number
    message?: MetaMessage
  }
  type MetaEntry = {
    id: string
    time?: number
    messaging?: MetaMessagingEvent[]
  }
  type MetaWebhookPayload = {
    object: 'page' | 'instagram'
    entry: MetaEntry[]
  }

  let payload: MetaWebhookPayload
  try {
    payload = (await req.json()) as MetaWebhookPayload
  } catch {
    return jsonResponse({ error: 'invalid_json' }, 400)
  }

  if (!payload?.entry?.length) {
    // Meta иногда шлёт пустые heartbeat'ы — отвечаем 200 чтобы не получить
    // re-delivery storm.
    return jsonResponse({ ok: true })
  }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const channel = payload.object === 'instagram' ? 'instagram' : 'facebook'

  for (const entry of payload.entry) {
    const pageOrIgId = entry.id
    const events = entry.messaging ?? []
    if (events.length === 0) continue

    // Находим интеграцию салона по external_account_id = pageOrIgId
    const { data: integ } = await admin
      .from('messenger_integrations')
      .select('salon_id, channel, status')
      .eq('channel', channel)
      .eq('external_account_id', pageOrIgId)
      .maybeSingle()
    if (!integ?.salon_id) continue

    for (const ev of events) {
      if (!ev.message) continue
      await ingestMessage(admin, integ.salon_id, channel, ev, pageOrIgId)
    }
  }

  return jsonResponse({ ok: true })
})

async function ingestMessage(
  admin: SupabaseClient,
  salonId: string,
  channel: 'facebook' | 'instagram',
  ev: {
    sender: { id: string; name?: string }
    recipient: { id: string }
    timestamp?: number
    message?: {
      mid?: string
      text?: string
      attachments?: Array<{ type: 'image' | 'video' | 'audio' | 'file' }>
    }
  },
  pageId: string,
): Promise<void> {
  if (!ev.message) return

  // direction='out' если отправитель — сама страница (page-initiated).
  // У FB sender.id === pageId когда это echo собственного сообщения; такие
  // эхо приходят только если включён `message_echoes`, мы их пишем как out.
  const direction = ev.sender.id === pageId ? 'out' : 'in'
  const externalUserId = direction === 'out' ? ev.recipient.id : ev.sender.id

  // Upsert conversation
  const { data: convo } = await admin
    .from('messenger_conversations')
    .upsert(
      {
        salon_id: salonId,
        channel,
        external_user_id: externalUserId,
        display_name: ev.sender.name ?? `User ${externalUserId.slice(-6)}`,
      },
      { onConflict: 'salon_id,channel,external_user_id' },
    )
    .select('id')
    .single()
  if (!convo) return

  const text = ev.message.text ?? null
  const mediaKind = ev.message.attachments?.[0]?.type ?? null
  const createdAt = ev.timestamp ? new Date(ev.timestamp).toISOString() : new Date().toISOString()
  const externalMessageId = ev.message.mid ?? null

  // Insert (UNIQUE на external_message_id обеспечивает дедуп)
  const insertPayload: Record<string, unknown> = {
    conversation_id: convo.id,
    salon_id: salonId,
    direction,
    text,
    media_kind: mediaKind,
    external_message_id: externalMessageId,
    created_at: createdAt,
  }
  await admin.from('messenger_messages').insert(insertPayload)
}
