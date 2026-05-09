/**
 * banking-connect — стартует bank-auth flow для салона.
 *
 * Вход (JSON):
 *   { salon_id, aspsp_name, aspsp_country, history_days }
 *
 * Что делает:
 *   1. Проверяет membership юзера в салоне (role = owner|admin)
 *   2. Создаёт строку bank_connections со status='pending'
 *   3. Вызывает Enable Banking POST /auth с redirect_url, привязанным к
 *      нашему callback'у. State = id строки bank_connections (UUID).
 *   4. Возвращает {auth_url} — клиент делает window.location = url
 *
 * Юзер уходит на страницу банка (или EB-aggregator), проходит SCA,
 * возвращается на /banking/callback?code=...&state=<connection_id>.
 * Дальше — banking-callback.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.6'

import { getSalonMembership, getUserFromRequest } from '../_shared/auth.ts'
import { corsHeaders, preflight } from '../_shared/cors.ts'
import { createAuth, type EbConfig } from '../_shared/enable-banking.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const APP_ID = Deno.env.get('ENABLE_BANKING_APP_ID') ?? ''
const PRIVATE_KEY = Deno.env.get('ENABLE_BANKING_PRIVATE_KEY') ?? ''
const REDIRECT_URL =
  Deno.env.get('ENABLE_BANKING_REDIRECT_URL') ?? 'https://finkley.app/banking/callback'

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

  let body: {
    salon_id?: string
    aspsp_name?: string
    aspsp_country?: string
    history_days?: number
  }
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: 'bad_request' }, 400)
  }

  if (!body.salon_id || !body.aspsp_name || !body.aspsp_country) {
    return jsonResponse({ error: 'missing_fields' }, 400)
  }

  const membership = await getSalonMembership(SUPABASE_URL, SERVICE_KEY, user.userId, body.salon_id)
  if (!membership || !['owner', 'admin'].includes(membership.role)) {
    return jsonResponse({ error: 'forbidden' }, 403)
  }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  // Pre-create запись подключения. State = id этой записи; после callback
  // мы по этому id найдём pending-row и проапдейтим её.
  const historyDays = Math.min(Math.max(body.history_days ?? 90, 30), 730)
  const { data: connRow, error: insertErr } = await admin
    .from('bank_connections')
    .insert({
      salon_id: body.salon_id,
      bank_aspsp_name: body.aspsp_name,
      bank_country: body.aspsp_country,
      history_days: historyDays,
      status: 'pending',
      created_by: user.userId,
    })
    .select('id')
    .single()
  if (insertErr || !connRow) {
    console.error('insert bank_connections', insertErr)
    return jsonResponse({ error: 'db_error', detail: insertErr?.message }, 500)
  }

  const cfg: EbConfig = { appId: APP_ID, privateKeyPem: PRIVATE_KEY }
  try {
    const authResp = await createAuth(cfg, {
      aspspName: body.aspsp_name,
      aspspCountry: body.aspsp_country,
      redirectUrl: REDIRECT_URL,
      state: connRow.id as string,
      psuType: 'business',
    })
    return jsonResponse({ auth_url: authResp.url, connection_id: connRow.id })
  } catch (e) {
    console.error('createAuth failed', e)
    // Помечаем pending-row как ошибочную, чтобы не висела.
    await admin
      .from('bank_connections')
      .update({ status: 'error', last_error: e instanceof Error ? e.message : String(e) })
      .eq('id', connRow.id)
    return jsonResponse(
      { error: 'enable_banking_error', detail: e instanceof Error ? e.message : String(e) },
      502,
    )
  }
})
