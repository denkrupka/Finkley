/**
 * wfirma-proxy — интеграция с wFirma (PL bookkeeping).
 *
 * Actions (см. ADR-012, Hybrid X3):
 *   - connect_with_login    — X2: email+password → web-flow генерация ключей
 *   - connect_with_credentials — X1: ручной ввод 3 ключей
 *   - sync                  — pull purchase invoices → expenses
 *   - push_expense          — POST /expenses/add из существующего expense
 *   - disconnect            — RLS-удаление; SPA сама делает supabase.delete()
 *   - cron_sync_one         — вызывается из pg_cron с rendezvous-token
 *
 * Шифрование: secret_key хранится AES-256-GCM (ADR-011).
 *
 * ENV:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   WFIRMA_APP_KEY            — наш appKey, переиспользуем из bookysync-bot
 *   WFIRMA_SECRETS_KEY        — 32 байта base64, для AES-256-GCM secret_key
 *   WFIRMA_AUTO_LOGIN_DISABLED — '1' чтобы выключить X2 (kill-switch)
 */

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'

import { corsHeaders, preflight } from '../_shared/cors.ts'

import {
  wfirmaCompaniesFind,
  wfirmaExpenseAdd,
  wfirmaExpenseGet,
  wfirmaExpensePdf,
  wfirmaExpensesFind,
  type PushExpenseInput,
  type WfirmaApiCreds,
  type WfirmaExpense,
} from './api.ts'
import { recordSyncResult } from '../_shared/notify.ts'
import { mapWfirmaToFinkleyCategory } from './category-mapping.ts'
import { decryptSecret, encryptSecret } from './crypto.ts'
import { generateApiKeyViaWebFlow } from './web-flow.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const WFIRMA_APP_KEY = Deno.env.get('WFIRMA_APP_KEY') ?? ''
const AUTO_LOGIN_DISABLED = Deno.env.get('WFIRMA_AUTO_LOGIN_DISABLED') === '1'

const DEFAULT_IMPORT_CATEGORY = 'Импорт wFirma'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'content-type': 'application/json' },
  })
}

// =============================================================================
// Helpers: salon_integrations CRUD
// =============================================================================

type StoredCredentials = {
  access_key: string
  secret_key_enc: string
  company_id: string
  company_nip: string
  company_name: string
  connected_via: 'auto_login' | 'manual'
}

async function loadCreds(
  admin: SupabaseClient,
  salonId: string,
): Promise<{ creds: WfirmaApiCreds; meta: StoredCredentials } | null> {
  const { data } = await admin
    .from('salon_integrations')
    .select('credentials')
    .eq('salon_id', salonId)
    .eq('provider', 'wfirma')
    .maybeSingle()
  if (!data) return null
  const stored = data.credentials as StoredCredentials
  if (!stored?.access_key || !stored?.secret_key_enc) return null
  const secretKey = await decryptSecret(stored.secret_key_enc)
  return {
    meta: stored,
    creds: {
      accessKey: stored.access_key,
      secretKey,
      appKey: WFIRMA_APP_KEY,
      companyId: stored.company_id,
    },
  }
}

async function saveCreds(
  admin: SupabaseClient,
  salonId: string,
  creds: WfirmaApiCreds,
  companyName: string,
  companyNip: string,
  via: 'auto_login' | 'manual',
): Promise<void> {
  const stored: StoredCredentials = {
    access_key: creds.accessKey,
    secret_key_enc: await encryptSecret(creds.secretKey),
    company_id: creds.companyId ?? '',
    company_nip: companyNip,
    company_name: companyName,
    connected_via: via,
  }
  await admin.from('salon_integrations').upsert(
    {
      salon_id: salonId,
      provider: 'wfirma',
      status: 'connected',
      credentials: stored,
      last_error: null,
      sync_interval_minutes: 60,
    },
    { onConflict: 'salon_id,provider' },
  )
}

async function ensureMember(
  admin: SupabaseClient,
  userId: string,
  salonId: string,
): Promise<boolean> {
  const { data } = await admin
    .from('salon_members')
    .select('user_id')
    .eq('user_id', userId)
    .eq('salon_id', salonId)
    .maybeSingle()
  return !!data
}

// =============================================================================
// Connect actions
// =============================================================================

async function handleConnectWithLogin(
  admin: SupabaseClient,
  userId: string,
  salonId: string,
  email: string,
  password: string,
  selectedCompanyId?: string,
): Promise<Response> {
  if (!(await ensureMember(admin, userId, salonId))) {
    return jsonResponse({ ok: false, error: 'forbidden' }, 403)
  }
  if (AUTO_LOGIN_DISABLED) {
    return jsonResponse({ ok: false, error: 'auto_login_disabled' }, 503)
  }
  if (!WFIRMA_APP_KEY) {
    return jsonResponse({ ok: false, error: 'function_not_configured' }, 500)
  }

  const flowRes = await generateApiKeyViaWebFlow(email, password, { selectedCompanyId })
  if (!flowRes.ok) {
    // В аккаунте >1 фирмы — отдаём список UI'ю, чтобы юзер выбрал. UI
    // повторно дёргает action с `selected_company_id`.
    if (flowRes.reason === 'choose_company') {
      return jsonResponse({
        ok: false,
        error: 'choose_company',
        companies: flowRes.companies,
      })
    }
    // Возвращаем 200 чтобы клиент мог парсить { ok:false, error, details }.
    // Supabase functions.invoke() при non-2xx бросает generic 'Edge Function
    // returned non-2xx' — конкретный reason теряется. С 200 юзер видит
    // 'wfirma_login_failed' или 'wfirma_form_changed: <details>' и понимает.
    return jsonResponse({
      ok: false,
      error: flowRes.reason,
      details: 'details' in flowRes ? (flowRes.details ?? null) : null,
    })
  }

  // Валидируем пару + получаем company nip через api2
  const apiCreds: WfirmaApiCreds = {
    accessKey: flowRes.data.accessKey,
    secretKey: flowRes.data.secretKey,
    appKey: WFIRMA_APP_KEY,
    companyId: flowRes.data.companyId,
  }
  const find = await wfirmaCompaniesFind(apiCreds)
  if (!find.ok) {
    return jsonResponse({ ok: false, error: 'wfirma_keygen_failed', details: find.code }, 400)
  }
  const company =
    find.companies.find((c) => String(c.id) === flowRes.data.companyId) ?? find.companies[0]
  if (!company) {
    return jsonResponse({ ok: false, error: 'wfirma_no_companies' }, 400)
  }

  await saveCreds(admin, salonId, apiCreds, company.name, company.nip, 'auto_login')

  return jsonResponse({
    ok: true,
    company: { id: company.id, name: company.name, nip: company.nip },
  })
}

async function handleConnectWithCredentials(
  admin: SupabaseClient,
  userId: string,
  salonId: string,
  accessKey: string,
  secretKey: string,
  companyId: string,
): Promise<Response> {
  if (!(await ensureMember(admin, userId, salonId))) {
    return jsonResponse({ ok: false, error: 'forbidden' }, 403)
  }
  if (!WFIRMA_APP_KEY) {
    return jsonResponse({ ok: false, error: 'function_not_configured' }, 500)
  }
  if (!/^[a-f0-9]{32}$/.test(accessKey) || !/^[a-f0-9]{32}$/.test(secretKey)) {
    return jsonResponse({ ok: false, error: 'invalid_keys_format' }, 400)
  }
  if (!/^\d+$/.test(companyId)) {
    return jsonResponse({ ok: false, error: 'invalid_company_id' }, 400)
  }

  const apiCreds: WfirmaApiCreds = {
    accessKey,
    secretKey,
    appKey: WFIRMA_APP_KEY,
    companyId,
  }
  const find = await wfirmaCompaniesFind(apiCreds)
  if (!find.ok) {
    if (find.code === 'AUTH') {
      return jsonResponse({ ok: false, error: 'wfirma_invalid_credentials' }, 400)
    }
    return jsonResponse({ ok: false, error: 'wfirma_api_error', details: find.code }, 400)
  }
  const company = find.companies.find((c) => String(c.id) === companyId)
  if (!company) {
    return jsonResponse({ ok: false, error: 'wfirma_company_id_not_found' }, 400)
  }

  await saveCreds(admin, salonId, apiCreds, company.name, company.nip, 'manual')

  return jsonResponse({
    ok: true,
    company: { id: company.id, name: company.name, nip: company.nip },
  })
}

// =============================================================================
// Sync (pull) — wFirma → Finkley
// =============================================================================

type SyncStats = {
  expenses_synced: number
  expenses_skipped: number
}

async function getOrCreateImportCategory(
  admin: SupabaseClient,
  salonId: string,
): Promise<string | null> {
  const { data: existing } = await admin
    .from('expense_categories')
    .select('id')
    .eq('salon_id', salonId)
    .eq('name', DEFAULT_IMPORT_CATEGORY)
    .eq('is_archived', false)
    .maybeSingle()
  if (existing) return existing.id
  const { data: created } = await admin
    .from('expense_categories')
    .insert({
      salon_id: salonId,
      name: DEFAULT_IMPORT_CATEGORY,
      is_system: false,
      sort_order: 1000,
    })
    .select('id')
    .single()
  return created?.id ?? null
}

/**
 * Кэш категорий для одного запуска sync. Ищем системную категорию по
 * name внутри салона (без учёта регистра), кешируем найденный id.
 */
async function findSystemCategoryId(
  admin: SupabaseClient,
  salonId: string,
  name: string,
  cache: Map<string, string | null>,
): Promise<string | null> {
  const key = name.toLowerCase()
  if (cache.has(key)) return cache.get(key) ?? null
  const { data } = await admin
    .from('expense_categories')
    .select('id')
    .eq('salon_id', salonId)
    .eq('is_archived', false)
    .ilike('name', name)
    .limit(1)
  const id = data?.[0]?.id ?? null
  cache.set(key, id)
  return id
}

/**
 * Скачивает PDF фактуры wFirma и кладёт в Storage bucket `receipts`.
 * Path: `<salon_id>/wfirma-<wfirma_id>-<uuid>.pdf`. Возвращает path или null.
 */
async function uploadWfirmaPdf(
  admin: SupabaseClient,
  creds: WfirmaApiCreds,
  salonId: string,
  wfirmaExpenseId: string,
): Promise<string | null> {
  const bytes = await wfirmaExpensePdf(creds, wfirmaExpenseId)
  if (!bytes) return null
  const path = `${salonId}/wfirma-${wfirmaExpenseId}-${crypto.randomUUID()}.pdf`
  const { error } = await admin.storage.from('receipts').upload(path, bytes, {
    contentType: 'application/pdf',
    upsert: false,
  })
  if (error) {
    console.warn(`wfirma pdf upload failed for ${wfirmaExpenseId}: ${error.message}`)
    return null
  }
  return path
}

function plnFromExpense(e: WfirmaExpense): {
  amountCents: number
  netCents: number | null
  vatRatePct: number | null
  currency: string
} | null {
  const total = parseFloat(e.total ?? '0')
  if (!isFinite(total) || total <= 0) return null
  const amountCents = Math.round(total * 100)
  // wFirma возвращает netto/vat как строки в детализированном expense.
  // Если оба заданы — считаем ставку из них (round до целого процента).
  // Иначе оставляем null — клиент будет fallback'ать на defaultVatRate.
  let netCents: number | null = null
  let vatRatePct: number | null = null
  const netto = parseFloat(e.netto ?? '')
  const vat = parseFloat(e.vat ?? '')
  if (isFinite(netto) && netto > 0) {
    netCents = Math.round(netto * 100)
    if (isFinite(vat) && vat > 0) {
      vatRatePct = Math.round((vat / netto) * 100)
    } else if (amountCents > netCents) {
      // только нетто известно, vat = total-netto
      vatRatePct = Math.round(((amountCents - netCents) / netCents) * 100)
    }
  }
  return {
    amountCents,
    netCents,
    vatRatePct,
    currency: (e.currency || 'PLN').toUpperCase(),
  }
}

async function syncWfirmaToFinkley(
  admin: SupabaseClient,
  salonId: string,
  creds: WfirmaApiCreds,
  lastSyncAt: string | null,
): Promise<SyncStats> {
  const stats: SyncStats = { expenses_synced: 0, expenses_skipped: 0 }
  // Тянем расходы за последние 60 дней или с last_sync_at, что новее
  const since = (() => {
    const d = lastSyncAt ? new Date(lastSyncAt) : new Date(Date.now() - 60 * 24 * 60 * 60 * 1000)
    return d.toISOString().slice(0, 10)
  })()

  const list = await wfirmaExpensesFind(creds, since)
  if (!list.ok) throw new Error(`expenses_find_${list.code}`)

  if (list.expenses.length === 0) return stats

  // Fallback-категория «Импорт wFirma» создаётся лениво — только если хоть один
  // expense не сматчился ни на одну системную.
  let fallbackCategoryId: string | null = null
  const ensureFallback = async (): Promise<string | null> => {
    if (fallbackCategoryId) return fallbackCategoryId
    fallbackCategoryId = await getOrCreateImportCategory(admin, salonId)
    return fallbackCategoryId
  }
  const categoryCache = new Map<string, string | null>()

  // Bulk-load уже импортированных wFirma id чтобы не бить detail-fetch на каждый
  const { data: alreadyImported } = await admin
    .from('expenses')
    .select('external_id')
    .eq('salon_id', salonId)
    .eq('source', 'wfirma')
    .is('deleted_at', null)
  const importedSet = new Set<string>()
  for (const r of alreadyImported ?? []) {
    if (r.external_id) importedSet.add(r.external_id)
  }

  for (const ex of list.expenses) {
    if (importedSet.has(ex.id)) {
      stats.expenses_skipped++
      continue
    }
    // Пытаемся вытащить детали (для contractor.nip и ksef_id) — если не
    // получилось, инсертим без них.
    let detail: WfirmaExpense = ex
    const detailRes = await wfirmaExpenseGet(creds, ex.id)
    if (detailRes.ok) detail = detailRes.expense

    const money = plnFromExpense(detail)
    if (!money) {
      stats.expenses_skipped++
      continue
    }

    const expenseAt = (detail.paid_date || detail.date || since).slice(0, 10)
    const vendor = detail.contractor?.name ?? detail.name ?? '—'
    const vendorNip = detail.contractor?.nip ?? null
    const ksefId = detail.ksef_id ?? null
    const description = detail.description || detail.name || null

    // Semantic-маппинг: пытаемся подобрать одну из 7 системных категорий
    // (Аренда / Зарплата / ...) по keyword'ам в name+description+contractor.
    // Если ничего не подошло или такой категории нет в салоне — fallback на
    // «Импорт wFirma» (создаётся лениво).
    const mappedName = mapWfirmaToFinkleyCategory({
      name: detail.name,
      description: detail.description,
      contractor: detail.contractor?.name,
    })
    let categoryId: string | null = null
    let categoryMapped: string | null = null
    if (mappedName) {
      categoryId = await findSystemCategoryId(admin, salonId, mappedName, categoryCache)
      if (categoryId) categoryMapped = mappedName
    }
    if (!categoryId) categoryId = await ensureFallback()

    // Best-effort: PDF фактуры в Storage receipts. Если wFirma не отдаёт
    // PDF (например bill без файла) или upload упал — продолжаем без чека.
    const receiptPath = await uploadWfirmaPdf(admin, creds, salonId, detail.id)

    const { error } = await admin.from('expenses').insert({
      salon_id: salonId,
      category_id: categoryId,
      expense_at: expenseAt,
      amount_cents: money.amountCents,
      // VAT-разбивка из wFirma netto/vat-полей. Если не заданы (vat_exempt
      // или bill без detail) — null, P&L клиента fallback на amount_cents.
      amount_net_cents: money.netCents,
      vat_rate_pct: money.vatRatePct,
      payment_method: 'transfer',
      comment: description,
      contractor_name: vendor,
      invoice_number: detail.number ?? null,
      source: 'wfirma',
      external_id: detail.id,
      receipt_url: receiptPath,
      metadata: {
        wfirma_expense_id: detail.id,
        ksef_id: ksefId, // унифицированное поле для дедупа кросс-портал
        wfirma_ksef_id: ksefId, // legacy backwards compat — оставляем 1 релиз
        vendor_nip: vendorNip,
        currency_original: money.currency,
        ...(categoryMapped ? { wfirma_category_mapped: categoryMapped } : {}),
      },
    })
    if (error) {
      console.warn(`expense insert failed for wfirma ${detail.id}: ${error.message}`)
      stats.expenses_skipped++
      continue
    }
    stats.expenses_synced++

    // Auto-import / reverse-sync в платёжный календарь.
    // Если paid_date null — добавляем в календарь как pending (или ничего
    // не делаем при повторном sync — защита UNIQUE_VIOLATION).
    // Если paid_date появился — помечаем calendar row как paid.
    if (!detail.paid_date && (detail.date || expenseAt)) {
      const dueDate = (detail.date ?? expenseAt).slice(0, 10)
      const { error: pmtErr } = await admin.from('scheduled_payments').insert({
        salon_id: salonId,
        due_date: dueDate,
        amount_cents: money.amountCents,
        amount_net_cents: money.netCents,
        vat_rate_pct: money.vatRatePct,
        vendor_name: vendor,
        invoice_number: detail.number ?? null,
        category_id: categoryId,
        source: 'wfirma',
        external_id: detail.id,
      })
      // UNIQUE_VIOLATION (23505) — уже в календаре, всё ок
      if (pmtErr && pmtErr.code !== '23505') {
        console.warn(`scheduled_payment insert failed wfirma ${detail.id}: ${pmtErr.message}`)
      }
    } else if (detail.paid_date) {
      // Фактура оплачена в wFirma — отмечаем в нашем календаре
      const { error: pmtErr } = await admin
        .from('scheduled_payments')
        .update({
          status: 'paid',
          paid_at:
            detail.paid_date.length >= 10
              ? `${detail.paid_date.slice(0, 10)}T00:00:00Z`
              : new Date().toISOString(),
        })
        .eq('salon_id', salonId)
        .eq('source', 'wfirma')
        .eq('external_id', detail.id)
        .eq('status', 'pending')
      if (pmtErr) {
        console.warn(`scheduled_payment reverse-sync failed wfirma ${detail.id}: ${pmtErr.message}`)
      }
    }
  }

  return stats
}

async function runSyncForSalon(
  admin: SupabaseClient,
  salonId: string,
): Promise<{ ok: true; stats: SyncStats } | { ok: false; status: number; message: string }> {
  const loaded = await loadCreds(admin, salonId)
  if (!loaded) return { ok: false, status: 404, message: 'not_connected' }

  const { data: existing } = await admin
    .from('salon_integrations')
    .select('last_sync_at')
    .eq('salon_id', salonId)
    .eq('provider', 'wfirma')
    .maybeSingle()
  const lastSyncAt = existing?.last_sync_at ?? null

  let stats: SyncStats
  try {
    stats = await syncWfirmaToFinkley(admin, salonId, loaded.creds, lastSyncAt)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    const { data: salonRow } = await admin
      .from('salons')
      .select('name')
      .eq('id', salonId)
      .maybeSingle()
    await recordSyncResult(admin, {
      salonId,
      provider: 'wfirma',
      ok: false,
      errorMessage: msg,
      salonName: (salonRow as { name?: string } | null)?.name ?? null,
    })
    return { ok: false, status: 502, message: msg }
  }

  await recordSyncResult(admin, { salonId, provider: 'wfirma', ok: true })
  await admin
    .from('salon_integrations')
    .update({ status: 'connected', last_sync_stats: stats })
    .eq('salon_id', salonId)
    .eq('provider', 'wfirma')

  return { ok: true, stats }
}

async function handleSync(
  admin: SupabaseClient,
  userId: string,
  salonId: string,
): Promise<Response> {
  if (!(await ensureMember(admin, userId, salonId))) {
    return jsonResponse({ ok: false, error: 'forbidden' }, 403)
  }
  const res = await runSyncForSalon(admin, salonId)
  if (!res.ok) {
    return jsonResponse({ ok: false, error: 'sync_failed', message: res.message }, res.status)
  }
  return jsonResponse({ ok: true, stats: res.stats })
}

async function handleCronSyncOne(
  admin: SupabaseClient,
  salonId: string,
  token: string,
): Promise<Response> {
  const { data: trig, error: trigErr } = await admin
    .from('wfirma_sync_triggers')
    .update({ used_at: new Date().toISOString() })
    .eq('token', token)
    .eq('salon_id', salonId)
    .is('used_at', null)
    .gt('expires_at', new Date().toISOString())
    .select('token')
    .maybeSingle()
  if (trigErr || !trig) {
    return jsonResponse({ ok: false, error: 'invalid_or_expired_token' }, 401)
  }
  const res = await runSyncForSalon(admin, salonId)
  if (!res.ok) {
    return jsonResponse({ ok: false, error: 'sync_failed', message: res.message }, res.status)
  }
  return jsonResponse({ ok: true, stats: res.stats })
}

// =============================================================================
// Push (single expense) — Finkley → wFirma
// =============================================================================

async function handlePushExpense(
  admin: SupabaseClient,
  userId: string,
  salonId: string,
  expenseId: string,
  auto: boolean,
): Promise<Response> {
  if (!(await ensureMember(admin, userId, salonId))) {
    return jsonResponse({ ok: false, error: 'forbidden' }, 403)
  }
  const loaded = await loadCreds(admin, salonId)
  if (!loaded) return jsonResponse({ ok: false, error: 'not_connected' }, 404)

  const { data: ex } = await admin
    .from('expenses')
    .select(
      'id, expense_at, amount_cents, amount_net_cents, vat_rate_pct, contractor_name, invoice_number, comment, metadata, source, external_id, receipt_url',
    )
    .eq('id', expenseId)
    .eq('salon_id', salonId)
    .is('deleted_at', null)
    .maybeSingle()
  if (!ex) return jsonResponse({ ok: false, error: 'expense_not_found' }, 404)
  if (ex.source === 'wfirma') {
    return jsonResponse({ ok: false, error: 'already_from_wfirma' }, 409)
  }
  const meta = (ex.metadata ?? {}) as Record<string, unknown>
  if (typeof meta.wfirma_expense_id === 'string') {
    return jsonResponse(
      { ok: false, error: 'already_pushed', wfirma_id: meta.wfirma_expense_id },
      409,
    )
  }

  // Auto-mode: пушим только если есть чек и buyer_nip совпал с компанией.
  // Manual-mode (auto=false): пушим всегда.
  const buyerNip = typeof meta.buyer_nip === 'string' ? meta.buyer_nip : null
  const expectedNip = loaded.meta.company_nip
  if (auto) {
    if (!ex.receipt_url) {
      return jsonResponse({ ok: false, error: 'skipped_no_receipt' }, 200)
    }
    if (!buyerNip) {
      return jsonResponse({ ok: false, error: 'skipped_no_buyer_nip' }, 200)
    }
    if (buyerNip !== expectedNip) {
      return jsonResponse(
        {
          ok: false,
          error: 'skipped_nip_mismatch',
          buyer_nip: buyerNip,
          expected_nip: expectedNip,
        },
        200,
      )
    }
  }

  // Берём currency из salon (наша внутренняя валюта расхода)
  const { data: salon } = await admin
    .from('salons')
    .select('currency')
    .eq('id', salonId)
    .maybeSingle()
  const currency = (salon?.currency ?? 'PLN').toUpperCase()

  const input: PushExpenseInput = {
    expenseAt: ex.expense_at,
    amount: ex.amount_cents / 100,
    // VAT-разбивка из Finkley → wFirma не угадывает ставку (важно для
    // 8% медуслуг, 5% книг/еды, 0% vat-exempt и реверс-чарж).
    netAmount: ex.amount_net_cents != null ? ex.amount_net_cents / 100 : null,
    vatRatePct: ex.vat_rate_pct ?? null,
    currency,
    vendor: ex.contractor_name || 'Bez nazwy',
    vendorNip: typeof meta.vendor_nip === 'string' ? meta.vendor_nip : null,
    description: ex.comment,
    invoiceNumber: ex.invoice_number,
  }

  const pushRes = await wfirmaExpenseAdd(loaded.creds, input)
  if (!pushRes.ok) {
    return jsonResponse(
      {
        ok: false,
        error: 'wfirma_push_failed',
        code: pushRes.code,
        raw: pushRes.raw ?? null,
      },
      502,
    )
  }

  await admin
    .from('expenses')
    .update({
      metadata: {
        ...meta,
        wfirma_expense_id: pushRes.wfirmaId,
        wfirma_pushed_at: new Date().toISOString(),
      },
    })
    .eq('id', expenseId)

  return jsonResponse({ ok: true, wfirma_id: pushRes.wfirmaId })
}

// =============================================================================
// Entry
// =============================================================================

import { withSentry } from '../_shared/sentry.ts'

Deno.serve(
  withSentry('wfirma-proxy', async (req: Request) => {
    if (req.method === 'OPTIONS') return preflight()
    if (req.method !== 'POST') return jsonResponse({ ok: false, error: 'method_not_allowed' }, 405)
    if (!SUPABASE_URL || !SERVICE_KEY) {
      return jsonResponse({ ok: false, error: 'function_not_configured' }, 500)
    }

    let body: {
      action?: string
      salon_id?: string
      email?: string
      password?: string
      access_key?: string
      secret_key?: string
      company_id?: string
      selected_company_id?: string
      expense_id?: string
      auto?: boolean
      token?: string
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

    // Cron action — без user JWT
    if (body.action === 'cron_sync_one') {
      if (!body.token) return jsonResponse({ ok: false, error: 'token_required' }, 400)
      return handleCronSyncOne(admin, body.salon_id, body.token)
    }

    // Все остальные actions требуют user JWT
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
      return jsonResponse({ ok: false, error: 'invalid_token', message: userErr?.message }, 401)
    }
    const userId = userRes.user.id

    switch (body.action) {
      case 'connect_with_login':
        if (!body.email || !body.password) {
          return jsonResponse({ ok: false, error: 'email_password_required' }, 400)
        }
        return handleConnectWithLogin(
          admin,
          userId,
          body.salon_id,
          body.email,
          body.password,
          body.selected_company_id,
        )
      case 'connect_with_credentials':
        if (!body.access_key || !body.secret_key || !body.company_id) {
          return jsonResponse({ ok: false, error: 'keys_required' }, 400)
        }
        return handleConnectWithCredentials(
          admin,
          userId,
          body.salon_id,
          body.access_key,
          body.secret_key,
          body.company_id,
        )
      case 'sync':
        return handleSync(admin, userId, body.salon_id)
      case 'push_expense':
        if (!body.expense_id) {
          return jsonResponse({ ok: false, error: 'expense_id_required' }, 400)
        }
        return handlePushExpense(admin, userId, body.salon_id, body.expense_id, body.auto === true)
      default:
        return jsonResponse({ ok: false, error: 'unknown_action' }, 400)
    }
  }),
)
