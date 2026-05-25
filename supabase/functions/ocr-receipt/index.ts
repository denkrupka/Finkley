/**
 * ocr-receipt — распознаёт чек на фото через Claude Haiku 4.5 с vision.
 *
 * Принимает: { image_base64, mime } или { image_url } (signed URL из Storage).
 * Возвращает: { amount, currency, expense_at, vendor, category_guess, raw_text }
 *
 * Auth: verify_jwt: true (платформа Supabase валидирует JWT юзера).
 *
 * Стоимость: Claude Haiku 4.5 vision ~$0.001-0.002 per receipt.
 *
 * ENV:
 *   ANTHROPIC_API_KEY
 */

import { corsHeaders, preflight } from '../_shared/cors.ts'

const ANTHROPIC_KEY = Deno.env.get('ANTHROPIC_API_KEY') ?? ''

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'content-type': 'application/json' },
  })
}

type OcrResult = {
  amount: number | null
  currency: string | null
  expense_at: string | null // YYYY-MM-DD
  vendor: string | null
  vendor_nip: string | null
  vendor_address: string | null
  buyer_nip: string | null
  category_guess: string | null
  document_number: string | null
  /** IBAN счёта продавца (для bulk-перевода). Извлекаем из фактуры если есть. */
  vendor_iban: string | null
  raw_text: string | null
}

const SYSTEM_PROMPT = `Ты обрабатываешь фото бумажного чека или фактуры из салона красоты или магазина в Польше/Европе.

Извлеки и верни СТРОГО JSON со следующей структурой (без объяснений вокруг JSON):
{
  "amount": <число итоговой суммы — final total, не subtotal>,
  "currency": "PLN" | "EUR" | "USD" | "UAH" | "RUB",
  "expense_at": "YYYY-MM-DD",
  "vendor": "<имя продавца / название магазина или организации>",
  "vendor_nip": "<NIP sprzedawcy/wystawcy — польский ИНН продавца, ровно 10 цифр без пробелов и дефисов; null если не указан>",
  "vendor_address": "<полный адрес продавца как одна строка: улица, дом, индекс, город; null если не указан>",
  "buyer_nip": "<NIP nabywcy — польский ИНН покупателя, ровно 10 цифр без пробелов и дефисов; null если на чеке нет покупателя или это розничный paragon без NIP>",
  "category_guess": "<короткая категория расхода на русском, для салона красоты: Косметика и расходники, Аренда, Связь и интернет, Зарплата, Налоги, Маркетинг, Хозяйственные товары, Транспорт, Прочее>",
  "document_number": "<номер документа: для фактуры — Numer faktury (FV/.../...); для paragon — Numer paragonu; null если не указан>",
  "vendor_iban": "<IBAN счёта продавца — для bulk-переводов. На польской фактуре помечен как 'Numer konta', 'Bank', 'IBAN', 'Konto bankowe'. Возвращай как чистую строку без пробелов, начинается с 2 букв страны (PL/DE/CZ/etc) + 2 цифры check + остальные цифры. Только если IBAN явно указан и валиден по формату; null для paragon и неполных номеров>",
  "raw_text": "<до 200 символов raw текста чека для дебага>"
}

Если поле не распознано — возвращай null. amount всегда дробное число (использует точку как десятичный разделитель). Если на чеке несколько валют — выбирай главную (по итоговой сумме). Если категория неоднозначна — выбирай ближайшую из перечисленных, не выдумывай новые.

NIP-поля: на польских фактурах продавец помечен как "Sprzedawca" / "Wystawca", покупатель — "Nabywca" / "Kupujący". На обычном paragon (рознице) buyer_nip обычно отсутствует. NIP всегда ровно 10 цифр; если на документе вместо 10 цифр другой формат — верни null.

IBAN: длина 15-34 символа, для PL — 28 символов, начинается с "PL". Возвращай БЕЗ пробелов и дефисов (как одна строка). Если на документе несколько счетов — выбирай "główne konto" / "konto rozliczeniowe", иначе первое валидное.

Если на фото вообще не чек (например, скриншот, селфи, природа) — верни все поля null.`

import { withSentry } from '../_shared/sentry.ts'

Deno.serve(
  withSentry('ocr-receipt', async (req: Request) => {
    if (req.method === 'OPTIONS') return preflight()
    if (req.method !== 'POST') return jsonResponse({ error: 'method_not_allowed' }, 405)
    if (!ANTHROPIC_KEY) return jsonResponse({ error: 'function_not_configured' }, 500)

    let body: { image_base64?: string; mime?: string }
    try {
      body = await req.json()
    } catch {
      return jsonResponse({ error: 'invalid_json' }, 400)
    }
    if (!body.image_base64) return jsonResponse({ error: 'image_base64_required' }, 400)
    const mime = body.mime ?? 'image/jpeg'

    // Защита: фото больше 4 MB не пропускаем (anthropic vision лимит)
    const sizeBytes = (body.image_base64.length * 3) / 4
    if (sizeBytes > 4 * 1024 * 1024) {
      return jsonResponse({ error: 'image_too_large' }, 413)
    }

    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': ANTHROPIC_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 600,
          system: SYSTEM_PROMPT,
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'image',
                  source: { type: 'base64', media_type: mime, data: body.image_base64 },
                },
                {
                  type: 'text',
                  text: 'Распознай чек и верни JSON по схеме.',
                },
              ],
            },
          ],
        }),
      })
      if (!res.ok) {
        const errText = await res.text()
        console.error('anthropic vision', res.status, errText)
        return jsonResponse({ error: 'anthropic_error', status: res.status }, 502)
      }
      const data = await res.json()
      const block = data.content?.[0]
      if (block?.type !== 'text') return jsonResponse({ error: 'unexpected_response' }, 502)

      // Извлекаем JSON из ответа (на случай если AI обернул в ```json fences)
      const text = block.text as string
      const match = text.match(/\{[\s\S]*\}/)
      if (!match)
        return jsonResponse({ error: 'no_json_in_response', raw: text.slice(0, 200) }, 502)

      let parsed: OcrResult
      try {
        parsed = JSON.parse(match[0])
      } catch (e) {
        return jsonResponse(
          { error: 'parse_failed', message: e instanceof Error ? e.message : String(e) },
          502,
        )
      }

      return jsonResponse({ ok: true, result: parsed })
    } catch (err) {
      console.error('ocr-receipt', err)
      return jsonResponse(
        { error: 'internal', message: err instanceof Error ? err.message : String(err) },
        500,
      )
    }
  }),
)
