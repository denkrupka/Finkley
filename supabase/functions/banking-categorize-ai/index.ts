/**
 * banking-categorize-ai — распределение банковских расходов по категориям.
 *
 * Порядок (запрос юзера 02.07):
 *   1. ПРАВИЛА: enabled bank_tx_rules салона (те же, что в banking-sync,
 *      matcher из _shared/bank-rule-match.ts). Берём только action
 *      set_category — ignore/set_counterparty к УЖЕ созданным expenses не
 *      применяем (это семантика синка, не перекатегоризации).
 *   2. AI: всё, что после правил осталось «Банк (без категории)» /
 *      «БЕЗ КАТЕГОРИИ» / без категории, уходит одним batch-запросом (чанки)
 *      в Claude вместе со списком категорий ЭТОГО салона. AI выбирает
 *      category_id из списка или null («не уверен» — оставляем как есть).
 *
 * Цели: только expenses с source bank_import/bank_ai и категорией-заглушкой.
 * Расходы, которым юзер уже вручную выставил осмысленную категорию, не
 * трогаем — кнопка не должна перетирать ручную работу.
 *
 * Вызов: из browser-клиента (Authorization: Bearer <jwt>), body { salon_id }.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.6'

import { getSalonMembership, getUserFromRequest } from '../_shared/auth.ts'
import { corsHeaders, preflight } from '../_shared/cors.ts'
import { findFirstMatch, type RuleLike, type RuleTxLike } from '../_shared/bank-rule-match.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const ANTHROPIC_KEY = Deno.env.get('ANTHROPIC_API_KEY') ?? ''

/** Категории-заглушки: расходы в них считаются «нераспределёнными». */
const FALLBACK_CATEGORY_NAMES = ['Банк (без категории)', 'БЕЗ КАТЕГОРИИ']
/** Максимум расходов за один вызов функции (защита walltime). */
const MAX_TARGETS = 300
/** Размер чанка для одного запроса в Claude. */
const AI_CHUNK = 60
const AI_MODEL = 'claude-haiku-4-5-20251001'

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'content-type': 'application/json' },
  })
}

type TargetExpense = {
  id: string
  category_id: string | null
  expense_at: string
  amount_cents: number
  contractor_name: string | null
  description: string | null
  comment: string | null
  source: string
  bank_transaction_id: string | null
  metadata: Record<string, unknown> | null
}

/**
 * Нормализованные поля для матчера правил и AI-промпта.
 *
 * ВАЖНО: banking-sync при создании bank_import-расхода кладёт контрагента
 * транзакции в expenses.description, назначение платежа — в expenses.comment,
 * а contractor_name оставляет NULL. Без этого маппинга правила с условием по
 * counterparty никогда бы не матчились, а AI видел бы имя контрагента под
 * видом назначения. Канонический источник — сама bank_transactions (учитывает
 * и контрагентов, извлечённых extract-counterparty ПОСЛЕ создания расхода).
 */
function normalizeExpenseFields(
  exp: TargetExpense,
  tx: { counterparty: string | null; description: string | null } | undefined,
): { counterparty: string | null; purpose: string | null } {
  if (tx) return { counterparty: tx.counterparty, purpose: tx.description }
  if (exp.source === 'bank_import') {
    return {
      counterparty: exp.description === 'Банк' ? null : exp.description,
      purpose: exp.comment,
    }
  }
  return { counterparty: exp.contractor_name, purpose: exp.description }
}

type RuleRow = RuleLike & {
  id: string
  name: string
  actions: Array<
    | { type: 'set_category'; category_id: string }
    | { type: 'set_counterparty'; counterparty: string }
    | { type: 'ignore' }
  >
}

type AiRow = TargetExpense & { counterparty: string | null; purpose: string | null }

async function claudeAssignments(
  categories: Array<{ id: string; name: string }>,
  expenses: AiRow[],
): Promise<Map<string, string>> {
  const system = `Ты — финансовый ассистент салона красоты. Распредели банковские расходы по категориям расходов салона.
Правила:
- Используй ТОЛЬКО category_id из списка КАТЕГОРИИ. Не выдумывай id.
- Смотри на контрагента и назначение платежа. Пример: аптека/дрогерия → материалы; ZUS/US → налоги; топливо → транспорт (если такая категория есть).
- Если по данным нельзя уверенно выбрать категорию — верни null, НЕ угадывай.
- Ответ СТРОГО JSON без markdown: {"assignments":[{"id":"<expense_id>","category_id":"<uuid или null>"}]}. По одной записи на каждый расход.`
  const prompt = `КАТЕГОРИИ (id — name):
${categories.map((c) => `${c.id} — ${c.name}`).join('\n')}

РАСХОДЫ (id | дата | сумма | контрагент | назначение):
${expenses
  .map(
    (e) =>
      `${e.id} | ${e.expense_at} | ${(e.amount_cents / 100).toFixed(2)} | ${(
        e.counterparty ?? '—'
      ).slice(0, 80)} | ${(e.purpose ?? '—').slice(0, 140)}`,
  )
  .join('\n')}`

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: AI_MODEL,
      max_tokens: 4000,
      system,
      messages: [{ role: 'user', content: prompt }],
    }),
  })
  if (!res.ok) throw new Error(`claude ${res.status}: ${await res.text()}`)
  const data = await res.json()
  const block = data.content?.[0]
  if (block?.type !== 'text') throw new Error('claude non-text response')
  const match = (block.text as string).match(/\{[\s\S]*\}/)
  if (!match) throw new Error('claude returned non-json')
  const parsed = JSON.parse(match[0]) as {
    assignments?: Array<{ id?: string; category_id?: string | null }>
  }
  const allowed = new Set(categories.map((c) => c.id))
  const out = new Map<string, string>()
  for (const a of parsed.assignments ?? []) {
    if (a.id && a.category_id && allowed.has(a.category_id)) out.set(a.id, a.category_id)
  }
  return out
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return preflight()
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)
  if (!ANTHROPIC_KEY) return json({ error: 'anthropic_key_missing' }, 500)

  const user = await getUserFromRequest(req, SUPABASE_URL, SERVICE_KEY)
  if (!user) return json({ error: 'unauthorized' }, 401)

  let body: { salon_id?: string; scope?: string }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'bad_request' }, 400)
  }
  const salonId = body.salon_id
  if (!salonId) return json({ error: 'salon_id_required' }, 400)
  // scope='bank' (default) — только банковские расходы (bank_import/bank_ai).
  // scope='all' — второй прогон по подтверждению юзера: ВСЕ расходы в
  // категориях-заглушках независимо от источника (KSeF, вручную, ...),
  // кроме системных авто-комиссий.
  const scope: 'bank' | 'all' = body.scope === 'all' ? 'all' : 'bank'

  const membership = await getSalonMembership(SUPABASE_URL, SERVICE_KEY, user.userId, salonId)
  if (!membership || !['owner', 'admin'].includes(membership.role)) {
    return json({ error: 'forbidden' }, 403)
  }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  // Категории салона: живые пользовательские — кандидаты для AI, заглушки —
  // маркер «не распределён». Системные (is_system: «Комиссии», «ЗАРПЛАТЫ»,
  // «БЕЗ КАТЕГОРИИ», «Банк (без категории)») в кандидаты не идут — они
  // скрыты и из UI-выпадашек, у них своя механика (авто-комиссии, payouts).
  const { data: catsRaw, error: catsErr } = await admin
    .from('expense_categories')
    .select('id, name, is_archived, is_system')
    .eq('salon_id', salonId)
    .eq('is_archived', false)
  if (catsErr) return json({ error: catsErr.message }, 500)
  const cats = (catsRaw ?? []) as Array<{ id: string; name: string; is_system: boolean }>
  const fallbackIds = cats.filter((c) => FALLBACK_CATEGORY_NAMES.includes(c.name)).map((c) => c.id)
  const aiCategories = cats.filter((c) => !c.is_system && !FALLBACK_CATEGORY_NAMES.includes(c.name))
  if (aiCategories.length === 0) {
    return json({ ok: true, targets: 0, rules_applied: 0, ai_applied: 0, ai_unsure: 0 })
  }

  // Целевые расходы: банковские, в заглушке или вовсе без категории.
  const orFilter =
    fallbackIds.length > 0
      ? `category_id.is.null,category_id.in.(${fallbackIds.join(',')})`
      : 'category_id.is.null'
  let targetsQuery = admin
    .from('expenses')
    .select(
      'id, category_id, expense_at, amount_cents, contractor_name, description, comment, source, bank_transaction_id, metadata',
    )
    .eq('salon_id', salonId)
    .is('deleted_at', null)
    .or(orFilter)
  if (scope === 'bank') {
    targetsQuery = targetsQuery.in('source', ['bank_import', 'bank_ai'])
  } else {
    // NULL-safe исключение авто-комиссий: .neq выкинул бы source IS NULL.
    targetsQuery = targetsQuery.or('source.is.null,source.neq.auto_commission')
  }
  const { data: targetsRaw, error: targetsErr } = await targetsQuery
    .order('expense_at', { ascending: false })
    .limit(MAX_TARGETS)
  if (targetsErr) return json({ error: targetsErr.message }, 500)
  const targets = (targetsRaw ?? []) as TargetExpense[]

  // Сколько НЕбанковских расходов сидит в заглушках (KSeF/вручную): клиент
  // после банковского прогона спросит юзера «распределить и их?» → scope='all'.
  let otherUncategorized = 0
  if (scope === 'bank') {
    const { data: stubRows } = await admin
      .from('expenses')
      .select('id, source')
      .eq('salon_id', salonId)
      .is('deleted_at', null)
      .or(orFilter)
      .limit(1000)
    otherUncategorized = ((stubRows ?? []) as Array<{ source: string | null }>).filter(
      (r) => r.source !== 'bank_import' && r.source !== 'bank_ai' && r.source !== 'auto_commission',
    ).length
  }

  if (targets.length === 0) {
    return json({
      ok: true,
      targets: 0,
      rules_applied: 0,
      rule_ignored: 0,
      ai_applied: 0,
      ai_unsure: 0,
      truncated: false,
      other_uncategorized: otherUncategorized,
    })
  }

  // Канонические поля контрагент/назначение — из связанных bank_transactions.
  const txIds = targets.map((e) => e.bank_transaction_id).filter((v): v is string => !!v)
  const txById = new Map<string, { counterparty: string | null; description: string | null }>()
  if (txIds.length > 0) {
    const { data: txRows } = await admin
      .from('bank_transactions')
      .select('id, counterparty, description')
      .in('id', txIds)
    for (const r of (txRows ?? []) as Array<{
      id: string
      counterparty: string | null
      description: string | null
    }>) {
      txById.set(r.id, { counterparty: r.counterparty, description: r.description })
    }
  }

  // ─── Шаг 1: правила ───────────────────────────────────────────────────
  const { data: rulesRaw } = await admin
    .from('bank_tx_rules')
    .select('id, name, enabled, applies_to, conditions, actions, sort_order, created_at')
    .eq('salon_id', salonId)
    .eq('enabled', true)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })
  const rules = (rulesRaw ?? []) as RuleRow[]

  let rulesApplied = 0
  let ruleIgnored = 0
  const remaining: AiRow[] = []
  for (const exp of targets) {
    const { counterparty, purpose } = normalizeExpenseFields(
      exp,
      exp.bank_transaction_id ? txById.get(exp.bank_transaction_id) : undefined,
    )
    let categoryId: string | null = null
    let ruleMeta: { rule_id: string; rule_name: string } | null = null
    // Правила банкинга применяем только к расходам, связанным с банком:
    // для KSeF/ручных (scope='all') семантика bank_tx_rules не определена.
    const rulesEligible =
      exp.source === 'bank_import' || exp.source === 'bank_ai' || !!exp.bank_transaction_id
    if (rules.length > 0 && rulesEligible) {
      const txLike: RuleTxLike = {
        type: 'debit',
        counterparty,
        description: purpose,
        amount_cents: exp.amount_cents,
      }
      const matched = findFirstMatch(rules, txLike)
      // ignore-правило = «личная трата, не мой расход». Уже созданный expense
      // не удаляем (это решение юзера), но и в AI-категоризацию не отдаём —
      // иначе AI «узаконит» расход, который юзер правилом исключил.
      if (matched?.actions.some((a) => a.type === 'ignore')) {
        ruleIgnored++
        continue
      }
      const setCategory = matched?.actions.find(
        (a): a is { type: 'set_category'; category_id: string } => a.type === 'set_category',
      )
      // Заглушку правило тоже может указывать — её не считаем распределением.
      if (setCategory && !fallbackIds.includes(setCategory.category_id)) {
        categoryId = setCategory.category_id
        ruleMeta = { rule_id: matched!.id, rule_name: matched!.name }
      }
    }
    if (categoryId && ruleMeta) {
      const { error: updErr } = await admin
        .from('expenses')
        .update({
          category_id: categoryId,
          metadata: { ...(exp.metadata ?? {}), categorized_by: 'rule', ...ruleMeta },
        })
        .eq('id', exp.id)
      if (!updErr) rulesApplied++
      else remaining.push({ ...exp, counterparty, purpose })
    } else {
      remaining.push({ ...exp, counterparty, purpose })
    }
  }

  // ─── Шаг 2: AI для остатка ───────────────────────────────────────────
  let aiApplied = 0
  let aiUnsure = 0
  for (let i = 0; i < remaining.length; i += AI_CHUNK) {
    const chunk = remaining.slice(i, i + AI_CHUNK)
    let assignments: Map<string, string>
    try {
      assignments = await claudeAssignments(aiCategories, chunk)
    } catch (e) {
      console.error('banking-categorize-ai claude error:', e)
      // Частичный успех лучше падения: возвращаем то, что уже применили.
      return json({
        ok: true,
        targets: targets.length,
        rules_applied: rulesApplied,
        rule_ignored: ruleIgnored,
        ai_applied: aiApplied,
        ai_unsure: aiUnsure + (remaining.length - i),
        truncated: targets.length === MAX_TARGETS,
        other_uncategorized: otherUncategorized,
        ai_error: e instanceof Error ? e.message : String(e),
      })
    }
    for (const exp of chunk) {
      const categoryId = assignments.get(exp.id)
      if (!categoryId) {
        aiUnsure++
        continue
      }
      const { error: updErr } = await admin
        .from('expenses')
        .update({
          category_id: categoryId,
          metadata: {
            ...(exp.metadata ?? {}),
            categorized_by: 'ai',
            ai_model: AI_MODEL,
            ai_categorized_at: new Date().toISOString(),
          },
        })
        .eq('id', exp.id)
      if (!updErr) aiApplied++
      else aiUnsure++
    }
  }

  return json({
    ok: true,
    targets: targets.length,
    rules_applied: rulesApplied,
    rule_ignored: ruleIgnored,
    ai_applied: aiApplied,
    ai_unsure: aiUnsure,
    // Выборка ограничена MAX_TARGETS: если упёрлись в лимит — за бортом
    // могли остаться ещё цели, клиент подскажет нажать кнопку повторно.
    truncated: targets.length === MAX_TARGETS,
    other_uncategorized: otherUncategorized,
  })
})
