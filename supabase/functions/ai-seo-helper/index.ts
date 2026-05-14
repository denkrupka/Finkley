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
      const system = `Ты — SEO-копирайтер для блога управленческого учёта салонов красоты Finkley.
Пишешь по-русски, для владельцев маленьких салонов (не для финансовых директоров).
Создавай title-теги: 50–60 символов, содержат конкретную пользу, без кликбейта.`
      const prompt = `Контент статьи:\n${plain || '(пусто — придумай хороший title для статьи на тему ниже)'}\n\n${kw ? `Целевое ключевое слово: ${kw}\n\n` : ''}Дай 3 варианта SEO-заголовка. Просто список из 3 строк, без нумерации, без кавычек.`
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
      const system = `Ты — SEO-копирайтер. Пишешь meta description'ы 140–160 символов, по-русски, с пользой и cta «узнайте/разберёмся/посчитаем».`
      const prompt = `Заголовок: ${title}\n\nКонтент:\n${plain || '(пусто — основан только на заголовке)'}\n\nДай ОДНО meta description'у 140-160 символов. Без кавычек, только текст.`
      const description = await claudeMessage(prompt, system, 300)
      return json({ description: description.replace(/^["«]|["»]$/g, '') })
    }

    if (action === 'generate_keywords') {
      const title = (body.title as string) ?? ''
      const plain = htmlToPlain((body.body_html as string) ?? '').slice(0, 4000)
      const system = `Ты — SEO-исследователь. Выделяешь 5–8 целевых ключей для статьи: 1 основной (точная фраза 2-3 слова) и 4–7 LSI/синонимов. По-русски.`
      const prompt = `Заголовок: ${title}\n\nТекст:\n${plain}\n\nВерни ровно JSON-массив строк: ["ключ1","ключ2",...] без markdown.`
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
      const system = `Ты — редактор блога Finkley (учёт салонов). Создаёшь outline статей: 4–7 H2-секций (без H3 если не нужны). По-русски, для не-технарей.`
      const prompt = `Заголовок: ${title}\n${kw ? `Целевое ключевое слово: ${kw}\n` : ''}\nДай outline в виде Markdown — каждая секция начинается с "## " (уровень H2). Без вступления и без заключения — только заголовки секций. 4–7 секций.`
      const outline = await claudeMessage(prompt, system, 600)
      return json({ outline })
    }

    if (action === 'improve_text') {
      const text = (body.text as string) ?? ''
      const instruction =
        (body.instruction as string) ?? 'Сделай яснее и интереснее, сохрани смысл и длину.'
      const system = `Ты — редактор блога Finkley. Пишешь по-русски, без канцелярита и воды, разговорным языком но без сленга. Сохраняешь HTML-теги если они есть.`
      const prompt = `Инструкция: ${instruction}\n\nТекст:\n${text}\n\nВерни ТОЛЬКО улучшенный текст, без вступлений.`
      const improved = await claudeMessage(prompt, system, 1500)
      return json({ improved })
    }

    if (action === 'suggest_topics') {
      const kw = (body.target_keyword as string) ?? ''
      const system = `Ты — content-стратег Finkley. Придумываешь темы для блога управленческого учёта салонов: финансы, маркетинг, операционка, маржа, мастера, клиенты.`
      const prompt = `Тема/keyword: ${kw}\n\nДай 5 идей для статей. Просто список из 5 заголовков, по строке на каждый, без нумерации.`
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
