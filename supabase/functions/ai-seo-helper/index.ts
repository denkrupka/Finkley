/**
 * ai-seo-helper — ИИ-помощник SEO-лаборатории в /admin/media.
 *
 * Доступ: только app_admins (внутренняя фича для команды Finkley).
 * Шлёт запросы в Anthropic Claude Haiku 4.5.
 *
 * Endpoints (через ?action=):
 *   generate_title       { body_html, target_keyword? } → 3 варианта title
 *   generate_description { title, body_html }           → meta description 150-160 chars
 *   generate_keywords    { title, body_html }           → массив 5-8 keywords
 *   generate_outline     { title, target_keyword? }     → outline H2/H3 структура
 *   improve_text         { text, instruction? }        → улучшенный текст
 *   suggest_topics       { target_keyword }            → 5 идей тем статей
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.6'

import { getUserFromRequest } from '../_shared/auth.ts'
import { corsHeaders, preflight } from '../_shared/cors.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const ANTHROPIC_KEY = Deno.env.get('ANTHROPIC_API_KEY') ?? ''

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'content-type': 'application/json' },
  })
}

async function claudeMessage(prompt: string, system?: string, maxTokens = 800): Promise<string> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: prompt }],
    }),
  })
  if (!res.ok) throw new Error(`claude ${res.status}: ${await res.text()}`)
  const data = await res.json()
  const block = data.content?.[0]
  if (block?.type !== 'text') throw new Error('claude non-text response')
  return (block.text as string).trim()
}

/** Strips HTML tags для подсчёта длины / отправки в LLM. */
function htmlToPlain(html: string): string {
  return (html ?? '')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return preflight()
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)
  if (!SUPABASE_URL || !SERVICE_KEY || !ANTHROPIC_KEY) {
    return json({ error: 'function_not_configured' }, 500)
  }

  const user = await getUserFromRequest(req, SUPABASE_URL, SERVICE_KEY)
  if (!user) return json({ error: 'unauthorized' }, 401)

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: a } = await admin
    .from('app_admins')
    .select('user_id')
    .eq('user_id', user.userId)
    .maybeSingle()
  if (!a) return json({ error: 'forbidden' }, 403)

  const url = new URL(req.url)
  const action = url.searchParams.get('action') ?? ''
  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return json({ error: 'invalid_json' }, 400)
  }

  try {
    if (action === 'generate_title') {
      const plain = htmlToPlain((body.body_html as string) ?? '').slice(0, 4000)
      const kw = (body.target_keyword as string)?.trim() ?? ''
      const system = `Ты — SEO-копирайтер с 6+ годами опыта в B2B SaaS для малого бизнеса в Польше и СНГ. Пишешь блог Finkley — это управленческий учёт для владельцев салонов красоты (1–5 мастеров).
Аудитория: владелец салона, не финансист. Читает с телефона в перерыве между клиентами.
Правила title: РОВНО 50–60 символов, содержит конкретную пользу (число, имя проблемы, результат), без кликбейта типа «топ-10 секретов».
ANTI-FLUFF: запрещены слова «возможно», «попробуйте», «в среднем», «обычно», «секреты», «всё что нужно знать». Лучше конкретика: «как», «за 5 минут», «без бухгалтера», «к 25-му числу».
Тон: уверенный, прикладной, как коллега-практик. Никаких «дорогой друг».`
      const prompt = `Контент статьи:\n${plain || '(пусто — придумай хороший title для статьи на тему ниже)'}\n\n${kw ? `Целевое ключевое слово (обязательно включи в title): ${kw}\n\n` : ''}Дай 3 варианта SEO-заголовка. Просто список из 3 строк, без нумерации, без кавычек. Каждый — 50–60 символов.`
      const text = await claudeMessage(prompt, system, 400)
      const titles = text
        .split('\n')
        .map((l) => l.replace(/^[-*\d.)\s"«»]+|["«»\s]+$/g, '').trim())
        .filter((l) => l.length > 0 && l.length < 100)
        .slice(0, 3)
      return json({ titles })
    }

    if (action === 'generate_description') {
      const title = (body.title as string) ?? ''
      const plain = htmlToPlain((body.body_html as string) ?? '').slice(0, 4000)
      const system = `Ты — SEO-копирайтер с 6+ годами опыта. Пишешь meta description'ы РОВНО 140–160 символов для блога Finkley (управленческий учёт салонов красоты).
GROUNDING: meta description опирается ТОЛЬКО на title и контент статьи — не выдумывай факты которых в статье нет.
ANTI-FLUFF: запрещены «возможно», «попробуйте», «в среднем», «секреты», «всё что нужно знать». Каждое description — открывается с проблемы или конкретного бенефита, заканчивается CTA «разберёмся / посчитаем / покажем / научим». Без кликбейта.
Тон: профессиональный, прикладной, без воды.`
      const prompt = `Заголовок: ${title}\n\nКонтент:\n${plain || '(пусто — основан только на заголовке)'}\n\nДай ОДНО meta description РОВНО 140–160 символов. Без кавычек, только текст.`
      const description = await claudeMessage(prompt, system, 300)
      return json({ description: description.replace(/^["«]|["»]$/g, '') })
    }

    if (action === 'generate_keywords') {
      const title = (body.title as string) ?? ''
      const plain = htmlToPlain((body.body_html as string) ?? '').slice(0, 4000)
      const system = `Ты — SEO-исследователь с 6+ годами опыта в семантическом ядре для B2B SaaS малого бизнеса. Анализируешь реальный текст статьи и подбираешь ключи под намерения владельца салона красоты, который гуглит в Польше / СНГ.
GROUNDING: ключи строятся ТОЛЬКО на содержимом статьи — не добавляй темы которых в тексте нет.
Правило: 1 основной ключ (точная фраза 2-3 слова, ровно из текста или близкий синоним) + 4–7 LSI/синонимов и near-related queries. По-русски.
ANTI-FLUFF: никаких слишком общих ключей вроде «бизнес», «деньги», «успех». Конкретика: «учёт расходов салона», «зарплата мастера salon», «маркетплейс косметики».`
      const prompt = `Заголовок: ${title}\n\nТекст:\n${plain}\n\nВерни ровно JSON-массив строк: ["ключ1","ключ2",...] без markdown. 5–8 ключей, первый — основной.`
      const text = await claudeMessage(prompt, system, 300)
      let keywords: string[] = []
      try {
        const m = text.match(/\[[\s\S]*\]/)
        if (m) keywords = JSON.parse(m[0]) as string[]
      } catch {
        keywords = text
          .split(/[,\n]/)
          .map((s) => s.replace(/^[-*"«]+|["»]+$/g, '').trim())
          .filter(Boolean)
          .slice(0, 8)
      }
      return json({ keywords })
    }

    if (action === 'generate_outline') {
      const title = (body.title as string) ?? ''
      const kw = (body.target_keyword as string) ?? ''
      const system = `Ты — главный редактор B2B-блога с 8+ годами опыта в малом бизнесе и SaaS. Создаёшь outline для статей Finkley (управленческий учёт салонов красоты).
Аудитория: владелец салона 1–5 мастеров, читает с телефона, ценит конкретику.
Структура: 4–7 H2-секций. Каждая секция = конкретный практический вопрос или шаг. Сначала «что/зачем» (1 секция), потом «как делать» (2-4 секции с конкретикой), последняя — итог или чеклист.
ANTI-FLUFF: запрещены секции типа «Введение», «Заключение», «Почему это важно». Конкретика: «Как считать маржу мастера», «Шаг 1: запиши все расходы», «Чеклист: что собрать к 25-му числу».
По-русски, без воды.`
      const prompt = `Заголовок: ${title}\n${kw ? `Целевое ключевое слово: ${kw}\n` : ''}\nДай outline в виде Markdown — каждая секция начинается с "## " (уровень H2). Без вступления и без заключения — только заголовки секций. 4–7 секций. Каждая — практический шаг или конкретный вопрос.`
      const outline = await claudeMessage(prompt, system, 600)
      return json({ outline })
    }

    if (action === 'improve_text') {
      const text = (body.text as string) ?? ''
      const instruction =
        (body.instruction as string) ?? 'Сделай яснее и интереснее, сохрани смысл и длину.'
      const system = `Ты — редактор B2B-блога с 8+ годами опыта в малом бизнесе. Редактируешь тексты Finkley (учёт салонов).
GROUNDING: сохраняй ВСЕ факты и числа из исходного текста — ничего не выдумывай, не убирай конкретику, не добавляй своих примеров.
ANTI-FLUFF: убирай «возможно», «попробуйте», «в среднем», «обычно», «как правило», «стоило бы», «дорогой читатель», канцелярит («осуществлять», «производить расчёт»). Заменяй на прямые формулировки.
Сохраняешь HTML-теги если они есть. Сохраняешь markdown **bold** и *italic*. Длину держишь близко к оригиналу (±15%).
Тон: разговорный профессиональный, как коллега-практик. Без слэнга, без снисхождения.`
      const prompt = `Инструкция от автора: ${instruction}\n\nТекст:\n${text}\n\nВерни ТОЛЬКО улучшенный текст, без вступлений, без объяснений.`
      const improved = await claudeMessage(prompt, system, 1500)
      return json({ improved })
    }

    if (action === 'suggest_topics') {
      const kw = (body.target_keyword as string) ?? ''
      const system = `Ты — content-стратег с 8+ годами опыта в B2B SaaS для малого бизнеса. Придумываешь темы блога Finkley (управленческий учёт салонов красоты 1–5 мастеров в Польше / СНГ).
Понимаешь реальные боли владельца: где деньги, кто из мастеров выгоден, как платить честно, как готовиться к налогам, как не упустить лояльных клиентов.
GROUNDING: темы должны быть конкретными и решать конкретную проблему — никаких «10 советов начинающему».
ANTI-FLUFF: запрещены кликбейтные шаблоны типа «Топ-N секретов», «Всё что нужно знать о...», «Эта статья изменит ваш бизнес».
Структура темы: «Как [действие] чтобы [результат]» или «Почему [проблема] и что с этим делать» или «[Конкретный шаблон/чеклист]: [для чего]».`
      const prompt = `Целевой ключ: ${kw}\n\nДай 5 идей статей. Каждая — конкретная боль владельца салона с конкретным результатом. Просто список из 5 заголовков, по строке, без нумерации, без кавычек.`
      const text = await claudeMessage(prompt, system, 400)
      const topics = text
        .split('\n')
        .map((l) => l.replace(/^[-*\d.)\s"«»]+|["«»\s]+$/g, '').trim())
        .filter(Boolean)
        .slice(0, 5)
      return json({ topics })
    }

    return json({ error: 'unknown_action' }, 400)
  } catch (e) {
    console.error('ai-seo-helper', action, e)
    return json({ error: e instanceof Error ? e.message : String(e) }, 500)
  }
})
