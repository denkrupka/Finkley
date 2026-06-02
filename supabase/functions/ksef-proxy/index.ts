/**
 * ksef-proxy — прямой коннект к Krajowy System e-Faktur (КСеФ, PL).
 *
 * Actions (см. ADR-013, TASK-46):
 *   - connect_with_token  — валидируем NIP+token, открываем тестовую сессию,
 *                           шифруем token и сохраняем
 *   - sync                — pull входящих фактур (subjectType=subject2) с
 *                           момента last_sync_at в expenses
 *   - disconnect          — RLS-удаление; SPA сама делает supabase.delete()
 *   - cron_sync_one       — вызывается из pg_cron с rendezvous-token
 *
 * Шифрование: token хранится AES-256-GCM (KSEF_SECRETS_KEY).
 *
 * ENV:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   KSEF_SECRETS_KEY     — 32 байта base64, для AES-256-GCM authorisation token
 *
 * Всегда работает с prod-окружением KSeF (api.ksef.mf.gov.pl) — test/demo
 * убрали по решению владельца 2026-05-11.
 */

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'

import { corsHeaders, preflight } from '../_shared/cors.ts'
import { recordSyncResult } from '../_shared/notify.ts'
import { withSentry } from '../_shared/sentry.ts'

import {
  closeSession,
  getInvoiceXml,
  openSession,
  parseInvoiceXml,
  querySubjectInvoices,
  type KsefInvoiceListItem,
} from './api.ts'
import { mapKsefToFinkleyCategory } from './category-mapping.ts'
import { decryptSecret, encryptSecret } from './crypto.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

const DEFAULT_IMPORT_CATEGORY = 'Импорт КСеФ'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'content-type': 'application/json' },
  })
}

// =============================================================================
// salon_integrations CRUD
// =============================================================================

type StoredCredentials = {
  nip: string
  token_enc: string
  connected_at: string
}

async function loadCreds(
  admin: SupabaseClient,
  salonId: string,
): Promise<{ nip: string; token: string } | null> {
  const { data } = await admin
    .from('salon_integrations')
    .select('credentials')
    .eq('salon_id', salonId)
    .eq('provider', 'ksef')
    .maybeSingle()
  if (!data) return null
  const stored = data.credentials as StoredCredentials
  if (!stored?.nip || !stored?.token_enc) return null
  const token = await decryptSecret(stored.token_enc)
  return { nip: stored.nip, token }
}

async function saveCreds(
  admin: SupabaseClient,
  salonId: string,
  nip: string,
  token: string,
): Promise<void> {
  const stored: StoredCredentials = {
    nip,
    token_enc: await encryptSecret(token),
    connected_at: new Date().toISOString(),
  }
  await admin.from('salon_integrations').upsert(
    {
      salon_id: salonId,
      provider: 'ksef',
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
// Connect: валидируем что token+NIP позволяют открыть КСеФ-сессию, и сохраняем
// =============================================================================

async function handleConnectWithToken(
  admin: SupabaseClient,
  userId: string,
  salonId: string,
  nip: string,
  token: string,
): Promise<Response> {
  if (!(await ensureMember(admin, userId, salonId))) {
    return jsonResponse({ ok: false, error: 'forbidden' }, 403)
  }
  const cleanNip = nip.replace(/[\s-]/g, '')
  if (!/^\d{10}$/.test(cleanNip)) {
    return jsonResponse({ ok: false, error: 'invalid_nip_format' }, 400)
  }
  if (!token || token.trim().length < 32) {
    return jsonResponse({ ok: false, error: 'invalid_token_format' }, 400)
  }

  // Smoke-test: пробуем открыть сессию. Если KSEF_SECRETS_KEY не настроен —
  // словим явный AUTH/NETWORK от api, а не зависнем при write.
  const session = await openSession(cleanNip, token.trim())
  if (!session.ok) {
    const msg = `${session.code}${session.message ? ': ' + session.message : ''}`
    if (session.code === 'AUTH') {
      return jsonResponse({ ok: false, error: 'ksef_invalid_credentials', details: msg }, 400)
    }
    if (session.code === 'CHALLENGE') {
      return jsonResponse({ ok: false, error: 'ksef_challenge_failed', details: msg }, 400)
    }
    return jsonResponse({ ok: false, error: 'ksef_api_error', details: msg }, 502)
  }
  // Сессию закрываем сразу — нужен был только smoke-test
  await closeSession(session.session.accessToken)

  await saveCreds(admin, salonId, cleanNip, token.trim())
  return jsonResponse({ ok: true, nip: cleanNip })
}

// =============================================================================
// Sync (pull) — КСеФ → Finkley
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
      sort_order: 1010,
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

async function uploadKsefXml(
  admin: SupabaseClient,
  bytes: Uint8Array,
  salonId: string,
  ksefRef: string,
): Promise<string | null> {
  const path = `${salonId}/ksef-${ksefRef.replace(/[^a-zA-Z0-9_-]/g, '_')}-${crypto.randomUUID()}.xml`
  const { error } = await admin.storage.from('receipts').upload(path, bytes, {
    contentType: 'application/xml',
    upsert: false,
  })
  if (error) {
    console.warn(`ksef xml upload failed for ${ksefRef}: ${error.message}`)
    return null
  }
  return path
}

async function syncKsefToFinkley(
  admin: SupabaseClient,
  salonId: string,
  creds: { nip: string; token: string },
  lastSyncAt: string | null,
): Promise<SyncStats> {
  const stats: SyncStats = { expenses_synced: 0, expenses_skipped: 0 }

  // Окно: ВСЕГДА 60 дней назад (КСеФ ограничивает range), независимо от
  // last_sync_at. Дедуп идёт по ksef_id — мы не делаем дубликатов.
  // Юзер 01.06 жаловался: «не импортирует за май» — last_sync_at был на
  // позднюю дату, окно стало слишком узким → 0 новых.
  void lastSyncAt
  const since = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const today = new Date().toISOString().slice(0, 10)

  // Open session
  const session = await openSession(creds.nip, creds.token)
  if (!session.ok) {
    throw new Error(`ksef_session_${session.code}${session.message ? ':' + session.message : ''}`)
  }
  const accessToken = session.session.accessToken

  let invoices: KsefInvoiceListItem[] = []
  const list = await querySubjectInvoices(accessToken, {
    dateFrom: since,
    dateTo: today,
    subjectType: 'subject2',
  })
  if (!list.ok) {
    await closeSession(accessToken)
    throw new Error(`ksef_query_${list.code}${list.message ? ':' + list.message : ''}`)
  }
  invoices = list.invoices

  if (invoices.length === 0) {
    await closeSession(accessToken)
    return stats
  }

  // Bulk-load уже импортированных ksef_id чтобы не делать Invoice/Get для них
  const { data: alreadyImported } = await admin
    .from('expenses')
    .select(`metadata`)
    .eq('salon_id', salonId)
    .is('deleted_at', null)
    .not('metadata->>ksef_id', 'is', null)
  const importedSet = new Set<string>()
  for (const r of alreadyImported ?? []) {
    const meta = r.metadata as { ksef_id?: string } | null
    if (meta?.ksef_id) importedSet.add(meta.ksef_id)
  }

  // ensureFallback убран по запросу 01.06 — категорию «Импорт КСеФ»
  // больше не создаём. Категория = null если нет точного маппинга, юзер
  // укажет вручную в UI.
  void getOrCreateImportCategory
  const categoryCache = new Map<string, string | null>()

  try {
    for (const inv of invoices) {
      if (importedSet.has(inv.ksefReferenceNumber)) {
        stats.expenses_skipped++
        continue
      }
      // Тянем XML фактуры — best-effort. Если упало — берём поля из header
      let detail = {
        totalGross: inv.totalGross,
        issueDate: inv.issueDate,
        invoiceNumber: inv.invoiceNumber,
        sellerNip: inv.sellerNip,
        sellerName: inv.sellerName,
        sellerAddress: null as string | null,
        buyerNip: inv.buyerNip,
        description: null as string | null,
        items: [] as string[],
        sellerIban: null as string | null,
        paymentMethod: null as 'cash' | 'card' | 'transfer' | null,
        paymentDeadline: null as string | null,
        paidAt: null as string | null,
        isPaid: false,
        vatRatePct: null as number | null,
        totalNet: null as number | null,
      }
      let xmlPath: string | null = null
      const xmlRes = await getInvoiceXml(accessToken, inv.ksefReferenceNumber)
      if (xmlRes.ok) {
        const parsed = parseInvoiceXml(xmlRes.bytes)
        if (parsed) {
          detail = {
            totalGross: parsed.totalGross ?? detail.totalGross,
            issueDate: parsed.issueDate ?? detail.issueDate,
            invoiceNumber: parsed.invoiceNumber ?? detail.invoiceNumber,
            sellerNip: parsed.sellerNip ?? detail.sellerNip,
            sellerName: parsed.sellerName ?? detail.sellerName,
            sellerAddress: parsed.sellerAddress,
            buyerNip: parsed.buyerNip ?? detail.buyerNip,
            description: parsed.description,
            items: parsed.items,
            sellerIban: parsed.sellerIban,
            paymentMethod: parsed.paymentMethod,
            paymentDeadline: parsed.paymentDeadline,
            paidAt: parsed.paidAt,
            isPaid: parsed.isPaid,
            vatRatePct: parsed.vatRatePct,
            totalNet: parsed.totalNet,
          }
        }
        xmlPath = await uploadKsefXml(admin, xmlRes.bytes, salonId, inv.ksefReferenceNumber)
      }

      if (!detail.totalGross || detail.totalGross <= 0) {
        stats.expenses_skipped++
        continue
      }

      const expenseAt = (detail.issueDate || inv.issueDate || since).slice(0, 10)
      const vendor = detail.sellerName ?? '—'
      // Описание = items joined (если позиций несколько) или единичное P_7.
      const description =
        detail.items.length > 0 ? detail.items.join(', ') : (detail.description ?? '')

      // (3) Категорию НЕ создаём «Импорт КСеФ» — юзер сам выберет в UI.
      // Маппим только если есть точное совпадение с системной категорией.
      const mapped = mapKsefToFinkleyCategory({
        description: detail.description,
        sellerName: detail.sellerName,
      })
      let categoryId: string | null = null
      let categoryMapped: string | null = null
      if (mapped) {
        categoryId = await findSystemCategoryId(admin, salonId, mapped, categoryCache)
        if (categoryId) categoryMapped = mapped
      }
      // НЕ вызываем ensureFallback — оставляем null, юзер укажет вручную.

      // (7) Counterparty: lookup по NIP, иначе создаём.
      // Юзер 02.06: если контрагент уже есть и у него default_expense_category_id
      // — подтягиваем эту категорию в expense (приоритет над auto-mapped).
      let counterpartyId: string | null = null
      if (detail.sellerNip) {
        const cleanNip = detail.sellerNip.replace(/[\s-]/g, '')
        const { data: existingCp } = await admin
          .from('counterparties')
          .select('id, default_expense_category_id')
          .eq('salon_id', salonId)
          .eq('nip', cleanNip)
          .is('archived_at', null)
          .maybeSingle()
        if (existingCp) {
          const cp = existingCp as { id: string; default_expense_category_id: string | null }
          counterpartyId = cp.id
          // Auto-pull дефолтной категории контрагента (если задана)
          if (cp.default_expense_category_id) {
            categoryId = cp.default_expense_category_id
            categoryMapped = 'counterparty_default'
          }
        } else if (vendor !== '—') {
          const { data: createdCp } = await admin
            .from('counterparties')
            .insert({
              salon_id: salonId,
              name: vendor,
              nip: cleanNip,
              address: detail.sellerAddress,
            })
            .select('id')
            .single()
          counterpartyId = (createdCp as { id: string } | null)?.id ?? null
        }
      }

      // (2) Статус оплаты:
      //   isPaid=true  → expense.status=paid
      //   isPaid=false → создать scheduled_payment (pending) с due_date,
      //                  expense НЕ создаём.
      if (!detail.isPaid) {
        const dueDate = detail.paymentDeadline ?? expenseAt
        const { error: spErr } = await admin.from('scheduled_payments').insert({
          salon_id: salonId,
          category_id: categoryId,
          due_date: dueDate,
          amount_cents: Math.round(detail.totalGross * 100),
          // VAT: amount_net_cents + vat_rate_pct (миграция 20260602000001).
          // Если KSeF не вернул ставку — оставляем null (treated as «без VAT
          // разбивки» вне зависимости от is_vat_payer флага салона).
          amount_net_cents: detail.totalNet != null ? Math.round(detail.totalNet * 100) : null,
          vat_rate_pct: detail.vatRatePct,
          vendor_name: vendor,
          invoice_number: detail.invoiceNumber,
          comment: description.slice(0, 500) || null,
          source: 'ksef',
          external_id: inv.ksefReferenceNumber,
        })
        if (spErr) {
          if (spErr.code === '23505') {
            stats.expenses_skipped++
            continue
          }
          console.warn(
            `ksef scheduled_payment insert failed for ${inv.ksefReferenceNumber}: ${spErr.message}`,
          )
          stats.expenses_skipped++
          continue
        }
        stats.expenses_synced++
        continue
      }

      // Оплаченная фактура — INSERT в expenses.
      const { error } = await admin.from('expenses').insert({
        salon_id: salonId,
        category_id: categoryId,
        expense_at: expenseAt,
        amount_cents: Math.round(detail.totalGross * 100),
        // VAT: записываем нетто и ставку из KSeF (миграция 20260602000001).
        // Если не извлеклись (старые KSeF без P_13_x) — null, тогда old-style
        // «брутто=net» сохраняется в P&L.
        amount_net_cents: detail.totalNet != null ? Math.round(detail.totalNet * 100) : null,
        vat_rate_pct: detail.vatRatePct,
        // (4) payment_method из XML; если не определён — оставляем transfer
        // как «банковский перевод» (default для оплаченных фактур).
        payment_method: detail.paymentMethod ?? 'transfer',
        paid_at: detail.paidAt ? new Date(detail.paidAt).toISOString() : null,
        // (6) Description (а не comment) — items.join(', ')
        description: description.slice(0, 500) || null,
        comment: null,
        contractor_name: vendor,
        counterparty_id: counterpartyId,
        // (5) document_number = invoice_number из KSeF
        document_number: detail.invoiceNumber ?? null,
        invoice_number: detail.invoiceNumber,
        source: 'ksef',
        external_id: inv.ksefReferenceNumber,
        receipt_url: xmlPath,
        bank_account_iban: detail.sellerIban,
        metadata: {
          ksef_id: inv.ksefReferenceNumber,
          vendor_nip: detail.sellerNip,
          buyer_nip: detail.buyerNip,
          currency_original: inv.currency,
          ...(categoryMapped ? { ksef_category_mapped: categoryMapped } : {}),
        },
      })
      if (error) {
        // UNIQUE_VIOLATION на idx_expenses_salon_ksef_id означает что ту же
        // фактуру уже импортировали из другого портала (wFirma и т.п.) —
        // приоритет: бухгалтерская система выигрывает (см. ADR-013 §D), мы
        // просто скипаем.
        if (error.code === '23505') {
          stats.expenses_skipped++
          continue
        }
        console.warn(`ksef expense insert failed for ${inv.ksefReferenceNumber}: ${error.message}`)
        stats.expenses_skipped++
        continue
      }
      stats.expenses_synced++
    }
  } finally {
    await closeSession(accessToken)
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
    .eq('provider', 'ksef')
    .maybeSingle()
  const lastSyncAt = existing?.last_sync_at ?? null

  let stats: SyncStats
  try {
    stats = await syncKsefToFinkley(admin, salonId, creds, lastSyncAt)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    const { data: salonRow } = await admin
      .from('salons')
      .select('name')
      .eq('id', salonId)
      .maybeSingle()
    await recordSyncResult(admin, {
      salonId,
      provider: 'ksef',
      ok: false,
      errorMessage: msg,
      salonName: (salonRow as { name?: string } | null)?.name ?? null,
    })
    return { ok: false, status: 502, message: msg }
  }

  await recordSyncResult(admin, { salonId, provider: 'ksef', ok: true })
  await admin
    .from('salon_integrations')
    .update({ status: 'connected', last_sync_stats: stats })
    .eq('salon_id', salonId)
    .eq('provider', 'ksef')

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
    .from('ksef_sync_triggers')
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
// Entry
// =============================================================================

Deno.serve(
  withSentry('ksef-proxy', async (req: Request) => {
    if (req.method === 'OPTIONS') return preflight()
    if (req.method !== 'POST') return jsonResponse({ ok: false, error: 'method_not_allowed' }, 405)
    if (!SUPABASE_URL || !SERVICE_KEY) {
      return jsonResponse({ ok: false, error: 'function_not_configured' }, 500)
    }

    let body: {
      action?: string
      salon_id?: string
      nip?: string
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
      case 'connect_with_token': {
        if (!body.nip || !body.token) {
          return jsonResponse({ ok: false, error: 'fields_required' }, 400)
        }
        return handleConnectWithToken(admin, userId, body.salon_id, body.nip, body.token)
      }
      case 'sync':
        return handleSync(admin, userId, body.salon_id)
      default:
        return jsonResponse({ ok: false, error: 'unknown_action' }, 400)
    }
  }),
)
