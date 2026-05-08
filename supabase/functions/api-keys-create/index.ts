/**
 * api-keys-create — генерирует новый API ключ для салона.
 *
 * Возвращает полный ключ ОДИН раз — после этого только префикс хранится
 * в БД для UI, full key теряется. Юзер обязан скопировать.
 *
 * Format: `fnk_live_<32 random base32 chars>` ≈ 41 символ.
 *
 * Auth: user JWT, должен быть admin/owner салона.
 */

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'

import { corsHeaders, preflight } from '../_shared/cors.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'content-type': 'application/json' },
  })
}

function generateKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(20))
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  const b32 = btoa(bin).replace(/\+/g, '').replace(/\//g, '').replace(/=+$/, '').slice(0, 32)
  return `fnk_live_${b32}`
}

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

async function ensureAdmin(
  admin: SupabaseClient,
  userId: string,
  salonId: string,
): Promise<boolean> {
  const { data } = await admin
    .from('salon_members')
    .select('role')
    .eq('salon_id', salonId)
    .eq('user_id', userId)
    .maybeSingle()
  return !!data && (data.role === 'owner' || data.role === 'admin')
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return preflight()
  if (req.method !== 'POST') return jsonResponse({ ok: false, error: 'method_not_allowed' }, 405)

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
    return jsonResponse({ ok: false, error: 'invalid_token' }, 401)
  }
  const userId = userRes.user.id

  let body: { salon_id?: string; name?: string; scopes?: string[] }
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ ok: false, error: 'bad_request' }, 400)
  }

  if (!body.salon_id || !body.name?.trim()) {
    return jsonResponse({ ok: false, error: 'missing_fields' }, 400)
  }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  if (!(await ensureAdmin(admin, userId, body.salon_id))) {
    return jsonResponse({ ok: false, error: 'forbidden' }, 403)
  }

  const fullKey = generateKey()
  const keyHash = await sha256Hex(fullKey)
  const keyPrefix = fullKey.slice(0, 12)
  const scopes = body.scopes && body.scopes.length > 0 ? body.scopes : ['read']
  const allowedScopes = ['read', 'write']
  if (!scopes.every((s) => allowedScopes.includes(s))) {
    return jsonResponse({ ok: false, error: 'invalid_scopes' }, 400)
  }

  const { data, error } = await admin
    .from('api_keys')
    .insert({
      salon_id: body.salon_id,
      name: body.name.trim().slice(0, 100),
      key_prefix: keyPrefix,
      key_hash: keyHash,
      scopes,
      created_by: userId,
    })
    .select('id, name, key_prefix, scopes, created_at')
    .single()
  if (error || !data) {
    return jsonResponse({ ok: false, error: 'create_failed', message: error?.message }, 500)
  }

  return jsonResponse({
    ok: true,
    api_key: fullKey, // показываем ОДИН РАЗ
    record: data,
  })
})
