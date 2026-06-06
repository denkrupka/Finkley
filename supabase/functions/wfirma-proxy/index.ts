/**
 * wfirma-proxy — интеграция с wFirma (PL bookkeeping).
 *
 * Actions:
 *   - connect_with_login       — X2: email+password → web-flow генерация ключей
 *   - connect_with_credentials — X1: ручной ввод 3 ключей
 *
 * NOTE 06.06: pull-синк (sync, cron_sync_one, push_expense) удалён — wFirma
 * теперь работает только как OCR-цель: расходы добавленные с фото/документом
 * экспортируются в wFirma OCR через отдельную функцию. См. wFirma-OCR в
 * следующем commit'е. Соответствующие миграции: 20260606000001_drop_wfirma_sync.
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
import { withSentry } from '../_shared/sentry.ts'

import { wfirmaCompaniesFind, type WfirmaApiCreds } from './api.ts'
import { decryptSecret, encryptSecret } from './crypto.ts'
import { generateApiKeyViaWebFlow } from './web-flow.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const WFIRMA_APP_KEY = Deno.env.get('WFIRMA_APP_KEY') ?? ''
const AUTO_LOGIN_DISABLED = Deno.env.get('WFIRMA_AUTO_LOGIN_DISABLED') === '1'

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
  // Всегда возвращаем 200 чтобы supabase.functions.invoke() в UI не съел
  // конкретный error code общим 'Edge Function returned non-2xx'.
  if (!(await ensureMember(admin, userId, salonId))) {
    return jsonResponse({ ok: false, error: 'forbidden' })
  }
  if (AUTO_LOGIN_DISABLED) {
    return jsonResponse({ ok: false, error: 'auto_login_disabled' })
  }
  if (!WFIRMA_APP_KEY) {
    return jsonResponse({ ok: false, error: 'function_not_configured' })
  }

  const flowRes = await generateApiKeyViaWebFlow(email, password, { selectedCompanyId })
  if (!flowRes.ok) {
    if (flowRes.reason === 'choose_company') {
      return jsonResponse({
        ok: false,
        error: 'choose_company',
        companies: flowRes.companies,
      })
    }
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
  // 05.06: api2.wfirma.pl иногда возвращает 0 компаний сразу после
  // создания свежего API-ключа (eventual consistency между web-panel и
  // api2). Но web-flow уже отдал валидные ключи + companyId/companyName,
  // которые мы УЖЕ знаем. Не блокируемся на NIP — сохраним креды без
  // него, NIP подцепится при первом запросе компании.
  const find = await wfirmaCompaniesFind(apiCreds)
  let companyName = flowRes.data.companyName || ''
  let companyNip = flowRes.data.companyNip || ''
  let companyId = flowRes.data.companyId
  if (find.ok) {
    const company =
      find.companies.find((c) => String(c.id) === flowRes.data.companyId) ?? find.companies[0]
    if (company) {
      companyId = String(company.id)
      companyName = company.name || companyName
      companyNip = company.nip || companyNip
    }
  }
  if (!companyName && companyId) {
    companyName = `Firma #${companyId}`
  }

  await saveCreds(admin, salonId, apiCreds, companyName, companyNip, 'auto_login')

  return jsonResponse({
    ok: true,
    company: { id: companyId, name: companyName, nip: companyNip },
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
    return jsonResponse({ ok: false, error: 'forbidden' })
  }
  if (!WFIRMA_APP_KEY) {
    return jsonResponse({ ok: false, error: 'function_not_configured' })
  }
  if (!/^[a-f0-9]{32}$/.test(accessKey) || !/^[a-f0-9]{32}$/.test(secretKey)) {
    return jsonResponse({ ok: false, error: 'invalid_keys_format' })
  }
  if (!/^\d+$/.test(companyId)) {
    return jsonResponse({ ok: false, error: 'invalid_company_id' })
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
      return jsonResponse({ ok: false, error: 'wfirma_invalid_credentials' })
    }
    return jsonResponse({ ok: false, error: 'wfirma_api_error', details: find.code })
  }
  const company = find.companies.find((c) => String(c.id) === companyId)
  if (!company) {
    return jsonResponse({ ok: false, error: 'wfirma_company_id_not_found' })
  }

  await saveCreds(admin, salonId, apiCreds, company.name, company.nip, 'manual')

  return jsonResponse({
    ok: true,
    company: { id: company.id, name: company.name, nip: company.nip },
  })
}

// =============================================================================
// HTTP entrypoint
// =============================================================================

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

    // Все actions требуют user JWT
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
      default:
        return jsonResponse({ ok: false, error: 'unknown_action' }, 400)
    }
  }),
)

// Suppress unused warning until commit 2 introduces push_receipt_ocr.
export { loadCreds }
