/**
 * ai-onboarding-preview — реальный AI-анализ на WOW-шаге онбординга.
 *
 * Принимает «данные с шагов» (salon_type, country, integrations, masters_count,
 * services_count, company_name, has_google_place, ocr_visits_count) — БЕЗ
 * salon_id (салон ещё не создан). Возвращает {insights: [{title, body}]} —
 * 3-4 кратких выгоды на основе того, что юзер уже ввёл.
 *
 * Это не «приснимок реальных финансов» (для этого нужен импорт визитов),
 * а «что AI рекомендует сделать первым» исходя из контекста салона.
 *
 * Модель: Claude Haiku 4.5 (быстрый, дешёвый).
 * Auth: любой залогиненный юзер.
 */

import { getUserFromRequest } from '../_shared/auth.ts'
import { corsHeaders, preflight } from '../_shared/cors.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const ANTHROPIC_KEY = Deno.env.get('ANTHROPIC_API_KEY') ?? ''

type Insight = {
  /** Иконка-якорь: 'staff' | 'services' | 'bookings' | 'banking' | 'social' | 'google' | 'company' | 'general'. */
  icon: string
  /** Headline (1 фраза до 60 символов). */
  title: string
  /** Что AI рекомендует делать или что подтянется (1-2 предложения). */
  body: string
}

type OnboardingPayload = {
  salon_type?: string
  country?: string
  integrations?: string[]
  masters_count?: number
  services_count?: number
  has_google_place?: boolean
  has_nip?: boolean
  company_name?: string
  ocr_visits_count?: number
  locale?: string
  /** T144 — режим ответа:
   *   - 'insights' (default) — 3-4 короткие карточки для StepWowAi
   *   - 'full_summary' — overview + список советов с приоритетом для StepAiSummary
   */
  mode?: 'insights' | 'full_summary'
  /** D1+ — если early-create salon уже произошёл, передаём salon_id.
   *  Edge function подгружает реальные данные (visits/staff/services/
   *  clients/integrations) из БД и подаёт Claude'у в prompt. */
  salon_id?: string
}

/** D1+ — реальные данные из БД для конкретного salon_id. */
type SalonRealData = {
  visits_total: number
  visits_last_7d: number
  revenue_total_cents: number
  staff_total: number
  services_total: number
  clients_total: number
  top_services: Array<{ name: string; visits: number }>
  top_staff: Array<{ name: string; visits: number }>
  connected_integrations: string[]
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'content-type': 'application/json' },
  })
}

function normalizeLocale(input: unknown): 'ru' | 'pl' | 'en' {
  if (typeof input !== 'string') return 'ru'
  const base = input.split('-')[0]?.toLowerCase()
  if (base === 'pl') return 'pl'
  if (base === 'en') return 'en'
  return 'ru'
}

function systemForLocale(locale: 'ru' | 'pl' | 'en', mode: 'insights' | 'full_summary'): string {
  const langInstruction = {
    ru: 'На русском, кратко, без воды, по-деловому.',
    pl: 'Po polsku, zwięźle, bez lania wody, rzeczowo.',
    en: 'In English, concise, no fluff, business-like.',
  }[locale]
  if (mode === 'full_summary') {
    return `You are an onboarding assistant for the Finkley beauty-salon management app. ${langInstruction}

Based on the data the owner has entered, deliver a holistic summary of the salon + 4-6 specific pieces of actionable advice prioritized.

Response format — STRICTLY JSON:
{
  "overview": "<2-4 sentences summarizing what you understood about the salon>",
  "advice": [
    {
      "title": "<headline up to 60 chars>",
      "body": "<1-2 sentences with a concrete recommendation>",
      "priority": "high" | "medium" | "low"
    }
  ]
}

JSON only, no markdown, no preface. Sort advice by priority (high first).
Reference specific numbers from input (masters count, services count, integrations).`
  }
  return `You are an onboarding assistant for the Finkley beauty-salon management app. ${langInstruction}

Based on the data the owner has entered (salon type, integrations chosen, masters/services counts), generate 3-4 concrete insights about what AI will do for them right after the salon is created. Each insight = one icon-anchored card.

Response format — STRICTLY JSON:
{
  "insights": [
    {
      "icon": "staff" | "services" | "bookings" | "banking" | "social" | "google" | "company" | "general",
      "title": "<headline up to 60 chars>",
      "body": "<1-2 sentences with a concrete promise>"
    }
  ]
}

JSON only, no markdown, no preface. Return 3-4 insights.
Pick icons that match: staff for masters, services for catalog, bookings for Booksy/calendar, banking for PSD2, social for IG/FB/Telegram, google for Google Place, company for NIP.`
}

function buildPrompt(payload: OnboardingPayload, real: SalonRealData | null): string {
  const state = {
    salon_type: payload.salon_type ?? 'unknown',
    country: payload.country ?? 'PL',
    integrations: payload.integrations ?? [],
    masters_count: payload.masters_count ?? 0,
    services_count: payload.services_count ?? 0,
    has_google_place: !!payload.has_google_place,
    company_name: payload.company_name || null,
    ocr_visits_count: payload.ocr_visits_count ?? 0,
  }
  const realBlock = real
    ? `\n\nReal data fetched from the salon's DB right now (use these as ground truth, they override estimates from onboarding state):
${JSON.stringify(real, null, 2)}`
    : ''
  return `Owner's onboarding state (JSON):
${JSON.stringify(state, null, 2)}${realBlock}

Generate 3-4 insights tailored to what the owner has actually entered. Reference specific numbers (e.g. "your team of {N} masters", "{X} services in your catalog") and integrations they picked. Skip generic advice they didn't enable.${real ? ' Prefer real numbers from the DB over onboarding estimates.' : ''}`
}

/** D1+ — pulls live data from Supabase REST API using service role.
 *  Возвращает null если salon_id невалидный или юзер не имеет доступа
 *  (verified via salon_members). */
async function fetchRealData(salonId: string, userId: string): Promise<SalonRealData | null> {
  const headers = {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    'content-type': 'application/json',
  }

  const memRes = await fetch(
    `${SUPABASE_URL}/rest/v1/salon_members?select=role&salon_id=eq.${salonId}&user_id=eq.${userId}&limit=1`,
    { headers },
  )
  const memJson = (await memRes.json()) as Array<{ role: string }>
  if (!Array.isArray(memJson) || memJson.length === 0) return null

  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()

  async function getCount(table: string, filter = ''): Promise<number> {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/${table}?select=id&salon_id=eq.${salonId}${filter}`,
      { headers: { ...headers, Prefer: 'count=exact', Range: '0-0' } },
    )
    const range = r.headers.get('content-range') ?? ''
    const m = range.match(/\/(\d+)$/)
    return m ? Number(m[1]) : 0
  }

  async function sumRevenue(): Promise<number> {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/visits?select=amount_cents&salon_id=eq.${salonId}&status=eq.paid&limit=10000`,
      { headers },
    )
    const rows = (await r.json()) as Array<{ amount_cents: number }>
    if (!Array.isArray(rows)) return 0
    return rows.reduce((acc, x) => acc + (x.amount_cents ?? 0), 0)
  }

  async function topServices(): Promise<Array<{ name: string; visits: number }>> {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/visits?select=service_name_snapshot&salon_id=eq.${salonId}&limit=5000`,
      { headers },
    )
    const rows = (await r.json()) as Array<{ service_name_snapshot: string | null }>
    if (!Array.isArray(rows)) return []
    const tally = new Map<string, number>()
    for (const v of rows) {
      const name = v.service_name_snapshot?.trim()
      if (!name) continue
      tally.set(name, (tally.get(name) ?? 0) + 1)
    }
    return Array.from(tally.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, visits]) => ({ name, visits }))
  }

  async function topStaff(): Promise<Array<{ name: string; visits: number }>> {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/visits?select=staff_id,staff:staff_id(full_name)&salon_id=eq.${salonId}&limit=5000`,
      { headers },
    )
    const rows = (await r.json()) as Array<{
      staff_id: string | null
      staff: { full_name: string } | null
    }>
    if (!Array.isArray(rows)) return []
    const tally = new Map<string, number>()
    for (const v of rows) {
      const name = v.staff?.full_name?.trim()
      if (!name) continue
      tally.set(name, (tally.get(name) ?? 0) + 1)
    }
    return Array.from(tally.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, visits]) => ({ name, visits }))
  }

  async function connectedIntegrations(): Promise<string[]> {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/salon_integrations?select=provider,status&salon_id=eq.${salonId}`,
      { headers },
    )
    const rows = (await r.json()) as Array<{ provider: string; status: string }>
    if (!Array.isArray(rows)) return []
    return rows.filter((r) => r.status !== 'disconnected').map((r) => r.provider)
  }

  const [
    visits_total,
    visits_last_7d,
    revenue_total_cents,
    staff_total,
    services_total,
    clients_total,
    top_services,
    top_staff,
    connected_integrations,
  ] = await Promise.all([
    getCount('visits'),
    getCount('visits', `&visit_at=gte.${since}`),
    sumRevenue(),
    getCount('staff'),
    getCount('services'),
    getCount('clients'),
    topServices(),
    topStaff(),
    connectedIntegrations(),
  ])

  return {
    visits_total,
    visits_last_7d,
    revenue_total_cents,
    staff_total,
    services_total,
    clients_total,
    top_services,
    top_staff,
    connected_integrations,
  }
}

async function claudeJson(system: string, prompt: string): Promise<unknown> {
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
  const match = text.match(/\{[\s\S]*\}/)
  if (!match) throw new Error('claude returned non-json')
  return JSON.parse(match[0])
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return preflight()
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  const user = await getUserFromRequest(req, SUPABASE_URL, SERVICE_KEY)
  if (!user) return json({ error: 'unauthorized' }, 401)

  if (!ANTHROPIC_KEY) return json({ error: 'anthropic_key_missing' }, 500)

  let payload: OnboardingPayload
  try {
    payload = (await req.json()) as OnboardingPayload
  } catch {
    return json({ error: 'invalid_json' }, 400)
  }

  const locale = normalizeLocale(payload.locale)
  const mode = payload.mode === 'full_summary' ? 'full_summary' : 'insights'

  // D1+ — если есть salon_id и юзер has access — подгружаем реальные данные.
  // Падение fetchRealData не блокирует AI: возвращаем insights только по
  // metadata (legacy mode).
  let real: SalonRealData | null = null
  if (payload.salon_id) {
    try {
      real = await fetchRealData(payload.salon_id, user.id)
    } catch (e) {
      console.warn('fetchRealData failed', e)
    }
  }

  try {
    const result = await claudeJson(systemForLocale(locale, mode), buildPrompt(payload, real))
    return json(result)
  } catch (e) {
    return json({ error: 'ai_failed', detail: e instanceof Error ? e.message : String(e) }, 502)
  }
})
