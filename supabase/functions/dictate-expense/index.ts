/**
 * dictate-expense — голосовая надиктовка расхода.
 *
 * Принимает audio blob (webm/mp3/wav), отправляет в Groq Whisper-large для
 * транскрипции, потом в Groq Llama-3 для парсинга текста в структуру:
 *   { amount, expense_at, category_guess, vendor_guess, document_number,
 *     comment }
 *
 * Фронт показывает результат и просит юзера проверить (особенно vendor).
 *
 * ENV:
 *   GROQ_API_KEY — Groq API key (Whisper + Llama)
 *
 * Auth: JWT обязателен (вызывается из SPA).
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'

import { corsHeaders, preflight } from '../_shared/cors.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
const GROQ_KEY = Deno.env.get('GROQ_API_KEY') ?? ''

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'content-type': 'application/json' },
  })
}

type ParsedExpense = {
  amount: number | null
  expense_at: string | null
  category_guess: string | null
  vendor_guess: string | null
  document_number: string | null
  comment: string | null
}

const PARSE_PROMPT = `Ты — опытный bookkeeping-аналитик с 8+ годами обработки расходных документов для салонов красоты и розничного бизнеса в Польше. Знаешь типичные категории трат салона (аренда, косметика, реклама на Insta/Booksy, налоги ZUS/PIT, зарплаты, коммуналка, транспорт).

GROUNDING (КРИТИЧНО): извлекай ТОЛЬКО то что владелец явно сказал в надиктовке. НИКОГДА не выдумывай суммы, vendor, дату или номер документа. Если поля не прозвучало — null. Если сумма звучит неуверенно («где-то сто… или двести») — null лучше чем неверная.
ANTI-FLUFF: не комментируй, не объясняй, не пиши preface — только JSON.

Задача: тебе дана текстовая транскрипция голосовой надиктовки расхода. Извлеки структурированные поля.

Верни ТОЛЬКО валидный JSON, ничего больше. Схема:
{
  "amount": число в основной валюте (например 123.45) или null,
  "expense_at": "YYYY-MM-DD" или null,
  "category_guess": краткое имя категории (Аренда, Косметика, Реклама, Налоги,
    Зарплата, Коммунальные, Транспорт, Прочее) или null,
  "vendor_guess": название поставщика/контрагента или null,
  "document_number": номер фактуры/чека или null,
  "comment": краткое описание расхода своими словами или null
}

Категория: выбирай ТОЛЬКО из списка выше. Если ничего не подходит однозначно — "Прочее". Не выдумывай свои категории.

Текст надиктовки:`

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return preflight()
  if (req.method !== 'POST') return jsonResponse({ error: 'method_not_allowed' }, 405)
  if (!GROQ_KEY) return jsonResponse({ error: 'function_not_configured' }, 500)

  const authHeader = req.headers.get('Authorization') || req.headers.get('authorization') || ''
  if (!authHeader.startsWith('Bearer ')) return jsonResponse({ error: 'unauthorized' }, 401)

  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  })
  const { data: u, error: userErr } = await userClient.auth.getUser()
  if (userErr || !u?.user) return jsonResponse({ error: 'unauthorized' }, 401)

  // Принимаем multipart/form-data с полем "audio" (Blob).
  let audio: File | null = null
  try {
    const form = await req.formData()
    const f = form.get('audio')
    if (f instanceof File) audio = f
  } catch {
    return jsonResponse({ error: 'invalid_form' }, 400)
  }
  if (!audio) return jsonResponse({ error: 'audio_required' }, 400)

  try {
    // 1) Whisper транскрипция через Groq.
    const transcribeForm = new FormData()
    transcribeForm.append('file', audio, audio.name || 'audio.webm')
    transcribeForm.append('model', 'whisper-large-v3')
    transcribeForm.append('language', 'ru')
    transcribeForm.append('response_format', 'json')

    const transcribeRes = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${GROQ_KEY}` },
      body: transcribeForm,
    })
    if (!transcribeRes.ok) {
      const text = await transcribeRes.text().catch(() => '')
      return jsonResponse(
        { error: 'transcribe_failed', status: transcribeRes.status, detail: text.slice(0, 500) },
        502,
      )
    }
    const transcribeJson = (await transcribeRes.json()) as { text?: string }
    const transcript = (transcribeJson.text ?? '').trim()
    if (!transcript) return jsonResponse({ error: 'empty_transcript' }, 422)

    // 2) Llama-3 парсинг текста в JSON.
    const parseRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${GROQ_KEY}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        temperature: 0.1,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content:
              'Ты опытный bookkeeping-аналитик. Возвращаешь СТРОГО валидный JSON по схеме. Не выдумываешь данных которых нет в транскрипции.',
          },
          { role: 'user', content: `${PARSE_PROMPT}\n\n"${transcript}"` },
        ],
      }),
    })
    if (!parseRes.ok) {
      const text = await parseRes.text().catch(() => '')
      return jsonResponse(
        {
          ok: true,
          transcript,
          parsed: null,
          parse_error: text.slice(0, 500),
        },
        200,
      )
    }
    const parseJson = (await parseRes.json()) as {
      choices?: Array<{ message?: { content?: string } }>
    }
    const raw = parseJson.choices?.[0]?.message?.content ?? '{}'
    let parsed: ParsedExpense | null = null
    try {
      const obj = JSON.parse(raw) as Partial<ParsedExpense>
      parsed = {
        amount: typeof obj.amount === 'number' ? obj.amount : null,
        expense_at: typeof obj.expense_at === 'string' ? obj.expense_at : null,
        category_guess: typeof obj.category_guess === 'string' ? obj.category_guess : null,
        vendor_guess: typeof obj.vendor_guess === 'string' ? obj.vendor_guess : null,
        document_number: typeof obj.document_number === 'string' ? obj.document_number : null,
        comment: typeof obj.comment === 'string' ? obj.comment : null,
      }
    } catch {
      parsed = null
    }

    return jsonResponse({ ok: true, transcript, parsed })
  } catch (e) {
    return jsonResponse(
      { error: 'pipeline_failed', message: e instanceof Error ? e.message : String(e) },
      500,
    )
  }
})
