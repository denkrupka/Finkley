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
    ru: 'Отвечай ИСКЛЮЧИТЕЛЬНО на русском.',
    pl: 'Odpowiadaj WYŁĄCZNIE po polsku.',
    en: 'Reply ONLY in English.',
  }[locale]
  const ownerVoice = {
    ru: 'от первого лица владельца («Помоги мне ...»)',
    pl: 'w pierwszej osobie właściciela („Pomóż mi ...")',
    en: 'in the first person of the owner ("Help me ...")',
  }[locale]
  return `You are a senior financial consultant for beauty salons with 8+ years of hands-on experience advising salon owners in Poland and the EU. You've personally turned around dozens of underperforming salons by reading their numbers, spotting leaks, and giving the owner ONE concrete action they could do this week. You speak like an experienced operator — not like a textbook. ${langInstruction}

=== GROUNDING (CRITICAL) ===
You analyze ONLY the real numbers in the payload below. NEVER invent services, masters, clients, or amounts that aren't in the data. If the payload is empty or has too few data points to draw a conclusion — say it honestly in the insight body: «Недостаточно данных за этот период — попробуйте расширить диапазон или добавить визитов/расходов за последние 30 дней». No fabricated stats. No industry-average benchmarks unless they're explicitly in the data.

=== ANTI-WATER (CRITICAL) ===
BANNED phrases (do NOT use, ever): «возможно», «попробуйте», «в среднем по отрасли», «обычно», «как правило», «рассмотрите», «стоило бы подумать», «может быть полезно», «вероятно», «как известно». These are filler. Each insight must contain at least ONE concrete number from the payload (amount, %, count, name) and ONE concrete action with a deadline («на этой неделе», «до пятницы», «в течение 3 дней»).

=== TONE ===
You're a confident senior consultant, not a chatbot. Be direct. Name names. Quote amounts. If something is bad — say it's bad. If something is great — say it's great. Don't hedge.

=== OUTPUT FORMAT — STRICTLY JSON ===
{
  "insights": [
    {
      "title": "<headline with concrete data, up to 80 chars, e.g. «Маникюр приносит 47% выручки — но мастер Анна перегружена»>",
      "body": "<2-3 sentences. Open with the concrete number/name. Then the diagnosis. Close with ONE specific action and deadline. Use markdown: **bold** for key numbers and names. Start with relevant emoji: 📊 для выручки/визитов, ⚠️ для риска/просадки, ✅ для роста/успеха, 💰 для денег, 👥 для клиентов, ✂️ для услуг, 🎯 для рекомендации.>",
      "action_prompt": "<question to the AI assistant, ${ownerVoice}, that drills into the specific data point — e.g. «Помоги мне разобраться, почему мастер Анна перегружена в маникюре и как перераспределить нагрузку»>"
    }
  ]
}

JSON only — no markdown wrapper, no explanations around it.
Return 3-5 insights, ranked by business impact (most impactful first).`
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
  return `=== REAL SALON SERVICES DATA (JSON) ===
${JSON.stringify(payload, null, 2)}
=== END DATA ===

Analyze ONLY these services with these exact names and numbers. Do NOT invent services.

Look for:
1. **Top revenue earner** — name the specific service, its revenue, its % of total. Action: how to defend/scale it.
2. **Top by margin** (price minus cost if cost data is present) — name service + concrete margin number. Action: where to upsell.
3. **Growing demand signal** — service with rising visit count. Action: increase availability/price/promotion.
4. **Dead weight** — service with low revenue AND low visits. Action: discontinue or rework — give a specific deadline.

Each insight MUST name the specific service from the data and quote its exact number. If only one service exists in payload — say so honestly and recommend adding more variety. If payload.services is empty — return one insight: «Недостаточно данных по услугам за этот период».`
}

function promptForClients(payload: unknown): string {
  return `=== REAL SALON CLIENTS DATA (JSON) ===
${JSON.stringify(payload, null, 2)}
=== END DATA ===

Analyze ONLY these clients with their actual visit history and revenue. Do NOT invent clients or made-up segments.

Look for:
1. **Lost VIP** — name a specific client who used to spend big and stopped coming. Quote their total revenue and days since last visit. Action: personal message with a concrete offer this week.
2. **Acquisition channel that works** — if data shows referral sources, name the best-performing one with its conversion %. Action: double down on it.
3. **Loyal regulars at risk** — clients with 3+ visits whose frequency is dropping. Name 2-3 of them. Action: how to keep them.
4. **New-but-not-returning** — count clients who came once and didn't come back in 30+ days. Action: a re-engagement message with a specific hook.

Each insight MUST name a specific client (or count) and quote real numbers. If payload.clients is empty — return one insight: «Недостаточно данных по клиентам — нужно минимум 10 визитов за период чтобы делать выводы».`
}

function promptForServiceMatch(payload: unknown): string {
  return `You are matching salon service names between our salon and competitors.
Names vary: "manicure" vs "Маникюр с гель-лаком" — these are the SAME core service.
"manicure" vs "manicure express" — also same family.
"manicure" vs "pedicure" — DIFFERENT (different body part).
"hair cut" vs "Strzyżenie męskie" — same (Polish for haircut).
"depilation" vs "массаж" — different.

Payload (JSON):
${JSON.stringify(payload, null, 2)}

For EACH of our services, return matches across competitors. Even partial matches count
if the core treatment is the same (a competitor's "manicure + gel polish" matches our
"manicure" — gel is a variant of the same service).

Respond STRICTLY as JSON (no markdown, no preface):
{
  "matches": [
    {
      "our_service": "<exact name from our_services>",
      "competitors": [
        {
          "competitor_id": "<id from input>",
          "competitor_service": "<exact name from their list>",
          "confidence": "high" | "medium" | "low",
          "reason": "<1 short sentence why this matches>"
        }
      ]
    }
  ]
}

Only include matches where confidence is high or medium. If no competitor has a match
for a given our_service — return empty "competitors" array. Be strict — do NOT match
different treatments just because the words look similar.`
}

function promptForCompetitorsPrices(payload: unknown): string {
  return `=== REAL PRICING DATA: OUR SALON vs COMPETITORS (JSON) ===
${JSON.stringify(payload, null, 2)}
=== END DATA ===

Analyze ONLY these services with these exact prices. Do NOT invent prices or competitors.

Look for:
1. **OVERPRICED service** — name our service where our price is significantly higher than competitor avg. Quote both numbers and the % gap. Action: lower to specific amount OR justify with premium positioning (concrete proof).
2. **UNDERPRICED service** — name our service where competitors charge meaningfully more. Quote both numbers. Action: raise to specific amount by specific date.
3. **Unique service** — service we offer that no competitor has. Action: how to market it as USP.
4. **Pricing strategy gap** — if our prices are scattered (some premium, some bargain), name the inconsistency. Action: pick one positioning.

Each insight MUST quote actual zł amounts from the data (e.g. «поднять Маникюр гибрид с **120 zł** до **140 zł** до конца недели — у 3 из 5 конкурентов средняя цена **150 zł**»). If payload has fewer than 3 competitors or fewer than 5 matched services — say: «Недостаточно данных для уверенного сравнения цен — добавьте больше конкурентов в /competitors».`
}

function promptForCompetitorsContent(payload: unknown): string {
  return `=== REAL SOCIAL MEDIA DATA: OUR SALON vs COMPETITORS (JSON) ===
${JSON.stringify(payload, null, 2)}
=== END DATA ===

Analyze ONLY these accounts with their actual follower/posts numbers. Do NOT invent stats.

Look for:
1. **Followers gap** — name the competitor with the most followers vs us. Quote both numbers and the gap. Action: concrete content tactic to close it (e.g. «постить **3 reels в неделю** — у @competitor так и **+850 подписчиков за месяц**»).
2. **Posting frequency mismatch** — if our posts_per_month is significantly different from competitor avg, flag it. Action: specific target (e.g. «поднять с 4 до 12 постов в месяц до конца месяца»).
3. **Bad signal** — if we follow more than we have followers (или сильный перекос following/followers), flag it as «выглядит как фейк». Action: отписаться от X аккаунтов.
4. **Benchmark account** — name the competitor with the best engagement-per-follower ratio. Action: что повторить (тип контента, частота, время постинга).

Each insight MUST name the specific competitor handle and quote real follower/post counts. If payload has < 3 competitors or no social data for own salon — say: «Недостаточно данных по соцсетям — подключите Instagram в /settings/integrations».`
}

function promptForCompetitorsOccupancy(payload: unknown): string {
  return `=== REAL OCCUPANCY DATA: 7-DAY FREE SLOTS PER COMPETITOR (JSON) ===
${JSON.stringify(payload, null, 2)}
=== END DATA ===

Field meanings (read carefully):
  - free_slots_7d: bookable slots competitor has free in next 7 days
  - days_with_slots: days (0..7) with at least one free slot
  - staff_count: masters performing this service
  - duration_min: service duration

Decision rules:
  - Many free slots + 5-7 days_with_slots = UNDERLOADED competitor → we can poach their clients on convenience
  - Few free slots + 0-2 days_with_slots = BOOKED competitor → either learn from them OR catch their overflow
  - 0 days_with_slots = closed booking or fully booked → opportunity for us right now

Analyze ONLY these competitors with these exact numbers. Do NOT invent.

Look for:
1. **OUR WIN** — service where competitors are booked solid AND we have slots. Name competitor + service + free_slots count. Action: marketing message «у нас есть слот на этой неделе» on Instagram by specific date.
2. **OUR LOSS** — service where competitors have more days_with_slots than us. Name competitor + concrete diagnosis (более 1 мастер? больше часов?). Action: specific operational change.
3. **HIGH-DEMAND SERVICE** — service where ALL competitors have < 2 days_with_slots → market is hot. Action: raise our price OR add a master in that service.
4. **OUR USP** — service where we have free_slots_7d > 10 and competitors avg < 5 → flag «always available» as positioning.

Each insight MUST quote specific competitor name + specific service + actual slot numbers. If payload has no occupancy data or fewer than 2 competitors with valid slot data — say: «Недостаточно данных по загрузке — Booksy не сгенерил расписание для большинства конкурентов».`
}

function promptForCompetitorsRating(payload: unknown): string {
  return `=== REAL RATINGS DATA: BOOKSY + GOOGLE (JSON) ===
${JSON.stringify(payload, null, 2)}
=== END DATA ===

Analyze ONLY these rating values and review counts. Do NOT invent ratings.

Look for:
1. **BELOW AREA AVERAGE** — source (Booksy/Google) where our rating is lower than competitor median. Quote our rating, the median, and the gap (e.g. «**4.3** против медианы **4.7**»). Action: specific fix this month (например «попросить **5** текущих лояльных клиентов оставить отзыв на Google — поднимет с **4.3** до **4.5**»).
2. **OUR EDGE** — source where we beat all competitors. Quote numbers. Action: use it in Instagram bio / website hero text.
3. **PLATFORM IMBALANCE** — if Booksy review count is 10x more than Google (or vice versa), flag it. Action: SMS-template to ask the next 10 happy clients to leave a Google review.
4. **SUSPICIOUS COMPETITOR** — competitor with 5.0 rating and < 20 reviews → likely fake/bought reviews. Note: «не равняемся, продолжаем органику».

Each insight MUST quote actual rating values and review counts. If we have < 5 reviews on a platform — say: «**3 отзыва** — статистически не значимо, нужно минимум **20** для уверенных выводов».`
}

function promptForStaff(payload: unknown): string {
  return `=== REAL SALON STAFF DATA (JSON) ===
${JSON.stringify(payload, null, 2)}
=== END DATA ===

Analyze ONLY these masters with their actual revenue and visit counts. Do NOT invent masters.

Look for:
1. **Top earner** — name the master, their revenue, their % of total salon revenue. Action: concrete retention move (bonus amount, rate raise %, student to train).
2. **Underperformer at risk** — master with < 50% of top earner's revenue. Name them, quote both numbers. Action: training, redistribute clients, or honest conversation — pick one with a deadline.
3. **Utilization gap** — if schedule data is present, name the master whose actual visits / scheduled hours is lowest. Action: how to fill the gap.
4. **Revenue concentration risk** — if 1 master generates > 40% of revenue, flag it as a single-point-of-failure. Action: what to do if they leave.

Each insight MUST name the specific master from the data and quote their real revenue. If payload.staff has only 1 master — say it honestly: «Один мастер — рисков перегрузки и зависимости много, нужен второй до конца квартала». If empty — return: «Недостаточно данных по мастерам».`
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
    case 'service_match':
      prompt = promptForServiceMatch(body.payload)
      break
    case 'competitors_prices':
      prompt = promptForCompetitorsPrices(body.payload)
      break
    case 'competitors_occupancy':
      prompt = promptForCompetitorsOccupancy(body.payload)
      break
    case 'competitors_content':
      prompt = promptForCompetitorsContent(body.payload)
      break
    case 'competitors_rating':
      prompt = promptForCompetitorsRating(body.payload)
      break
    default:
      return json({ error: 'unknown_kind' }, 400)
  }

  try {
    const result = await claudeJson(systemForLocale(locale), prompt)
    if (body.kind === 'service_match') {
      // У service_match другая схема ответа — пропускаем через как есть.
      if (!Array.isArray((result as unknown as { matches?: unknown }).matches)) {
        return json({ error: 'invalid_claude_response' }, 502)
      }
      return json(result)
    }
    if (!Array.isArray(result.insights)) {
      return json({ error: 'invalid_claude_response' }, 502)
    }
    return json(result)
  } catch (e) {
    console.error('ai-report-insights', e)
    return json({ error: e instanceof Error ? e.message : String(e) }, 500)
  }
})
