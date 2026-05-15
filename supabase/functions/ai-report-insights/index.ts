/**
 * ai-report-insights — AI-аналитика для трёх вкладок /reports.
 *
 * Принимает {salon_id, kind, payload}, где kind ∈ services | clients | staff.
 * payload — структурированные данные отчёта (топ позиций, агрегаты).
 * Возвращает {insights: [{title, body, action_prompt}, …]} — массив
 * кратких выводов с заготовленным prompt'ом для AI-помощника.
 *
 * Auth: salon member.
 * Модель: Claude Haiku 4.5 (быстрый, дешёвый).
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

type Insight = {
  /** Короткий заголовок (одна фраза, до 80 символов) */
  title: string
  /** Развёрнутое описание + рекомендация (1-3 предложения) */
  body: string
  /** Готовый prompt для AI-помощника при клике «Что с этим делать?» */
  action_prompt: string
}

const SYSTEM_BASE = `Ты — финансовый консультант салона красоты Finkley. По-русски, кратко, без воды.

Формат ответа — СТРОГО JSON:
{
  "insights": [
    {
      "title": "<заголовок 1 фраза до 80 символов>",
      "body": "<1-3 предложения с конкретной рекомендацией>",
      "action_prompt": "<вопрос или просьба к ассистенту, который раскроет тему детальнее>"
    }
  ]
}

Только JSON, без markdown, без пояснений вокруг.
Возвращай 3-5 insights. Каждый body — действие, а не описание.
action_prompt должен быть от первого лица владельца («Помоги мне ...»).`

async function claudeJson(system: string, prompt: string): Promise<{ insights: Insight[] }> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1500,
      system,
      messages: [{ role: 'user', content: prompt }],
    }),
  })
  if (!res.ok) throw new Error(`claude ${res.status}: ${await res.text()}`)
  const data = await res.json()
  const block = data.content?.[0]
  if (block?.type !== 'text') throw new Error('claude non-text response')
  const text = (block.text as string).trim()
  // Терпим оборачивающий ```json ... ``` — иногда Claude его добавляет
  const match = text.match(/\{[\s\S]*\}/)
  if (!match) throw new Error('claude returned non-json')
  return JSON.parse(match[0]) as { insights: Insight[] }
}

function promptForServices(payload: unknown): string {
  return `Данные по услугам салона за выбранный период (JSON):
${JSON.stringify(payload, null, 2)}

Сделай аналитику по группам услуг (маникюр / брови / стрижки / прочее):
1. Топ-3 самых продаваемых услуг по КОЛИЧЕСТВУ визитов.
2. Топ-3 самых ВЫГОДНЫХ услуг по МАРЖЕ (разница цена - себестоимость).
3. На какую услугу стоит настроить рекламу (растёт спрос или высокая маржа).
4. Где провисы — что приносит мало денег и не пользуется спросом.

Каждый insight — это короткая конкретная рекомендация владельцу.`
}

function promptForClients(payload: unknown): string {
  return `Данные по клиентам салона за выбранный период (JSON):
${JSON.stringify(payload, null, 2)}

Сделай аналитику по клиентам:
1. Из каких каналов приходят клиенты (анализируй sources/referrals если есть).
2. Структура: постоянные (3+ визитов), новые без визитов, давно не были (>60 дней).
3. На кого настроить рассылку с офферами и каким offer'ом.
4. Какие услуги у клиентов любимые — какие промо предложить под их интересы.

Каждый insight — конкретный сегмент клиентов + что ему предложить.`
}

function promptForStaff(payload: unknown): string {
  return `Данные по мастерам салона за выбранный период (JSON):
${JSON.stringify(payload, null, 2)}

Сделай аналитику по мастерам:
1. Кто сколько денег принёс и сколько клиентов отработал.
2. Какова загрузка мастера относительно его рабочего графика (если есть данные).
3. Какую долю в общей выручке салона занимает каждый.
4. Топ-мастеров — рекомендации как мотивировать (бонус, ученики, рост ставки).
5. Аутсайдеры — рекомендации как с ними работать (тренинги, перераспределение клиентов, разговор).

Каждый insight — конкретный мастер или группа + действие.`
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return preflight()
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)
  if (!SUPABASE_URL || !SERVICE_KEY || !ANTHROPIC_KEY) {
    return json({ error: 'function_not_configured' }, 500)
  }

  const user = await getUserFromRequest(req, SUPABASE_URL, SERVICE_KEY)
  if (!user) return json({ error: 'unauthorized' }, 401)

  let body: { salon_id?: string; kind?: string; payload?: unknown }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return json({ error: 'invalid_json' }, 400)
  }
  if (!body.salon_id || !body.kind || !body.payload) {
    return json({ error: 'bad_request' }, 400)
  }

  // RLS-check: юзер должен быть членом салона
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: member } = await admin
    .from('salon_members')
    .select('user_id')
    .eq('salon_id', body.salon_id)
    .eq('user_id', user.userId)
    .maybeSingle()
  if (!member) return json({ error: 'forbidden' }, 403)

  let prompt: string
  switch (body.kind) {
    case 'services':
      prompt = promptForServices(body.payload)
      break
    case 'clients':
      prompt = promptForClients(body.payload)
      break
    case 'staff':
      prompt = promptForStaff(body.payload)
      break
    default:
      return json({ error: 'unknown_kind' }, 400)
  }

  try {
    const result = await claudeJson(SYSTEM_BASE, prompt)
    if (!Array.isArray(result.insights)) {
      return json({ error: 'invalid_claude_response' }, 502)
    }
    return json(result)
  } catch (e) {
    console.error('ai-report-insights', e)
    return json({ error: e instanceof Error ? e.message : String(e) }, 500)
  }
})
