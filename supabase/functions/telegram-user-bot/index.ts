/**
 * telegram-user-bot — webhook для @finkley_tg_bot.
 *
 * Это «клиентский» бот Finkley: основной канал коммуникации с пользователями
 * (привязка аккаунта, дайджесты, маркетинг). Не путать с @finklay_dev_bot,
 * который только bug-collector для команды + клиентских багов.
 *
 * Сейчас умеет:
 *   - /start link_<CODE>  → привязывает Telegram к user_id, владеющему кодом
 *                           (deep-link flow из TelegramLinkCard)
 *   - /start              → приветствие с описанием бота
 *   - любая другая команда/текст → короткий ack
 *
 * В будущем сюда же добавится outbound-рассылка (дайджесты, маркетинг)
 * через /broadcast endpoint с FUNCTION_INTERNAL_SECRET.
 *
 * Auth: Telegram передаёт `X-Telegram-Bot-Api-Secret-Token` (мы задаём через
 * setWebhook). Проверяем timing-safe equal с TELEGRAM_USER_WEBHOOK_SECRET.
 * deploy --no-verify-jwt: webhook идёт без JWT, защита через secret.
 *
 * ENV:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   TELEGRAM_BOT_TOKEN              — токен @finkley_tg_bot
 *   TELEGRAM_USER_WEBHOOK_SECRET    — secret_token из setWebhook (random hex)
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN') ?? ''
const WEBHOOK_SECRET = Deno.env.get('TELEGRAM_USER_WEBHOOK_SECRET') ?? ''

const TELEGRAM_API = `https://api.telegram.org/bot${BOT_TOKEN}`

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

async function tgSend(chatId: number, text: string, replyTo?: number): Promise<void> {
  await fetch(`${TELEGRAM_API}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: 'Markdown',
      reply_to_message_id: replyTo,
      allow_sending_without_reply: true,
    }),
  }).catch((e) => console.error('tgSend', e))
}

type TgUser = { id: number; first_name?: string; username?: string }
type TgChat = { id: number; type: string }
type TgMessage = {
  message_id: number
  from?: TgUser
  chat: TgChat
  date: number
  text?: string
}

const WELCOME_MESSAGE =
  '👋 *Привет!*\n\n' +
  'Это бот Finkley — управленческий учёт салона красоты.\n\n' +
  'Через меня ты будешь получать:\n' +
  '📊 Ежедневные и еженедельные дайджесты по салону\n' +
  '💡 AI-инсайты и подсказки\n' +
  '🎯 Маркетинговые материалы и обновления\n\n' +
  'Чтобы подключиться — открой приложение [finkley.app](https://finkley.app), ' +
  'войди в аккаунт и нажми «Привязать через бота» в Настройках → Профиль.'

const ALREADY_LINKED_MESSAGE =
  '✅ Этот Telegram-аккаунт уже привязан к Finkley.\n\n' +
  'Жди здесь дайджесты и обновления. Чтобы изменить настройки уведомлений — ' +
  'открой [Настройки → Уведомления](https://finkley.app) в приложении.'

/**
 * Привязывает telegram_id отправителя к user_id, владеющему одноразовым кодом.
 * Код создаётся в SPA через RPC create_telegram_link_code(), TTL 10 мин.
 */
async function handleLinkCode(
  admin: ReturnType<typeof createClient>,
  msg: TgMessage,
  code: string,
  senderId: number,
): Promise<void> {
  const { data: row, error: findErr } = await admin
    .from('telegram_link_codes')
    .select('user_id, expires_at, used_at')
    .eq('code', code)
    .maybeSingle()

  if (findErr || !row) {
    await tgSend(
      msg.chat.id,
      '❌ Код не найден или истёк. Сгенерируй новый в Finkley → Настройки → Профиль.',
    )
    return
  }
  const r = row as { user_id: string; expires_at: string; used_at: string | null }
  if (r.used_at) {
    await tgSend(msg.chat.id, '❌ Этот код уже использован. Сгенерируй новый в приложении.')
    return
  }
  if (new Date(r.expires_at).getTime() < Date.now()) {
    await tgSend(msg.chat.id, '❌ Код истёк (живёт 10 минут). Сгенерируй новый в приложении.')
    return
  }

  // Не привязан ли этот telegram_id уже к другому профилю?
  const { data: existing } = await admin
    .from('profiles')
    .select('id')
    .eq('telegram_id', senderId)
    .maybeSingle()
  if (existing && (existing as { id: string }).id !== r.user_id) {
    await tgSend(
      msg.chat.id,
      '❌ Этот Telegram уже привязан к другому аккаунту Finkley. Отвяжи его в том аккаунте, потом попробуй снова.',
    )
    return
  }

  const { error: updErr } = await admin
    .from('profiles')
    .update({
      telegram_id: senderId,
      telegram_username: msg.from?.username ?? null,
    })
    .eq('id', r.user_id)

  if (updErr) {
    await tgSend(msg.chat.id, `❌ Ошибка привязки: ${updErr.message}`)
    return
  }

  await admin
    .from('telegram_link_codes')
    .update({ used_at: new Date().toISOString() })
    .eq('code', code)

  await tgSend(
    msg.chat.id,
    '✅ *Telegram привязан!*\n\nТеперь ты будешь получать дайджесты и обновления от Finkley сюда. ' +
      'Управление уведомлениями — в [Настройки → Уведомления](https://finkley.app).',
  )
}

async function handleMessage(admin: ReturnType<typeof createClient>, msg: TgMessage) {
  const text = (msg.text ?? '').trim()
  const senderId = msg.from?.id
  if (!senderId) return

  // Только private chat — групповые ботом не используются.
  if (msg.chat.type !== 'private') return

  // Deep-link привязка
  const linkMatch = text.match(/^\/start(?:@\S+)?\s+link_([A-Z0-9]{4,16})$/i)
  if (linkMatch) {
    await handleLinkCode(admin, msg, linkMatch[1]!.toUpperCase(), senderId)
    return
  }

  // Обычный /start или /help
  if (text === '/start' || text === '/help' || text.startsWith('/start@')) {
    // Проверим — уже привязан ли этот telegram_id?
    const { data: profile } = await admin
      .from('profiles')
      .select('id')
      .eq('telegram_id', senderId)
      .maybeSingle()
    await tgSend(msg.chat.id, profile ? ALREADY_LINKED_MESSAGE : WELCOME_MESSAGE)
    return
  }

  // Любое другое сообщение от привязанного юзера — игнорируем silently
  // (этот бот не bug-collector, баги пишутся в @finklay_dev_bot). От незнакомого
  // юзера — короткий гайд.
  const { data: knownProfile } = await admin
    .from('profiles')
    .select('id')
    .eq('telegram_id', senderId)
    .maybeSingle()
  if (!knownProfile) {
    await tgSend(msg.chat.id, WELCOME_MESSAGE)
  }
  // Привязанный юзер — silent. Чтобы он мог писать о багах в этот же бот, нужно
  // отдельное решение — пока не в скоупе.
}

const FUNCTION_INTERNAL_SECRET = Deno.env.get('FUNCTION_INTERNAL_SECRET') ?? ''

/**
 * Server-to-server endpoint для регистрации webhook в Telegram. Вызывается
 * локально из scripts/setup-telegram-user-webhook.mjs с FUNCTION_INTERNAL_SECRET.
 * Сама функция знает TELEGRAM_BOT_TOKEN и TELEGRAM_USER_WEBHOOK_SECRET через env.
 */
async function handleSelfSetup(req: Request): Promise<Response> {
  let body: { secret?: string }
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: 'bad_request' }, 400)
  }
  if (!FUNCTION_INTERNAL_SECRET || !timingSafeEqual(body.secret ?? '', FUNCTION_INTERNAL_SECRET)) {
    return jsonResponse({ error: 'unauthorized' }, 401)
  }
  if (!BOT_TOKEN) return jsonResponse({ error: 'bot_token_missing' }, 500)
  if (!WEBHOOK_SECRET) return jsonResponse({ error: 'webhook_secret_missing' }, 500)

  const webhookUrl = `${SUPABASE_URL}/functions/v1/telegram-user-bot`
  const res = await fetch(`${TELEGRAM_API}/setWebhook`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      url: webhookUrl,
      secret_token: WEBHOOK_SECRET,
      drop_pending_updates: true,
      allowed_updates: ['message'],
    }),
  })
  const tgResp = await res.json()
  return jsonResponse({ ok: res.ok, telegram: tgResp, webhook_url: webhookUrl })
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return jsonResponse({ error: 'method_not_allowed' }, 405)

  if (!SUPABASE_URL || !SERVICE_KEY || !BOT_TOKEN) {
    return jsonResponse({ error: 'function_not_configured' }, 500)
  }

  // Routing: /setup-webhook — server-to-server endpoint для регистрации
  // webhook в Telegram. Использует FUNCTION_INTERNAL_SECRET вместо
  // Telegram secret_token.
  const url = new URL(req.url)
  if (url.pathname.endsWith('/setup-webhook')) {
    return handleSelfSetup(req)
  }

  // Telegram secret_token (обязательно — без него никто не должен достучаться)
  if (WEBHOOK_SECRET) {
    const got = req.headers.get('x-telegram-bot-api-secret-token') ?? ''
    if (!timingSafeEqual(got, WEBHOOK_SECRET)) {
      console.warn('telegram-user-bot: rejected bad secret_token')
      return jsonResponse({ error: 'unauthorized' }, 401)
    }
  }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  let update: { message?: TgMessage; edited_message?: TgMessage }
  try {
    update = await req.json()
  } catch {
    return jsonResponse({ error: 'bad_request' }, 400)
  }

  const msg = update.message ?? update.edited_message
  if (msg) {
    try {
      await handleMessage(admin, msg)
    } catch (e) {
      console.error('telegram-user-bot handleMessage', e)
    }
  }

  // Telegram ждёт 200 OK — иначе будет ретраить
  return jsonResponse({ ok: true })
})
