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

function systemForLocale(locale: 'ru' | 'pl' | 'en'): string {
  const langInstruction = {
    ru: 'На русском, кратко, без воды, по-деловому.',
    pl: 'Po polsku, zwięźle, bez lania wody, rzeczowo.',
    en: 'In English, concise, no fluff, business-like.',
  }[locale]
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

function buildPrompt(payload: OnboardingPayload): string {
  return `Owner's onboarding state (JSON):
${JSON.stringify(
  {
    salon_type: payload.salon_type ?? 'unknown',
    country: payload.country ?? 'PL',
    integrations: payload.integrations ?? [],
    masters_count: payload.masters_count ?? 0,
    services_count: payload.services_count ?? 0,
    has_google_place: !!payload.has_google_place,
    company_name: payload.company_name || null,
    ocr_visits_count: payload.ocr_visits_count ?? 0,
  },
  null,
  2,
)}

Generate 3-4 insights tailored to what the owner has actually entered. Reference specific numbers (e.g. "your team of {N} masters", "{X} services in your catalog") and integrations they picked. Skip generic advice they didn't enable.`
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
      max_tokens: 1000,
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
  return JSON.parse(match[0]) as { insights: Insight[] }
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
  try {
    const result = await claudeJson(systemForLocale(locale), buildPrompt(payload))
    return json(result)
  } catch (e) {
    return json({ error: 'ai_failed', detail: e instanceof Error ? e.message : String(e) }, 502)
  }
})
