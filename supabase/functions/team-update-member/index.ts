/**
 * team-update-member — owner/admin салона может редактировать имя/фамилия/
 * телефон члена своей команды через карточку участника в /salon/settings/team.
 *
 * Email НЕ редактируется здесь (это требует auth-flow). Только админ
 * портала через /admin/users → UserCardModal (admin-stats user_update_profile)
 * может менять email.
 *
 * Body:
 *   { salon_id, target_user_id, first_name?, last_name?, phone? }
 *
 * Проверки:
 *   - Caller — owner/admin того же salon_id
 *   - Target — состоит в этом салоне (защита от update любого юзера)
 *
 * Deploy: --no-verify-jwt (сами проверяем через getUserFromRequest)
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.6'

import { getUserFromRequest } from '../_shared/auth.ts'
import { corsHeaders, preflight } from '../_shared/cors.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'content-type': 'application/json' },
  })
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return preflight()
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)
  if (!SUPABASE_URL || !SERVICE_KEY) return json({ error: 'function_not_configured' }, 500)

  const user = await getUserFromRequest(req, SUPABASE_URL, SERVICE_KEY)
  if (!user) return json({ error: 'unauthorized' }, 401)

  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return json({ error: 'invalid_json' }, 400)
  }

  const salonId = body.salon_id
  const targetId = body.target_user_id
  if (typeof salonId !== 'string') return json({ error: 'salon_id_required' }, 400)
  if (typeof targetId !== 'string') return json({ error: 'target_user_id_required' }, 400)

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  // 1) caller — owner/admin этого салона?
  const { data: caller } = await admin
    .from('salon_members')
    .select('role')
    .eq('salon_id', salonId)
    .eq('user_id', user.userId)
    .maybeSingle()
  if (!caller || (caller.role !== 'owner' && caller.role !== 'admin')) {
    return json({ error: 'forbidden' }, 403)
  }

  // 2) target — член того же салона?
  const { data: target } = await admin
    .from('salon_members')
    .select('role')
    .eq('salon_id', salonId)
    .eq('user_id', targetId)
    .maybeSingle()
  if (!target) {
    return json({ error: 'target_not_in_salon' }, 404)
  }

  // 3) Применяем patch на profiles
  const firstName = typeof body.first_name === 'string' ? body.first_name.trim() : undefined
  const lastName = typeof body.last_name === 'string' ? body.last_name.trim() : undefined
  const phone = typeof body.phone === 'string' ? body.phone.trim() : undefined

  const patch: Record<string, string | null> = {}
  if (firstName !== undefined || lastName !== undefined) {
    const fn = firstName ?? ''
    const ln = lastName ?? ''
    patch.full_name = [fn, ln].filter((x) => x.length > 0).join(' ') || null
  }
  if (phone !== undefined) {
    patch.phone = phone.length > 0 ? phone : null
  }

  if (Object.keys(patch).length === 0) {
    return json({ error: 'nothing_to_update' }, 400)
  }

  const { error } = await admin.from('profiles').update(patch).eq('id', targetId)
  if (error) return json({ error: error.message }, 500)

  return json({ ok: true })
})
