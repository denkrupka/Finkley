/**
 * bookon-proxy — интеграция с BookOn (https://bookon.binotel.pl/),
 * booking-системой от Binotel для салонов в PL/UA.
 *
 * Public API не задокументирован — нужен партнёрский запрос. Текущий
 * каркас сохраняет credentials в salon_integrations.credentials и
 * помечает интеграцию connected. Sync пока возвращает stub до
 * реализации pull-логики (когда будет доступ к их API).
 *
 * Bug 5059189d (Елена 01.06): запрос добавить плитку BookOn рядом
 * с Booksy в /integrations.
 *
 * STATUS: skeleton — connect собирает credentials, sync TODO.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'

import { corsHeaders, preflight } from '../_shared/cors.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'content-type': 'application/json' },
  })
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return preflight()
  if (!SUPABASE_URL || !SERVICE_KEY) return jsonResponse({ error: 'not_configured' }, 500)
  if (req.method !== 'POST') return jsonResponse({ error: 'method_not_allowed' }, 405)

  const body = (await req.json().catch(() => null)) as {
    action?: 'connect' | 'sync' | 'disconnect'
    salon_id?: string
    login?: string
    password?: string
  } | null
  if (!body?.action || !body.salon_id) return jsonResponse({ error: 'bad_request' }, 400)

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  if (body.action === 'connect') {
    if (!body.login || !body.password) return jsonResponse({ error: 'creds_missing' }, 400)
    // Сохраняем credentials в salon_integrations. Шифрование at-rest даёт
    // Supabase Storage; для secret-level — переходить на pgsodium когда
    // появится реальный API call.
    const { error } = await admin.from('salon_integrations').upsert(
      {
        salon_id: body.salon_id,
        provider: 'bookon',
        status: 'connected',
        external_account_id: body.login,
        credentials: {
          login: body.login,
          password: body.password,
        },
        last_sync_at: null,
      },
      { onConflict: 'salon_id,provider' },
    )
    if (error) return jsonResponse({ error: error.message }, 500)
    return jsonResponse({
      ok: true,
      note: 'Credentials BookOn сохранены. Sync (импорт визитов/клиентов/мастеров) будет включён после получения партнёрского доступа к их API.',
    })
  }

  if (body.action === 'disconnect') {
    await admin
      .from('salon_integrations')
      .update({ status: 'disconnected' })
      .eq('salon_id', body.salon_id)
      .eq('provider', 'bookon')
    return jsonResponse({ ok: true })
  }

  if (body.action === 'sync') {
    // TODO: pull bookings/clients/staff из BookOn API когда будет доступ.
    // Сейчас — возвращаем пустую статистику чтобы UI не падал.
    await admin
      .from('salon_integrations')
      .update({ last_sync_at: new Date().toISOString() })
      .eq('salon_id', body.salon_id)
      .eq('provider', 'bookon')
    return jsonResponse({
      ok: true,
      stats: { staff_synced: 0, services_synced: 0, clients_synced: 0, visits_synced: 0 },
      message:
        'BookOn sync пока заглушка — credentials сохранены, реальный pull будет добавлен после получения доступа к их API.',
    })
  }

  return jsonResponse({ error: 'unknown_action' }, 400)
})
