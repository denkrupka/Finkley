/**
 * ai-assistant — чат с владельцем салона. Принимает сообщение + salon_id,
 * собирает snapshot KPI из БД, отправляет в Claude haiku 4.5 С tool-use,
 * сохраняет user-сообщение и ответ в ai_messages.
 *
 * Tool-use: Claude может вызвать инструменты для модификации данных:
 *   - create_visit, create_expense, create_client, create_service, transfer_cash
 * Каждый успешный вызов сохраняется в ai_tool_calls (для UI inline-карточек
 * + undo). См. миграцию 20260530000003_ai_tool_calls.sql.
 *
 * Auth: user JWT. Membership через salon_members. Tool actions требуют
 * owner/admin (валидируется в SQL RPC).
 *
 * Actions:
 *   - 'send' { salon_id, conversation_id?, message } → ответ + tool_calls
 *   - 'history' { conversation_id } → список сообщений + tool_calls
 *   - 'suggestions' { salon_id } → динамические подсказки на главном экране
 *   - 'reset' { salon_id } → новый conversation
 *   - 'undo_tool_call' { tool_call_id } → отменить операцию
 */

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'

import { corsHeaders, preflight } from '../_shared/cors.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const ANTHROPIC_KEY = Deno.env.get('ANTHROPIC_API_KEY') ?? ''
const MODEL = 'claude-haiku-4-5-20251001'

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

async function ensureOwnerAdmin(
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
  return data?.role === 'owner' || data?.role === 'admin'
}

// ───────────────────────────────────────────────────────────────────────────
// Snapshot types
// ───────────────────────────────────────────────────────────────────────────

type StaffRef = { id: string; full_name: string }
type ServiceRef = {
  id: string
  name: string
  default_price_cents: number
  default_duration_min: number | null
}
type CategoryRef = { id: string; name: string }
type RegisterRef = { id: string; label: string; balance_cents: number }
type Problems = {
  staff_without_payout_scheme?: number
  pending_visits_past?: number
  clients_inactive_90d?: number
  unpaid_payouts_prev_month?: number
  expenses_no_category_count?: number
}

type SnapshotRow = {
  current_month?: { revenue: number; visits: number; avg_ticket: number }
  prev_month?: { revenue: number; visits: number }
  top_staff?: { name: string; revenue: number; visits: number }[]
  top_services?: { name: string; revenue: number; visits: number }[]
  expenses_current_month_cents?: number
  clients?: { active: number; total: number; never_visited: number }
  pending_unbilled_past?: number
  staff_list?: StaffRef[]
  services_list?: ServiceRef[]
  expense_categories?: CategoryRef[]
  cash_registers?: RegisterRef[]
  problems?: Problems
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

// ───────────────────────────────────────────────────────────────────────────
// System prompt — только реальные данные салона
// ───────────────────────────────────────────────────────────────────────────

function buildSystemPrompt(
  snapshot: SnapshotRow,
  currency: string,
  salonName: string,
  locale: 'ru' | 'pl' | 'en' = 'ru',
  todayIso: string,
): string {
  const cur = snapshot.current_month
  const prev = snapshot.prev_month
  const revGrowth =
    cur && prev && prev.revenue > 0
      ? Math.round(((cur.revenue - prev.revenue) / prev.revenue) * 100)
      : null

  const langInstruction = {
    ru: 'Respond in Russian (русский).',
    pl: 'Respond in Polish (polski).',
    en: 'Respond in English.',
  }[locale]

  const lines: string[] = [
    'You are an AI assistant for a beauty salon owner. Friendly, on-point, no jargon.',
    langInstruction,
    'STRICT RULES:',
    '- Use ONLY data from the snapshot below. NEVER invent numbers, names, or facts.',
    '- If data is missing — say so explicitly and suggest where the user can find it.',
    `- Format money as "1 234,56 ${currency}" (space thousands, comma decimal).`,
    `- Today is ${todayIso}.`,
    '',
    'TOOL USE:',
    '- When the user clearly intends an action (record a visit, log an expense,',
    '  add a client/service, transfer cash) — call the appropriate tool.',
    '- Resolve names from the snapshot lists. If staff/service/category name is',
    '  ambiguous or missing — ASK to clarify, do NOT guess.',
    '- For transfer_cash: from/to are register IDs from cash_registers list.',
    '- Amount inputs are always in main currency units (PLN/EUR/etc), not cents.',
    '- After successful tool call, briefly confirm in one sentence.',
    '',
    `Salon: "${salonName}". Currency: ${currency}.`,
    '',
    '=== BUSINESS SNAPSHOT ===',
  ]

  if (cur) {
    lines.push(
      `Current month: revenue ${fmtMoney(cur.revenue, currency)}, ` +
        `${cur.visits} visits, avg ticket ${fmtMoney(Math.round(cur.avg_ticket), currency)}.`,
    )
  }
  if (prev) {
    lines.push(
      `Previous month: revenue ${fmtMoney(prev.revenue, currency)}, ${prev.visits} visits.`,
    )
  }
  if (revGrowth !== null) {
    lines.push(`Revenue dynamics: ${revGrowth >= 0 ? '+' : ''}${revGrowth}% vs previous month.`)
  }
  if (snapshot.expenses_current_month_cents !== undefined) {
    lines.push(`Expenses this month: ${fmtMoney(snapshot.expenses_current_month_cents, currency)}.`)
    if (cur) {
      const profit = cur.revenue - snapshot.expenses_current_month_cents
      lines.push(`Net (revenue − expenses): ${fmtMoney(profit, currency)}.`)
    }
  }
  if (snapshot.top_staff?.length) {
    lines.push('Top masters (this month):')
    for (const s of snapshot.top_staff) {
      lines.push(`  - ${s.name}: ${fmtMoney(s.revenue, currency)} (${s.visits} visits)`)
    }
  }
  if (snapshot.top_services?.length) {
    lines.push('Top services (this month):')
    for (const s of snapshot.top_services) {
      lines.push(`  - ${s.name}: ${fmtMoney(s.revenue, currency)} (${s.visits} times)`)
    }
  }
  if (snapshot.clients) {
    lines.push(
      `Clients: total ${snapshot.clients.total}, active 90d ${snapshot.clients.active}, never visited ${snapshot.clients.never_visited}.`,
    )
  }
  if (snapshot.pending_unbilled_past) {
    lines.push(`Warning: ${snapshot.pending_unbilled_past} past pending visits are unbilled.`)
  }

  // Lists for tool resolution
  if (snapshot.staff_list?.length) {
    lines.push('', 'STAFF (id → name):')
    for (const s of snapshot.staff_list.slice(0, 30)) {
      lines.push(`  ${s.id} → ${s.full_name}`)
    }
  }
  if (snapshot.services_list?.length) {
    lines.push('', 'SERVICES (id → name, default price):')
    for (const s of snapshot.services_list.slice(0, 30)) {
      lines.push(`  ${s.id} → ${s.name} (${fmtMoney(s.default_price_cents, currency)})`)
    }
  }
  if (snapshot.expense_categories?.length) {
    lines.push('', 'EXPENSE CATEGORIES (id → name):')
    for (const c of snapshot.expense_categories.slice(0, 30)) {
      lines.push(`  ${c.id} → ${c.name}`)
    }
  }
  if (snapshot.cash_registers?.length) {
    lines.push('', 'CASH REGISTERS (id → label, current balance):')
    for (const r of snapshot.cash_registers) {
      lines.push(`  ${r.id} → ${r.label} (${fmtMoney(r.balance_cents, currency)})`)
    }
  }

  const p = snapshot.problems
  if (p) {
    const issues: string[] = []
    if (p.pending_visits_past) issues.push(`${p.pending_visits_past} past visits unpaid`)
    if (p.staff_without_payout_scheme)
      issues.push(`${p.staff_without_payout_scheme} masters without payout scheme`)
    if (p.unpaid_payouts_prev_month)
      issues.push(`${p.unpaid_payouts_prev_month} draft payouts for closed months`)
    if (p.expenses_no_category_count)
      issues.push(`${p.expenses_no_category_count} expenses without category in last 30d`)
    if (p.clients_inactive_90d) issues.push(`${p.clients_inactive_90d} clients inactive 90+ days`)
    if (issues.length) {
      lines.push('', 'KNOWN ISSUES:')
      for (const i of issues) lines.push(`  - ${i}`)
    }
  }

  lines.push('', '=== /SNAPSHOT ===')
  lines.push(
    '',
    'Reply concisely: 1-3 short paragraphs. Do not mention "snapshot" or "JSON" — speak naturally.',
  )

  return lines.join('\n')
}

// ───────────────────────────────────────────────────────────────────────────
// Tool definitions (Anthropic tool-use schema)
// ───────────────────────────────────────────────────────────────────────────

type ToolDef = {
  name: string
  description: string
  input_schema: Record<string, unknown>
}

const TOOLS: ToolDef[] = [
  {
    name: 'create_visit',
    description:
      'Create a new paid visit (sale). Use when the user reports a completed service/transaction. Amount is in main currency units (e.g. 200 means 200 PLN).',
    input_schema: {
      type: 'object',
      properties: {
        staff_id: {
          type: 'string',
          description: 'UUID of the master (from STAFF list). Required.',
        },
        client_id: {
          type: 'string',
          description: 'UUID of an existing client (optional).',
        },
        service_id: {
          type: 'string',
          description: 'UUID of an existing service (optional).',
        },
        amount: {
          type: 'number',
          description: 'Amount in main currency units (not cents). E.g. 200 = 200 PLN.',
        },
        payment_method: {
          type: 'string',
          enum: ['cash', 'card', 'transfer', 'online', 'mixed'],
        },
        visit_date: {
          type: 'string',
          description:
            'ISO date or date-time (e.g. 2026-05-30 or 2026-05-30T14:00:00). Default = today.',
        },
        comment: { type: 'string' },
      },
      required: ['staff_id', 'amount', 'payment_method'],
    },
  },
  {
    name: 'create_expense',
    description: 'Log a new expense. Amount in main currency units.',
    input_schema: {
      type: 'object',
      properties: {
        category_id: {
          type: 'string',
          description: 'UUID from EXPENSE CATEGORIES list. Optional.',
        },
        amount: { type: 'number', description: 'Amount in main currency units.' },
        expense_date: {
          type: 'string',
          description: 'ISO date (default = today).',
        },
        comment: { type: 'string' },
        contractor_name: { type: 'string' },
      },
      required: ['amount'],
    },
  },
  {
    name: 'create_client',
    description: 'Create a new client.',
    input_schema: {
      type: 'object',
      properties: {
        full_name: { type: 'string' },
        phone: { type: 'string' },
        email: { type: 'string' },
        notes: { type: 'string' },
      },
      required: ['full_name'],
    },
  },
  {
    name: 'create_service',
    description: 'Create a new service in the catalog.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        price: {
          type: 'number',
          description: 'Default price in main currency units.',
        },
        duration_min: { type: 'number' },
      },
      required: ['name', 'price'],
    },
  },
  {
    name: 'transfer_cash',
    description:
      'Move money between cash registers. from/to are register IDs from CASH REGISTERS list.',
    input_schema: {
      type: 'object',
      properties: {
        from_register: { type: 'string', description: 'Source register ID.' },
        to_register: { type: 'string', description: 'Destination register ID.' },
        amount: { type: 'number', description: 'Amount in main currency units.' },
        comment: { type: 'string' },
      },
      required: ['from_register', 'to_register', 'amount'],
    },
  },
]

// ───────────────────────────────────────────────────────────────────────────
// Tool executors
// ───────────────────────────────────────────────────────────────────────────

type ToolResult = {
  ok: boolean
  status: 'success' | 'error'
  summary?: string
  error?: string
  entity_type?: string
  entity_id?: string
}

type ToolInput = Record<string, unknown>

function asString(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null
}
function asNumber(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.length > 0) {
    const n = Number(v)
    if (Number.isFinite(n)) return n
  }
  return null
}
function toCents(amount: number): number {
  return Math.round(amount * 100)
}

async function execTool(
  admin: SupabaseClient,
  userId: string,
  salonId: string,
  toolName: string,
  input: ToolInput,
  snapshot: SnapshotRow,
  currency: string,
): Promise<ToolResult> {
  // Owner/admin gate (all write tools).
  if (!(await ensureOwnerAdmin(admin, userId, salonId))) {
    return { ok: false, status: 'error', error: 'owner/admin only' }
  }

  try {
    switch (toolName) {
      case 'create_visit': {
        const staffId = asString(input.staff_id)
        const clientId = asString(input.client_id)
        const serviceId = asString(input.service_id)
        const amount = asNumber(input.amount)
        const method = asString(input.payment_method)
        if (!amount) return { ok: false, status: 'error', error: 'amount required' }
        if (!method) return { ok: false, status: 'error', error: 'payment_method required' }
        if (!staffId) return { ok: false, status: 'error', error: 'staff_id required' }
        const visitDate = asString(input.visit_date) ?? new Date().toISOString()
        const { data, error } = await admin.rpc('ai_create_visit', {
          p_user_id: userId,
          p_salon_id: salonId,
          p_staff_id: staffId,
          p_client_id: clientId,
          p_service_id: serviceId,
          p_amount_cents: toCents(amount),
          p_payment_method: method,
          p_visit_at: visitDate,
          p_comment: asString(input.comment),
        })
        if (error) return { ok: false, status: 'error', error: error.message }
        const row = (Array.isArray(data) ? data[0] : data) as { id: string } | null
        const staffName = snapshot.staff_list?.find((s) => s.id === staffId)?.full_name ?? 'мастер'
        return {
          ok: true,
          status: 'success',
          summary: `Визит: ${staffName}, ${fmtMoney(toCents(amount), currency)} (${method})`,
          entity_type: 'visit',
          entity_id: row?.id,
        }
      }

      case 'create_expense': {
        const amount = asNumber(input.amount)
        const categoryId = asString(input.category_id)
        if (!amount) return { ok: false, status: 'error', error: 'amount required' }
        const expDate = asString(input.expense_date) ?? new Date().toISOString().slice(0, 10)
        const { data, error } = await admin.rpc('ai_create_expense', {
          p_user_id: userId,
          p_salon_id: salonId,
          p_category_id: categoryId,
          p_amount_cents: toCents(amount),
          p_expense_at: expDate,
          p_comment: asString(input.comment),
          p_contractor_name: asString(input.contractor_name),
        })
        if (error) return { ok: false, status: 'error', error: error.message }
        const row = (Array.isArray(data) ? data[0] : data) as { id: string } | null
        const catName = categoryId
          ? snapshot.expense_categories?.find((c) => c.id === categoryId)?.name
          : null
        return {
          ok: true,
          status: 'success',
          summary: `Расход: ${fmtMoney(toCents(amount), currency)}${catName ? ` (${catName})` : ''}`,
          entity_type: 'expense',
          entity_id: row?.id,
        }
      }

      case 'create_client': {
        const name = asString(input.full_name)
        if (!name) return { ok: false, status: 'error', error: 'full_name required' }
        const { data, error } = await admin.rpc('ai_create_client', {
          p_user_id: userId,
          p_salon_id: salonId,
          p_name: name,
          p_phone: asString(input.phone),
          p_email: asString(input.email),
          p_notes: asString(input.notes),
        })
        if (error) return { ok: false, status: 'error', error: error.message }
        const row = (Array.isArray(data) ? data[0] : data) as { id: string } | null
        return {
          ok: true,
          status: 'success',
          summary: `Клиент создан: ${name}`,
          entity_type: 'client',
          entity_id: row?.id,
        }
      }

      case 'create_service': {
        const name = asString(input.name)
        const price = asNumber(input.price)
        if (!name) return { ok: false, status: 'error', error: 'name required' }
        if (price === null) return { ok: false, status: 'error', error: 'price required' }
        const duration = asNumber(input.duration_min)
        const { data, error } = await admin.rpc('ai_create_service', {
          p_user_id: userId,
          p_salon_id: salonId,
          p_name: name,
          p_default_price_cents: toCents(price),
          p_default_duration_min: duration,
          p_category_id: null,
        })
        if (error) return { ok: false, status: 'error', error: error.message }
        const row = (Array.isArray(data) ? data[0] : data) as { id: string } | null
        return {
          ok: true,
          status: 'success',
          summary: `Услуга: ${name}, ${fmtMoney(toCents(price), currency)}`,
          entity_type: 'service',
          entity_id: row?.id,
        }
      }

      case 'transfer_cash': {
        const from = asString(input.from_register)
        const to = asString(input.to_register)
        const amount = asNumber(input.amount)
        if (!from || !to)
          return { ok: false, status: 'error', error: 'from_register/to_register required' }
        if (!amount) return { ok: false, status: 'error', error: 'amount required' }
        const { data, error } = await admin.rpc('ai_transfer_cash', {
          p_user_id: userId,
          p_salon_id: salonId,
          p_from: from,
          p_to: to,
          p_amount_cents: toCents(amount),
          p_comment: asString(input.comment),
        })
        if (error) return { ok: false, status: 'error', error: error.message }
        const row = (Array.isArray(data) ? data[0] : data) as { id: string } | null
        const fromLbl = snapshot.cash_registers?.find((r) => r.id === from)?.label ?? from
        const toLbl = snapshot.cash_registers?.find((r) => r.id === to)?.label ?? to
        return {
          ok: true,
          status: 'success',
          summary: `Перевод: ${fmtMoney(toCents(amount), currency)} ${fromLbl} → ${toLbl}`,
          entity_type: 'cash_transfer',
          entity_id: row?.id,
        }
      }

      default:
        return { ok: false, status: 'error', error: `unknown tool: ${toolName}` }
    }
  } catch (e) {
    return { ok: false, status: 'error', error: e instanceof Error ? e.message : String(e) }
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Claude tool-use loop
// ───────────────────────────────────────────────────────────────────────────

type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: ToolInput }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean }

type AnthropicMsg = { role: 'user' | 'assistant'; content: string | ContentBlock[] }

async function callClaudeRaw(
  systemPrompt: string,
  messages: AnthropicMsg[],
  withTools: boolean,
): Promise<{
  content: ContentBlock[]
  stop_reason: string
  input_tokens: number
  output_tokens: number
}> {
  const body: Record<string, unknown> = {
    model: MODEL,
    max_tokens: 2048,
    system: systemPrompt,
    messages,
  }
  if (withTools) body.tools = TOOLS

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const errText = await res.text()
    console.error('anthropic error', res.status, errText.slice(0, 500))
    throw new Error(`Claude API ${res.status}`)
  }

  const data = await res.json()
  return {
    content: (data.content ?? []) as ContentBlock[],
    stop_reason: data.stop_reason ?? '',
    input_tokens: data.usage?.input_tokens ?? 0,
    output_tokens: data.usage?.output_tokens ?? 0,
  }
}

type ToolCallRecord = {
  tool_name: string
  tool_input: ToolInput
  status: 'success' | 'error'
  result_summary?: string | null
  error_message?: string | null
  entity_type?: string | null
  entity_id?: string | null
}

async function runConversationLoop(
  admin: SupabaseClient,
  userId: string,
  salonId: string,
  systemPrompt: string,
  history: AnthropicMsg[],
  userMessage: string,
  snapshot: SnapshotRow,
  currency: string,
): Promise<{
  text: string
  tool_calls: ToolCallRecord[]
  input_tokens: number
  output_tokens: number
}> {
  const messages: AnthropicMsg[] = [...history, { role: 'user', content: userMessage }]
  const toolCalls: ToolCallRecord[] = []
  let totalIn = 0
  let totalOut = 0
  let finalText = ''

  // Max 4 tool-use rounds — защита от бесконечного цикла.
  for (let round = 0; round < 4; round++) {
    const resp = await callClaudeRaw(systemPrompt, messages, true)
    totalIn += resp.input_tokens
    totalOut += resp.output_tokens

    const textParts: string[] = []
    const toolUses: { id: string; name: string; input: ToolInput }[] = []
    for (const block of resp.content) {
      if (block.type === 'text') textParts.push(block.text)
      else if (block.type === 'tool_use')
        toolUses.push({ id: block.id, name: block.name, input: block.input })
    }
    finalText = textParts.join('\n').trim()

    if (resp.stop_reason !== 'tool_use' || toolUses.length === 0) {
      break
    }

    messages.push({ role: 'assistant', content: resp.content })

    const results = await Promise.all(
      toolUses.map(async (tu) => {
        const r = await execTool(admin, userId, salonId, tu.name, tu.input, snapshot, currency)
        toolCalls.push({
          tool_name: tu.name,
          tool_input: tu.input,
          status: r.ok ? 'success' : 'error',
          result_summary: r.summary ?? null,
          error_message: r.error ?? null,
          entity_type: r.entity_type ?? null,
          entity_id: r.entity_id ?? null,
        })
        const content = r.ok
          ? JSON.stringify({ ok: true, summary: r.summary, entity_id: r.entity_id })
          : JSON.stringify({ ok: false, error: r.error })
        return { tool_use_id: tu.id, content, is_error: !r.ok }
      }),
    )

    messages.push({
      role: 'user',
      content: results.map((r) => ({
        type: 'tool_result' as const,
        tool_use_id: r.tool_use_id,
        content: r.content,
        is_error: r.is_error,
      })),
    })
  }

  return { text: finalText, tool_calls: toolCalls, input_tokens: totalIn, output_tokens: totalOut }
}

// ───────────────────────────────────────────────────────────────────────────
// Handlers
// ───────────────────────────────────────────────────────────────────────────

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

  // Conversation
  let convId = conversationId
  if (!convId) {
    const { data: existing } = await admin
      .from('ai_conversations')
      .select('id')
      .eq('salon_id', salonId)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (existing) convId = existing.id
    else {
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
  if (snapErr) console.error('snapshot rpc failed', snapErr.message)
  const snapshot = (snapshotData ?? {}) as SnapshotRow

  // History (last 10 messages, as plain user/assistant text strings)
  const { data: histRows } = await admin
    .from('ai_messages')
    .select('role, content')
    .eq('conversation_id', convId)
    .order('created_at', { ascending: true })
  const history: AnthropicMsg[] = (histRows ?? [])
    .slice(-10)
    .map((r) => ({ role: r.role as 'user' | 'assistant', content: r.content as string }))

  // Save user message immediately
  await admin.from('ai_messages').insert({
    conversation_id: convId,
    role: 'user',
    content: message,
  })

  const todayIso = new Date().toISOString().slice(0, 10)
  const systemPrompt = buildSystemPrompt(snapshot, currency, salonName, locale, todayIso)

  let assistantText = ''
  let toolCalls: ToolCallRecord[] = []
  let inputTokens = 0
  let outputTokens = 0
  if (!ANTHROPIC_KEY) {
    assistantText =
      'Извини, AI пока не подключен — нужен ANTHROPIC_API_KEY в настройках Supabase. Свяжись с поддержкой.'
  } else {
    try {
      const result = await runConversationLoop(
        admin,
        userId,
        salonId,
        systemPrompt,
        history,
        message,
        snapshot,
        currency,
      )
      assistantText = result.text || '✓'
      toolCalls = result.tool_calls
      inputTokens = result.input_tokens
      outputTokens = result.output_tokens
    } catch (e) {
      assistantText = 'Не получилось получить ответ от AI. Попробуй ещё раз через минуту.'
      console.error('runConversationLoop failed', e instanceof Error ? e.message : e)
    }
  }

  // Save assistant message + tool_calls
  const { data: assistantMsg } = await admin
    .from('ai_messages')
    .insert({
      conversation_id: convId,
      role: 'assistant',
      content: assistantText,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
    })
    .select('id, content, created_at')
    .single()

  let savedToolCalls: unknown[] = []
  if (assistantMsg && toolCalls.length) {
    const rows = toolCalls.map((tc) => ({
      message_id: assistantMsg.id,
      salon_id: salonId,
      tool_name: tc.tool_name,
      tool_input: tc.tool_input,
      status: tc.status,
      result_summary: tc.result_summary,
      error_message: tc.error_message,
      entity_type: tc.entity_type,
      entity_id: tc.entity_id,
    }))
    const { data: inserted } = await admin
      .from('ai_tool_calls')
      .insert(rows)
      .select(
        'id, message_id, tool_name, tool_input, status, result_summary, error_message, entity_type, entity_id, undone_at, created_at',
      )
    savedToolCalls = inserted ?? []
  }

  await admin
    .from('ai_conversations')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', convId)

  return jsonResponse({
    ok: true,
    conversation_id: convId,
    message: assistantMsg,
    tool_calls: savedToolCalls,
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
    if (!latest)
      return jsonResponse({ ok: true, conversation_id: null, messages: [], tool_calls: [] })
    convId = latest.id
  }

  const { data: messages } = await admin
    .from('ai_messages')
    .select('id, role, content, created_at')
    .eq('conversation_id', convId)
    .order('created_at', { ascending: true })

  const messageIds = (messages ?? []).map((m) => m.id)
  let toolCalls: unknown[] = []
  if (messageIds.length) {
    const { data: tcs } = await admin
      .from('ai_tool_calls')
      .select(
        'id, message_id, tool_name, tool_input, status, result_summary, error_message, entity_type, entity_id, undone_at, created_at',
      )
      .in('message_id', messageIds)
    toolCalls = tcs ?? []
  }

  return jsonResponse({
    ok: true,
    conversation_id: convId,
    messages: messages ?? [],
    tool_calls: toolCalls,
  })
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

async function handleSuggestions(
  admin: SupabaseClient,
  userId: string,
  salonId: string,
  locale: 'ru' | 'pl' | 'en',
): Promise<Response> {
  if (!(await ensureMember(admin, userId, salonId))) {
    return jsonResponse({ ok: false, error: 'forbidden' }, 403)
  }
  const { data: snapshotData } = await admin.rpc('ai_salon_snapshot', { p_salon_id: salonId })
  const snapshot = (snapshotData ?? {}) as SnapshotRow
  const p = snapshot.problems ?? {}
  const top = snapshot.top_staff?.[0]?.name
  const suggestions: { prompt: string; reason?: string }[] = []

  const L = (ru: string, pl: string, en: string) =>
    locale === 'pl' ? pl : locale === 'en' ? en : ru

  if ((p.pending_visits_past ?? 0) > 0) {
    suggestions.push({
      prompt: L(
        `У меня ${p.pending_visits_past} визитов в pending — что делать?`,
        `Mam ${p.pending_visits_past} wizyt w pending — co robić?`,
        `I have ${p.pending_visits_past} pending visits — what to do?`,
      ),
    })
  }
  if ((p.staff_without_payout_scheme ?? 0) > 0) {
    suggestions.push({
      prompt: L(
        `У ${p.staff_without_payout_scheme} мастеров не настроена схема ЗП — подскажи как`,
        `${p.staff_without_payout_scheme} mistrzów bez schematu wynagrodzenia — podpowiedz`,
        `${p.staff_without_payout_scheme} masters have no payout scheme — help`,
      ),
    })
  }
  if ((p.unpaid_payouts_prev_month ?? 0) > 0) {
    suggestions.push({
      prompt: L(
        `Не закрыты ЗП-периоды за прошлый месяц — что делать?`,
        `Niezamknięte okresy wynagrodzeń za zeszły miesiąc — co robić?`,
        `Unpaid payout periods for last month — what now?`,
      ),
    })
  }
  if ((p.expenses_no_category_count ?? 0) > 0) {
    suggestions.push({
      prompt: L(
        `${p.expenses_no_category_count} расходов без категории за последний месяц — поможешь?`,
        `${p.expenses_no_category_count} wydatków bez kategorii — pomóż`,
        `${p.expenses_no_category_count} uncategorised expenses — help`,
      ),
    })
  }

  // Fallback общие подсказки до 4 шт
  if (suggestions.length < 4) {
    suggestions.push({
      prompt: L(
        'Сколько я заработал в этом месяце?',
        'Ile zarobiłem w tym miesiącu?',
        'How much did I earn this month?',
      ),
    })
  }
  if (suggestions.length < 4) {
    suggestions.push({
      prompt: L(
        top
          ? `Сколько принёс ${top} в этом месяце?`
          : 'Какой мастер приносит больше всего выручки?',
        top ? `Ile przyniósł ${top} w tym miesiącu?` : 'Który mistrz przynosi najwięcej?',
        top ? `How much did ${top} bring this month?` : 'Which master brings the most revenue?',
      ),
    })
  }
  if (suggestions.length < 4) {
    suggestions.push({
      prompt: L(
        'Сравни этот месяц с прошлым',
        'Porównaj ten miesiąc z poprzednim',
        'Compare this month to previous',
      ),
    })
  }

  return jsonResponse({ ok: true, suggestions: suggestions.slice(0, 4) })
}

async function handleUndo(
  admin: SupabaseClient,
  userId: string,
  toolCallId: string,
): Promise<Response> {
  const { data: tc } = await admin
    .from('ai_tool_calls')
    .select('*')
    .eq('id', toolCallId)
    .maybeSingle()
  if (!tc) return jsonResponse({ ok: false, error: 'not_found' }, 404)
  if (!(await ensureOwnerAdmin(admin, userId, tc.salon_id))) {
    return jsonResponse({ ok: false, error: 'forbidden' }, 403)
  }
  if (tc.undone_at) return jsonResponse({ ok: false, error: 'already_undone' }, 400)
  if (tc.status !== 'success' || !tc.entity_id || !tc.entity_type) {
    return jsonResponse({ ok: false, error: 'nothing_to_undo' }, 400)
  }

  const now = new Date().toISOString()
  let undoErr: string | null = null

  if (tc.entity_type === 'visit') {
    const { error } = await admin.from('visits').update({ deleted_at: now }).eq('id', tc.entity_id)
    if (error) undoErr = error.message
  } else if (tc.entity_type === 'expense') {
    const { error } = await admin
      .from('expenses')
      .update({ deleted_at: now })
      .eq('id', tc.entity_id)
    if (error) undoErr = error.message
  } else if (tc.entity_type === 'client') {
    const { error } = await admin.from('clients').update({ deleted_at: now }).eq('id', tc.entity_id)
    if (error) undoErr = error.message
  } else if (tc.entity_type === 'service') {
    const { error } = await admin
      .from('services')
      .update({ is_archived: true })
      .eq('id', tc.entity_id)
    if (error) undoErr = error.message
  } else if (tc.entity_type === 'cash_transfer') {
    const { error } = await admin.rpc('cash_transfer_soft_delete', {
      p_id: tc.entity_id,
      p_reason: 'Отменено AI-помощником',
    })
    if (error) undoErr = error.message
  } else {
    return jsonResponse({ ok: false, error: 'unsupported_entity_type' }, 400)
  }

  if (undoErr) return jsonResponse({ ok: false, error: undoErr }, 500)

  await admin
    .from('ai_tool_calls')
    .update({ undone_at: now, undone_by: userId, status: 'undone' })
    .eq('id', toolCallId)

  return jsonResponse({ ok: true })
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
      tool_call_id?: string
    }
    try {
      body = await req.json()
    } catch {
      return jsonResponse({ ok: false, error: 'bad_request' }, 400)
    }

    const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    })

    // undo_tool_call не требует salon_id — берёт его из самой записи tool_call
    if (body.action === 'undo_tool_call') {
      if (!body.tool_call_id)
        return jsonResponse({ ok: false, error: 'tool_call_id_required' }, 400)
      return handleUndo(admin, userId, body.tool_call_id)
    }

    if (!body.salon_id) return jsonResponse({ ok: false, error: 'salon_id_required' }, 400)

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
      case 'suggestions':
        return handleSuggestions(admin, userId, body.salon_id, normalizeLocale(body.locale))
      default:
        return jsonResponse({ ok: false, error: 'unknown_action' }, 400)
    }
  }),
)
