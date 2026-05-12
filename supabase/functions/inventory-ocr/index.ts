/**
 * inventory-ocr — распознаёт чек / WZ / заказ / накладную через Claude vision
 * и возвращает структурированный список позиций для склада (preview).
 *
 * Принимает: { file_base64, mime }.
 *   - mime image/* (jpeg, png, webp) — vision image block
 *   - mime application/pdf            — document block (Anthropic supports PDF natively)
 *
 * Возвращает:
 *   { ok: true, items: [{name, unit, quantity, unit_cost_cents?, sku?, supplier?, notes?}, ...] }
 *
 * Auth: verify_jwt: true.
 * Стоимость: Claude Haiku 4.5 vision/document ~$0.003-0.01 per doc.
 *
 * ENV:
 *   ANTHROPIC_API_KEY
 */

import { corsHeaders, preflight } from '../_shared/cors.ts'
import { withSentry } from '../_shared/sentry.ts'

const ANTHROPIC_KEY = Deno.env.get('ANTHROPIC_API_KEY') ?? ''

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'content-type': 'application/json' },
  })
}

type InventoryItemDraft = {
  name: string
  unit: string
  quantity: number
  unit_cost_cents: number | null
  sku: string | null
  supplier: string | null
  notes: string | null
}

const SYSTEM_PROMPT = `Ты обрабатываешь документ поставки/закупки для салона красоты или магазина (чек, фактура VAT, WZ, инвойс, заказ). Цель — извлечь товарные позиции для занесения на склад.

Верни СТРОГО JSON массив объектов (без markdown-обёрток, без объяснений вокруг):
[
  {
    "name": "<название товара, как написано в документе>",
    "unit": "<единица измерения: шт / мл / г / л / кг / м; нормализуй варианты вроде 'pcs' → 'шт', 'ml' → 'мл'>",
    "quantity": <число — количество единиц>,
    "unit_cost_cents": <число — цена за единицу В КОПЕЙКАХ/ЦЕНТАХ (например 12.50 PLN → 1250); если в документе указана только общая сумма позиции — посчитай unit_cost = total / quantity>,
    "sku": "<артикул/код товара если указан, иначе null>",
    "supplier": "<имя поставщика из шапки документа; повторяй для каждой позиции>",
    "notes": "<краткое примечание если есть скидка, акция или важная деталь>"
  },
  ...
]

Правила:
- Игнорируй служебные строки: подитоги ("Subtotal"), НДС/VAT отдельно, скидки общие, доставка, итого.
- Если quantity не указан явно — считай 1.
- unit обязателен. Если непонятно — ставь "шт".
- name — БЕЗ единиц/количеств (их выноси отдельно), без артикулов в скобках.
- unit_cost_cents — целое число копеек. Если цена 12.50 PLN → 1250.
- Если документ совсем не товарный (например, фото природы) — верни пустой массив [].
- Поля без данных — null. quantity и unit обязательны для каждой позиции.`

Deno.serve(
  withSentry('inventory-ocr', async (req: Request) => {
    if (req.method === 'OPTIONS') return preflight()
    if (req.method !== 'POST') return jsonResponse({ error: 'method_not_allowed' }, 405)
    if (!ANTHROPIC_KEY) return jsonResponse({ error: 'function_not_configured' }, 500)

    let body: { file_base64?: string; mime?: string }
    try {
      body = await req.json()
    } catch {
      return jsonResponse({ error: 'invalid_json' }, 400)
    }
    if (!body.file_base64) return jsonResponse({ error: 'file_base64_required' }, 400)
    const mime = body.mime ?? 'image/jpeg'

    // Лимит на размер: 10 MB (PDF) / 4 MB (image)
    const sizeBytes = (body.file_base64.length * 3) / 4
    const maxBytes = mime === 'application/pdf' ? 10 * 1024 * 1024 : 4 * 1024 * 1024
    if (sizeBytes > maxBytes) return jsonResponse({ error: 'file_too_large' }, 413)

    const isPdf = mime === 'application/pdf'
    const contentBlock = isPdf
      ? {
          type: 'document',
          source: { type: 'base64', media_type: 'application/pdf', data: body.file_base64 },
        }
      : {
          type: 'image',
          source: { type: 'base64', media_type: mime, data: body.file_base64 },
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
          max_tokens: 2000,
          system: SYSTEM_PROMPT,
          messages: [
            {
              role: 'user',
              content: [
                contentBlock,
                {
                  type: 'text',
                  text: 'Извлеки все товарные позиции из документа. Верни JSON-массив.',
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

      const text = block.text as string
      // Сначала пробуем найти JSON-массив; если нет — пустой массив
      const match = text.match(/\[[\s\S]*\]/)
      if (!match) return jsonResponse({ ok: true, items: [] })

      let parsed: InventoryItemDraft[]
      try {
        parsed = JSON.parse(match[0])
      } catch (e) {
        return jsonResponse(
          { error: 'parse_failed', message: e instanceof Error ? e.message : String(e) },
          502,
        )
      }

      // Sanitize — все строковые поля trim, числовые приводим к number
      const items: InventoryItemDraft[] = (Array.isArray(parsed) ? parsed : [])
        .map((it) => ({
          name: String(it.name ?? '').trim(),
          unit: String(it.unit ?? 'шт').trim() || 'шт',
          quantity: Number(it.quantity) || 1,
          unit_cost_cents:
            it.unit_cost_cents == null ? null : Math.round(Number(it.unit_cost_cents)),
          sku: it.sku ? String(it.sku).trim() : null,
          supplier: it.supplier ? String(it.supplier).trim() : null,
          notes: it.notes ? String(it.notes).trim() : null,
        }))
        .filter((it) => it.name.length > 0)

      return jsonResponse({ ok: true, items })
    } catch (err) {
      console.error('inventory-ocr', err)
      return jsonResponse(
        { error: 'internal', message: err instanceof Error ? err.message : String(err) },
        500,
      )
    }
  }),
)
