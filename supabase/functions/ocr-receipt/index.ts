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

const SYSTEM_PROMPT = `Ты — старший OCR-инженер с 10+ годами работы с польскими бухгалтерскими документами (paragony, faktury VAT, FV korygujące, WZ). Обрабатываешь фото / скриншот / PDF чека или фактуры из салона красоты или магазина в Польше / EU.

КРИТИЧНОЕ ПРАВИЛО: если поле ВИДНО на документе — извлекай его. НЕ возвращай null когда значение явно присутствует на изображении. Особенно amount и document_number — они почти ВСЕГДА есть на любой фактуре/чеке, ищи внимательно.

ГДЕ ИСКАТЬ amount (final total, ИТОГ к оплате):
  Польские фактуры VAT — в правом нижнем углу таблицы, лейблы:
    "Razem do zapłaty", "Razem brutto", "Suma brutto", "Wartość brutto",
    "Do zapłaty", "Kwota do zapłaty", "Razem", "Suma", "Brutto razem",
    "Należność ogółem", "Wartość ogółem", "Total"
  ПРИОРИТЕТ: всегда бери BRUTTO (с VAT), не NETTO. Если показаны
  оба — выбирай brutto. Если показано только Razem без разделения
  netto/brutto — бери Razem.
  Paragon: "SUMA PLN", "Suma" внизу. Часто после нескольких позиций.
  Не путай amount с zaliczka / wpłata / kwota odsetek / podatek VAT.

ГДЕ ИСКАТЬ document_number:
  Польские фактуры VAT: вверху листа, лейблы "Faktura VAT nr",
    "Faktura nr", "FV nr", "Numer faktury", просто "FV/.../...".
    Формат обычно "FV/<месяц>/<год>/<seq>" или похожее.
  Paragon: "Nr paragonu", "Paragon nr".
  Возвращай ровно строку как она напечатана (с слешами/дефисами).

ГДЕ ИСКАТЬ expense_at:
  Польские фактуры — "Data wystawienia", "Data sprzedaży",
    "Data faktury", "Dnia". Формат на документе DD-MM-YYYY или DD.MM.YYYY
    или YYYY-MM-DD. Возвращай в YYYY-MM-DD.
  Paragon: дата печати чека вверху или внизу.

ГДЕ ИСКАТЬ NIP:
  "Sprzedawca:" → NIP под именем продавца → vendor_nip
  "Nabywca:" / "Kupujący:" → NIP под именем покупателя → buyer_nip
  Иногда лейбл "NIP:" сразу со значением — определи владение по контексту
  (sprzedawca указан в шапке, nabywca указан как платильщик).
  NIP всегда РОВНО 10 цифр (без пробелов и дефисов в твоём ответе).

ГДЕ ИСКАТЬ vendor_address:
  Под именем продавца (Sprzedawca). Обычно 1-2 строки: улица + дом,
  затем индекс + город. Возвращай как ОДНУ строку через запятую.
  Пример: "ul. Słowackiego 55/1, 60-521 Poznań".

ГДЕ ИСКАТЬ vendor_iban:
  В нижней части польской фактуры VAT, лейблы:
    "Numer konta", "Konto bankowe", "Bank", "Rachunek bankowy", "IBAN".
  Польский IBAN всегда 28 символов: "PL" + 26 цифр. Сгруппирован
  по 4 цифры через пробелы — убирай ВСЕ пробелы в ответе.
  На paragon обычно нет IBAN → null.

ANTI-HALLUCINATION: если действительно не видишь поле или оно
неразборчиво — возвращай null. НИКОГДА не выдумывай NIP (ошибка в
1 цифре сломает auto-match с wFirma) или IBAN (платёж улетит не
туда). Но для amount/document_number — ищи особенно внимательно,
они почти всегда есть.

ANTI-FLUFF: не комментируй, не объясняй, не оборачивай в \`\`\`json
fences — только raw JSON.

Извлеки и верни СТРОГО JSON со следующей структурой:
{
  "amount": <число — итоговая сумма BRUTTO, точка как десятичный разделитель>,
  "currency": "PLN" | "EUR" | "USD" | "UAH" | "RUB",
  "expense_at": "YYYY-MM-DD",
  "vendor": "<имя продавца / название организации>",
  "vendor_nip": "<10 цифр без пробелов | null>",
  "vendor_address": "<адрес одной строкой через запятую | null>",
  "buyer_nip": "<10 цифр nabywcy | null если paragon или не указан>",
  "category_guess": "<категория из списка>",
  "document_number": "<номер документа как напечатан | null>",
  "vendor_iban": "<PL+26 цифр без пробелов | null если paragon>",
  "raw_text": "<до 200 символов сырого текста для дебага>"
}

Категории (выбирай ближайшую, не выдумывай): Косметика и расходники, Аренда, Связь и интернет, Зарплата, Налоги, Маркетинг, Хозяйственные товары, Транспорт, Прочее.

Если на фото вообще не финансовый документ (селфи, природа, чёрный экран) — верни все поля null.`

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

    // Защита: файлы больше 8 MB не пропускаем. PDF фактуры обычно <2 MB,
    // фото с телефона <4 MB. Anthropic лимит — 5 MB на media block, но на
    // практике безопаснее обрезать на 8 MB до base64-overhead.
    const sizeBytes = (body.image_base64.length * 3) / 4
    if (sizeBytes > 8 * 1024 * 1024) {
      return jsonResponse({ error: 'file_too_large' }, 413)
    }

    try {
      // PDF (application/pdf) → type='document' блок Anthropic Beta.
      // image/* → type='image'. Anthropic API natively принимает оба формата.
      const isPdf = mime === 'application/pdf'
      const contentBlock = isPdf
        ? {
            type: 'document',
            source: { type: 'base64', media_type: 'application/pdf', data: body.image_base64 },
          }
        : {
            type: 'image',
            source: { type: 'base64', media_type: mime, data: body.image_base64 },
          }
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': ANTHROPIC_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          // Opus 4.7 1M для ВСЕХ форматов. Haiku 4.5 путался с польскими
          // фактурами (пропускал amount/document_number даже на чёткой
          // картинке) — юзер 02.06: «не вытянуло суммы из фактуры». Цена
          // ~5x выше, но OCR runs редко (одна faktura = один call).
          model: 'claude-opus-4-7',
          max_tokens: 600,
          system: SYSTEM_PROMPT,
          messages: [
            {
              role: 'user',
              content: [
                contentBlock,
                {
                  type: 'text',
                  text: 'Распознай чек/фактуру и верни JSON по схеме.',
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
