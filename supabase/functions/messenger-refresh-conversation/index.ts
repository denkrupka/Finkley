/**
 * messenger-refresh-conversation — обновить display_name + avatar для
 * существующей conversation через провайдер API.
 *
 * Use case: webhook сохранил дефолт `User XXXXXX` (приватный профиль
 * собеседника + отсутствие prompts permission). Позднее юзер хочет
 * подтянуть имя — клик «Обновить» в чате → вызов этой функции →
 * re-fetch профиль через provider token.
 *
 * Body: { salon_id, conversation_id }
 *
 * Поддерживаемые каналы: instagram, facebook (IG/FB Graph API).
 * Telegram, WhatsApp: имя приходит в payload сообщения, refresh не нужен.
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
  if (req.method !== 'POST') return jsonResponse({ error: 'method_not_allowed' }, 405)
  if (!SUPABASE_URL || !SERVICE_KEY) return jsonResponse({ error: 'not_configured' }, 500)

  const body = (await req.json().catch(() => null)) as {
    salon_id?: string
    conversation_id?: string
  } | null
  if (!body?.salon_id || !body.conversation_id) return jsonResponse({ error: 'bad_request' }, 400)

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data: conv } = await admin
    .from('messenger_conversations')
    .select('id, salon_id, channel, external_user_id, display_name')
    .eq('id', body.conversation_id)
    .eq('salon_id', body.salon_id)
    .maybeSingle()
  if (!conv) return jsonResponse({ ok: false, error: 'conversation_not_found' }, 404)
  if (conv.channel !== 'instagram' && conv.channel !== 'facebook') {
    return jsonResponse({
      ok: false,
      error: 'channel_not_supported',
      message: 'Refresh поддерживается только для Instagram/Facebook',
    })
  }

  const { data: integ } = await admin
    .from('messenger_integrations')
    .select('credentials, channel')
    .eq('salon_id', body.salon_id)
    .eq('channel', conv.channel)
    .maybeSingle()
  const token = (integ?.credentials as { access_token?: string } | null)?.access_token
  if (!token) return jsonResponse({ ok: false, error: 'no_provider_token' }, 400)

  const externalId = conv.external_user_id
  let displayName: string | null = null
  let avatarUrl: string | null = null

  if (conv.channel === 'instagram') {
    const r = await fetch(
      `https://graph.instagram.com/v21.0/${externalId}?fields=name,username,profile_pic&access_token=${encodeURIComponent(token)}`,
    )
    if (r.ok) {
      const prof = (await r.json()) as {
        name?: string
        username?: string
        profile_pic?: string
      }
      displayName = prof.name ?? (prof.username ? `@${prof.username}` : null)
      avatarUrl = prof.profile_pic ?? null
    }
  } else {
    // facebook
    const r = await fetch(
      `https://graph.facebook.com/v21.0/${externalId}?fields=name,first_name,last_name,profile_pic&access_token=${encodeURIComponent(token)}`,
    )
    if (r.ok) {
      const prof = (await r.json()) as {
        name?: string
        first_name?: string
        last_name?: string
        profile_pic?: string
      }
      const fullName = [prof.first_name, prof.last_name].filter(Boolean).join(' ').trim()
      displayName = fullName || prof.name || null
      avatarUrl = prof.profile_pic ?? null
    }
  }

  if (!displayName && !avatarUrl) {
    return jsonResponse({
      ok: false,
      error: 'provider_no_data',
      message: 'Провайдер не вернул данных — профиль приватный или token истёк',
    })
  }

  const updates: Record<string, string | null> = {}
  if (displayName) updates.display_name = displayName
  if (avatarUrl) updates.avatar_url = avatarUrl
  const { error } = await admin.from('messenger_conversations').update(updates).eq('id', conv.id)
  if (error) return jsonResponse({ ok: false, error: error.message }, 500)

  return jsonResponse({ ok: true, display_name: displayName, avatar_url: avatarUrl })
})
