/**
 * banking-callback — принимает code от Enable Banking после bank-auth,
 * обменивает на session, привязывает аккаунты, запускает первый sync.
 *
 * Вход:
 *   POST /banking-callback
 *   Body: { code, state }
 *
 * `state` = id записи bank_connections (выдан при banking-connect).
 *
 * Auth: юзер должен быть авторизован (Authorization: Bearer <session-jwt>),
 * мы дополнительно проверяем что connection.created_by = user.id, чтобы
 * чужой не мог зацепить чужой код (state — UUID, но perfect-secrecy
 * не гарантируем).
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.6'

import { getUserFromRequest } from '../_shared/auth.ts'
import { corsHeaders, preflight } from '../_shared/cors.ts'
import { createSession, type EbConfig } from '../_shared/enable-banking.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const APP_ID = Deno.env.get('ENABLE_BANKING_APP_ID') ?? ''
const PRIVATE_KEY = Deno.env.get('ENABLE_BANKING_PRIVATE_KEY') ?? ''
const FUNCTIONS_URL = (Deno.env.get('SUPABASE_URL') ?? '').replace(
  /^https:\/\/([a-z0-9]+)\.supabase\.co\/?$/,
  'https://$1.functions.supabase.co',
)

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'content-type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return preflight()
  if (req.method !== 'POST') return jsonResponse({ error: 'method_not_allowed' }, 405)

  if (!APP_ID || !PRIVATE_KEY) {
    return jsonResponse({ error: 'enable_banking_not_configured' }, 500)
  }

  const user = await getUserFromRequest(req, SUPABASE_URL, SERVICE_KEY)
  if (!user) return jsonResponse({ error: 'unauthorized' }, 401)

  let body: { code?: string; state?: string }
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: 'bad_request' }, 400)
  }
  if (!body.code || !body.state) {
    return jsonResponse({ error: 'missing_code_or_state' }, 400)
  }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  // Находим pending-connection по state. Должна принадлежать этому юзеру.
  const { data: conn, error: findErr } = await admin
    .from('bank_connections')
    .select('id, salon_id, created_by, status, history_days, bank_aspsp_name, bank_country')
    .eq('id', body.state)
    .maybeSingle()
  if (findErr || !conn) {
    return jsonResponse({ error: 'connection_not_found' }, 404)
  }
  if (conn.created_by !== user.userId) {
    return jsonResponse({ error: 'forbidden' }, 403)
  }

  const cfg: EbConfig = { appId: APP_ID, privateKeyPem: PRIVATE_KEY }
  let session: Awaited<ReturnType<typeof createSession>>
  try {
    session = await createSession(cfg, body.code)
  } catch (e) {
    console.error('createSession failed', e)
    await admin
      .from('bank_connections')
      .update({ status: 'error', last_error: e instanceof Error ? e.message : String(e) })
      .eq('id', conn.id)
    return jsonResponse(
      { error: 'enable_banking_error', detail: e instanceof Error ? e.message : String(e) },
      502,
    )
  }

  // Проапдейтить bank_connections
  await admin
    .from('bank_connections')
    .update({
      session_id: session.session_id,
      bank_name: session.aspsp?.name ?? conn.bank_aspsp_name,
      valid_until: session.access?.valid_until ?? null,
      status: 'connected',
      last_error: null,
    })
    .eq('id', conn.id)

  // Сохранить аккаунты (multi-account по запросу владельца)
  const accountInserts = (session.accounts ?? []).map((a) => ({
    connection_id: conn.id,
    external_id: a.uid,
    iban: a.account_id?.iban ?? a.account_id?.other?.identification ?? null,
    name: a.name ?? a.product ?? null,
    currency: a.currency ?? null,
    is_active: true,
  }))
  if (accountInserts.length > 0) {
    const { error: accErr } = await admin
      .from('bank_accounts')
      .upsert(accountInserts, { onConflict: 'connection_id,external_id' })
    if (accErr) console.error('upsert bank_accounts', accErr)
  }

  // Первичный sync — запускаем server-to-server вызов banking-sync.
  // Это асинхронно и долго; не блокируем callback. Юзер увидит транзакции
  // через несколько секунд после рефреша /expenses.
  const internalSecret = Deno.env.get('FUNCTION_INTERNAL_SECRET') ?? ''
  if (FUNCTIONS_URL && internalSecret) {
    fetch(`${FUNCTIONS_URL}/banking-sync`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        connection_id: conn.id,
        secret: internalSecret,
        is_initial: true,
      }),
    }).catch((e) => console.warn('banking-sync trigger failed', e))
  }

  return jsonResponse({
    ok: true,
    connection_id: conn.id,
    accounts_count: accountInserts.length,
    bank_name: session.aspsp?.name ?? null,
    valid_until: session.access?.valid_until ?? null,
  })
})
