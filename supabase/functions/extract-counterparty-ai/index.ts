/**
 * extract-counterparty-ai — Groq Llama fallback для извлечения counterparty
 * из bank_tx.description когда regex (extract_bank_tx_counterparty) не справился.
 *
 * Принимает p_salon_id (uuid). Берёт до 50 tx у которых counterparty IS NULL
 * AND description IS NOT NULL, прогоняет через Llama-3.3 одной batch-prompt'ой,
 * UPDATE counterparty.
 *
 * Auth: JWT обязателен, юзер должен быть owner/admin салона (проверка через
 * salon_members на supabase user-client).
 *
 * ENV:
 *   GROQ_API_KEY — Groq API key
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'

import { corsHeaders, preflight } from '../_shared/cors.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const GROQ_KEY = Deno.env.get('GROQ_API_KEY') ?? ''

const BATCH_LIMIT = 50

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'content-type': 'application/json' },
  })
}

const PARSE_PROMPT = `Ты помощник салона красоты. Тебе дан список банковских
транзакций (массив описаний). Для каждого извлеки имя контрагента/продавца
если оно есть в строке. Если в строке нет осмысленного имени — верни null.

Примеры:
- "ROSSMANN 21 POZNAN POL 2026-05-22" → "ROSSMANN 21"
- "LIDL OSTROWSKA Poznan POL" → "LIDL OSTROWSKA"
- "Zwrot pożyczki" → null (это назначение, не имя)
- "Telefonnyj perevod BLIK" → null (это назначение перевода)
- "Transfer to phone number 48692***35" → null
- "PRZELEW ŚRODKÓW" → null
- "Revolut**3322* Dublin IRL" → "Revolut"
- "APPLE.COM/BILL IRL" → "APPLE.COM"
- "PAMIATKOWA 1998 Poznan POL" → "PAMIATKOWA"
- "OLEKSANDR LAVRENIUK" → "Oleksandr Lavreniuk"
- "Iwan Kowalski przelew za usługi" → "Iwan Kowalski"

Верни ТОЛЬКО валидный JSON-объект формы:
{ "results": [{"index": 0, "name": "ROSSMANN 21"}, {"index": 1, "name": null}, ...] }

Не объясняй, не комментируй. Только JSON.

Описания (по индексам):`

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return preflight()
  if (req.method !== 'POST') return jsonResponse({ error: 'method_not_allowed' }, 405)
  if (!GROQ_KEY) return jsonResponse({ error: 'function_not_configured' }, 500)

  const authHeader = req.headers.get('Authorization') || req.headers.get('authorization') || ''
  if (!authHeader.startsWith('Bearer ')) return jsonResponse({ error: 'unauthorized' }, 401)

  let body: { salon_id?: string }
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: 'bad_request' }, 400)
  }
  if (!body.salon_id) return jsonResponse({ error: 'missing_salon_id' }, 400)

  // user-client для RLS-проверки членства
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  })
  const { data: u, error: userErr } = await userClient.auth.getUser()
  if (userErr || !u?.user) return jsonResponse({ error: 'unauthorized' }, 401)

  // Проверка owner/admin через salon_members
  const { data: member } = await userClient
    .from('salon_members')
    .select('role')
    .eq('salon_id', body.salon_id)
    .eq('user_id', u.user.id)
    .single()
  if (!member || (member.role !== 'owner' && member.role !== 'admin')) {
    return jsonResponse({ error: 'forbidden' }, 403)
  }

  // admin-client для batch SELECT/UPDATE bank_transactions без RLS-overhead
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  // Берём tx без counterparty, ограничиваем салоном через JOIN
  const { data: txs, error: txErr } = await admin
    .from('bank_transactions')
    .select(
      `id, description,
       bank_accounts!inner (
         bank_connections!inner ( salon_id )
       )`,
    )
    .eq('bank_accounts.bank_connections.salon_id', body.salon_id)
    .is('counterparty', null)
    .not('description', 'is', null)
    .limit(BATCH_LIMIT)

  if (txErr) return jsonResponse({ error: 'select_failed', detail: txErr.message }, 500)
  const list = (txs ?? []) as Array<{ id: string; description: string | null }>
  if (list.length === 0) {
    return jsonResponse({ ok: true, processed: 0, updated: 0, total_remaining: 0 })
  }

  // Формируем batch-prompt
  const indexed = list.map((r, i) => `${i}. ${(r.description ?? '').slice(0, 300)}`).join('\n')

  let parsed: Array<{ index: number; name: string | null }> = []
  try {
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
          { role: 'system', content: 'Ты возвращаешь строго валидный JSON.' },
          { role: 'user', content: `${PARSE_PROMPT}\n\n${indexed}` },
        ],
      }),
    })
    if (!parseRes.ok) {
      const text = await parseRes.text().catch(() => '')
      return jsonResponse(
        { error: 'groq_failed', status: parseRes.status, detail: text.slice(0, 500) },
        502,
      )
    }
    const parseJson = (await parseRes.json()) as {
      choices?: Array<{ message?: { content?: string } }>
    }
    const raw = parseJson.choices?.[0]?.message?.content ?? '{}'
    const obj = JSON.parse(raw) as { results?: Array<{ index: number; name: string | null }> }
    parsed = Array.isArray(obj.results) ? obj.results : []
  } catch (e) {
    return jsonResponse(
      { error: 'parse_failed', message: e instanceof Error ? e.message : String(e) },
      500,
    )
  }

  // Применяем UPDATE'ы
  let updated = 0
  for (const r of parsed) {
    if (typeof r.index !== 'number' || r.index < 0 || r.index >= list.length) continue
    const tx = list[r.index]
    if (!tx) continue
    const name = r.name && typeof r.name === 'string' ? r.name.trim().slice(0, 200) : null
    if (!name) continue
    const { error: upErr } = await admin
      .from('bank_transactions')
      .update({ counterparty: name })
      .eq('id', tx.id)
    if (!upErr) updated++
  }

  // Сколько ещё осталось без counterparty
  const { count: remaining } = await admin
    .from('bank_transactions')
    .select('id, bank_accounts!inner(bank_connections!inner(salon_id))', {
      count: 'exact',
      head: true,
    })
    .eq('bank_accounts.bank_connections.salon_id', body.salon_id)
    .is('counterparty', null)
    .not('description', 'is', null)

  return jsonResponse({
    ok: true,
    processed: list.length,
    updated,
    total_remaining: remaining ?? 0,
  })
})
