/**
 * banking-sync — тянет транзакции из Enable Banking и пишет:
 *   - все транзакции в bank_transactions (raw audit-trail, дедуп по
 *     unique(account_id, external_id))
 *   - debits — также в expenses (категория «Банк (без категории)») со
 *     ссылкой bank_transaction_id ↔ expense.bank_transaction_id
 *   - credits — только в bank_transactions (показываем в отдельном
 *     виджете «Поступления», не плодим автоматически revenue-строки)
 *
 * Может вызываться:
 *   1. Из browser-клиента (Authorization: Bearer <session-jwt>) — для
 *      ручного "Sync now" кнопкой. Body: { connection_id }
 *   2. Server-to-server из cron'а или banking-callback — без JWT, по
 *      shared FUNCTION_INTERNAL_SECRET. Body: { connection_id, secret }
 *      (deploy --no-verify-jwt)
 *
 * Idempotent: повторный sync не плодит дубли (UPSERT с onConflict).
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.6'

import { getSalonMembership, getUserFromRequest } from '../_shared/auth.ts'
import { corsHeaders, preflight } from '../_shared/cors.ts'
import {
  counterpartyName,
  listTransactions,
  parseAmount,
  transactionDate,
  transactionDescription,
  transactionExternalId,
  type EbConfig,
  type EbTransaction,
} from '../_shared/enable-banking.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const APP_ID = Deno.env.get('ENABLE_BANKING_APP_ID') ?? ''
const PRIVATE_KEY = Deno.env.get('ENABLE_BANKING_PRIVATE_KEY') ?? ''
const INTERNAL_SECRET = Deno.env.get('FUNCTION_INTERNAL_SECRET') ?? ''

const BANK_CATEGORY_NAME = 'Банк (без категории)'

/**
 * Эвристика для извлечения имени продавца из bank-tx description.
 * POS-операции PL банков часто содержат имя магазина в верхнем регистре,
 * за которым следуют место/код/дата:
 *   "ROSSMANN 21 POZNAN POL 2026-05-22"        → "ROSSMANN 21"
 *   "LIDL OSTROWSKA Poznan POL 2026-05-22"     → "LIDL OSTROWSKA"
 *   "PL KFC POZNAN STATOIL POZNAN POL 2026-..." → "PL KFC POZNAN STATOIL"
 *   "Revolut**3322* Dublin IRL"                 → "Revolut"
 *   "APPLE.COM/BILL APPLE.COM/BIL IRL"          → "APPLE.COM"
 * Возвращает null если эвристика не нашла осмысленного имени.
 */
function extractCounterpartyFromDescription(description: string): string | null {
  const text = description.trim()
  if (!text) return null
  // Pattern 1: leading UPPERCASE-words (минимум 2 буквы) — PL POS-формат
  const upper = text.match(/^([A-Z][A-Z0-9.\-]*(?:\s+[A-Z][A-Z0-9.\-]*){0,3})\b/)
  if (upper && upper[1].length >= 3) {
    // Cut at common geo-noise tokens (POZNAN, WARSZAWA, POL, IRL, DE, etc.)
    const cleaned = upper[1]
      .replace(
        /\b(POZNAN|POZNA|WARSZAWA|KRAKOW|GDANSK|WROCLAW|LODZ|POL|PL|IRL|DE|US|UK|GB)\b.*$/,
        '',
      )
      .trim()
    return cleaned.length >= 3 ? cleaned.slice(0, 200) : upper[1].slice(0, 200)
  }
  // Pattern 2: домен-like (APPLE.COM, GOOGLE.COM)
  const domain = text.match(/^([A-Z][A-Z0-9]*\.(?:COM|PL|EU|NET|ORG))/i)
  if (domain) return domain[1].slice(0, 200)
  // Pattern 3: первое слово с большой буквы (Revolut, Enea, Spotify) — берём
  // если длина >= 4 символов, чтобы не цеплять предлоги.
  const word = text.match(/^([A-ZА-Я][a-zа-я]{3,}(?:\*+[A-Za-z0-9]+)?)/)
  if (word) return word[1].slice(0, 200)
  return null
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'content-type': 'application/json' },
  })
}

function timingSafeEqual(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return preflight()
  if (req.method !== 'POST') return jsonResponse({ error: 'method_not_allowed' }, 405)

  if (!APP_ID || !PRIVATE_KEY) {
    return jsonResponse({ error: 'enable_banking_not_configured' }, 500)
  }

  let body: {
    connection_id?: string
    secret?: string
    cron_token?: string
    is_initial?: boolean
  }
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: 'bad_request' }, 400)
  }
  if (!body.connection_id) return jsonResponse({ error: 'missing_connection_id' }, 400)

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  // Auth: три варианта:
  //   1) FUNCTION_INTERNAL_SECRET в body.secret — для callback'а после
  //      successful bank-auth (сразу запустить первичный sync)
  //   2) cron_token из bank_sync_triggers — для pg_cron'а (one-shot,
  //      потребляется при использовании, истекает через 15 мин)
  //   3) user-JWT с membership-check — для ручного «Sync now» из UI
  const isInternalSecret = body.secret && timingSafeEqual(body.secret, INTERNAL_SECRET)
  let isCronToken = false
  if (!isInternalSecret && body.cron_token) {
    const { data: trig } = await admin
      .from('bank_sync_triggers')
      .select('token, connection_id, expires_at, consumed_at')
      .eq('token', body.cron_token)
      .maybeSingle()
    if (
      trig &&
      trig.connection_id === body.connection_id &&
      !trig.consumed_at &&
      new Date(trig.expires_at as string) > new Date()
    ) {
      isCronToken = true
      // Консьюмим — токен одноразовый
      await admin
        .from('bank_sync_triggers')
        .update({ consumed_at: new Date().toISOString() })
        .eq('token', body.cron_token)
    }
  }
  if (!isInternalSecret && !isCronToken) {
    const user = await getUserFromRequest(req, SUPABASE_URL, SERVICE_KEY)
    if (!user) return jsonResponse({ error: 'unauthorized' }, 401)
    const { data: conn, error: connErr } = await admin
      .from('bank_connections')
      .select('salon_id')
      .eq('id', body.connection_id)
      .maybeSingle()
    if (connErr || !conn) return jsonResponse({ error: 'connection_not_found' }, 404)
    const m = await getSalonMembership(SUPABASE_URL, SERVICE_KEY, user.userId, conn.salon_id)
    if (!m || !['owner', 'admin'].includes(m.role)) {
      return jsonResponse({ error: 'forbidden' }, 403)
    }
  }

  const result = await syncConnection(admin, body.connection_id, body.is_initial ?? false)
  return jsonResponse(result, result.error ? 502 : 200)
})

// =============================================================================
// Core sync logic
// =============================================================================

type SyncResult = {
  ok: boolean
  error?: string
  accounts_synced: number
  tx_total: number
  tx_new: number
  expenses_created: number
}

async function syncConnection(
  admin: ReturnType<typeof createClient>,
  connectionId: string,
  isInitial: boolean,
): Promise<SyncResult> {
  const { data: conn, error: connErr } = await admin
    .from('bank_connections')
    .select('id, salon_id, status, history_days, last_synced_at, valid_until')
    .eq('id', connectionId)
    .maybeSingle()
  if (connErr || !conn) {
    return {
      ok: false,
      error: 'connection_not_found',
      accounts_synced: 0,
      tx_total: 0,
      tx_new: 0,
      expenses_created: 0,
    }
  }

  if (conn.status !== 'connected') {
    return {
      ok: false,
      error: `connection_status=${conn.status}`,
      accounts_synced: 0,
      tx_total: 0,
      tx_new: 0,
      expenses_created: 0,
    }
  }

  // Проверяем, не истекла ли сессия
  if (conn.valid_until && new Date(conn.valid_until) < new Date()) {
    await admin
      .from('bank_connections')
      .update({ status: 'expired', last_error: 'consent_expired' })
      .eq('id', connectionId)
    return {
      ok: false,
      error: 'consent_expired',
      accounts_synced: 0,
      tx_total: 0,
      tx_new: 0,
      expenses_created: 0,
    }
  }

  const { data: accounts, error: accErr } = await admin
    .from('bank_accounts')
    .select('id, external_id, currency, iban')
    .eq('connection_id', connectionId)
    .eq('is_active', true)
  if (accErr) {
    return {
      ok: false,
      error: accErr.message,
      accounts_synced: 0,
      tx_total: 0,
      tx_new: 0,
      expenses_created: 0,
    }
  }

  // Гарантируем что есть seed-категория «Банк (без категории)» для салона.
  // Создаём только если нет — без upsert (нет уникального constraint на name).
  const bankCatId = await ensureBankCategory(admin, conn.salon_id)

  const cfg: EbConfig = { appId: APP_ID, privateKeyPem: PRIVATE_KEY }
  let txTotal = 0
  let txNew = 0
  let expensesCreated = 0
  let pendingCount = 0

  // Range: при первом синке тащим conn.history_days назад. При следующих —
  // от last_synced_at − 7 дней (overlap для свежесозданных booked транзакций).
  const dateTo = new Date()
  let dateFrom: Date
  if (isInitial || !conn.last_synced_at) {
    dateFrom = new Date(Date.now() - conn.history_days * 24 * 60 * 60 * 1000)
  } else {
    const overlap = 7 * 24 * 60 * 60 * 1000
    dateFrom = new Date(new Date(conn.last_synced_at).getTime() - overlap)
  }
  const rangeTo = dateTo.toISOString().slice(0, 10)

  // T32 — fix incorrectly-narrow sync window. Bank Millennium часто отдаёт
  // только последние ~3 дня если dateFrom близок к now (вторичный quirk
  // некоторых aspsp). Гарантируем минимум 30 дней истории при каждом sync
  // (не только initial), чтобы поймать lazy-booked tx через 1–7 дней.
  const MIN_WINDOW_MS = 30 * 24 * 60 * 60 * 1000
  if (dateTo.getTime() - dateFrom.getTime() < MIN_WINDOW_MS) {
    dateFrom = new Date(dateTo.getTime() - MIN_WINDOW_MS)
  }
  // Bug b02625bb (Елена 02.06): при подключении банка тянуть данные минимум
  // с 1 числа предыдущего месяца (например 2 июня → с 1 мая). Это гарантирует
  // что юзер увидит весь предыдущий месяц + текущий, для нормальной аналитики.
  // Применяется только на is_initial (первый sync) — для incremental sync'ов
  // overlap = 7 дней достаточно.
  if (isInitial) {
    const firstOfPrevMonth = new Date(dateTo.getFullYear(), dateTo.getMonth() - 1, 1)
    if (dateFrom.getTime() > firstOfPrevMonth.getTime()) {
      dateFrom = firstOfPrevMonth
    }
  }
  const effectiveFrom = dateFrom.toISOString().slice(0, 10)

  for (const acc of accounts ?? []) {
    let txs: EbTransaction[] = []
    try {
      txs = await listTransactions(cfg, acc.external_id as string, {
        dateFrom: effectiveFrom,
        dateTo: rangeTo,
      })
      console.log(
        `[banking-sync] listTransactions account=${acc.external_id} from=${effectiveFrom} to=${rangeTo} got=${txs.length}`,
      )
    } catch (e) {
      console.error('listTransactions failed', acc.external_id, e)
      await admin
        .from('bank_connections')
        .update({ last_error: e instanceof Error ? e.message : String(e) })
        .eq('id', connectionId)
      continue
    }
    txTotal += txs.length
    pendingCount += txs.filter((t) => t.status === 'PDNG').length

    const { newCount, expCount } = await persistTransactions(admin, {
      accountId: acc.id as string,
      salonId: conn.salon_id as string,
      currency: (acc.currency as string) ?? 'PLN',
      bankCategoryId: bankCatId,
      txs,
    })
    txNew += newCount
    expensesCreated += expCount
  }

  // Bug 03.06 (Денис): применяем bank_tx_rules к новым tx ПОСЛЕ persist.
  // 1) action='ignore' → bank_transactions.is_personal=true (тег Личное).
  // 2) action='auto_create' → создаём expense (source='bank_ai') если нет
  //    дубля по сумме (±1 PLN) и дате (±3 дня).
  await applyBankTxRules(admin, conn.salon_id as string)

  await admin
    .from('bank_connections')
    .update({
      last_synced_at: new Date().toISOString(),
      last_error: null,
      pending_today_count: pendingCount,
    })
    .eq('id', connectionId)

  return {
    ok: true,
    accounts_synced: accounts?.length ?? 0,
    tx_total: txTotal,
    tx_new: txNew,
    pending: pendingCount,
    expenses_created: expensesCreated,
  }
}

async function ensureBankCategory(
  admin: ReturnType<typeof createClient>,
  salonId: string,
): Promise<string | null> {
  const { data: existing } = await admin
    .from('expense_categories')
    .select('id')
    .eq('salon_id', salonId)
    .eq('name', BANK_CATEGORY_NAME)
    .is('is_archived', false)
    .maybeSingle()
  if (existing) return existing.id as string
  const { data: created, error } = await admin
    .from('expense_categories')
    .insert({
      salon_id: salonId,
      name: BANK_CATEGORY_NAME,
      is_system: false,
      sort_order: 999,
    })
    .select('id')
    .single()
  if (error) {
    console.warn('ensureBankCategory failed', error)
    return null
  }
  return created.id as string
}

async function persistTransactions(
  admin: ReturnType<typeof createClient>,
  ctx: {
    accountId: string
    salonId: string
    currency: string
    bankCategoryId: string | null
    txs: EbTransaction[]
  },
): Promise<{ newCount: number; expCount: number }> {
  // T32 — детальное логирование чтобы диагностировать почему провайдер
  // возвращает «зелёную галочку» но новых tx нет. Видно в логе:
  //   - сколько всего пришло из API
  //   - сколько booked vs pending
  //   - сколько отфильтровано как дубль (existingIds)
  //   - сколько в итоге записано
  console.log(
    `[banking-sync] salon=${ctx.salonId} account=${ctx.accountId} provider_total=${ctx.txs.length}`,
  )
  if (ctx.txs.length === 0) {
    console.log(`[banking-sync] salon=${ctx.salonId} provider returned 0 transactions`)
    return { newCount: 0, expCount: 0 }
  }

  // Делим транзакции на booked (BOOK/BOOKED/unknown) и pending (PDNG).
  // PDNG сохраняем со status='pending' (см. миграцию 20260601000003) —
  // юзер хочет видеть свежие транзакции, а не ждать 1–24 часа booking.
  // При следующем sync PDNG → BOOK upsert через UNIQUE (account_id,external_id)
  // апдейтит status='booked' и финальную сумму. expense из pending НЕ
  // создаём (сумма может поменяться).
  const booked = ctx.txs.filter((t) => !t.status || t.status === 'BOOK' || t.status === 'BOOKED')
  const pending = ctx.txs.filter((t) => t.status === 'PDNG')
  if (pending.length > 0) {
    console.log(`[banking-sync] salon=${ctx.salonId} pending=${pending.length} (saved as PDNG)`)
  }

  const mapRow = (t: EbTransaction, status: 'booked' | 'pending') => {
    const { amountCents, type } = parseAmount(t)
    const description = transactionDescription(t)
    const explicit = counterpartyName(t)?.slice(0, 200) ?? null
    const fromDescription = explicit ? null : extractCounterpartyFromDescription(description)
    return {
      account_id: ctx.accountId,
      external_id: transactionExternalId(t),
      type,
      amount_cents: amountCents,
      currency: t.transaction_amount.currency || ctx.currency,
      description: description.slice(0, 500) || null,
      counterparty: explicit ?? fromDescription,
      executed_at: new Date(transactionDate(t)).toISOString(),
      status,
      raw: t as unknown as Record<string, unknown>,
    }
  }

  const txRows = booked.map((t) => mapRow(t, 'booked'))
  const pendingRows = pending.map((t) => mapRow(t, 'pending'))

  // Pending — upsert с обновлением status/amount (при PDNG→PDNG значения
  // могут чуть меняться, при PDNG→BOOK будет следующий sync). Делаем
  // отдельным запросом перед booked.
  if (pendingRows.length > 0) {
    await admin
      .from('bank_transactions')
      .upsert(pendingRows, { onConflict: 'account_id,external_id', ignoreDuplicates: false })
  }

  // Booked — двухшаговый процесс: select existing → insert новых. Не
  // апдейтим существующие booked (auto-expense уже создан, не пере-создаём).
  const { data: existingRows } = await admin
    .from('bank_transactions')
    .select('id, external_id, status')
    .eq('account_id', ctx.accountId)
    .in(
      'external_id',
      txRows.map((r) => r.external_id),
    )
  const existingIds = new Set((existingRows ?? []).map((r) => r.external_id))
  // PDNG → BOOK переход: для existing pending апдейтим status на booked
  // (auto-expense будет создан ниже в expense-create блоке).
  const pendingToBookedIds = (existingRows ?? [])
    .filter((r) => r.status === 'pending')
    .map((r) => r.external_id)
  if (pendingToBookedIds.length > 0) {
    await admin
      .from('bank_transactions')
      .update({ status: 'booked' })
      .eq('account_id', ctx.accountId)
      .in('external_id', pendingToBookedIds)
  }
  const newRows = txRows.filter((r) => !existingIds.has(r.external_id))
  console.log(
    `[banking-sync] salon=${ctx.salonId} booked=${booked.length} duplicates=${existingIds.size} to_insert=${newRows.length}`,
  )
  if (newRows.length === 0) return { newCount: 0, expCount: 0 }

  const { data: insertedTxs, error: txErr } = await admin
    .from('bank_transactions')
    .insert(newRows)
    .select('id, type, amount_cents, currency, description, executed_at, external_id')
  if (txErr || !insertedTxs) {
    console.error('insert bank_transactions', txErr)
    return { newCount: 0, expCount: 0 }
  }

  // Достаём также counterparty + description новых транзакций для match-логики
  const { data: insertedFull } = await admin
    .from('bank_transactions')
    .select('id, type, amount_cents, currency, description, counterparty, executed_at, external_id')
    .in(
      'id',
      insertedTxs.map((t) => t.id as string),
    )

  let expCount = 0
  for (const t of insertedFull ?? []) {
    if (t.type === 'debit') {
      const matched = await tryAutoMatchExpense(admin, ctx.salonId, t)
      if (!matched) {
        // Ничего похожего не нашли — создаём авто-expense (старое поведение,
        // но с пометкой needs_review чтобы оператор подтвердил категорию).
        const { data: newExp, error: expErr } = await admin
          .from('expenses')
          .insert({
            salon_id: ctx.salonId,
            category_id: ctx.bankCategoryId,
            expense_at: String(t.executed_at).slice(0, 10),
            amount_cents: t.amount_cents,
            payment_method: 'transfer',
            description: (t.counterparty as string | null) ?? 'Банк',
            comment: (t.description as string | null) ?? null,
            source: 'bank_import',
            bank_transaction_id: t.id,
            metadata: { bank_external_id: t.external_id, currency: t.currency },
          })
          .select('id')
          .single()
        if (expErr) {
          console.error('insert expense (bank import)', expErr)
        } else if (newExp) {
          await admin
            .from('bank_transactions')
            .update({ expense_id: newExp.id, needs_review: true })
            .eq('id', t.id)
          expCount += 1
        }
      }
    } else if (t.type === 'credit') {
      await tryAutoMatchOtherIncome(admin, ctx.salonId, t)
    }
  }

  return { newCount: insertedTxs.length, expCount }
}

type AutoMatchTx = {
  id: string
  type: 'debit' | 'credit'
  amount_cents: number
  description: string | null
  counterparty: string | null
  executed_at: string
}

/**
 * Авто-матчинг debit-транзакции к существующему expense.
 *
 * Скоринг (нужно ≥ 3 — link, ≥ 5 — auto-link без needs_review):
 *  - amount exact match: +3 (обязательно для полного матча; для частичных —
 *    Этап 3 в следующих коммитах)
 *  - document_number expense входит в description транзакции: +3
 *  - counterparty.nip входит в description: +3 (NIP уникален)
 *  - counterparty.name fuzzy совпадает (substring) с counterparty/description: +2
 *
 * Окно поиска: ±14 дней от executed_at. Уже привязанные через
 * bank_transaction_id expenses пропускаем.
 *
 * Возвращает true если привязка выполнена.
 */
async function tryAutoMatchExpense(
  admin: ReturnType<typeof createClient>,
  salonId: string,
  tx: AutoMatchTx,
): Promise<boolean> {
  const txDate = new Date(tx.executed_at)
  const dayMs = 24 * 60 * 60 * 1000
  const from = new Date(txDate.getTime() - 14 * dayMs).toISOString().slice(0, 10)
  const to = new Date(txDate.getTime() + 14 * dayMs).toISOString().slice(0, 10)

  const { data: candidates } = await admin
    .from('expenses')
    .select(
      'id, amount_cents, description, document_number, expense_at, counterparty_id, counterparties:counterparty_id(name, nip)',
    )
    .eq('salon_id', salonId)
    .gte('expense_at', from)
    .lte('expense_at', to)
    .is('bank_transaction_id', null)
  if (!candidates || candidates.length === 0) return false

  const desc = (tx.description ?? '').toLowerCase()
  const cpName = (tx.counterparty ?? '').toLowerCase()
  let best: { id: string; score: number } | null = null

  for (const e of candidates) {
    const cp = Array.isArray(e.counterparties)
      ? (e.counterparties[0] as { name?: string; nip?: string } | undefined)
      : (e.counterparties as { name?: string; nip?: string } | null)
    let score = 0
    if (e.amount_cents === tx.amount_cents) score += 3
    if (e.document_number && desc.includes(String(e.document_number).toLowerCase())) score += 3
    if (cp?.nip && desc.includes(String(cp.nip))) score += 3
    if (cp?.name) {
      const cpn = String(cp.name).toLowerCase()
      if (cpName && (cpName.includes(cpn) || cpn.includes(cpName))) score += 2
      else if (desc.includes(cpn)) score += 1
    }
    if (score > (best?.score ?? 0)) best = { id: e.id as string, score }
  }

  if (!best || best.score < 3) return false
  const needsReview = best.score < 5
  await admin
    .from('bank_transactions')
    .update({ expense_id: best.id, needs_review: needsReview })
    .eq('id', tx.id)
  await admin.from('expenses').update({ bank_transaction_id: tx.id }).eq('id', best.id)
  return true
}

/**
 * Авто-матчинг credit-транзакции к существующему other_incomes. Скоринг
 * проще: только amount + comment (description) — у other_incomes мало полей.
 */
async function tryAutoMatchOtherIncome(
  admin: ReturnType<typeof createClient>,
  salonId: string,
  tx: AutoMatchTx,
): Promise<boolean> {
  const txDate = new Date(tx.executed_at)
  const dayMs = 24 * 60 * 60 * 1000
  const from = new Date(txDate.getTime() - 14 * dayMs).toISOString().slice(0, 10)
  const to = new Date(txDate.getTime() + 14 * dayMs).toISOString().slice(0, 10)

  const { data: candidates } = await admin
    .from('other_incomes')
    .select('id, amount_cents, comment, income_at')
    .eq('salon_id', salonId)
    .gte('income_at', from)
    .lte('income_at', to)
  if (!candidates || candidates.length === 0) return false

  const desc = (tx.description ?? '').toLowerCase()
  const cpName = (tx.counterparty ?? '').toLowerCase()
  let best: { id: string; score: number } | null = null

  for (const inc of candidates) {
    let score = 0
    if (inc.amount_cents === tx.amount_cents) score += 3
    const comm = String(inc.comment ?? '').toLowerCase()
    if (comm) {
      if (desc.includes(comm) || comm.includes(desc.slice(0, 30))) score += 2
      if (cpName && comm.includes(cpName)) score += 1
    }
    if (score > (best?.score ?? 0)) best = { id: inc.id as string, score }
  }

  if (!best || best.score < 3) return false
  const needsReview = best.score < 5
  await admin
    .from('bank_transactions')
    .update({ linked_other_income_id: best.id, needs_review: needsReview })
    .eq('id', tx.id)
  return true
}

// =============================================================================
// ADR-031: применяем bank_tx_rules (богатая модель: name + enabled +
// applies_to + conditions + actions). Pure-matcher в
// `../_shared/bank-rule-match.ts` — синхронизировано с
// `apps/web/src/lib/banking/bank-rule-match.ts`.
//
// Логика:
//   1. Загружаем enabled rules для salonId, сортируем по sort_order.
//   2. Берём unprocessed tx (debit без expense_id + credit; за 90 дней).
//   3. Для каждой tx находим первое match-правило.
//   4. Применяем actions:
//      - 'set_counterparty' → UPDATE bank_transactions.counterparty
//      - 'ignore'           → is_personal=true; expense НЕ создаём
//      - 'set_category'     → создаём expense (только для debit) с
//        дедупом ±3 дня / ±100 cents
// =============================================================================
import {
  findFirstMatch,
  type RuleAction,
  type RuleAppliesTo,
  type RuleCondition,
  type RuleLike,
  type RuleTxLike,
} from '../_shared/bank-rule-match.ts'

type BankTxRuleRow = {
  id: string
  name: string
  enabled: boolean
  applies_to: RuleAppliesTo
  conditions: RuleCondition[]
  actions: RuleAction[]
  sort_order: number
  created_at: string
}

async function applyBankTxRules(
  admin: ReturnType<typeof createClient>,
  salonId: string,
): Promise<void> {
  const { data: rulesRaw } = await admin
    .from('bank_tx_rules')
    .select('id, name, enabled, applies_to, conditions, actions, sort_order, created_at')
    .eq('salon_id', salonId)
    .eq('enabled', true)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })
  const rulesList = (rulesRaw ?? []) as BankTxRuleRow[]
  if (rulesList.length === 0) return

  // Все НЕ обработанные tx салона за 90 дней. credit-tx без expense_id
  // или is_personal — это новые поступления, к ним применимы applies_to=income.
  // debit-tx с expense_id=null, is_personal=false — новые списания.
  const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()
  const { data: txs } = await admin
    .from('bank_transactions')
    .select(
      `id, account_id, type, amount_cents, currency, counterparty, description, executed_at,
       bank_accounts!inner ( bank_connections!inner ( salon_id ) )`,
    )
    .is('expense_id', null)
    .eq('is_personal', false)
    .gte('executed_at', since)
    .eq('bank_accounts.bank_connections.salon_id', salonId)
    .limit(500)
  if (!txs || txs.length === 0) return

  type Tx = {
    id: string
    type: 'credit' | 'debit'
    amount_cents: number
    currency: string
    counterparty: string | null
    description: string | null
    executed_at: string
  }

  for (const tx of txs as Tx[]) {
    const txLike: RuleTxLike = {
      type: tx.type,
      counterparty: tx.counterparty,
      description: tx.description,
      amount_cents: tx.amount_cents,
    }
    const matched = findFirstMatch(
      rulesList as RuleLike[] & BankTxRuleRow[],
      txLike,
    ) as BankTxRuleRow | null
    if (!matched) continue

    // Сначала set_counterparty (может повлиять на дальнейшее отображение,
    // expense.contractor_name берётся уже после).
    const newCounterparty = matched.actions.find(
      (a): a is { type: 'set_counterparty'; counterparty: string } => a.type === 'set_counterparty',
    )?.counterparty
    let txCounterparty = tx.counterparty
    if (newCounterparty) {
      await admin
        .from('bank_transactions')
        .update({ counterparty: newCounterparty })
        .eq('id', tx.id)
      txCounterparty = newCounterparty
    }

    // ignore: помечаем личной, expense НЕ создаём, exit.
    if (matched.actions.some((a) => a.type === 'ignore')) {
      await admin.from('bank_transactions').update({ is_personal: true }).eq('id', tx.id)
      continue
    }

    const setCategory = matched.actions.find(
      (a): a is { type: 'set_category'; category_id: string } => a.type === 'set_category',
    )
    if (!setCategory) continue

    const txDate = new Date(tx.executed_at)
    const lo = new Date(txDate.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    const hi = new Date(txDate.getTime() + 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    const amtLo = tx.amount_cents - 100
    const amtHi = tx.amount_cents + 100

    if (tx.type === 'debit') {
      // Дедуп: похожий expense за ±3 дня с amount ±100 cents.
      const { data: dupes } = await admin
        .from('expenses')
        .select('id')
        .eq('salon_id', salonId)
        .gte('expense_at', lo)
        .lte('expense_at', hi)
        .gte('amount_cents', amtLo)
        .lte('amount_cents', amtHi)
        .is('deleted_at', null)
        .limit(1)
      if (dupes && dupes.length > 0) {
        await admin
          .from('bank_transactions')
          .update({ expense_id: dupes[0].id, needs_review: true })
          .eq('id', tx.id)
        continue
      }

      const { data: created } = await admin
        .from('expenses')
        .insert({
          salon_id: salonId,
          category_id: setCategory.category_id,
          expense_at: tx.executed_at.slice(0, 10),
          amount_cents: tx.amount_cents,
          contractor_name: txCounterparty,
          description: tx.description,
          source: 'bank_ai',
          bank_transaction_id: tx.id,
          payment_method: 'card',
          metadata: { rule_id: matched.id, rule_name: matched.name },
        })
        .select('id')
        .single()
      if (created) {
        await admin.from('bank_transactions').update({ expense_id: created.id }).eq('id', tx.id)
      }
      continue
    }

    // credit-tx: создаём other_income с категорией из правила.
    // applies_to=income означает что category_id указывает на
    // other_income_categories (см. ADR-031 + UI BankRuleEditDialog).
    const { data: dupesInc } = await admin
      .from('other_incomes')
      .select('id')
      .eq('salon_id', salonId)
      .gte('income_at', lo)
      .lte('income_at', hi)
      .gte('amount_cents', amtLo)
      .lte('amount_cents', amtHi)
      .limit(1)
    if (dupesInc && dupesInc.length > 0) {
      await admin
        .from('bank_transactions')
        .update({ linked_other_income_id: dupesInc[0].id, needs_review: true })
        .eq('id', tx.id)
      continue
    }

    const { data: createdInc } = await admin
      .from('other_incomes')
      .insert({
        salon_id: salonId,
        category_id: setCategory.category_id,
        income_at: tx.executed_at.slice(0, 10),
        amount_cents: tx.amount_cents,
        comment: [txCounterparty, tx.description].filter(Boolean).join(' · ').slice(0, 500),
        payment_method: 'transfer',
      })
      .select('id')
      .single()
    if (createdInc) {
      await admin
        .from('bank_transactions')
        .update({ linked_other_income_id: createdInc.id })
        .eq('id', tx.id)
    }
  }
}
