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

  let body: { connection_id?: string; secret?: string; is_initial?: boolean }
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: 'bad_request' }, 400)
  }
  if (!body.connection_id) return jsonResponse({ error: 'missing_connection_id' }, 400)

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  // Auth: либо internal secret (server-to-server), либо user-JWT с
  // membership-check в рамках салона.
  const isInternal = body.secret && timingSafeEqual(body.secret, INTERNAL_SECRET)
  if (!isInternal) {
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
  const rangeFrom = dateFrom.toISOString().slice(0, 10)
  const rangeTo = dateTo.toISOString().slice(0, 10)

  for (const acc of accounts ?? []) {
    let txs: EbTransaction[] = []
    try {
      txs = await listTransactions(cfg, acc.external_id as string, {
        dateFrom: rangeFrom,
        dateTo: rangeTo,
      })
    } catch (e) {
      console.error('listTransactions failed', acc.external_id, e)
      await admin
        .from('bank_connections')
        .update({ last_error: e instanceof Error ? e.message : String(e) })
        .eq('id', connectionId)
      continue
    }
    txTotal += txs.length

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

  await admin
    .from('bank_connections')
    .update({ last_synced_at: new Date().toISOString(), last_error: null })
    .eq('id', connectionId)

  return {
    ok: true,
    accounts_synced: accounts?.length ?? 0,
    tx_total: txTotal,
    tx_new: txNew,
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
  if (ctx.txs.length === 0) return { newCount: 0, expCount: 0 }

  // Только booked транзакции пишем (PDNG/pending часто меняют сумму/исчезают).
  const booked = ctx.txs.filter((t) => !t.status || t.status === 'BOOK' || t.status === 'BOOKED')

  // Сначала — INSERT bank_transactions с onConflict ignore (через upsert)
  const txRows = booked.map((t) => {
    const { amountCents, type } = parseAmount(t)
    return {
      account_id: ctx.accountId,
      external_id: transactionExternalId(t),
      type,
      amount_cents: amountCents,
      currency: t.transaction_amount.currency || ctx.currency,
      description: transactionDescription(t).slice(0, 500) || null,
      counterparty: counterpartyName(t)?.slice(0, 200) ?? null,
      executed_at: new Date(transactionDate(t)).toISOString(),
      raw: t as unknown as Record<string, unknown>,
    }
  })

  // upsert с ignoreDuplicates — не возвращает существующие. Поэтому делаем
  // в два шага: select сначала чтобы узнать какие external_id уже есть,
  // потом insert новых.
  const { data: existingRows } = await admin
    .from('bank_transactions')
    .select('id, external_id')
    .eq('account_id', ctx.accountId)
    .in(
      'external_id',
      txRows.map((r) => r.external_id),
    )
  const existingIds = new Set((existingRows ?? []).map((r) => r.external_id))
  const newRows = txRows.filter((r) => !existingIds.has(r.external_id))
  if (newRows.length === 0) return { newCount: 0, expCount: 0 }

  const { data: insertedTxs, error: txErr } = await admin
    .from('bank_transactions')
    .insert(newRows)
    .select('id, type, amount_cents, currency, description, executed_at, external_id')
  if (txErr || !insertedTxs) {
    console.error('insert bank_transactions', txErr)
    return { newCount: 0, expCount: 0 }
  }

  // Создать expenses для всех debit-транзакций
  const debits = insertedTxs.filter((t) => t.type === 'debit')
  if (debits.length === 0) return { newCount: insertedTxs.length, expCount: 0 }

  const expenseRows = debits.map((t) => ({
    salon_id: ctx.salonId,
    category_id: ctx.bankCategoryId,
    expense_at: (t.executed_at as string).slice(0, 10),
    amount_cents: t.amount_cents,
    payment_method: 'transfer' as const,
    comment: (t.description as string | null) ?? null,
    source: 'bank_import',
    bank_transaction_id: t.id,
    metadata: { bank_external_id: t.external_id, currency: t.currency },
  }))

  const { data: insertedExp, error: expErr } = await admin
    .from('expenses')
    .insert(expenseRows)
    .select('id, bank_transaction_id')
  if (expErr) {
    console.error('insert expenses (bank import)', expErr)
    return { newCount: insertedTxs.length, expCount: 0 }
  }

  // Опционально — записать обратную ссылку (не критично, FK на expense.id
  // уже хранится; bank_transactions.expense_id мы держим для удобства query).
  if (insertedExp) {
    for (const e of insertedExp) {
      await admin
        .from('bank_transactions')
        .update({ expense_id: e.id })
        .eq('id', e.bank_transaction_id)
    }
  }

  return { newCount: insertedTxs.length, expCount: insertedExp?.length ?? 0 }
}
