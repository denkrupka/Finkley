/**
 * email-channel-pubsub-webhook — приёмник push-уведомлений от Gmail через
 * Google Cloud Pub/Sub. Заменяет poll-based архитектуру на real-time push.
 *
 * Flow:
 *   1. Юзер OAuth-нул Gmail → email-channel-oauth-callback дёргает
 *      users.watch(topicName) → Google запоминает что нас интересует и
 *      publish'ит уведомления в Pub/Sub topic при каждом изменении inbox.
 *   2. Pub/Sub push subscription POSTит сюда {message:{data:base64}, ...}
 *      где data = JSON {emailAddress, historyId}.
 *   3. Здесь по emailAddress находим integration → берём cached historyId
 *      из credentials.oauth.history_id (то что мы знали в last sync) →
 *      дёргаем users.history.list?startHistoryId=<oldId> → получаем
 *      diff с новыми messageIds.
 *   4. Для каждого messageId — get full → upsert conversation + insert
 *      messenger_messages (как poll). Идемпотентно через external_message_id.
 *   5. Обновляем history_id = новый из notification (для следующего раза).
 *
 * Pub/Sub шлёт acknowledgement на 200 OK. Возвращаем 200 даже при errors —
 * иначе Pub/Sub бесконечно retry'ит (DLQ можно настроить отдельно).
 *
 * Verify_jwt=false в config.toml — Pub/Sub не передаёт JWT в нашем формате.
 * Security: endpoint URL обфусцирован (Pub/Sub доступен только своим IP-range),
 * плюс мы валидируем что emailAddress соответствует connected integration.
 */

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

/** UTF-8 string → base64 (для refresh token requests). */
function strToB64(s: string): string {
  const bytes = new TextEncoder().encode(s)
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!)
  return btoa(binary)
}
void strToB64 // utility — может пригодиться

/** Refresh Google OAuth access_token. */
async function refreshGoogleToken(
  refreshToken: string,
): Promise<{ access_token: string; expires_in: number } | null> {
  const clientId = Deno.env.get('GOOGLE_OAUTH_CLIENT_ID') ?? ''
  const clientSecret = Deno.env.get('GOOGLE_OAUTH_CLIENT_SECRET') ?? ''
  if (!clientId || !clientSecret) return null
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
    }).toString(),
  })
  if (!res.ok) return null
  return (await res.json()) as { access_token: string; expires_in: number }
}

/** Достаёт access_token (с авто-refresh) для integration. */
async function ensureAccessToken(
  admin: SupabaseClient,
  salonId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  allCreds: any,
): Promise<string | null> {
  let accessToken = allCreds.oauth?.access_token as string | undefined
  if (!accessToken) return null
  const expiresAt = new Date(allCreds.oauth.expires_at as string).getTime()
  if (Date.now() > expiresAt - 60_000 && allCreds.oauth.refresh_token) {
    const refreshed = await refreshGoogleToken(allCreds.oauth.refresh_token as string)
    if (refreshed) {
      accessToken = refreshed.access_token
      await admin
        .from('messenger_integrations')
        .update({
          credentials: {
            ...allCreds,
            oauth: {
              ...allCreds.oauth,
              access_token: refreshed.access_token,
              expires_at: new Date(Date.now() + refreshed.expires_in * 1000).toISOString(),
            },
          },
        })
        .eq('salon_id', salonId)
        .eq('channel', 'email')
    }
  }
  return accessToken
}

/** Импорт конкретного message по id (full metadata) — upsert conv + insert msg. */
async function importMessage(
  admin: SupabaseClient,
  salonId: string,
  accessToken: string,
  messageId: string,
): Promise<boolean> {
  const msgRes = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=metadata` +
      `&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  )
  if (!msgRes.ok) return false
  const msg = (await msgRes.json()) as {
    id: string
    snippet?: string
    labelIds?: string[]
    payload?: { headers?: Array<{ name: string; value: string }> }
    internalDate?: string
  }
  // Skip outgoing (мы сами их отправили через Gmail API)
  if (msg.labelIds?.includes('SENT') && !msg.labelIds.includes('INBOX')) return false

  const hdr = (n: string) =>
    msg.payload?.headers?.find((h) => h.name.toLowerCase() === n.toLowerCase())?.value ?? ''
  const fromHeader = hdr('From')
  const subject = hdr('Subject')
  const snippet = msg.snippet ?? ''
  const emailMatch = fromHeader.match(/<([^>]+)>/) ?? fromHeader.match(/([^\s<>]+@[^\s<>]+)/)
  const fromAddr = (emailMatch?.[1] ?? fromHeader).toLowerCase().trim()
  if (!fromAddr || !fromAddr.includes('@')) return false
  const fromName = fromHeader.match(/^([^<]+?)\s*</)?.[1]?.trim() || fromAddr.split('@')[0]
  const createdAt = msg.internalDate
    ? new Date(Number(msg.internalDate)).toISOString()
    : new Date().toISOString()

  const { data: existing } = await admin
    .from('messenger_conversations')
    .select('id')
    .eq('salon_id', salonId)
    .eq('channel', 'email')
    .eq('external_user_id', fromAddr)
    .maybeSingle()
  let convId: string | null = null
  if (existing) {
    convId = (existing as { id: string }).id
    await admin
      .from('messenger_conversations')
      .update({
        display_name: fromName,
        last_message_at: createdAt,
        last_message_preview: subject.slice(0, 200),
      })
      .eq('id', convId)
  } else {
    const { data: created } = await admin
      .from('messenger_conversations')
      .insert({
        salon_id: salonId,
        channel: 'email',
        external_user_id: fromAddr,
        display_name: fromName,
        last_message_at: createdAt,
        last_message_preview: subject.slice(0, 200),
      })
      .select('id')
      .single()
    if (created) convId = (created as { id: string }).id
  }
  if (!convId) return false
  const { error } = await admin.from('messenger_messages').insert({
    conversation_id: convId,
    salon_id: salonId,
    direction: 'in',
    text: subject ? `**${subject}**\n\n${snippet}` : snippet,
    external_message_id: msg.id,
    created_at: createdAt,
  })
  return !error || error.code === '23505' // 23505 = uniq violation = дубль, считаем ок
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return jsonResponse({ ok: false, error: 'method_not_allowed' }, 405)
  if (!SUPABASE_URL || !SERVICE_KEY)
    return jsonResponse({ ok: false, error: 'not_configured' }, 200)

  // Pub/Sub envelope
  const body = (await req.json().catch(() => null)) as {
    message?: { data?: string; messageId?: string; publishTime?: string }
    subscription?: string
  } | null
  if (!body?.message?.data) {
    // Возможно health-check / verify — отвечаем 200 чтобы Pub/Sub не повторял
    return jsonResponse({ ok: true })
  }
  let notification: { emailAddress?: string; historyId?: string } = {}
  try {
    // data это base64 of JSON
    const decoded = atob(body.message.data)
    notification = JSON.parse(decoded)
  } catch (e) {
    console.error('pubsub parse failed:', (e as Error).message)
    return jsonResponse({ ok: true }) // 200, не retry
  }
  const { emailAddress, historyId: newHistoryId } = notification
  if (!emailAddress || !newHistoryId) return jsonResponse({ ok: true })

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  // Находим integration по email из uniq oauth.email field
  // (хранится в credentials.oauth.email при OAuth callback)
  const { data: integs } = await admin
    .from('messenger_integrations')
    .select('salon_id, credentials')
    .eq('channel', 'email')
    .eq('status', 'connected')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const match = (integs ?? []).find((i: any) => {
    const c = i.credentials ?? {}
    return c?.oauth?.email?.toLowerCase?.() === emailAddress.toLowerCase()
  })
  if (!match) {
    console.warn(`pubsub: no integration for ${emailAddress}`)
    return jsonResponse({ ok: true })
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const allCreds = (match as any).credentials as any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const salonId = (match as any).salon_id as string

  const accessToken = await ensureAccessToken(admin, salonId, allCreds)
  if (!accessToken) return jsonResponse({ ok: true })

  // Берём last history id из БД, если есть. Если нет — fallback на полный
  // history.list начиная с newHistoryId-1 (как minimum окно).
  const lastHistoryId = (allCreds.oauth.history_id as string | undefined) ?? null
  const startHistoryId = lastHistoryId ?? newHistoryId

  // Diff через history.list. historyTypes=messageAdded чтобы получить только
  // new messages. Если startHistoryId слишком старый (>7 дней) Google вернёт
  // 404 — fallback: импорт через poll API (newer_than:1h).
  const histUrl =
    `https://gmail.googleapis.com/gmail/v1/users/me/history?` +
    `startHistoryId=${startHistoryId}` +
    `&historyTypes=messageAdded&labelId=INBOX`
  const histRes = await fetch(histUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  let messageIds: string[] = []
  if (histRes.ok) {
    const histJson = (await histRes.json()) as {
      history?: Array<{ messagesAdded?: Array<{ message: { id: string } }> }>
    }
    for (const h of histJson.history ?? []) {
      for (const m of h.messagesAdded ?? []) {
        if (m.message?.id) messageIds.push(m.message.id)
      }
    }
  } else if (histRes.status === 404) {
    // History expired — fallback to recent INBOX messages
    const listRes = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent('newer_than:1h -from:me')}&maxResults=25`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    )
    if (listRes.ok) {
      const j = (await listRes.json()) as { messages?: Array<{ id: string }> }
      messageIds = (j.messages ?? []).map((m) => m.id)
    }
  }

  let imported = 0
  for (const id of messageIds) {
    if (await importMessage(admin, salonId, accessToken, id)) imported++
  }

  // Persist new history_id для следующей нотификации
  await admin
    .from('messenger_integrations')
    .update({
      credentials: {
        ...allCreds,
        oauth: { ...allCreds.oauth, history_id: newHistoryId },
      },
      last_synced_at: new Date().toISOString(),
      last_error: null,
    })
    .eq('salon_id', salonId)
    .eq('channel', 'email')

  return jsonResponse({ ok: true, imported })
})
