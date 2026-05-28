/**
 * ocr-notebook — извлечение визитов из фото блокнота через Claude Vision.
 *
 * Запрос: { image_base64: string, salon_id: string }
 * Ответ: { visits: Array<{ date, client?, service?, amount?, master? }> }
 *
 * Используется в онбординге (StepIntegrationsBookings → опция «Фото
 * блокнота → AI») и в /income/visits → меню «Импорт». Юзер фотографирует
 * страницы блокнота, Claude парсит и возвращает структурированные записи
 * визитов которые потом импортируются как обычные visits.
 *
 * Auth: salon member.
 * Модель: Claude Sonnet 4.6 (нужен vision; haiku-vision хуже на рукописном).
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.6'

import { getUserFromRequest } from '../_shared/auth.ts'
import { corsHeaders, preflight } from '../_shared/cors.ts'
import { withSentry } from '../_shared/sentry.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const ANTHROPIC_KEY = Deno.env.get('ANTHROPIC_API_KEY') ?? ''

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'content-type': 'application/json' },
  })
}

type ParsedVisit = {
  date?: string // YYYY-MM-DD если распознали; иначе оригинальный текст
  client_name?: string
  service?: string
  amount?: number // в основной валюте, не центы
  master?: string
  raw?: string // оригинальный текст строки для отладки
}

const SYSTEM_PROMPT = `You are an OCR + structured-data extractor for a beauty salon notebook.

You receive a photo of a handwritten page (or several) where the owner tracks visits:
date, client name, service name, amount, sometimes master name.

Return STRICT JSON only, no markdown wrappers:
{
  "visits": [
    { "date": "YYYY-MM-DD" | null, "client_name": "..." | null,
      "service": "..." | null, "amount": <number> | null,
      "master": "..." | null, "raw": "<original line>" }
  ]
}

Rules:
- One row in the photo = one item in "visits" array.
- date: if the page header has a date (e.g. "12.05") and individual rows
  don't repeat it — apply that header date to all rows. Convert all
  formats to YYYY-MM-DD; if year is missing, use the current year.
- amount: extract numbers; ignore currency signs.
- If a field is illegible — set it to null but still include the row.
- raw: copy the original line text as-is.
- Maximum 100 visits per response. If page has more — return first 100
  and add { "truncated": true } to root.

JSON only. No commentary.`

async function claudeVision(imageBase64: string): Promise<{ visits: ParsedVisit[] }> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: 'image/jpeg', data: imageBase64 },
            },
            { type: 'text', text: 'Extract visits from this page.' },
          ],
        },
      ],
    }),
  })
  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    throw new Error(`claude ${res.status}: ${errText.slice(0, 400)}`)
  }
  const data = await res.json()
  const block = data.content?.[0]
  if (block?.type !== 'text') throw new Error('claude non-text response')
  const text = (block.text as string).trim()
  const match = text.match(/\{[\s\S]*\}/)
  if (!match) throw new Error('claude no-json response')
  const parsed = JSON.parse(match[0]) as { visits?: ParsedVisit[] }
  return { visits: Array.isArray(parsed.visits) ? parsed.visits : [] }
}

Deno.serve(
  withSentry('ocr-notebook', async (req: Request) => {
    if (req.method === 'OPTIONS') return preflight()
    if (req.method !== 'POST') return jsonResponse({ error: 'method_not_allowed' }, 405)
    if (!SUPABASE_URL || !SERVICE_KEY) {
      return jsonResponse({ error: 'function_not_configured' }, 500)
    }
    if (!ANTHROPIC_KEY) {
      return jsonResponse({ error: 'ai_not_configured' }, 503)
    }

    const userRes = await getUserFromRequest(req)
    if (!userRes.ok) return jsonResponse({ error: 'unauthorized' }, 401)

    let body: { image_base64?: string; salon_id?: string }
    try {
      body = await req.json()
    } catch {
      return jsonResponse({ error: 'invalid_json' }, 400)
    }
    if (!body.image_base64 || !body.salon_id) {
      return jsonResponse({ error: 'missing_fields' }, 400)
    }
    // Sanity-check размера: base64 ~33% больше bytes. Лимит Claude ~5MB
    // изображения; нам достаточно ~2 MB.
    if (body.image_base64.length > 3 * 1024 * 1024) {
      return jsonResponse({ error: 'image_too_large' }, 413)
    }

    // RLS-проверка что юзер — member указанного салона
    const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data: membership } = await admin
      .from('salon_members')
      .select('id')
      .eq('salon_id', body.salon_id)
      .eq('user_id', userRes.user.id)
      .maybeSingle()
    if (!membership) return jsonResponse({ error: 'forbidden' }, 403)

    try {
      const result = await claudeVision(body.image_base64)
      return jsonResponse({ ok: true, ...result })
    } catch (e) {
      console.warn('ocr-notebook claude failed:', e instanceof Error ? e.message : e)
      return jsonResponse({ error: 'ai_failed', detail: String(e).slice(0, 300) }, 502)
    }
  }),
)
