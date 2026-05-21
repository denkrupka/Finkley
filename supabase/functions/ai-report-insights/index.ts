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

/**
 * SYSTEM prompt параметризован языком вывода. Клиент передаёт locale из своей
 * i18n.language ('ru'/'pl'/'en'). Fallback на 'ru' если не указан или unsupported.
 */
function systemForLocale(locale: 'ru' | 'pl' | 'en'): string {
  const langInstruction = {
    ru: 'На русском, кратко, без воды.',
    pl: 'Po polsku, zwięźle, bez lania wody.',
    en: 'In English, concise, no fluff.',
  }[locale]
  const ownerVoice = {
    ru: 'от первого лица владельца («Помоги мне ...»)',
    pl: 'w pierwszej osobie właściciela („Pomóż mi ...")',
    en: 'in the first person of the owner ("Help me ...")',
  }[locale]
  return `You are a financial consultant for the Finkley beauty salon. ${langInstruction}

Response format — STRICTLY JSON:
{
  "insights": [
    {
      "title": "<headline, 1 phrase up to 80 chars>",
      "body": "<1-3 sentences with a concrete recommendation>",
      "action_prompt": "<question or request to the assistant that elaborates on the topic>"
    }
  ]
}

JSON only, no markdown, no explanations around it.
Return 3-5 insights. Each body — an action, not a description.
action_prompt must be ${ownerVoice}.`
}

function normalizeLocale(input: unknown): 'ru' | 'pl' | 'en' {
  if (typeof input !== 'string') return 'ru'
  const base = input.split('-')[0]?.toLowerCase()
  if (base === 'pl') return 'pl'
  if (base === 'en') return 'en'
  return 'ru'
}

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

// Промпты — на английском с языком ответа в SYSTEM. Так Claude стабильно
// держит требуемую локаль и одну версию prompt-логики на все языки.
function promptForServices(payload: unknown): string {
  return `Salon services data for the selected period (JSON):
${JSON.stringify(payload, null, 2)}

Analyze by service groups (manicure / brows / haircuts / other):
1. Top-3 most sold services by NUMBER of visits.
2. Top-3 most PROFITABLE services by MARGIN (price - cost).
3. Which service to advertise (growing demand or high margin).
4. Where the gaps are — what brings little money and has no demand.

Each insight = short concrete recommendation for the owner.`
}

function promptForClients(payload: unknown): string {
  return `Salon clients data for the selected period (JSON):
${JSON.stringify(payload, null, 2)}

Client analytics:
1. Acquisition channels (analyze sources/referrals if available).
2. Structure: regulars (3+ visits), new without visits, lapsed (>60 days).
3. Whom to target with a mailing campaign, with what offer.
4. Favorite services among clients — promos to suggest based on their interests.

Each insight = specific client segment + what to offer them.`
}

function promptForStaff(payload: unknown): string {
  return `Salon masters data for the selected period (JSON):
${JSON.stringify(payload, null, 2)}

Master analytics:
1. Who earned how much money and served how many clients.
2. Master utilization relative to their schedule (if data available).
3. Each master's share of total salon revenue.
4. Top-masters — recommendations on motivation (bonus, students, rate raise).
5. Underperformers — how to work with them (training, redistribute clients, talk).

Each insight = specific master or group + action.`
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return preflight()
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)
  if (!SUPABASE_URL || !SERVICE_KEY || !ANTHROPIC_KEY) {
    return json({ error: 'function_not_configured' }, 500)
  }

  const user = await getUserFromRequest(req, SUPABASE_URL, SERVICE_KEY)
  if (!user) return json({ error: 'unauthorized' }, 401)

  let body: { salon_id?: string; kind?: string; payload?: unknown; locale?: string }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return json({ error: 'invalid_json' }, 400)
  }
  if (!body.salon_id || !body.kind || !body.payload) {
    return json({ error: 'bad_request' }, 400)
  }
  const locale = normalizeLocale(body.locale)

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
    const result = await claudeJson(systemForLocale(locale), prompt)
    if (!Array.isArray(result.insights)) {
      return json({ error: 'invalid_claude_response' }, 502)
    }
    return json(result)
  } catch (e) {
    console.error('ai-report-insights', e)
    return json({ error: e instanceof Error ? e.message : String(e) }, 500)
  }
})
