/**
 * fakturownia-proxy — интеграция с Fakturownia (PL invoicing SaaS).
 *
 * Actions:
 *   - connect_with_credentials  — валидируем subdomain + api_token, сохраняем
 *   - sync                      — pull expenses → Finkley expenses
 *   - push_expense              — POST expense из Finkley в Fakturownia
 *   - cron_sync_one             — вызывается из pg_cron
 *
 * Шифрование api_token: AES-256-GCM (FAKTUROWNIA_SECRETS_KEY).
 *
 * ENV:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   FAKTUROWNIA_SECRETS_KEY  — 32 байта base64
 */

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'

import { corsHeaders, preflight } from '../_shared/cors.ts'
import { recordSyncResult } from '../_shared/notify.ts'
import { withSentry } from '../_shared/sentry.ts'

import {
  fakturowniaCreateExpense,
  fakturowniaGetExpensePdf,
  fakturowniaListExpenses,
  fakturowniaPing,
  type FakturowniaCreds,
} from './api.ts'
import { mapFakturowniaToFinkleyCategory } from './category-mapping.ts'
import { decryptSecret, encryptSecret } from './crypto.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

const DEFAULT_IMPORT_CATEGORY = 'Импорт Fakturownia'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'content-type': 'application/json' },
  })
}

type StoredCredentials = {
  subdomain: string
  api_token_enc: string
  connected_at: string
}

async function loadCreds(admin: SupabaseClient, salonId: string): Promise<FakturowniaCreds | null> {
  const { data } = await admin
    .from('salon_integrations')
    .select('credentials')
    .eq('salon_id', salonId)
    .eq('provider', 'fakturownia')
    .maybeSingle()
  if (!data) return null
  const stored = data.credentials as StoredCredentials
  if (!stored?.subdomain || !stored?.api_token_enc) return null
  const apiToken = await decryptSecret(stored.api_token_enc)
  return { subdomain: stored.subdomain, apiToken }
}

async function saveCreds(
  admin: SupabaseClient,
  salonId: string,
  creds: FakturowniaCreds,
): Promise<void> {
  const stored: StoredCredentials = {
    subdomain: creds.subdomain,
    api_token_enc: await encryptSecret(creds.apiToken),
    connected_at: new Date().toISOString(),
  }
  await admin.from('salon_integrations').upsert(
    {
      salon_id: salonId,
      provider: 'fakturownia',
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
// Connect
// =============================================================================

async function handleConnect(
  admin: SupabaseClient,
  userId: string,
  salonId: string,
  subdomain: string,
  apiToken: string,
): Promise<Response> {
  if (!(await ensureMember(admin, userId, salonId))) {
    return jsonResponse({ ok: false, error: 'forbidden' }, 403)
  }
  if (!subdomain.trim() || !apiToken.trim()) {
    return jsonResponse({ ok: false, error: 'fields_required' }, 400)
  }
  const creds: FakturowniaCreds = { subdomain: subdomain.trim(), apiToken: apiToken.trim() }

  const ping = await fakturowniaPing(creds)
  if (!ping.ok) {
    if (ping.code === 'AUTH') {
      return jsonResponse({ ok: false, error: 'fakturownia_invalid_credentials' }, 400)
    }
    if (ping.code === 'HTTP' && ping.status === 404) {
      return jsonResponse({ ok: false, error: 'fakturownia_invalid_subdomain' }, 400)
    }
    return jsonResponse(
      { ok: false, error: 'fakturownia_api_error', details: ping.message ?? null },
      502,
    )
  }
  await saveCreds(admin, salonId, creds)
  return jsonResponse({ ok: true, subdomain: creds.subdomain })
}

// =============================================================================
// Sync (pull)
// =============================================================================

type SyncStats = { expenses_synced: number; expenses_skipped: number }

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
      sort_order: 1020,
    })
    .select('id')
    .single()
  return created?.id ?? null
}

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

async function uploadFakturowniaPdf(
  admin: SupabaseClient,
  creds: FakturowniaCreds,
  salonId: string,
  expenseId: string,
): Promise<string | null> {
  const bytes = await fakturowniaGetExpensePdf(creds, expenseId)
  if (!bytes) return null
  const path = `${salonId}/fakturownia-${expenseId}-${crypto.randomUUID()}.pdf`
  const { error } = await admin.storage.from('receipts').upload(path, bytes, {
    contentType: 'application/pdf',
    upsert: false,
  })
  if (error) {
    console.warn(`fakturownia pdf upload failed for ${expenseId}: ${error.message}`)
    return null
  }
  return path
}

async function syncFakturowniaToFinkley(
  admin: SupabaseClient,
  salonId: string,
  creds: FakturowniaCreds,
  lastSyncAt: string | null,
): Promise<SyncStats> {
  const stats: SyncStats = { expenses_synced: 0, expenses_skipped: 0 }
  const since = (() => {
    const d = lastSyncAt ? new Date(lastSyncAt) : new Date(Date.now() - 60 * 24 * 60 * 60 * 1000)
    return d.toISOString().slice(0, 10)
  })()

  // Bulk-load already imported Fakturownia ids
  const { data: alreadyImported } = await admin
    .from('expenses')
    .select('external_id')
    .eq('salon_id', salonId)
    .eq('source', 'fakturownia')
    .is('deleted_at', null)
  const importedSet = new Set<string>()
  for (const r of alreadyImported ?? []) {
    if (r.external_id) importedSet.add(r.external_id)
  }

  let fallbackCategoryId: string | null = null
  const ensureFallback = async (): Promise<string | null> => {
    if (fallbackCategoryId) return fallbackCategoryId
    fallbackCategoryId = await getOrCreateImportCategory(admin, salonId)
    return fallbackCategoryId
  }
  const categoryCache = new Map<string, string | null>()

  // Пагинация — 100 на страницу. Стоп когда hasMore=false или прогнали 50 страниц.
  let page = 1
  while (page <= 50) {
    const list = await fakturowniaListExpenses(creds, { sinceDate: since, page, perPage: 100 })
    if (!list.ok) {
      throw new Error(`fakturownia_list_${list.code}${list.message ? ':' + list.message : ''}`)
    }
    for (const ex of list.expenses) {
      const externalId = String(ex.id)
      if (importedSet.has(externalId)) {
        stats.expenses_skipped++
        continue
      }
      if (!ex.amount || ex.amount <= 0) {
        stats.expenses_skipped++
        continue
      }
      const expenseAt = (ex.expense_date || ex.payment_date || since).slice(0, 10)
      // В income=no «seller_name» — это поставщик (тот, кто выставил нам фактуру)
      const vendor = ex.seller_name ?? '—'
      const description = ex.description ?? ex.number

      const mapped = mapFakturowniaToFinkleyCategory({
        name: ex.number,
        description: ex.description,
        category: ex.category,
        buyerName: ex.seller_name,
      })
      let categoryId: string | null = null
      let categoryMapped: string | null = null
      if (mapped) {
        categoryId = await findSystemCategoryId(admin, salonId, mapped, categoryCache)
        if (categoryId) categoryMapped = mapped
      }
      if (!categoryId) categoryId = await ensureFallback()

      // Best-effort: PDF фактуры → Storage receipts
      const receiptPath = await uploadFakturowniaPdf(admin, creds, salonId, externalId)

      const { error } = await admin.from('expenses').insert({
        salon_id: salonId,
        category_id: categoryId,
        expense_at: expenseAt,
        amount_cents: Math.round((ex.amount ?? 0) * 100),
        payment_method: 'transfer',
        comment: description,
        contractor_name: vendor,
        invoice_number: ex.number,
        source: 'fakturownia',
        external_id: externalId,
        receipt_url: receiptPath,
        metadata: {
          fakturownia_id: externalId,
          ksef_id: ex.ksef_number, // дедуп с КСеФ-direct идёт по нему
          vendor_nip: ex.seller_tax_no,
          currency_original: ex.currency,
          fakturownia_paid: ex.paid,
          ...(categoryMapped ? { fakturownia_category_mapped: categoryMapped } : {}),
        },
      })
      if (error) {
        if (error.code === '23505') {
          stats.expenses_skipped++
          continue
        }
        console.warn(`fakturownia expense insert failed for ${externalId}: ${error.message}`)
        stats.expenses_skipped++
        continue
      }
      stats.expenses_synced++

      // Auto-import / reverse-sync в платёжный календарь
      if (!ex.paid && (ex.payment_date || ex.expense_date)) {
        const dueDate = (ex.payment_date ?? ex.expense_date)!.slice(0, 10)
        const { error: pmtErr } = await admin.from('scheduled_payments').insert({
          salon_id: salonId,
          due_date: dueDate,
          amount_cents: Math.round((ex.amount ?? 0) * 100),
          vendor_name: vendor,
          invoice_number: ex.number,
          category_id: categoryId,
          source: 'fakturownia',
          external_id: externalId,
        })
        if (pmtErr && pmtErr.code !== '23505') {
          console.warn(
            `scheduled_payment insert failed fakturownia ${externalId}: ${pmtErr.message}`,
          )
        }
      } else if (ex.paid) {
        // Фактура оплачена в Fakturownia — отмечаем календарь
        const { error: pmtErr } = await admin
          .from('scheduled_payments')
          .update({
            status: 'paid',
            paid_at: ex.payment_date ? `${ex.payment_date}T00:00:00Z` : new Date().toISOString(),
          })
          .eq('salon_id', salonId)
          .eq('source', 'fakturownia')
          .eq('external_id', externalId)
          .eq('status', 'pending')
        if (pmtErr) {
          console.warn(
            `scheduled_payment reverse-sync failed fakturownia ${externalId}: ${pmtErr.message}`,
          )
        }
      }
    }
    if (!list.hasMore) break
    page++
  }
  return stats
}

async function runSyncForSalon(
  admin: SupabaseClient,
  salonId: string,
): Promise<{ ok: true; stats: SyncStats } | { ok: false; status: number; message: string }> {
  const creds = await loadCreds(admin, salonId)
  if (!creds) return { ok: false, status: 404, message: 'not_connected' }

  const { data: existing } = await admin
    .from('salon_integrations')
    .select('last_sync_at')
    .eq('salon_id', salonId)
    .eq('provider', 'fakturownia')
    .maybeSingle()
  const lastSyncAt = existing?.last_sync_at ?? null

  let stats: SyncStats
  try {
    stats = await syncFakturowniaToFinkley(admin, salonId, creds, lastSyncAt)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    const { data: salonRow } = await admin
      .from('salons')
      .select('name')
      .eq('id', salonId)
      .maybeSingle()
    await recordSyncResult(admin, {
      salonId,
      provider: 'fakturownia',
      ok: false,
      errorMessage: msg,
      salonName: (salonRow as { name?: string } | null)?.name ?? null,
    })
    return { ok: false, status: 502, message: msg }
  }

  await recordSyncResult(admin, { salonId, provider: 'fakturownia', ok: true })
  await admin
    .from('salon_integrations')
    .update({ status: 'connected', last_sync_stats: stats })
    .eq('salon_id', salonId)
    .eq('provider', 'fakturownia')

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
    .from('fakturownia_sync_triggers')
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
// Push (single expense Finkley → Fakturownia)
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
  const creds = await loadCreds(admin, salonId)
  if (!creds) return jsonResponse({ ok: false, error: 'not_connected' }, 404)

  const { data: ex } = await admin
    .from('expenses')
    .select(
      'id, expense_at, amount_cents, contractor_name, comment, metadata, source, external_id, receipt_url',
    )
    .eq('id', expenseId)
    .eq('salon_id', salonId)
    .is('deleted_at', null)
    .maybeSingle()
  if (!ex) return jsonResponse({ ok: false, error: 'expense_not_found' }, 404)
  if (ex.source === 'fakturownia') {
    return jsonResponse({ ok: false, error: 'already_from_fakturownia' }, 409)
  }
  const meta = (ex.metadata ?? {}) as Record<string, unknown>
  if (typeof meta.fakturownia_id === 'string') {
    return jsonResponse(
      { ok: false, error: 'already_pushed', fakturownia_id: meta.fakturownia_id },
      409,
    )
  }
  // Auto-mode (используется при auto-push после save): пушим только если
  // есть чек (receipt). NIP-match для Fakturownia пока не сделан (нет
  // company_nip в credentials), потому опираемся только на наличие чека.
  if (auto && !ex.receipt_url) {
    return jsonResponse({ ok: false, error: 'skipped_no_receipt' }, 200)
  }

  const { data: salon } = await admin
    .from('salons')
    .select('currency')
    .eq('id', salonId)
    .maybeSingle()
  const currency = (salon?.currency ?? 'PLN').toUpperCase()

  const pushRes = await fakturowniaCreateExpense(creds, {
    expenseAt: ex.expense_at,
    amount: ex.amount_cents / 100,
    currency,
    vendor: ex.contractor_name || 'Bez nazwy',
    description: ex.comment,
  })
  if (!pushRes.ok) {
    return jsonResponse(
      { ok: false, error: 'fakturownia_push_failed', code: pushRes.code, message: pushRes.message },
      502,
    )
  }
  await admin
    .from('expenses')
    .update({
      metadata: {
        ...meta,
        fakturownia_id: pushRes.id,
        fakturownia_pushed_at: new Date().toISOString(),
      },
    })
    .eq('id', expenseId)
  return jsonResponse({ ok: true, fakturownia_id: pushRes.id })
}

// =============================================================================
// Entry
// =============================================================================

Deno.serve(
  withSentry('fakturownia-proxy', async (req: Request) => {
    if (req.method === 'OPTIONS') return preflight()
    if (req.method !== 'POST') return jsonResponse({ ok: false, error: 'method_not_allowed' }, 405)
    if (!SUPABASE_URL || !SERVICE_KEY) {
      return jsonResponse({ ok: false, error: 'function_not_configured' }, 500)
    }

    let body: {
      action?: string
      salon_id?: string
      subdomain?: string
      api_token?: string
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

    if (body.action === 'cron_sync_one') {
      if (!body.token) return jsonResponse({ ok: false, error: 'token_required' }, 400)
      return handleCronSyncOne(admin, body.salon_id, body.token)
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
      return jsonResponse({ ok: false, error: 'invalid_token', message: userErr?.message }, 401)
    }
    const userId = userRes.user.id

    switch (body.action) {
      case 'connect_with_credentials':
        if (!body.subdomain || !body.api_token) {
          return jsonResponse({ ok: false, error: 'fields_required' }, 400)
        }
        return handleConnect(admin, userId, body.salon_id, body.subdomain, body.api_token)
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
