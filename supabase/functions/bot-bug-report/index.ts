/**
 * bot-bug-report — endpoint, на который наш Telegram-бот форвардит баг-репорты
 * от **клиентов салонов** (не от команды). Записывает в bug_reports с флагом
 * `requires_approval=true` и `source='client'`. Эти баги не идут в работу,
 * пока super-admin не аппрувнет их в /admin/feedback.
 *
 * Аутентификация: общий секрет в заголовке `x-bot-secret` (env BOT_WEBHOOK_SECRET).
 * Не вызывается из браузера — это межсервисный hook.
 *
 * Тело запроса (JSON):
 *   {
 *     telegram_chat_id: number,
 *     telegram_message_id: number,
 *     sender_id: number,
 *     sender_username?: string,
 *     sender_first_name?: string,
 *     message_text: string,
 *     attachments?: any[],
 *     reporter_user_id?: string,  // если бот авторизован Telegram Login и
 *                                  // знает Supabase user_id клиента
 *     salon_id?: string,           // если клиент пишет про конкретный салон
 *     kind?: 'bug' | 'feature'     // 'bug' по умолчанию
 *   }
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.6'

import { corsHeaders, preflight } from '../_shared/cors.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const BOT_SECRET = Deno.env.get('BOT_WEBHOOK_SECRET') ?? ''

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'content-type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return preflight()
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)
  if (!BOT_SECRET) return json({ error: 'bot_secret_not_configured' }, 500)

  const provided = req.headers.get('x-bot-secret')
  if (provided !== BOT_SECRET) return json({ error: 'unauthorized' }, 401)

  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return json({ error: 'invalid_json' }, 400)
  }

  const telegramChatId = body.telegram_chat_id
  const telegramMessageId = body.telegram_message_id
  const senderId = body.sender_id
  const messageText = body.message_text
  if (
    typeof telegramChatId !== 'number' ||
    typeof telegramMessageId !== 'number' ||
    typeof senderId !== 'number' ||
    typeof messageText !== 'string'
  ) {
    return json({ error: 'missing_required_fields' }, 400)
  }

  const kind = body.kind === 'feature' ? 'feature' : 'bug'

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  // Идемпотентно: (telegram_chat_id, telegram_message_id) — unique
  const { data, error } = await admin
    .from('bug_reports')
    .upsert(
      {
        telegram_chat_id: telegramChatId,
        telegram_message_id: telegramMessageId,
        sender_id: senderId,
        sender_username: typeof body.sender_username === 'string' ? body.sender_username : null,
        sender_first_name:
          typeof body.sender_first_name === 'string' ? body.sender_first_name : null,
        message_text: messageText,
        attachments: Array.isArray(body.attachments) ? body.attachments : [],
        kind,
        source: 'client',
        requires_approval: true,
        status: 'open',
        reporter_user_id: typeof body.reporter_user_id === 'string' ? body.reporter_user_id : null,
        salon_id: typeof body.salon_id === 'string' ? body.salon_id : null,
      },
      { onConflict: 'telegram_chat_id,telegram_message_id', ignoreDuplicates: false },
    )
    .select('id')
    .single()

  if (error) return json({ error: error.message }, 500)
  return json({ ok: true, id: data?.id })
})
