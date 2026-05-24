/**
 * messenger-connect — подключение мессенджер-интеграций для салона.
 *
 * Actions:
 *   - connect      — валидирует креды (для telegram — getMe + setWebhook;
 *                     остальные сохраняют как есть), пишет шифрованные данные
 *                     в messenger_integrations.credentials, ставит status='connected'.
 *   - disconnect   — удаляет integration row и (для telegram) сбрасывает webhook.
 *   - status       — возвращает meta-инфу без секретов.
 *
 * Поддерживаемые каналы:
 *   - telegram     — bot token (BotFather). Реальная валидация + setWebhook.
 *   - whatsapp     — phone_number_id + permanent token + verify_token.
 *   - instagram    — page_id + page_access_token (Meta Graph).
 *   - facebook     — page_id + page_access_token (Meta Graph).
 *
 * Для WA/IG/FB реальная валидация требует Meta App Review — в этом релизе
 * креды сохраняются и помечаются status='pending'. Реальный webhook-flow
 * подключается отдельно после прохождения review.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.6'

import { getSalonMembership, getUserFromRequest } from '../_shared/auth.ts'
import { corsHeaders, preflight } from '../_shared/cors.ts'
import { encryptSecret } from './crypto.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
/** Публичный URL telegram-webhook edge function. Если пусто — setWebhook пропускается. */
const TG_WEBHOOK_BASE = Deno.env.get('MESSENGER_TG_WEBHOOK_URL') ?? ''

type Channel = 'telegram' | 'whatsapp' | 'instagram' | 'facebook'

function isChannel(v: unknown): v is Channel {
  return v === 'telegram' || v === 'whatsapp' || v === 'instagram' || v === 'facebook'
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'content-type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return preflight()
  if (req.method !== 'POST') return jsonResponse({ error: 'method_not_allowed' }, 405)

  if (!SUPABASE_URL || !SERVICE_KEY) {
    return jsonResponse({ error: 'server_misconfigured' }, 500)
  }

  const user = await getUserFromRequest(req, SUPABASE_URL, SERVICE_KEY)
  if (!user) return jsonResponse({ error: 'unauthorized' }, 401)

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: 'invalid_json' }, 400)
  }

  const action = String(body.action ?? '')
  const salonId = String(body.salon_id ?? '')
  if (!salonId) return jsonResponse({ error: 'salon_id_required' }, 400)

  const membership = await getSalonMembership(SUPABASE_URL, SERVICE_KEY, user.userId, salonId)
  if (!membership) return jsonResponse({ error: 'forbidden' }, 403)
  if (!['owner', 'admin'].includes(membership.role)) {
    return jsonResponse({ error: 'role_insufficient' }, 403)
  }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  if (action === 'status') {
    const { data } = await admin
      .from('messenger_integrations')
      .select('id, channel, status, external_account_id, display_name, last_synced_at, last_error')
      .eq('salon_id', salonId)
    return jsonResponse({ integrations: data ?? [] })
  }

  if (action === 'connect') {
    const channel = body.channel
    if (!isChannel(channel)) return jsonResponse({ error: 'channel_invalid' }, 400)
    const credentials = (body.credentials as Record<string, unknown> | undefined) ?? {}
    try {
      const result = await connectChannel(channel, salonId, credentials, admin)
      return jsonResponse({ ok: true, ...result })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return jsonResponse({ error: 'connect_failed', message: msg }, 400)
    }
  }

  if (action === 'disconnect') {
    const channel = body.channel
    if (!isChannel(channel)) return jsonResponse({ error: 'channel_invalid' }, 400)
    await disconnectChannel(channel, salonId, admin)
    return jsonResponse({ ok: true })
  }

  return jsonResponse({ error: 'action_unknown' }, 400)
})

async function connectChannel(
  channel: Channel,
  salonId: string,
  credentials: Record<string, unknown>,
  // deno-lint-ignore no-explicit-any
  admin: any,
): Promise<{ external_account_id: string; display_name: string; status: 'connected' | 'pending' }> {
  if (channel === 'telegram') {
    const token = String(credentials.bot_token ?? '').trim()
    if (!token) throw new Error('bot_token required')

    // 1) getMe — проверка токена
    const getMe = await fetch(`https://api.telegram.org/bot${token}/getMe`)
    if (!getMe.ok) throw new Error(`Telegram getMe failed: ${getMe.status}`)
    const meJson = (await getMe.json()) as {
      ok: boolean
      result?: { id: number; username?: string; first_name?: string }
      description?: string
    }
    if (!meJson.ok || !meJson.result) {
      throw new Error(meJson.description ?? 'Invalid bot token')
    }
    const me = meJson.result

    // 2) setWebhook — если задан MESSENGER_TG_WEBHOOK_URL, регистрируем приём
    const webhookSecret = crypto.randomUUID().replace(/-/g, '')
    if (TG_WEBHOOK_BASE) {
      const webhookUrl = `${TG_WEBHOOK_BASE}?salon=${encodeURIComponent(salonId)}`
      const sw = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          url: webhookUrl,
          secret_token: webhookSecret,
          allowed_updates: ['message', 'edited_message', 'callback_query'],
        }),
      })
      const swJson = (await sw.json().catch(() => ({}))) as { ok?: boolean; description?: string }
      if (!swJson.ok) {
        throw new Error(`Telegram setWebhook failed: ${swJson.description ?? 'unknown'}`)
      }
    }

    const encrypted = await encryptSecret(token)
    await upsertIntegration(admin, salonId, channel, {
      external_account_id: String(me.id),
      display_name: me.username ? `@${me.username}` : (me.first_name ?? 'Telegram Bot'),
      status: 'connected',
      credentials: { bot_token_enc: encrypted },
      webhook_secret: webhookSecret,
    })
    return {
      external_account_id: String(me.id),
      display_name: me.username ? `@${me.username}` : (me.first_name ?? 'Telegram Bot'),
      status: 'connected',
    }
  }

  if (channel === 'whatsapp') {
    const phoneNumberId = String(credentials.phone_number_id ?? '').trim()
    const accessToken = String(credentials.access_token ?? '').trim()
    // verify_token — webhook validation secret. Если юзер не задал, генерируем
    // случайный (юзеру не нужно его помнить, кладём в webhook config в Meta).
    const userVerifyToken = String(credentials.verify_token ?? '').trim()
    const verifyToken = userVerifyToken || crypto.randomUUID().replace(/-/g, '')
    if (!phoneNumberId || !accessToken) {
      throw new Error('phone_number_id and access_token required')
    }
    const encrypted = await encryptSecret(
      JSON.stringify({ access_token: accessToken, verify_token: verifyToken }),
    )
    await upsertIntegration(admin, salonId, channel, {
      external_account_id: phoneNumberId,
      display_name: `WA · ${phoneNumberId.slice(-4)}`,
      status: 'pending',
      credentials: { access_enc: encrypted, phone_number_id: phoneNumberId },
      webhook_secret: null,
    })
    return {
      external_account_id: phoneNumberId,
      display_name: `WA · ${phoneNumberId.slice(-4)}`,
      status: 'pending',
    }
  }

  if (channel === 'instagram' || channel === 'facebook') {
    const pageId = String(credentials.page_id ?? '').trim()
    const pageToken = String(credentials.page_access_token ?? '').trim()
    if (!pageId || !pageToken) throw new Error('page_id and page_access_token required')
    const encrypted = await encryptSecret(pageToken)
    await upsertIntegration(admin, salonId, channel, {
      external_account_id: pageId,
      display_name: `${channel === 'instagram' ? 'IG' : 'FB'} · ${pageId.slice(-4)}`,
      status: 'pending',
      credentials: { page_access_enc: encrypted, page_id: pageId },
      webhook_secret: null,
    })
    return {
      external_account_id: pageId,
      display_name: `${channel === 'instagram' ? 'IG' : 'FB'} · ${pageId.slice(-4)}`,
      status: 'pending',
    }
  }

  throw new Error('channel_not_supported')
}

async function disconnectChannel(
  channel: Channel,
  salonId: string,
  // deno-lint-ignore no-explicit-any
  admin: any,
): Promise<void> {
  // Для telegram попробуем сбросить webhook (best-effort).
  if (channel === 'telegram') {
    const { data } = await admin
      .from('messenger_integrations')
      .select('credentials')
      .eq('salon_id', salonId)
      .eq('channel', 'telegram')
      .maybeSingle()
    if (data?.credentials?.bot_token_enc) {
      try {
        const { decryptSecret } = await import('./crypto.ts')
        const token = await decryptSecret(data.credentials.bot_token_enc)
        await fetch(`https://api.telegram.org/bot${token}/deleteWebhook`, { method: 'POST' })
      } catch {
        // best-effort
      }
    }
  }

  await admin.from('messenger_integrations').delete().eq('salon_id', salonId).eq('channel', channel)
}

async function upsertIntegration(
  // deno-lint-ignore no-explicit-any
  admin: any,
  salonId: string,
  channel: Channel,
  patch: {
    external_account_id: string
    display_name: string
    status: 'pending' | 'connected'
    credentials: Record<string, unknown>
    webhook_secret: string | null
  },
): Promise<void> {
  const { error } = await admin.from('messenger_integrations').upsert(
    {
      salon_id: salonId,
      channel,
      external_account_id: patch.external_account_id,
      display_name: patch.display_name,
      status: patch.status,
      credentials: patch.credentials,
      webhook_secret: patch.webhook_secret,
      last_error: null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'salon_id,channel' },
  )
  if (error) throw new Error(error.message)
}
