/**
 * ai-assistant — чат с владельцем салона. Принимает сообщение + salon_id,
 * собирает snapshot KPI из БД, отправляет в Claude haiku 4.5, сохраняет
 * user-сообщение и ответ в ai_messages.
 *
 * Auth: user JWT (через verify_jwt=true на edge function level или явно
 * проверяем здесь). Membership проверяется через salon_members.
 *
 * Actions:
 *   - 'send' { salon_id, conversation_id?, message } → создаёт/использует
 *      conversation, сохраняет user msg, шлёт в Claude, сохраняет ответ,
 *      возвращает {conversation_id, message_id, content}
 *   - 'history' { conversation_id } → возвращает список сообщений
 *   - 'list_conversations' { salon_id } → возвращает conversations салона
 *   - 'reset' { salon_id } → создаёт новый conversation (старый остаётся)
 */

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'

import { corsHeaders, preflight } from '../_shared/cors.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const ANTHROPIC_KEY = Deno.env.get('ANTHROPIC_API_KEY') ?? ''

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'content-type': 'application/json' },
  })
}

async function ensureMember(
  admin: SupabaseClient,
  userId: string,
  salonId: string,
): Promise<boolean> {
  const { data } = await admin
    .from('salon_members')
    .select('role')
    .eq('salon_id', salonId)
    .eq('user_id', userId)
    .maybeSingle()
  return !!data
}

type SnapshotRow = {
  current_month?: { revenue: number; visits: number; avg_ticket: number }
  prev_month?: { revenue: number; visits: number }
  top_staff?: { name: string; revenue: number; visits: number }[]
  top_services?: { name: string; revenue: number; visits: number }[]
  expenses_current_month_cents?: number
  clients?: { active: number; total: number; never_visited: number }
  pending_unbilled_past?: number
}

function fmtMoney(cents: number, currency: string): string {
  const n = (cents / 100).toFixed(2).replace('.', ',')
  return `${n} ${currency}`
}

function normalizeLocale(input: unknown): 'ru' | 'pl' | 'en' {
  if (typeof input !== 'string') return 'ru'
  const base = input.split('-')[0]?.toLowerCase()
  if (base === 'pl') return 'pl'
  if (base === 'en') return 'en'
  return 'ru'
}

function buildSystemPrompt(
  snapshot: SnapshotRow,
  currency: string,
  salonName: string,
  locale: 'ru' | 'pl' | 'en' = 'ru',
): string {
  const cur = snapshot.current_month
  const prev = snapshot.prev_month
  const revGrowth =
    cur && prev && prev.revenue > 0
      ? Math.round(((cur.revenue - prev.revenue) / prev.revenue) * 100)
      : null

  // Универсальный английский каркас + явная language-instruction. Claude
  // надёжно держит требуемый язык; данные в snapshot (имена услуг/мастеров)
  // остаются как есть — это контент юзера.
  const langInstruction = {
    ru: 'Respond in Russian (русский).',
    pl: 'Respond in Polish (polski).',
    en: 'Respond in English.',
  }[locale]

  const lines: string[] = [
    'You are an AI assistant for a beauty salon owner. Respond in a friendly, on-point manner, without jargon.',
    langInstruction,
    'Use only data from the snapshot below. Do not invent numbers.',
    'If data is insufficient — say so and suggest how to obtain it.',
    `Format numbers like "1 234,56 ${currency}" (comma decimal, space thousands).`,
    `Salon: "${salonName}". Currency: ${currency}.`,
    '',
    '=== BUSINESS SNAPSHOT ===',
  ]

  if (cur) {
    lines.push(
      `Current month: revenue ${fmtMoney(cur.revenue, currency)}, ` +
        `visits ${cur.visits}, avg ticket ${fmtMoney(Math.round(cur.avg_ticket), currency)}`,
    )
  }
  if (prev) {
    lines.push(`Previous month: revenue ${fmtMoney(prev.revenue, currency)}, visits ${prev.visits}`)
  }
  if (revGrowth !== null) {
    lines.push(`Revenue dynamics: ${revGrowth >= 0 ? '+' : ''}${revGrowth}% vs previous month`)
  }
  if (snapshot.expenses_current_month_cents !== undefined) {
    lines.push(
      `Current month expenses: ${fmtMoney(snapshot.expenses_current_month_cents, currency)}`,
    )
    if (cur) {
      const profit = cur.revenue - snapshot.expenses_current_month_cents
      lines.push(`Net profit (revenue − expenses): ${fmtMoney(profit, currency)}`)
    }
  }
  if (snapshot.top_staff?.length) {
    lines.push('Top masters this month:')
    for (const s of snapshot.top_staff) {
      lines.push(`  - ${s.name}: ${fmtMoney(s.revenue, currency)} (${s.visits} visits)`)
    }
  }
  if (snapshot.top_services?.length) {
    lines.push('Top services this month:')
    for (const s of snapshot.top_services) {
      lines.push(`  - ${s.name}: ${fmtMoney(s.revenue, currency)} (${s.visits} times)`)
    }
  }
  if (snapshot.clients) {
    lines.push(
      `Client base: total ${snapshot.clients.total}, active in 90 days ${snapshot.clients.active}, never visited ${snapshot.clients.never_visited}`,
    )
  }
  if (snapshot.pending_unbilled_past) {
    lines.push(
      `⚠ ${snapshot.pending_unbilled_past} past visits are unbilled — revenue is understated`,
    )
  }

  lines.push('', '=== /SNAPSHOT ===')
  lines.push(
    '',
    'Reply concisely: 1-3 paragraphs. When appropriate — give a concrete recommendation.',
    'Do not mention "snapshot" or "JSON" in the answer — speak naturally.',
  )

  return lines.join('\n')
}

async function callClaude(
  systemPrompt: string,
  history: { role: 'user' | 'assistant'; content: string }[],
  userMessage: string,
): Promise<{ content: string; input_tokens: number; output_tokens: number }> {
  if (!ANTHROPIC_KEY) {
    return {
      content:
        'Извини, AI пока не подключен — нужен ANTHROPIC_API_KEY в настройках. Свяжись с поддержкой.',
      input_tokens: 0,
      output_tokens: 0,
    }
  }

  // Берём последние 10 сообщений из истории чтобы не раздувать context
  const trimmedHistory = history.slice(-10)
  const messages = [...trimmedHistory, { role: 'user' as const, content: userMessage }]

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      system: systemPrompt,
      messages,
    }),
  })

  if (!res.ok) {
    const errText = await res.text()
    console.error('anthropic error', res.status, errText.slice(0, 500))
    throw new Error(`Claude API ${res.status}`)
  }

  const data = await res.json()
  const block = data.content?.[0]
  if (block?.type !== 'text') throw new Error('claude_invalid_response')

  return {
    content: block.text as string,
    input_tokens: data.usage?.input_tokens ?? 0,
    output_tokens: data.usage?.output_tokens ?? 0,
  }
}

async function handleSend(
  admin: SupabaseClient,
  userId: string,
  salonId: string,
  conversationId: string | undefined,
  message: string,
  locale: 'ru' | 'pl' | 'en' = 'ru',
): Promise<Response> {
  if (!(await ensureMember(admin, userId, salonId))) {
    return jsonResponse({ ok: false, error: 'forbidden' }, 403)
  }

  if (!message?.trim()) {
    return jsonResponse({ ok: false, error: 'empty_message' }, 400)
  }

  // Получаем или создаём conversation
  let convId = conversationId
  if (!convId) {
    // Берём последний conversation если есть, иначе создаём новый
    const { data: existing } = await admin
      .from('ai_conversations')
      .select('id')
      .eq('salon_id', salonId)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (existing) {
      convId = existing.id
    } else {
      const { data: created, error: createErr } = await admin
        .from('ai_conversations')
        .insert({ salon_id: salonId, title: message.slice(0, 60) })
        .select('id')
        .single()
      if (createErr || !created)
        return jsonResponse({ ok: false, error: 'create_conversation_failed' }, 500)
      convId = created.id
    }
  }

  // Salon info + snapshot
  const { data: salon } = await admin
    .from('salons')
    .select('name, currency')
    .eq('id', salonId)
    .single()
  const currency = salon?.currency ?? 'PLN'
  const salonName = salon?.name ?? 'Салон'

  const { data: snapshotData, error: snapErr } = await admin.rpc('ai_salon_snapshot', {
    p_salon_id: salonId,
  })
  if (snapErr) {
    console.error('snapshot rpc failed', snapErr.message)
  }
  const snapshot = (snapshotData ?? {}) as SnapshotRow

  // Загружаем history
  const { data: histRows } = await admin
    .from('ai_messages')
    .select('role, content')
    .eq('conversation_id', convId)
    .order('created_at', { ascending: true })
  const history = (histRows ?? []) as { role: 'user' | 'assistant'; content: string }[]

  // Сохраняем user-сообщение СРАЗУ (даже если Claude упадёт)
  await admin.from('ai_messages').insert({
    conversation_id: convId,
    role: 'user',
    content: message,
  })

  // Зовём Claude
  const systemPrompt = buildSystemPrompt(snapshot, currency, salonName, locale)
  let assistantContent: string
  let inputTokens = 0
  let outputTokens = 0
  try {
    const claude = await callClaude(systemPrompt, history, message)
    assistantContent = claude.content
    inputTokens = claude.input_tokens
    outputTokens = claude.output_tokens
  } catch (e) {
    assistantContent = 'Не получилось получить ответ от AI. Попробуй ещё раз через минуту.'
    console.error('callClaude failed', e instanceof Error ? e.message : e)
  }

  const { data: assistantMsg } = await admin
    .from('ai_messages')
    .insert({
      conversation_id: convId,
      role: 'assistant',
      content: assistantContent,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
    })
    .select('id, content, created_at')
    .single()

  // Обновляем updated_at conversation чтобы он поднялся в списке
  await admin
    .from('ai_conversations')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', convId)

  return jsonResponse({
    ok: true,
    conversation_id: convId,
    message: assistantMsg,
  })
}

async function handleHistory(
  admin: SupabaseClient,
  userId: string,
  salonId: string,
  conversationId: string | undefined,
): Promise<Response> {
  if (!(await ensureMember(admin, userId, salonId))) {
    return jsonResponse({ ok: false, error: 'forbidden' }, 403)
  }

  let convId = conversationId
  if (!convId) {
    const { data: latest } = await admin
      .from('ai_conversations')
      .select('id')
      .eq('salon_id', salonId)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (!latest) return jsonResponse({ ok: true, conversation_id: null, messages: [] })
    convId = latest.id
  }

  const { data: messages } = await admin
    .from('ai_messages')
    .select('id, role, content, created_at')
    .eq('conversation_id', convId)
    .order('created_at', { ascending: true })

  return jsonResponse({ ok: true, conversation_id: convId, messages: messages ?? [] })
}

async function handleReset(
  admin: SupabaseClient,
  userId: string,
  salonId: string,
): Promise<Response> {
  if (!(await ensureMember(admin, userId, salonId))) {
    return jsonResponse({ ok: false, error: 'forbidden' }, 403)
  }
  const { data: created, error } = await admin
    .from('ai_conversations')
    .insert({ salon_id: salonId, title: 'Новая беседа' })
    .select('id')
    .single()
  if (error || !created) {
    return jsonResponse({ ok: false, error: 'create_failed', message: error?.message }, 500)
  }
  return jsonResponse({ ok: true, conversation_id: created.id })
}

import { withSentry } from '../_shared/sentry.ts'

Deno.serve(
  withSentry('ai-assistant', async (req: Request) => {
    if (req.method === 'OPTIONS') return preflight()
    if (req.method !== 'POST') return jsonResponse({ ok: false, error: 'method_not_allowed' }, 405)
    if (!SUPABASE_URL || !SERVICE_KEY) {
      return jsonResponse({ ok: false, error: 'function_not_configured' }, 500)
    }

    const authHeader = req.headers.get('Authorization') ?? ''
    if (!authHeader.startsWith('Bearer ')) {
      return jsonResponse({ ok: false, error: 'unauthorized' }, 401)
    }
    const userJwt = authHeader.slice('Bearer '.length)

    const userClient = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${userJwt}` } },
    })
    const { data: userRes, error: userErr } = await userClient.auth.getUser()
    if (userErr || !userRes?.user) {
      return jsonResponse({ ok: false, error: 'invalid_token' }, 401)
    }
    const userId = userRes.user.id

    let body: {
      action?: string
      salon_id?: string
      conversation_id?: string
      message?: string
      locale?: string
    }
    try {
      body = await req.json()
    } catch {
      return jsonResponse({ ok: false, error: 'bad_request' }, 400)
    }

    if (!body.salon_id) return jsonResponse({ ok: false, error: 'salon_id_required' }, 400)

    const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    })

    switch (body.action) {
      case 'send':
        return handleSend(
          admin,
          userId,
          body.salon_id,
          body.conversation_id,
          body.message ?? '',
          normalizeLocale(body.locale),
        )
      case 'history':
        return handleHistory(admin, userId, body.salon_id, body.conversation_id)
      case 'reset':
        return handleReset(admin, userId, body.salon_id)
      default:
        return jsonResponse({ ok: false, error: 'unknown_action' }, 400)
    }
  }),
)
