/**
 * telegram-bug-collector — webhook от @finklay_dev_bot. Принимает сообщения
 * из общего бэг-чата владельца+партнёра, складывает в public.bug_reports
 * с AI-категоризацией и анализом скриншотов через Anthropic Claude.
 *
 * Команды бота:
 *   /list                   — открытые баги (newest first), сводка
 *   /done <short_id>        — отметить как fixed
 *   /note <short_id> <text> — добавить заметку к багу
 *   (любое другое сообщение) → новый баг
 *
 * Auth:
 *   - Telegram передаёт `X-Telegram-Bot-Api-Secret-Token` (мы задаём через
 *     setWebhook). Проверяем timing-safe equal с TELEGRAM_BUG_WEBHOOK_SECRET.
 *   - deploy --no-verify-jwt: webhook идёт без JWT, защита через secret.
 *
 * ENV:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   TELEGRAM_BUG_BOT_TOKEN          — токен @finklay_dev_bot
 *   TELEGRAM_BUG_WEBHOOK_SECRET     — secret_token из setWebhook (random hex)
 *   TELEGRAM_BUG_CHAT_ID            — единственный разрешённый chat_id
 *   ANTHROPIC_API_KEY               — для AI-категоризации (опционально)
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const BOT_TOKEN = Deno.env.get('TELEGRAM_BUG_BOT_TOKEN') ?? ''
const WEBHOOK_SECRET = Deno.env.get('TELEGRAM_BUG_WEBHOOK_SECRET') ?? ''
const ALLOWED_CHAT_ID = Deno.env.get('TELEGRAM_BUG_CHAT_ID') ?? ''
const ANTHROPIC_KEY = Deno.env.get('ANTHROPIC_API_KEY') ?? ''

const TELEGRAM_API = `https://api.telegram.org/bot${BOT_TOKEN}`
const BOT_ID = BOT_TOKEN.split(':')[0] // первая часть токена = numeric id бота

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

// =============================================================================
// Telegram API helpers
// =============================================================================

async function tgSend(
  chatId: number,
  text: string,
  opts?: { replyTo?: number; threadId?: number },
): Promise<void> {
  const body: Record<string, unknown> = {
    chat_id: chatId,
    text,
    parse_mode: 'Markdown',
    reply_to_message_id: opts?.replyTo,
    allow_sending_without_reply: true,
  }
  // В forum-supergroup'ах нужно явно указывать топик, иначе ответ улетит
  // в General. message_thread_id берём из самого сообщения юзера.
  if (opts?.threadId) body.message_thread_id = opts.threadId
  await fetch(`${TELEGRAM_API}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }).catch((e) => console.error('tgSend', e))
}

async function tgGetFile(fileId: string): Promise<{ path: string; size: number } | null> {
  try {
    const res = await fetch(`${TELEGRAM_API}/getFile?file_id=${encodeURIComponent(fileId)}`)
    const data = await res.json()
    if (!data.ok) {
      console.warn('tgGetFile failed', data)
      return null
    }
    return { path: data.result.file_path, size: data.result.file_size ?? 0 }
  } catch (e) {
    console.error('tgGetFile', e)
    return null
  }
}

async function tgDownload(filePath: string): Promise<{ bytes: Uint8Array; mime: string } | null> {
  try {
    const res = await fetch(`https://api.telegram.org/file/bot${BOT_TOKEN}/${filePath}`)
    if (!res.ok) return null
    const buf = await res.arrayBuffer()
    const mime = res.headers.get('content-type') ?? 'application/octet-stream'
    return { bytes: new Uint8Array(buf), mime }
  } catch (e) {
    console.error('tgDownload', e)
    return null
  }
}

// =============================================================================
// Photo storage + analysis
// =============================================================================

type Attachment = {
  type: 'photo' | 'document' | 'video'
  file_id: string
  storage_path: string | null
  mime: string
  size: number
  vision_summary?: string
}

async function processPhoto(
  admin: ReturnType<typeof createClient>,
  fileId: string,
  bugIdHint: string,
): Promise<Attachment | null> {
  const meta = await tgGetFile(fileId)
  if (!meta) return null
  const file = await tgDownload(meta.path)
  if (!file) return null

  const ext = meta.path.split('.').pop()?.toLowerCase() ?? 'jpg'
  const storagePath = `${bugIdHint}/${fileId}.${ext}`

  const { error: upErr } = await admin.storage
    .from('bug-attachments')
    .upload(storagePath, file.bytes, { contentType: file.mime, upsert: true })
  if (upErr) {
    console.warn('storage upload failed', upErr)
    return {
      type: 'photo',
      file_id: fileId,
      storage_path: null,
      mime: file.mime,
      size: meta.size,
    }
  }

  // AI-описание (опционально, только если есть ключ)
  let visionSummary: string | undefined
  if (ANTHROPIC_KEY && file.mime.startsWith('image/')) {
    visionSummary = (await analyzeScreenshot(file.bytes, file.mime)) ?? undefined
  }

  return {
    type: 'photo',
    file_id: fileId,
    storage_path: storagePath,
    mime: file.mime,
    size: meta.size,
    vision_summary: visionSummary,
  }
}

async function analyzeScreenshot(bytes: Uint8Array, mime: string): Promise<string | null> {
  try {
    const base64 = btoa(String.fromCharCode(...bytes.slice(0, 4 * 1024 * 1024))) // safety: до 4 MB
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 250,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: { type: 'base64', media_type: mime, data: base64 },
              },
              {
                type: 'text',
                text: 'Это скриншот бага в SaaS-приложении Finkley (управленческий учёт салона). Опиши кратко (2 предложения): что на экране и какая может быть проблема. Если есть текст ошибки/предупреждения — процитируй. Если ничего необычного — скажи "ничего необычного".',
              },
            ],
          },
        ],
      }),
    })
    if (!res.ok) {
      console.warn('anthropic vision', res.status, await res.text())
      return null
    }
    const data = await res.json()
    const block = data.content?.[0]
    if (block?.type === 'text') return block.text as string
    return null
  } catch (e) {
    console.warn('analyzeScreenshot', e)
    return null
  }
}

async function generateFixAnnouncement(
  original: string,
  prevSummary: string,
  visionContext: string,
  fixDescription: string,
): Promise<string | null> {
  if (!ANTHROPIC_KEY) return null
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 350,
        system: `Ты пишешь короткое сообщение о ЗАКРЫТИИ бага в Finkley (учёт салонов).

Формат — 1-2 коротких предложения, ПО-ЧЕЛОВЕЧЕСКИ (без жаргона: render, state, types и т.п.).

Структура: «Исправлен баг с <тем что было сломано>. Проблема была <в чём суть>.»

Если описание фикса конкретное (например: "заменил тип файлов в БД") — упомяни это в человеческой формулировке.
Если описания фикса нет — просто опиши что было сломано и закрыто.

Возвращай ТОЛЬКО текст сообщения, без JSON и кавычек.`,
        messages: [
          {
            role: 'user',
            content:
              `Оригинальный баг:\n${original || '(только скриншот)'}\n\n` +
              (visionContext ? `Что было на скриншоте:\n${visionContext}\n\n` : '') +
              `Прежнее моё понимание:\n${prevSummary || '(не было)'}\n\n` +
              `Описание фикса от разработчика:\n${fixDescription || '(не указано)'}`,
          },
        ],
      }),
    })
    if (!res.ok) return null
    const data = await res.json()
    const block = data.content?.[0]
    if (block?.type !== 'text') return null
    return (block.text as string).trim()
  } catch (e) {
    console.warn('generateFixAnnouncement', e)
    return null
  }
}

async function recategorizeWithCorrection(
  original: string,
  prevSummary: string,
  correction: string,
  wasFixed: boolean,
): Promise<{ severity?: string; area?: string; summary?: string; steps?: string } | null> {
  if (!ANTHROPIC_KEY) return null
  try {
    const systemBase = `Ты помогаешь разработчику разбирать баг-репорты в Finkley (учёт салонов).`
    const systemContext = wasFixed
      ? `${systemBase} Я (разработчик) уже отчитался что починил этот баг, но юзер написал что НЕ ПОЧИНЕНО. Перевыдай summary с учётом того, что прошлая попытка фикса не сработала — это поможет мне разобраться повторно.`
      : `${systemBase} Юзер поправил твоё прежнее понимание бага. Перевыдай summary с учётом коррекции.`

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 500,
        system: `${systemContext}

Возвращай ТОЛЬКО JSON:
{
  "severity": "low|medium|high|critical",
  "area": "visits|expenses|payouts|reports|auth|clients|staff|onboarding|billing|settings|import|other",
  "summary": "<2-3 коротких предложения, по-человечески, для НЕтехнического человека: что не работает + что чинить.${wasFixed ? ' Учти что прошлая попытка фикса не сработала — нужен другой подход.' : ' Учти коррекцию юзера.'}>",
  "steps": ""
}`,
        messages: [
          {
            role: 'user',
            content: `Оригинальный баг-репорт:\n${original}\n\n${wasFixed ? 'Что я (разработчик) думал что починил' : 'Моё прежнее понимание (которое юзер исправил)'}:\n${prevSummary}\n\n${wasFixed ? 'Жалоба юзера что не починено' : 'Коррекция от юзера'}:\n${correction}\n\nДай новый summary.`,
          },
        ],
      }),
    })
    if (!res.ok) return null
    const data = await res.json()
    const block = data.content?.[0]
    if (block?.type !== 'text') return null
    const match = (block.text as string).match(/\{[\s\S]*\}/)
    if (!match) return null
    return JSON.parse(match[0])
  } catch (e) {
    console.warn('recategorizeWithCorrection', e)
    return null
  }
}

async function categorizeText(
  text: string,
): Promise<{ severity?: string; area?: string; summary?: string; steps?: string }> {
  if (!ANTHROPIC_KEY || !text.trim()) return {}
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 500,
        system: `Ты помогаешь разработчику разбирать баг-репорты в Finkley (web-приложение учёта салонов).

Возвращай ТОЛЬКО JSON со структурой:
{
  "severity": "low" | "medium" | "high" | "critical",
  "area": "visits" | "expenses" | "payouts" | "reports" | "auth" | "clients" | "staff" | "onboarding" | "billing" | "settings" | "import" | "other",
  "summary": "<2-3 коротких предложения, естественным разговорным языком, для НЕтехнического человека: что увидел юзер + что я думаю надо починить. Без жаргона, без 'event handler', без 'render', без 'state'. Просто на русском. Пример: 'Юзер не может добавить визит — кнопка не работает. Похоже, форма не реагирует на нажатие. Надо проверить почему сабмит не срабатывает.'>",
  "steps": "<если упомянуты шаги воспроизведения — короткий список через ; иначе пусто>"
}`,
        messages: [{ role: 'user', content: text }],
      }),
    })
    if (!res.ok) return {}
    const data = await res.json()
    const block = data.content?.[0]
    if (block?.type !== 'text') return {}
    const match = (block.text as string).match(/\{[\s\S]*\}/)
    if (!match) return {}
    const parsed = JSON.parse(match[0])
    return {
      severity: parsed.severity,
      area: parsed.area,
      summary: parsed.summary,
      steps: parsed.steps,
    }
  } catch (e) {
    console.warn('categorizeText', e)
    return {}
  }
}

// =============================================================================
// Commands
// =============================================================================

function shortId(uuid: string): string {
  return uuid.slice(0, 8)
}

async function cmdList(admin: ReturnType<typeof createClient>, chatId: number, threadId?: number) {
  const { data, error } = await admin
    .from('bug_reports')
    .select('id, ai_summary, message_text, severity, area, sender_first_name, reported_at')
    .eq('status', 'open')
    .order('reported_at', { ascending: false })
    .limit(20)
  if (error) {
    await tgSend(chatId, `❌ Ошибка чтения: ${error.message}`, { threadId })
    return
  }
  type Row = {
    id: string
    ai_summary: string | null
    message_text: string | null
    severity: string | null
    area: string | null
    sender_first_name: string | null
    reported_at: string
  }
  const rows = (data ?? []) as Row[]
  if (rows.length === 0) {
    await tgSend(chatId, '✅ Открытых багов нет', { threadId })
    return
  }
  const lines = rows.map((r) => {
    const sev = r.severity ? `[${r.severity.toUpperCase()}]` : ''
    const area = r.area ? ` · ${r.area}` : ''
    const summary = r.ai_summary || (r.message_text || '').slice(0, 100)
    return `\`${shortId(r.id)}\` ${sev}${area}\n_${r.sender_first_name ?? '?'}_: ${summary}`
  })
  await tgSend(chatId, `*Открытых багов: ${rows.length}*\n\n${lines.join('\n\n')}`, {
    threadId,
  })
}

async function cmdDone(
  admin: ReturnType<typeof createClient>,
  chatId: number,
  shortIdArg: string,
  fixDescription: string,
  threadId?: number,
) {
  if (!shortIdArg) {
    await tgSend(chatId, 'Использование: `/done <short_id> [описание фикса]`', { threadId })
    return
  }

  // Сначала достаём контекст бага (для последующего announce-сообщения)
  const { data: existing, error: findErr } = await admin
    .from('bug_reports')
    .select('id, message_text, ai_summary, attachments, notes, status')
    .like('id', `${shortIdArg}%`)
    .limit(2)

  if (findErr) {
    await tgSend(chatId, `❌ ${findErr.message}`, { threadId })
    return
  }
  if (!existing || existing.length === 0) {
    await tgSend(chatId, `Не нашёл баг с id \`${shortIdArg}\``, { threadId })
    return
  }
  if (existing.length > 1) {
    await tgSend(chatId, `Найдено несколько (${existing.length}) — уточни длиннее short_id`, {
      threadId,
    })
    return
  }

  const row = existing[0]! as {
    id: string
    message_text: string | null
    ai_summary: string | null
    attachments: Array<{ vision_summary?: string }>
    notes: string | null
    status: string
  }

  const updates: Record<string, unknown> = {
    status: 'fixed',
    fixed_at: new Date().toISOString(),
  }
  if (fixDescription) {
    const fixNote = `Исправление (${new Date().toISOString().slice(0, 10)}): ${fixDescription}`
    updates.notes = row.notes ? `${row.notes}\n---\n${fixNote}` : fixNote
  }
  const { error: updErr } = await admin.from('bug_reports').update(updates).eq('id', row.id)
  if (updErr) {
    await tgSend(chatId, `❌ ${updErr.message}`, { threadId })
    return
  }

  // Генерируем человекопонятный announce с учётом фикса (если описан)
  const visionContext = (row.attachments ?? [])
    .map((a) => a.vision_summary)
    .filter(Boolean)
    .join('\n')
  const announce = await generateFixAnnouncement(
    row.message_text || '',
    row.ai_summary || '',
    visionContext,
    fixDescription,
  )

  const ack = announce
    ? `✅ \`${shortId(row.id)}\`\n\n${announce}`
    : `✅ \`${shortId(row.id)}\` — закрыт`
  await tgSend(chatId, ack, { threadId })
}

/**
 * Юзер ответил на сообщение бота (например, на ack «🐛 Записал …»). Парсим
 * short_id из бот-сообщения, считаем что юзер поправляет/уточняет понимание
 * бага. Вызываем AI пересчитать summary с учётом коррекции и обновляем БД.
 */
async function handleCorrection(
  admin: ReturnType<typeof createClient>,
  msg: TgMessage,
  correctionText: string,
  threadId?: number,
): Promise<boolean> {
  const botText = msg.reply_to_message?.text ?? ''
  // Бот в ack использует `<short_id>` в backticks — парсим (любой ack:
  // 🐛 при создании, 🔄 при коррекции, ✅ при фиксе, 🔁 при reopen)
  const idMatch = botText.match(/`([0-9a-f]{8})`/i)
  if (!idMatch) return false // не consumed → handleMessage продолжит обычный flow
  const shortIdVal = idMatch[1]!.toLowerCase()

  const { data: bug, error: findErr } = await admin
    .from('bug_reports')
    .select('id, message_text, ai_summary, attachments, sender_first_name, notes, status')
    .like('id', `${shortIdVal}%`)
    .limit(2)
  if (findErr || !bug || bug.length === 0) {
    await tgSend(msg.chat.id, `Не нашёл \`${shortIdVal}\` в БД`, { threadId })
    return true
  }
  if (bug.length > 1) {
    await tgSend(msg.chat.id, `Несколько багов с id \`${shortIdVal}\` — уточни длиннее`, {
      threadId,
    })
    return true
  }
  const row = bug[0]! as {
    id: string
    message_text: string | null
    ai_summary: string | null
    attachments: Array<{ vision_summary?: string }>
    sender_first_name: string | null
    notes: string | null
    status: string
  }
  const wasFixed = row.status === 'fixed'

  // Собираем оригинальный контекст для AI
  const visionSummaries = (row.attachments ?? [])
    .map((a) => a.vision_summary)
    .filter(Boolean)
    .join('\n')
  const original = [row.message_text, visionSummaries].filter(Boolean).join('\n\n')

  const recat = await recategorizeWithCorrection(
    original || '(без оригинального текста, только скриншот)',
    row.ai_summary || '(пустое)',
    correctionText,
    wasFixed,
  )

  // Аппендим коррекцию в notes для истории. Если баг был fixed —
  // помечаем явно «фикс не сработал», чтобы в будущем было понятно.
  const noteLabel = wasFixed
    ? `Reopen — фикс не сработал (${msg.from?.first_name ?? '?'})`
    : `Коррекция (${msg.from?.first_name ?? '?'})`
  const correctionNote = `${noteLabel}: ${correctionText}`
  const newNotes = row.notes ? `${row.notes}\n---\n${correctionNote}` : correctionNote

  const updates: Record<string, unknown> = { notes: newNotes }
  if (recat) {
    if (recat.summary) updates.ai_summary = recat.summary
    if (recat.severity) updates.severity = recat.severity
    if (recat.area) updates.area = recat.area
    updates.ai_categorized_at = new Date().toISOString()
  }
  // Если баг был fixed — переоткрываем. fixed_at сбрасываем (иначе он
  // фильтруется в /list), но fixed_in_commit оставляем — это история
  // прошлой попытки, полезно для дебага.
  if (wasFixed) {
    updates.status = 'open'
    updates.fixed_at = null
  }

  await admin.from('bug_reports').update(updates).eq('id', row.id)

  const prefix = wasFixed ? '🔁' : '🔄'
  const header = wasFixed
    ? `${prefix} \`${shortId(row.id)}\` — переоткрыт, фикс не сработал`
    : `${prefix} \`${shortId(row.id)}\``
  const ackText = recat?.summary ? `${header}\n\n${recat.summary}` : header
  await tgSend(msg.chat.id, ackText, { replyTo: msg.message_id, threadId })
  return true
}

async function cmdNote(
  admin: ReturnType<typeof createClient>,
  chatId: number,
  shortIdArg: string,
  text: string,
  threadId?: number,
) {
  if (!shortIdArg || !text) {
    await tgSend(chatId, 'Использование: `/note <short_id> <текст>`', { threadId })
    return
  }
  const { data: existing } = await admin
    .from('bug_reports')
    .select('id, notes')
    .like('id', `${shortIdArg}%`)
    .limit(2)
  if (!existing || existing.length === 0) {
    await tgSend(chatId, `Не нашёл баг с id \`${shortIdArg}\``, { threadId })
    return
  }
  if (existing.length > 1) {
    await tgSend(chatId, `Найдено несколько — уточни длиннее short_id`, { threadId })
    return
  }
  const row = existing[0]! as { id: string; notes: string | null }
  const newNotes = row.notes ? `${row.notes}\n---\n${text}` : text
  await admin.from('bug_reports').update({ notes: newNotes }).eq('id', row.id)
  await tgSend(chatId, `📝 Заметка добавлена к \`${shortId(row.id)}\``, { threadId })
}

// =============================================================================
// Update processing
// =============================================================================

type TgPhotoSize = { file_id: string; width: number; height: number; file_size?: number }
type TgDocument = { file_id: string; mime_type?: string; file_size?: number }
type TgUser = { id: number; first_name?: string; username?: string }
type TgChat = { id: number; type: string }
type TgMessage = {
  message_id: number
  message_thread_id?: number
  from?: TgUser
  chat: TgChat
  date: number
  text?: string
  caption?: string
  photo?: TgPhotoSize[]
  document?: TgDocument
  reply_to_message?: TgMessage
  is_topic_message?: boolean
}

async function handleMessage(admin: ReturnType<typeof createClient>, msg: TgMessage) {
  if (ALLOWED_CHAT_ID && String(msg.chat.id) !== ALLOWED_CHAT_ID) {
    console.warn('rejected unauthorized chat', msg.chat.id)
    return
  }

  const text = (msg.text ?? msg.caption ?? '').trim()
  const threadId = msg.message_thread_id

  // Реплай на сообщение бота? Это либо коррекция понимания (если в боте есть
  // short_id в backticks), либо обычный новый баг (если реплай на /help, /list).
  if (
    msg.reply_to_message &&
    msg.reply_to_message.from?.id === Number(BOT_ID) &&
    text &&
    !text.startsWith('/')
  ) {
    const consumed = await handleCorrection(admin, msg, text, threadId)
    if (consumed) return
    // не нашли short_id в боте → продолжаем как новый баг
  }

  // Команды
  if (text.startsWith('/')) {
    const [cmdRaw, ...rest] = text.split(/\s+/)
    const cmd = cmdRaw!.split('@')[0]!.toLowerCase() // /list@finklay_dev_bot → /list
    if (cmd === '/list') return cmdList(admin, msg.chat.id, threadId)
    if (cmd === '/done') {
      const [doneId, ...descParts] = rest
      return cmdDone(admin, msg.chat.id, doneId ?? '', descParts.join(' '), threadId)
    }
    if (cmd === '/note') {
      const [id, ...textParts] = rest
      return cmdNote(admin, msg.chat.id, id ?? '', textParts.join(' '), threadId)
    }
    if (cmd === '/start' || cmd === '/help') {
      return tgSend(
        msg.chat.id,
        `*Finkley bug-collector* 🐛\n\nПросто пиши/скидывай скрин — занесу в багтрекер.\n\n*Команды:*\n\`/list\` — открытые баги\n\`/done <id> [описание]\` — закрыть (опц. что починил)\n\`/note <id> <текст>\` — добавить заметку\n\n*Reply на ответ бота:*\n— любой текст коррекции → бот пересчитает понимание бага`,
        { threadId },
      )
    }
    return // неизвестная команда — игнорируем
  }

  // Если это reply на сообщение бота с /list — парсим как duplicate? Skip пока.
  if (!text && !msg.photo && !msg.document) return

  // Создаём bug_report
  const bugIdHint = `${msg.chat.id}_${msg.message_id}`

  // Скачиваем attachments параллельно
  const attachments: Attachment[] = []
  if (msg.photo && msg.photo.length > 0) {
    // Берём самый большой размер (последний в массиве)
    const largest = msg.photo[msg.photo.length - 1]!
    const att = await processPhoto(admin, largest.file_id, bugIdHint)
    if (att) attachments.push(att)
  }
  if (msg.document) {
    const att = await processPhoto(admin, msg.document.file_id, bugIdHint)
    if (att) {
      att.type = 'document'
      attachments.push(att)
    }
  }

  // AI-разметка
  const visionSummary = attachments.find((a) => a.vision_summary)?.vision_summary ?? ''
  const fullText = [text, visionSummary].filter(Boolean).join('\n\n')
  const cat = await categorizeText(fullText)

  const { data, error } = await admin
    .from('bug_reports')
    .insert({
      telegram_chat_id: msg.chat.id,
      telegram_message_id: msg.message_id,
      telegram_thread_id: msg.message_thread_id ?? null,
      sender_id: msg.from?.id ?? 0,
      sender_username: msg.from?.username ?? null,
      sender_first_name: msg.from?.first_name ?? null,
      message_text: text || null,
      attachments,
      reported_at: new Date(msg.date * 1000).toISOString(),
      severity: cat.severity ?? null,
      area: cat.area ?? null,
      ai_summary: cat.summary ?? null,
      ai_steps_to_repro: cat.steps ?? null,
      ai_categorized_at: cat.summary ? new Date().toISOString() : null,
    })
    .select('id')
    .single()

  if (error) {
    if (error.code === '23505') {
      // Уже видели этот message — silent
      return
    }
    console.error('insert bug_reports', error)
    await tgSend(msg.chat.id, `⚠️ Не смог сохранить: ${error.message}`, { threadId })
    return
  }

  // Подтверждаем reply'ем в том же топике. Главное — человекопонятная сводка:
  // что я понял + что починить. Severity/area идут в /list и БД, в ack не лезут.
  const humanSummary = cat.summary || visionSummary || null
  const ack = [`🐛 \`${shortId(data!.id)}\``, humanSummary].filter(Boolean).join('\n\n')
  await tgSend(msg.chat.id, ack, { replyTo: msg.message_id, threadId })
}

// =============================================================================
// Webhook handler
// =============================================================================

const FUNCTION_INTERNAL_SECRET = Deno.env.get('FUNCTION_INTERNAL_SECRET') ?? ''

/**
 * /announce-fix endpoint — вызывается мной (Claude) после `git push` фикса.
 * Атомарно: помечает баг как fixed, генерит AI-объявление и постит в топик.
 *
 * Auth: X-Finkley-Secret = FUNCTION_INTERNAL_SECRET (тот же, что у других
 * server-to-server вызовов).
 *
 * Body: { short_id, fix_description?, commit_sha? }
 */
async function handleAnnounceFix(req: Request, admin: ReturnType<typeof createClient>) {
  // Auth: либо X-Finkley-Secret (server-to-server между функциями), либо
  // Authorization: Bearer <service_role_key> (CLI вызовы от меня после фикса).
  const internalSecret = req.headers.get('x-finkley-secret') ?? ''
  const authBearer = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
  const ok =
    (FUNCTION_INTERNAL_SECRET && timingSafeEqual(internalSecret, FUNCTION_INTERNAL_SECRET)) ||
    (SERVICE_KEY && timingSafeEqual(authBearer, SERVICE_KEY))
  if (!ok) return jsonResponse({ error: 'unauthorized' }, 401)
  let body: { short_id?: string; fix_description?: string; commit_sha?: string }
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: 'bad_request' }, 400)
  }
  if (!body.short_id) return jsonResponse({ error: 'short_id_required' }, 400)

  const { data: rows, error: findErr } = await admin
    .from('bug_reports')
    .select(
      'id, telegram_chat_id, telegram_thread_id, message_text, ai_summary, attachments, notes, status',
    )
    .like('id', `${body.short_id}%`)
    .limit(2)

  if (findErr) return jsonResponse({ error: findErr.message }, 500)
  if (!rows || rows.length === 0) return jsonResponse({ error: 'not_found' }, 404)
  if (rows.length > 1) return jsonResponse({ error: 'ambiguous_id' }, 409)

  const row = rows[0]! as {
    id: string
    telegram_chat_id: number
    telegram_thread_id: number | null
    message_text: string | null
    ai_summary: string | null
    attachments: Array<{ vision_summary?: string }>
    notes: string | null
    status: string
  }

  const fixNote = `Фикс${body.commit_sha ? ` (${body.commit_sha.slice(0, 7)})` : ''}: ${body.fix_description || '(без описания)'}`
  const updates: Record<string, unknown> = {
    status: 'fixed',
    fixed_at: new Date().toISOString(),
    fixed_in_commit: body.commit_sha ?? null,
    notes: row.notes ? `${row.notes}\n---\n${fixNote}` : fixNote,
  }
  await admin.from('bug_reports').update(updates).eq('id', row.id)

  const visionContext = (row.attachments ?? [])
    .map((a) => a.vision_summary)
    .filter(Boolean)
    .join('\n')
  const announce = await generateFixAnnouncement(
    row.message_text || '',
    row.ai_summary || '',
    visionContext,
    body.fix_description ?? '',
  )

  const ack = announce
    ? `✅ \`${shortId(row.id)}\`\n\n${announce}`
    : `✅ \`${shortId(row.id)}\` — закрыт`
  await tgSend(row.telegram_chat_id, ack, {
    threadId: row.telegram_thread_id ?? undefined,
  })

  return jsonResponse({ ok: true, id: row.id, announced: !!announce })
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return jsonResponse({ error: 'method_not_allowed' }, 405)

  if (!SUPABASE_URL || !SERVICE_KEY || !BOT_TOKEN) {
    return jsonResponse({ error: 'function_not_configured' }, 500)
  }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  // Routing: /announce-fix → server-to-server endpoint
  const url = new URL(req.url)
  if (url.pathname.endsWith('/announce-fix')) {
    return handleAnnounceFix(req, admin)
  }

  // Иначе — Telegram webhook
  // Telegram secret_token (опционально, но если задан — проверяем строго)
  if (WEBHOOK_SECRET) {
    const got = req.headers.get('x-telegram-bot-api-secret-token') ?? ''
    if (!timingSafeEqual(got, WEBHOOK_SECRET)) {
      console.warn('rejected: bad secret_token')
      return jsonResponse({ error: 'unauthorized' }, 401)
    }
  }

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
      console.error('handleMessage', e)
    }
  }

  // Telegram ждёт 200 OK — иначе будет ретраить
  return jsonResponse({ ok: true })
})
