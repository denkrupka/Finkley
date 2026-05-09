/**
 * banking-disconnect — отключает bank_connection: revoke сессию в EB,
 * помечает status='revoked' в БД. Импортированные транзакции остаются
 * (не сносим — это история расходов).
 *
 * Body: { connection_id }
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.6'

import { getSalonMembership, getUserFromRequest } from '../_shared/auth.ts'
import { corsHeaders, preflight } from '../_shared/cors.ts'
import { deleteSession, type EbConfig } from '../_shared/enable-banking.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const APP_ID = Deno.env.get('ENABLE_BANKING_APP_ID') ?? ''
const PRIVATE_KEY = Deno.env.get('ENABLE_BANKING_PRIVATE_KEY') ?? ''

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'content-type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return preflight()
  if (req.method !== 'POST') return jsonResponse({ error: 'method_not_allowed' }, 405)

  const user = await getUserFromRequest(req, SUPABASE_URL, SERVICE_KEY)
  if (!user) return jsonResponse({ error: 'unauthorized' }, 401)

  let body: { connection_id?: string }
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: 'bad_request' }, 400)
  }
  if (!body.connection_id) return jsonResponse({ error: 'missing_connection_id' }, 400)

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data: conn, error: connErr } = await admin
    .from('bank_connections')
    .select('id, salon_id, session_id, status')
    .eq('id', body.connection_id)
    .maybeSingle()
  if (connErr || !conn) return jsonResponse({ error: 'connection_not_found' }, 404)

  const m = await getSalonMembership(SUPABASE_URL, SERVICE_KEY, user.userId, conn.salon_id)
  if (!m || !['owner', 'admin'].includes(m.role)) {
    return jsonResponse({ error: 'forbidden' }, 403)
  }

  // Best-effort revoke в EB. Если упало — всё равно помечаем revoked локально,
  // потому что юзер хочет отключить, а не валидить сессию.
  if (conn.session_id && APP_ID && PRIVATE_KEY) {
    const cfg: EbConfig = { appId: APP_ID, privateKeyPem: PRIVATE_KEY }
    try {
      await deleteSession(cfg, conn.session_id as string)
    } catch (e) {
      console.warn('deleteSession failed (still marking revoked locally)', e)
    }
  }

  await admin
    .from('bank_connections')
    .update({ status: 'revoked', session_id: null })
    .eq('id', conn.id)

  return jsonResponse({ ok: true })
})
