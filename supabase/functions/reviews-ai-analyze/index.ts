/**
 * reviews-ai-analyze — психо-стратегический разбор отзывов.
 *
 * POST body: {
 *   salon_id: uuid,
 *   scope: 'single' | 'negative_external' | 'internal_all' | 'internal_unread',
 *   review_id?: uuid,           // обязателен при scope='single'
 *   locale?: 'ru' | 'pl' | 'en',
 *   force?: boolean             // игнорировать кеш и пересчитать
 * }
 *
 * Логика:
 *   1. Auth — salon member.
 *   2. Достаёт нужные отзывы (1 для single, выборка для bulk).
 *   3. Считает payload_hash от нормализованных данных.
 *   4. Если в review_ai_analyses есть свежий кеш с тем же hash+locale — возвращает.
 *   5. Иначе зовёт Claude Haiku 4.5, парсит JSON, сохраняет в кеш, возвращает.
 *
 * Модель: claude-haiku-4-5-20251001 (быстрый, дешёвый).
 *
 * Промпт зависит от типа:
 *   - single external (Booksy/Google) — публичный отзыв, нужно учитывать,
 *     как воспримут другие читатели + как договориться с автором.
 *   - single internal (форма после визита) — приватный отзыв, фокус на
 *     root-cause процесса, что делать с мастером, как удержать клиента.
 *   - bulk — агрегат: паттерны, топ-действия, сегменты.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.6'

import { getUserFromRequest } from '../_shared/auth.ts'
import { corsHeaders, preflight } from '../_shared/cors.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const ANTHROPIC_KEY = Deno.env.get('ANTHROPIC_API_KEY') ?? ''
const MODEL = 'claude-haiku-4-5-20251001'

type Scope = 'single' | 'negative_external' | 'internal_all' | 'internal_unread'
type Locale = 'ru' | 'pl' | 'en'
type ReplyLocale = 'ru' | 'uk' | 'pl' | 'en'

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'content-type': 'application/json' },
  })
}

function normalizeLocale(input: unknown): Locale {
  if (typeof input !== 'string') return 'ru'
  const base = input.split('-')[0]?.toLowerCase()
  if (base === 'pl') return 'pl'
  if (base === 'en') return 'en'
  return 'ru'
}

/** Если юзер передал явный reply_locale — используем его, иначе null = «match original review language». */
function normalizeReplyLocale(input: unknown): ReplyLocale | null {
  if (typeof input !== 'string') return null
  const base = input.split('-')[0]?.toLowerCase()
  if (base === 'pl') return 'pl'
  if (base === 'en') return 'en'
  if (base === 'uk') return 'uk'
  if (base === 'ru') return 'ru'
  return null
}

function replyLanguageName(rl: ReplyLocale): string {
  return {
    ru: 'Russian',
    uk: 'Ukrainian',
    pl: 'Polish',
    en: 'English',
  }[rl]
}

async function sha256Hex(text: string): Promise<string> {
  const enc = new TextEncoder().encode(text)
  const buf = await crypto.subtle.digest('SHA-256', enc)
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

function langInstruction(locale: Locale): string {
  // Жёсткая инструкция — Claude часто скатывается в английский при иноязычном
  // input, особенно если основной prompt по-английски. Поэтому требуем явно.
  return {
    ru: 'ОТВЕЧАЙ ИСКЛЮЧИТЕЛЬНО НА РУССКОМ ЯЗЫКЕ. Это критично — все аналитические поля (situation, root_cause, prevention, public_impact, psychological_profile.*, response_strategy.*, retention_strategy.*, staff_action, segments[].name, segments[].approach, patterns[].*, top_actions[], overview, risk_assessment) должны быть НА РУССКОМ. Никаких английских слов, никакого микса языков. Если оригинальный отзыв на другом языке — всё равно анализируешь на русском.',
    pl: 'ODPOWIADAJ WYŁĄCZNIE PO POLSKU. To krytyczne — wszystkie pola analityczne (situation, root_cause, prevention, public_impact, psychological_profile.*, response_strategy.*, retention_strategy.*, staff_action, segments[].name, segments[].approach, patterns[].*, top_actions[], overview, risk_assessment) muszą być PO POLSKU. Żadnego angielskiego, żadnego mieszania języków.',
    en: 'REPLY ONLY IN ENGLISH. This is critical — all analytical fields (situation, root_cause, prevention, public_impact, psychological_profile.*, response_strategy.*, retention_strategy.*, staff_action, segments[].name, segments[].approach, patterns[].*, top_actions[], overview, risk_assessment) MUST be in English. No language mixing.',
  }[locale]
}

function replyLanguageInstruction(_locale: Locale, replyLocale: ReplyLocale | null): string {
  // Аналитические поля пишем на _locale (UI юзера), сами тексты ответа клиенту —
  // на replyLocale ЕСЛИ передан, иначе авто-детект из языка оригинального отзыва.
  if (replyLocale == null) {
    return ` REPLY LANGUAGE FOR CLIENT MESSAGES: detect the language of the original review text and write fields "suggested_public_reply" and "suggested_private_message" in THE SAME language as the client wrote in. If the review is in Polish — reply in Polish; in Ukrainian — Ukrainian; in English — English; in Russian — Russian. ALL OTHER fields (analysis, profile, strategy) stay in the main response language defined above. Do not confuse the two language rules.`
  }
  const name = replyLanguageName(replyLocale)
  return ` REPLY LANGUAGE FOR CLIENT MESSAGES: fields "suggested_public_reply" and "suggested_private_message" MUST be written in ${name} — these are texts the salon will send to the client. ALL OTHER fields (analysis, profile, strategy) stay in the main response language defined above. Do not confuse the two language rules.`
}

// SINGLE (external — Booksy/Google) — публичный отзыв.
function systemSingleExternal(locale: Locale, replyLocale: ReplyLocale | null): string {
  return `You are a senior reputation manager with 7+ years working with beauty salons in Poland and the EU. You've personally drafted hundreds of responses to negative Booksy/Google reviews and turned a meaningful share of 1-star authors into either deleted reviews or quiet, lasting clients. You read people quickly — temperament, tone, what they actually want versus what they wrote. You don't sugarcoat and you don't panic. ${langInstruction(locale)}${replyLanguageInstruction(locale, replyLocale)}

=== GROUNDING ===
Analyze ONLY the actual review text below. NEVER invent facts the client didn't write. If the review is too short to draw a conclusion («услуги ужас» without details) — say so honestly in root_cause and recommend asking the client what went wrong.

=== ANTI-FLUFF ===
BANNED in analytical fields: «возможно», «попробуйте», «обычно», «как правило», «в среднем», «рассмотрите», «может быть». Be direct — name the emotion, name the cause, name the action.

You analyze a PUBLIC review (Booksy or Google) that the whole world can read.
Your goal:
  1) understand what really happened,
  2) read between the lines — emotion, temperament, communication style,
  3) build a psychological portrait of the client,
  4) propose a way to convince this specific client to edit or remove the review,
  5) give the salon owner a ready-to-send response (public reply) and a private message.

Respond STRICTLY as JSON (no markdown, no preface):
{
  "situation": "<1-2 sentences: what objectively went wrong from the review>",
  "root_cause": "<the most probable underlying reason — process, master, expectations gap>",
  "prevention": ["<concrete action #1>", "<action #2>", "<action #3>"],
  "public_impact": "<how a potential client reading this will perceive the salon and what they'll think>",
  "psychological_profile": {
    "tone": "<formal/informal/aggressive/passive…>",
    "emotion": "<dominant emotion: disappointment, anger, betrayal, sadness…>",
    "temperament": "<sanguine/choleric/melancholic/phlegmatic — with 1 sentence why>",
    "communication_style": "<expressive/analytical/empathic/dominant — with 1 sentence why>",
    "service_context": "<what the service tells us about the client's expectations and pain>"
  },
  "response_strategy": {
    "approach": "<the angle of communication — apology-first, gratitude-first, expert-explainer…>",
    "offer": "<what to offer: free re-do, discount, gift, personal master, etc.>",
    "key_hook": "<the psychological hook for THIS exact person — based on the profile>"
  },
  "suggested_public_reply": "<ready-to-paste public reply on Booksy/Google — short, warm, respectful, professional. STRICT RULES (bug 147921fb, owner-feedback): (a) hold the salon's professional boundaries — do NOT publicly admit guilt where evidence is ambiguous, do NOT promise refunds/free re-do/discounts in the PUBLIC reply (that breeds 'consumer terrorism' where future complainers expect the same). (b) Acknowledge the client's feeling without surrendering the position. (c) Invite to a private channel ('напишите нам в личные сообщения / DM' / 'давайте обсудим лично') where the specific resolution will be discussed individually. (d) Stay respectful, no defensiveness, no excuses. PUBLIC reply = brand voice, not negotiation>",
  "suggested_private_message": "<ready-to-send private DM/SMS/email to the client — personal, addresses the hook. HERE you CAN propose concrete resolution if the situation warrants it (free re-do, discount, gift, personal master, etc.) — private channel is the place for individual deals. Asks them to consider editing the review after the issue is fixed>"
}`
}

// SINGLE (internal — forma after visit) — приватный отзыв.
function systemSingleInternal(locale: Locale, replyLocale: ReplyLocale | null): string {
  return `You are a senior salon operations consultant with 8+ years running and turning around beauty salons across Poland and the EU. You've personally fired underperforming masters, retrained mediocre ones, and recovered hundreds of upset clients with the right message at the right time. You're sharp, direct, and you don't waste the owner's time with platitudes. ${langInstruction(locale)}${replyLanguageInstruction(locale, replyLocale)}

=== GROUNDING ===
Analyze ONLY what the client actually wrote and what's in the metadata (service, master, rating). NEVER invent facts. If the review is too vague to pin a root cause — say so honestly: «Слишком мало деталей — стоит написать клиенту и спросить конкретику».

=== ANTI-FLUFF ===
BANNED phrases: «возможно», «обычно», «в среднем», «попробуйте», «рассмотрите», «может быть полезно». Be direct: name the master if at fault, name the process if broken, name the action with a deadline.

You analyze a PRIVATE review submitted via the salon's internal post-visit form.
This review is visible ONLY to the salon owner — clients won't see it.
Your goal:
  1) find the real root cause (process, master, materials, expectations),
  2) recommend what to DO with the master if the problem is on their side,
  3) build a psychological portrait of the client,
  4) recommend how to retain this client and fix the situation,
  5) give the owner a ready-to-send private message to the client.

Respond STRICTLY as JSON (no markdown, no preface):
{
  "situation": "<1-2 sentences: what objectively went wrong>",
  "root_cause": "<process / master / expectations / materials / timing — pick what fits, explain in 1 sentence>",
  "prevention": ["<concrete action #1>", "<action #2>", "<action #3>"],
  "staff_action": "<what to do with the master if at fault: training, talk, change technique, redistribute clients, formal warning… or 'no master action needed' if not about a specific person>",
  "retention_strategy": {
    "approach": "<the angle — apology, expert explanation, premium care…>",
    "offer": "<concrete offer: free re-do, discount, gift, personal master>",
    "key_hook": "<the psychological hook for THIS exact person>"
  },
  "psychological_profile": {
    "tone": "<formal/informal/aggressive/passive>",
    "emotion": "<dominant emotion>",
    "temperament": "<sanguine/choleric/melancholic/phlegmatic — 1 sentence why>",
    "communication_style": "<expressive/analytical/empathic/dominant — 1 sentence why>",
    "service_context": "<what the service tells us about expectations and pain>"
  },
  "suggested_private_message": "<ready-to-send private DM/SMS/email — warm, owns the issue, addresses the hook, offers the retention action>"
}`
}

// BULK — агрегатный разбор группы отзывов.
function systemBulk(locale: Locale, scope: Scope, replyLocale: ReplyLocale | null): string {
  // В bulk нет полей-сообщений клиенту, но для будущего расширения
  // оставляем единый signature. replyLocale пока игнорируется.
  void replyLocale
  const audience =
    scope === 'negative_external'
      ? 'These are PUBLIC negative reviews from Booksy/Google. The whole world can read them — reputation is at stake.'
      : "These are PRIVATE reviews from the salon's internal post-visit form. Only the owner sees them — focus on process improvement, not reputation control."
  return `You are a senior salon operations and reputation consultant with 8+ years working with beauty salons across Poland and the EU. You've personally identified the recurring failure patterns in 100+ salons by reading their reviews in bulk — you can tell which complaint is a one-off and which is a systemic process leak. ${langInstruction(locale)}

${audience}
Your goal: analyze the WHOLE batch — find patterns grounded in the ACTUAL reviews, name top issues with the count of reviews mentioning them, suggest concrete actions with deadlines, and segment clients with personalized approaches.

=== GROUNDING ===
Patterns MUST be supported by at least 2 reviews from the batch. If only 1 review mentions an issue — it's a one-off, not a pattern. Quote review IDs or short snippets («"мастер опоздал" — 3 раза», «3 отзыва упоминают цену») as evidence. Don't invent patterns.

=== ANTI-FLUFF ===
BANNED phrases: «возможно», «обычно», «в среднем», «попробуйте», «рассмотрите». Each top_action must be concrete and have a deadline («на этой неделе», «до конца месяца»). risk_assessment must be honest — low/medium/high — with a one-sentence reason citing actual counts.

Respond STRICTLY as JSON (no markdown, no preface):
{
  "overview": "<1-2 sentences summary of the situation>",
  "patterns": [
    {"title": "<short label>", "description": "<what's happening + why>"}
  ],
  "top_actions": [
    "<concrete action #1, prioritized>",
    "<action #2>",
    "<action #3>"
  ],
  "segments": [
    {"name": "<group label>", "approach": "<how to talk to / what to offer this group>"}
  ],
  "risk_assessment": "<honest risk level (low/medium/high) and 1-sentence why>"
}`
}

async function claudeJson(system: string, prompt: string): Promise<Record<string, unknown>> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 4096,
      system,
      messages: [{ role: 'user', content: prompt }],
    }),
  })
  if (!res.ok) throw new Error(`claude ${res.status}: ${await res.text()}`)
  const data = await res.json()
  const block = data.content?.[0]
  if (block?.type !== 'text') throw new Error('claude non-text response')
  const text = (block.text as string).trim()
  const match = text.match(/\{[\s\S]*\}/)
  if (!match) throw new Error('claude returned non-json')
  return JSON.parse(match[0]) as Record<string, unknown>
}

type ReviewRow = {
  id: string
  source: 'internal' | 'booksy' | 'google'
  rating: number | null
  body: string | null
  author_name: string | null
  posted_at: string
  service_label?: string | null
  staff_label?: string | null
  client_label?: string | null
  visit_at?: string | null
}

function renderReviewForPrompt(r: ReviewRow): string {
  const lines = [
    `[id: ${r.id}]`,
    `Source: ${r.source}`,
    `Rating: ${r.rating ?? 'n/a'}`,
    `Date: ${r.posted_at}`,
    `Author: ${r.author_name ?? 'Anonymous'}`,
  ]
  if (r.client_label) lines.push(`Client (real name from CRM): ${r.client_label}`)
  if (r.service_label) lines.push(`Service: ${r.service_label}`)
  if (r.staff_label) lines.push(`Master: ${r.staff_label}`)
  if (r.visit_at) lines.push(`Visit date/time: ${r.visit_at}`)
  lines.push(`Text: ${r.body ?? '(no text)'}`)
  return lines.join('\n')
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return preflight()
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)
  if (!SUPABASE_URL || !SERVICE_KEY || !ANTHROPIC_KEY) {
    return json({ error: 'function_not_configured' }, 500)
  }

  const user = await getUserFromRequest(req, SUPABASE_URL, SERVICE_KEY)
  if (!user) return json({ error: 'unauthorized' }, 401)

  let body: {
    salon_id?: string
    scope?: Scope
    review_id?: string
    locale?: string
    reply_locale?: string
    force?: boolean
  }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return json({ error: 'invalid_json' }, 400)
  }
  if (!body.salon_id || !body.scope) return json({ error: 'bad_request' }, 400)
  const locale = normalizeLocale(body.locale)
  const replyLocale = normalizeReplyLocale(body.reply_locale)

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  // RLS-check: salon member
  const { data: member } = await admin
    .from('salon_members')
    .select('user_id')
    .eq('salon_id', body.salon_id)
    .eq('user_id', user.userId)
    .maybeSingle()
  if (!member) return json({ error: 'forbidden' }, 403)

  // --- Загружаем отзывы под scope ---
  let reviews: ReviewRow[] = []
  if (body.scope === 'single') {
    if (!body.review_id) return json({ error: 'review_id_required' }, 400)
    const { data: r } = await admin
      .from('reviews')
      .select('id, source, rating, body, author_name, posted_at, staff_id, visit_id, client_id')
      .eq('id', body.review_id)
      .eq('salon_id', body.salon_id)
      .maybeSingle()
    if (!r) return json({ error: 'review_not_found' }, 404)
    let staffLabel: string | null = null
    let serviceLabel: string | null = null
    if (r.staff_id) {
      const { data: s } = await admin
        .from('staff')
        .select('full_name')
        .eq('id', r.staff_id)
        .maybeSingle()
      staffLabel = s?.full_name ?? null
    }
    let visitAt: string | null = null
    let clientLabel: string | null = null
    if (r.visit_id) {
      const { data: v } = await admin
        .from('visits')
        .select('visit_at, service_name_snapshot')
        .eq('id', r.visit_id)
        .maybeSingle()
      if (v) {
        visitAt = (v as { visit_at: string }).visit_at
        serviceLabel =
          (v as { service_name_snapshot: string | null }).service_name_snapshot ?? serviceLabel
      }
      if (!serviceLabel) {
        const { data: vi } = await admin
          .from('visit_items')
          .select('label')
          .eq('visit_id', r.visit_id)
          .limit(1)
        serviceLabel = vi?.[0]?.label ?? null
      }
    }
    if (r.client_id) {
      const { data: c } = await admin
        .from('clients')
        .select('name')
        .eq('id', r.client_id)
        .maybeSingle()
      clientLabel = (c as { name: string | null } | null)?.name ?? null
    }
    reviews = [
      {
        id: r.id,
        source: r.source,
        rating: r.rating,
        body: r.body,
        author_name: r.author_name,
        posted_at: r.posted_at,
        staff_label: staffLabel,
        service_label: serviceLabel,
        client_label: clientLabel,
        visit_at: visitAt,
      },
    ]
  } else {
    let q = admin
      .from('reviews')
      .select('id, source, rating, body, author_name, posted_at')
      .eq('salon_id', body.salon_id)
      .order('posted_at', { ascending: false })
      .limit(50)
    if (body.scope === 'negative_external') {
      q = q.neq('source', 'internal').lt('rating', 5).is('read_at', null)
    } else if (body.scope === 'internal_all') {
      q = q.eq('source', 'internal')
    } else if (body.scope === 'internal_unread') {
      q = q.eq('source', 'internal').is('read_at', null)
    }
    const { data, error } = await q
    if (error) return json({ error: error.message }, 500)
    reviews = (data ?? []) as ReviewRow[]
  }

  if (reviews.length === 0) {
    return json({ error: 'no_reviews_for_scope', scope: body.scope }, 404)
  }

  // --- payload_hash от нормализованных данных ---
  const normalized = reviews
    .map((r) => `${r.id}|${r.rating ?? ''}|${(r.body ?? '').trim()}`)
    .sort()
    .join('||')
  const payloadHash = await sha256Hex(
    `${body.scope}|${locale}|${replyLocale ?? 'auto'}|${normalized}`,
  )

  // --- Кеш ---
  // payload_hash уже включает replyLocale, поэтому смена языка ответа
  // даёт другой hash и попадает в miss.
  if (!body.force) {
    let cacheQ = admin
      .from('review_ai_analyses')
      .select('content, created_at, model')
      .eq('salon_id', body.salon_id)
      .eq('scope', body.scope)
      .eq('locale', locale)
      .eq('payload_hash', payloadHash)
      .order('created_at', { ascending: false })
      .limit(1)
    if (body.scope === 'single') {
      cacheQ = cacheQ.eq('review_id', reviews[0].id)
    }
    const { data: cached } = await cacheQ
    if (cached && cached.length > 0) {
      return json({ cached: true, ...cached[0] })
    }
  }

  // --- Генерируем ---
  let system: string
  if (body.scope === 'single') {
    system =
      reviews[0].source === 'internal'
        ? systemSingleInternal(locale, replyLocale)
        : systemSingleExternal(locale, replyLocale)
  } else {
    system = systemBulk(locale, body.scope, replyLocale)
  }

  // Лимит длины отзыва — иначе bulk с 50 лонгридами на 3к символов уносит за лимит токенов.
  const MAX_BODY = 800
  const trimmedReviews = reviews.map((r) => ({
    ...r,
    body: r.body && r.body.length > MAX_BODY ? r.body.slice(0, MAX_BODY) + '…' : r.body,
  }))

  // Финальное напоминание языка в самом user-prompt — Claude чаще слушает
  // последнюю инструкцию, особенно при не-локальном input.
  const langReminder = {
    ru: 'Финальное напоминание: ВЕСЬ анализ — НА РУССКОМ языке.',
    pl: 'Końcowe przypomnienie: CAŁA analiza — PO POLSKU.',
    en: 'Final reminder: ALL analysis MUST be in English.',
  }[locale]

  const userPrompt =
    body.scope === 'single'
      ? `Analyze this single review:\n\n${renderReviewForPrompt(trimmedReviews[0])}\n\n${langReminder}`
      : `Analyze these ${trimmedReviews.length} reviews together:\n\n${trimmedReviews
          .map(renderReviewForPrompt)
          .join('\n---\n')}\n\n${langReminder}`

  let content: Record<string, unknown>
  try {
    content = await claudeJson(system, userPrompt)
  } catch (e) {
    console.error('reviews-ai-analyze claude error', e)
    return json(
      {
        error: 'claude_failed',
        detail: e instanceof Error ? e.message : String(e),
      },
      502,
    )
  }

  // --- Сохраняем в кеш ---
  const { error: insertErr } = await admin.from('review_ai_analyses').insert({
    salon_id: body.salon_id,
    review_id: body.scope === 'single' ? reviews[0].id : null,
    scope: body.scope,
    payload_hash: payloadHash,
    model: MODEL,
    locale,
    content,
  })
  if (insertErr) {
    // Не критично — анализ уже сгенерён, но логируем
    console.warn('review_ai_analyses insert failed:', insertErr.message)
  }

  return json({ cached: false, content, model: MODEL })
})
