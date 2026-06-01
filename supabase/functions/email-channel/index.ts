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
import { ImapFlow } from 'npm:imapflow@1.0.157'
import { simpleParser } from 'npm:mailparser@3.6.5'

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

/**
 * Логирует исходящее письмо в messenger_messages/conversations чтобы оно
 * появилось в UI мессенджера рядом с входящими. Без этого юзер шлёт
 * письмо через Finkley, оно уходит в Gmail Sent, но в Finkley-мессенджере
 * не видно — собственный диалог с клиентом обрывается.
 *
 * Upsert conversation per to-address (как для входящих по from-address).
 * direction='out', text = subject + body (markdown bold).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function logOutgoingMessage(
  admin: any,
  salonId: string,
  to: string,
  subject: string,
  textBody: string,
): Promise<void> {
  // try-catch — если БД insert упал (RLS / constraint / network), Gmail send
  // уже сделан, нет смысла отменять весь запрос. Просто warn в логах
  // чтобы можно было найти причину позже.
  try {
    const toAddr = to.toLowerCase().trim()
    // Conversation по to-address (как poll-branch для входящих по from-address)
    const { data: existing } = await admin
      .from('messenger_conversations')
      .select('id')
      .eq('salon_id', salonId)
      .eq('channel', 'email')
      .eq('external_user_id', toAddr)
      .maybeSingle()
    let convId: string | null = null
    if (existing) {
      convId = (existing as { id: string }).id
      await admin
        .from('messenger_conversations')
        .update({
          last_message_at: new Date().toISOString(),
          last_message_preview: cleanSubjectForPreview(subject),
        })
        .eq('id', convId)
    } else {
      const { data: created, error: convErr } = await admin
        .from('messenger_conversations')
        .insert({
          salon_id: salonId,
          channel: 'email',
          external_user_id: toAddr,
          display_name: toAddr,
          last_message_at: new Date().toISOString(),
          last_message_preview: cleanSubjectForPreview(subject),
        })
        .select('id')
        .single()
      if (convErr) {
        console.warn('logOutgoing conv insert failed:', convErr.message)
        return
      }
      if (created) convId = (created as { id: string }).id
    }
    if (!convId) return
    const { error: msgErr } = await admin.from('messenger_messages').insert({
      conversation_id: convId,
      salon_id: salonId, // NOT NULL — без этого insert падает
      direction: 'out',
      text: subject ? `**${subject}**\n\n${textBody}` : textBody,
    })
    if (msgErr) {
      console.warn('logOutgoing msg insert failed:', msgErr.message)
    }
  } catch (e) {
    console.warn('logOutgoing failed:', (e as Error).message)
  }
}

/**
 * Очищает subject от markdown + newlines + accumulated Re: префиксов.
 * Subject должен быть single-line plain text без накопленной истории.
 */
function cleanSubjectForPreview(raw: string | null | undefined): string {
  if (!raw) return ''
  return raw
    .replace(/\*\*/g, '')
    .replace(/[\r\n][\s\S]*$/, '')
    .trim()
    .slice(0, 150)
}

/**
 * Pull новые входящие через Gmail REST API. Используется в action='poll'
 * когда у юзера OAuth (нет IMAP credentials). Тянет сообщения новее
 * sinceUnix (last_synced_at), парсит From/Subject/snippet, upsert'ит
 * conversation + insert message. Идемпотентно: external_message_id =
 * gmail message id, повторный poll того же письма не создаст дубликат
 * (uniq index в messenger_messages).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function pollViaGmailApi(
  admin: any,
  salonId: string,
  accessToken: string,
  sinceUnix: number,
): Promise<number> {
  // Окно: динамически от sinceUnix. Если первый poll (sinceUnix > 7д назад)
  // — берём newer_than:7d (gmail-syntax, проверенный). Иначе — окно от
  // last_synced_at до сейчас (`after:<unix>` принимается Gmail API). На
  // повторном poll'е могут быть overlap'ы но external_message_id uniq
  // ловит дубли. maxResults=100 чтобы не терять при всплесках.
  const ageHours = (Date.now() / 1000 - sinceUnix) / 3600
  const query =
    ageHours > 168
      ? 'newer_than:7d -from:me' // первый poll — берём 7 дней максимум
      : `after:${sinceUnix} -from:me`
  const listUrl =
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?` +
    `q=${encodeURIComponent(query)}` +
    `&maxResults=100`
  const listRes = await fetch(listUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!listRes.ok) {
    throw new Error(`gmail_list_failed: ${listRes.status} ${await listRes.text()}`)
  }
  const listJson = (await listRes.json()) as { messages?: Array<{ id: string }> }
  const ids = listJson.messages ?? []
  let imported = 0
  // 2) для каждого id — get full
  for (const m of ids) {
    const msgRes = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=metadata` +
        `&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    )
    if (!msgRes.ok) continue
    const msg = (await msgRes.json()) as {
      id: string
      snippet?: string
      payload?: { headers?: Array<{ name: string; value: string }> }
      internalDate?: string
    }
    const hdr = (name: string): string =>
      msg.payload?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? ''
    const fromHeader = hdr('From')
    const subject = hdr('Subject')
    const snippet = msg.snippet ?? ''
    // From header формата 'Name <email@x.com>' или 'email@x.com'
    const emailMatch = fromHeader.match(/<([^>]+)>/) ?? fromHeader.match(/([^\s<>]+@[^\s<>]+)/)
    const fromAddr = (emailMatch?.[1] ?? fromHeader).toLowerCase().trim()
    if (!fromAddr || !fromAddr.includes('@')) continue
    const fromName = fromHeader.match(/^([^<]+?)\s*</)?.[1]?.trim() || fromAddr.split('@')[0]
    const createdAt = msg.internalDate
      ? new Date(Number(msg.internalDate)).toISOString()
      : new Date().toISOString()

    // upsert conversation
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
          last_message_preview: cleanSubjectForPreview(subject),
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
          last_message_preview: cleanSubjectForPreview(subject),
        })
        .select('id')
        .single()
      if (created) convId = (created as { id: string }).id
    }
    if (!convId) continue
    const { error: insErr } = await admin.from('messenger_messages').insert({
      conversation_id: convId,
      salon_id: salonId,
      direction: 'in',
      text: subject ? `**${subject}**\n\n${snippet}` : snippet,
      external_message_id: m.id,
      created_at: createdAt,
    })
    // Игнорируем UNIQUE_VIOLATION (23505) — это повтор poll'а того же письма
    if (insErr && insErr.code !== '23505') {
      console.warn('gmail poll msg insert failed:', insErr.message)
      continue
    }
    if (!insErr) imported++
  }
  return imported
}

/**
 * Refresh Google OAuth access_token через refresh_token. Используется в
 * action='send' когда access_token истёк (или истечёт в ближайшую минуту).
 */
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
  if (!res.ok) {
    console.error('refresh token failed:', await res.text())
    return null
  }
  return (await res.json()) as { access_token: string; expires_in: number }
}

/**
 * Send email via Gmail REST API (users.messages.send). raw — RFC 822
 * message в base64url. Лучше чем SMTP для Gmail (нет spam-маркировки,
 * authenticated). Юзер видит письмо в своих «Отправленных».
 */
async function sendViaGmailApi(
  accessToken: string,
  fromEmail: string,
  to: string,
  subject: string,
  textBody: string,
  htmlBody?: string,
): Promise<void> {
  // UTF-8 → base64. unescape(encodeURIComponent()) — legacy browser hack
  // который в Deno ломает кириллицу (даёт мусор). Используем TextEncoder
  // → bytes → base64 — это работает гарантированно.
  const bytesToB64 = (bytes: Uint8Array): string => {
    let binary = ''
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!)
    return btoa(binary)
  }
  const strToB64 = (s: string): string => bytesToB64(new TextEncoder().encode(s))
  // RFC 2047 encoded-word для non-ASCII headers (cyrillic/польские).
  const encodeHeader = (s: string): string => {
    // eslint-disable-next-line no-control-regex
    if (/^[\x00-\x7F]*$/.test(s)) return s
    return `=?UTF-8?B?${strToB64(s)}?=`
  }
  // base64 body — гарантирует что UTF-8 chars не порвут line wrapping.
  const encodeBody = (s: string): string => {
    const b64 = strToB64(s)
    return b64.match(/.{1,76}/g)?.join('\r\n') ?? ''
  }
  const subjectEnc = encodeHeader(subject)
  // Plain UTF-8 8bit body. Без base64 — некоторые receivers (onet.pl)
  // показывали MIME headers + base64 как raw в body когда мы делали
  // base64 inner-body. 8bit = «body это raw UTF-8 bytes» — поддерживается
  // всеми современными mail servers. Long UTF-8 не ломается потому что
  // SMTP servers либо поддерживают 8BITMIME extension, либо конвертят в
  // quoted-printable при transit.
  const boundary = `finkley-${crypto.randomUUID()}`
  let mime: string
  if (htmlBody) {
    mime =
      `From: ${fromEmail}\r\n` +
      `To: ${to}\r\n` +
      `Subject: ${subjectEnc}\r\n` +
      `MIME-Version: 1.0\r\n` +
      `Content-Type: multipart/alternative; boundary="${boundary}"\r\n\r\n` +
      `--${boundary}\r\n` +
      `Content-Type: text/plain; charset="UTF-8"\r\n` +
      `Content-Transfer-Encoding: 8bit\r\n\r\n` +
      `${textBody}\r\n\r\n` +
      `--${boundary}\r\n` +
      `Content-Type: text/html; charset="UTF-8"\r\n` +
      `Content-Transfer-Encoding: 8bit\r\n\r\n` +
      `${htmlBody}\r\n\r\n` +
      `--${boundary}--`
  } else {
    mime =
      `From: ${fromEmail}\r\n` +
      `To: ${to}\r\n` +
      `Subject: ${subjectEnc}\r\n` +
      `MIME-Version: 1.0\r\n` +
      `Content-Type: text/plain; charset="UTF-8"\r\n` +
      `Content-Transfer-Encoding: 8bit\r\n\r\n` +
      `${textBody}`
  }
  void encodeBody // оставлен на случай возврата к base64
  // base64url encode без padding
  const raw = strToB64(mime).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ raw }),
  })
  if (!res.ok) {
    const errText = await res.text()
    throw new Error(`gmail_api_send_failed: ${res.status} ${errText.slice(0, 200)}`)
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
    /** Когда send вызывается из messenger-send (route='email-branch'),
     *  messenger-send уже сам делает insert в messenger_messages. Чтобы
     *  не было дубля, передаём skip_log: true. */
    skip_log?: boolean
  } | null
  if (!body?.action || !body.salon_id) return jsonResponse({ error: 'bad_request' }, 400)

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  if (body.action === 'connect') {
    if (!body.smtp || !body.imap) return jsonResponse({ error: 'smtp_and_imap_required' }, 400)
    // Реальная IMAP-валидация: подключаемся и сразу logout. Проверяет
    // что host/port доступны и password корректный. denomailer SMTP
    // открывает соединение лениво на send — реальная SMTP-валидация
    // случается при первом send.
    try {
      const test = new ImapFlow({
        host: body.imap.host,
        port: body.imap.port,
        secure: body.imap.secure !== false,
        auth: { user: body.imap.user, pass: body.imap.pass },
        logger: false,
      })
      await test.connect()
      await test.logout()
    } catch (e) {
      return jsonResponse(
        { ok: false, error: 'imap_connect_failed', message: (e as Error).message },
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

  if (body.action === 'oauth_start') {
    // Gmail OAuth flow. Требует Client ID + Secret в Google Cloud Console
    // и scope review (~1-2 нед production-доступ). До завершения setup'а
    // возвращаем not_configured — UI EmailConnectDialog показывает юзеру
    // дружественный toast «используй SMTP/IMAP с app-password».
    //
    // Когда credentials появятся в env (GOOGLE_OAUTH_CLIENT_ID +
    // GOOGLE_OAUTH_REDIRECT_URI):
    //   const url = `https://accounts.google.com/o/oauth2/v2/auth?` +
    //     `client_id=${CLIENT_ID}` +
    //     `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
    //     `&response_type=code&scope=${SCOPES}` +
    //     `&state=${salonId}&access_type=offline&prompt=consent`
    //   return jsonResponse({ ok: true, url })
    const clientId = Deno.env.get('GOOGLE_OAUTH_CLIENT_ID')
    const redirectUri = Deno.env.get('GOOGLE_OAUTH_REDIRECT_URI')
    if (!clientId || !redirectUri) {
      return jsonResponse({ ok: false, error: 'oauth_not_configured' })
    }
    const scopes = [
      'https://www.googleapis.com/auth/gmail.send',
      'https://www.googleapis.com/auth/gmail.readonly',
    ].join(' ')
    const url =
      `https://accounts.google.com/o/oauth2/v2/auth?` +
      `client_id=${encodeURIComponent(clientId)}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&response_type=code&scope=${encodeURIComponent(scopes)}` +
      `&state=${encodeURIComponent(body.salon_id)}&access_type=offline&prompt=consent`
    return jsonResponse({ ok: true, url })
  }

  if (body.action === 'renew_watch') {
    // Gmail watch валиден 7 дней. Этот endpoint дёргается cron'ом каждые
    // 6 дней (с запасом) чтобы продлить watch и обновить history_id.
    const { data: integ } = await admin
      .from('messenger_integrations')
      .select('credentials')
      .eq('salon_id', body.salon_id)
      .eq('channel', 'email')
      .maybeSingle()
    const allCreds = (integ?.credentials ?? {}) as { oauth?: Record<string, unknown> }
    if (!allCreds.oauth?.access_token) {
      return jsonResponse({ ok: false, error: 'no_oauth' }, 200)
    }
    const pubsubTopic = Deno.env.get('GMAIL_PUBSUB_TOPIC') ?? ''
    if (!pubsubTopic) return jsonResponse({ ok: false, error: 'pubsub_not_configured' }, 200)
    let accessToken = allCreds.oauth.access_token as string
    const expiresAt = new Date(allCreds.oauth.expires_at as string).getTime()
    if (Date.now() > expiresAt - 60_000 && allCreds.oauth.refresh_token) {
      const refreshed = await refreshGoogleToken(allCreds.oauth.refresh_token as string)
      if (refreshed) accessToken = refreshed.access_token
    }
    const watchRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/watch', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        labelIds: ['INBOX'],
        labelFilterAction: 'include',
        topicName: pubsubTopic,
      }),
    })
    if (!watchRes.ok) {
      return jsonResponse({ ok: false, error: `watch_failed_${watchRes.status}` }, 200)
    }
    const watchJson = (await watchRes.json()) as { historyId?: string; expiration?: string }
    await admin
      .from('messenger_integrations')
      .update({
        credentials: {
          ...allCreds,
          oauth: {
            ...allCreds.oauth,
            history_id: watchJson.historyId ?? allCreds.oauth.history_id,
            watch_expiration: watchJson.expiration ?? null,
          },
        },
      })
      .eq('salon_id', body.salon_id)
      .eq('channel', 'email')
    return jsonResponse({ ok: true, expiration: watchJson.expiration })
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
    const allCreds = (integ?.credentials ?? {}) as {
      smtp?: SmtpConfig
      oauth?: {
        access_token: string
        refresh_token?: string
        expires_at: string
        email?: string | null
      }
    }
    // Приоритет: OAuth → SMTP. OAuth даёт лучший delivery (Gmail не маркит
    // спамом), не требует app-password. SMTP fallback для не-Gmail или
    // пока юзер не подключил OAuth.
    if (allCreds.oauth?.access_token) {
      try {
        let accessToken = allCreds.oauth.access_token
        // Auto-refresh если токен истёк (или истечёт в ближайшую минуту)
        const expiresAt = new Date(allCreds.oauth.expires_at).getTime()
        if (Date.now() > expiresAt - 60_000 && allCreds.oauth.refresh_token) {
          const refreshed = await refreshGoogleToken(allCreds.oauth.refresh_token)
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
              .eq('salon_id', body.salon_id)
              .eq('channel', 'email')
          }
        }
        const fromEmail = allCreds.oauth.email ?? 'me'
        await sendViaGmailApi(
          accessToken,
          fromEmail,
          body.to,
          body.subject,
          body.text_body,
          body.html_body,
        )
        if (!body.skip_log) {
          await logOutgoingMessage(admin, body.salon_id, body.to, body.subject, body.text_body)
        }
        return jsonResponse({ ok: true, via: 'gmail_oauth' })
      } catch (e) {
        // Если OAuth не сработал, пробуем SMTP fallback
        if (!allCreds.smtp) {
          return jsonResponse({ ok: false, error: (e as Error).message }, 500)
        }
      }
    }
    if (allCreds.smtp) {
      try {
        await sendEmail(allCreds.smtp, body.to, body.subject, body.text_body, body.html_body)
        if (!body.skip_log) {
          await logOutgoingMessage(admin, body.salon_id, body.to, body.subject, body.text_body)
        }
        return jsonResponse({ ok: true, via: 'smtp' })
      } catch (e) {
        return jsonResponse({ ok: false, error: (e as Error).message }, 500)
      }
    }
    return jsonResponse({ ok: false, error: 'not_connected' }, 404)
  }

  if (body.action === 'poll') {
    const { data: integ } = await admin
      .from('messenger_integrations')
      .select('id, credentials, last_synced_at')
      .eq('salon_id', body.salon_id)
      .eq('channel', 'email')
      .maybeSingle()
    const allCreds = (integ?.credentials ?? {}) as {
      imap?: ImapConfig
      oauth?: {
        access_token: string
        refresh_token?: string
        expires_at: string
        email?: string | null
      }
    }
    // OAuth-путь — через Gmail API messages.list. Приоритет над IMAP.
    if (allCreds.oauth?.access_token) {
      try {
        let accessToken = allCreds.oauth.access_token
        const expiresAt = new Date(allCreds.oauth.expires_at).getTime()
        if (Date.now() > expiresAt - 60_000 && allCreds.oauth.refresh_token) {
          const refreshed = await refreshGoogleToken(allCreds.oauth.refresh_token)
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
              .eq('salon_id', body.salon_id)
              .eq('channel', 'email')
          }
        }
        const sinceTs = integ?.last_synced_at
          ? Math.floor(new Date(integ.last_synced_at as string).getTime() / 1000)
          : Math.floor((Date.now() - 7 * 24 * 60 * 60 * 1000) / 1000)
        const imported = await pollViaGmailApi(admin, body.salon_id, accessToken, sinceTs)
        await admin
          .from('messenger_integrations')
          .update({ last_synced_at: new Date().toISOString(), last_error: null })
          .eq('salon_id', body.salon_id)
          .eq('channel', 'email')
        return jsonResponse({ ok: true, imported, via: 'gmail_oauth' })
      } catch (e) {
        await admin
          .from('messenger_integrations')
          .update({ last_error: (e as Error).message })
          .eq('salon_id', body.salon_id)
          .eq('channel', 'email')
        return jsonResponse({ ok: false, error: (e as Error).message }, 500)
      }
    }
    const creds = allCreds.imap
    if (!creds) return jsonResponse({ ok: false, error: 'not_connected' }, 404)
    const since = integ?.last_synced_at
      ? new Date(integ.last_synced_at as string)
      : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    let imported = 0
    let lastError: string | null = null
    try {
      const client = new ImapFlow({
        host: creds.host,
        port: creds.port,
        secure: creds.secure !== false,
        auth: { user: creds.user, pass: creds.pass },
        logger: false,
      })
      await client.connect()
      const lock = await client.getMailboxLock('INBOX')
      try {
        // Берём непрочитанные начиная с last_synced_at
        const seq = await client.search({ since, seen: false }, { uid: true })
        for (const uid of seq ?? []) {
          const msg = await client.fetchOne(
            String(uid),
            {
              source: true,
              envelope: true,
              internalDate: true,
            },
            { uid: true },
          )
          if (!msg?.source) continue
          const parsed = await simpleParser(msg.source as Buffer)
          const fromAddr =
            parsed.from?.value?.[0]?.address?.toLowerCase() ?? msg.envelope?.from?.[0]?.address
          const fromName =
            parsed.from?.value?.[0]?.name?.trim() ||
            msg.envelope?.from?.[0]?.name?.trim() ||
            fromAddr ||
            'unknown'
          if (!fromAddr) continue

          // upsert conversation per from-address
          const { data: existing } = await admin
            .from('messenger_conversations')
            .select('id')
            .eq('salon_id', body.salon_id)
            .eq('channel', 'email')
            .eq('external_user_id', fromAddr)
            .maybeSingle()
          let convId: string
          if (existing) {
            convId = (existing as { id: string }).id
            await admin
              .from('messenger_conversations')
              .update({
                display_name: fromName,
                last_message_at: msg.internalDate ?? new Date().toISOString(),
                last_message_preview: (parsed.subject ?? '').slice(0, 200),
              })
              .eq('id', convId)
          } else {
            const { data: created } = await admin
              .from('messenger_conversations')
              .insert({
                salon_id: body.salon_id,
                channel: 'email',
                external_user_id: fromAddr,
                display_name: fromName,
                last_message_at: msg.internalDate ?? new Date().toISOString(),
                last_message_preview: (parsed.subject ?? '').slice(0, 200),
              })
              .select('id')
              .single()
            if (!created) continue
            convId = (created as { id: string }).id
          }
          const text = (parsed.text ?? parsed.html ?? '').toString().slice(0, 10_000)
          await admin.from('messenger_messages').insert({
            conversation_id: convId,
            salon_id: body.salon_id, // NOT NULL — без него insert падал silent
            direction: 'in',
            text: parsed.subject ? `**${parsed.subject}**\n\n${text}` : text,
            external_message_id: parsed.messageId ?? `imap_${uid}`,
            created_at: msg.internalDate ?? new Date().toISOString(),
          })
          imported++
        }
      } finally {
        lock.release()
        await client.logout()
      }
    } catch (e) {
      lastError = (e as Error).message
    }
    await admin
      .from('messenger_integrations')
      .update({
        last_synced_at: new Date().toISOString(),
        last_error: lastError,
      })
      .eq('salon_id', body.salon_id)
      .eq('channel', 'email')
    if (lastError) return jsonResponse({ ok: false, error: lastError, imported }, 500)
    return jsonResponse({ ok: true, imported })
  }

  return jsonResponse({ error: 'unknown_action' }, 400)
})
