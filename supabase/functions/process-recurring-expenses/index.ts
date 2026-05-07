/**
 * process-recurring-expenses — scheduled cron, запускается раз в сутки.
 *
 * Что делает:
 * 1. Находит расходы с `recurrence` ∈ {weekly, monthly} и `next_occurrence_at <= today`,
 *    `deleted_at is null`.
 * 2. Для каждого создаёт новый расход с тем же category_id, amount_cents, payment_method,
 *    comment, receipt_url=null (чек не повторяется), recurrence=none, recurrence_parent_id=parent.
 * 3. Двигает родительский next_occurrence_at вперёд на 1 период.
 *
 * Идемпотентен: если запустить дважды в день — следующий раз уже не сработает,
 * потому что next_occurrence_at сдвинулся в будущее. Безопасно ставить cron
 * хоть каждый час.
 *
 * Auth: deploy --no-verify-jwt + проверка X-Finkley-Secret для cron-вызовов.
 *
 * ENV:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   FUNCTION_INTERNAL_SECRET
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'

import { corsHeaders, preflight } from '../_shared/cors.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const FUNCTION_SECRET = Deno.env.get('FUNCTION_INTERNAL_SECRET') ?? ''

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'content-type': 'application/json' },
  })
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return diff === 0
}

function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

function addMonths(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCMonth(d.getUTCMonth() + n)
  return d.toISOString().slice(0, 10)
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return preflight()
  if (req.method !== 'POST' && req.method !== 'GET') {
    return jsonResponse({ error: 'method_not_allowed' }, 405)
  }
  if (!SUPABASE_URL || !SERVICE_KEY || !FUNCTION_SECRET) {
    return jsonResponse({ error: 'function_not_configured' }, 500)
  }

  const got = req.headers.get('x-finkley-secret') || req.headers.get('X-Finkley-Secret') || ''
  if (!timingSafeEqual(got, FUNCTION_SECRET)) {
    return jsonResponse({ error: 'unauthorized' }, 401)
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const today = new Date().toISOString().slice(0, 10)

  type RecurringRow = {
    id: string
    salon_id: string
    category_id: string | null
    amount_cents: number
    payment_method: string | null
    comment: string | null
    recurrence: 'weekly' | 'monthly'
    next_occurrence_at: string
  }

  const { data: due, error: selectErr } = await supabase
    .from('expenses')
    .select(
      'id, salon_id, category_id, amount_cents, payment_method, comment, recurrence, next_occurrence_at',
    )
    .neq('recurrence', 'none')
    .lte('next_occurrence_at', today)
    .is('deleted_at', null)
    .limit(500)

  if (selectErr) {
    console.error('select due recurring expenses', selectErr)
    return jsonResponse({ error: 'select_failed', message: selectErr.message }, 502)
  }

  const dueRows = (due ?? []) as RecurringRow[]
  const created: string[] = []
  const errors: { id: string; error: string }[] = []

  for (const parent of dueRows) {
    // 1) Создаём новый instance этого расхода с датой = next_occurrence_at
    const { data: newRow, error: insertErr } = await supabase
      .from('expenses')
      .insert({
        salon_id: parent.salon_id,
        category_id: parent.category_id,
        amount_cents: parent.amount_cents,
        payment_method: parent.payment_method,
        comment: parent.comment,
        expense_at: parent.next_occurrence_at,
        recurrence: 'none',
        recurrence_parent_id: parent.id,
        source: 'recurring',
      })
      .select('id')
      .single()

    if (insertErr) {
      console.error('insert recurring instance', { parent: parent.id, error: insertErr })
      errors.push({ id: parent.id, error: insertErr.message })
      continue
    }
    created.push(newRow!.id)

    // 2) Двигаем родительский next_occurrence_at вперёд на 1 период
    const nextDate =
      parent.recurrence === 'weekly'
        ? addDays(parent.next_occurrence_at, 7)
        : addMonths(parent.next_occurrence_at, 1)

    const { error: updateErr } = await supabase
      .from('expenses')
      .update({ next_occurrence_at: nextDate })
      .eq('id', parent.id)

    if (updateErr) {
      // Не критично — следующий запуск повторит
      console.warn('update next_occurrence_at', { parent: parent.id, error: updateErr })
    }
  }

  return jsonResponse({
    ok: true,
    today,
    processed: dueRows.length,
    created: created.length,
    errors,
  })
})
