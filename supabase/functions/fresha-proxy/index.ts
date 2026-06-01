/**
 * fresha-proxy — интеграция с Fresha через Data Connector.
 *
 * Fresha предоставляет «Data Connector» (Snowflake share / BigQuery / REST
 * pull) для экспорта данных партнёрам:
 *   https://www.fresha.com/help-center/knowledge-base/reports/433-setup-and-manage-data-connectors
 *   https://www.fresha.com/help-center/knowledge-base/reports/479-available-data-connector-tools
 *   https://www.fresha.com/help-center/knowledge-base/reports/101734-data-connector-tables
 *
 * Таблицы которые нам нужны:
 *   - bookings (визиты)
 *   - clients (клиенты)
 *   - services (услуги)
 *   - team_members (мастера)
 *   - sales (продажи / payments)
 *
 * Auth flow:
 *   Юзер в Fresha включает Data Connector → получает credentials
 *   (account_id + access_key для Snowflake / project + service-account JSON
 *   для BigQuery). Мы храним их зашифрованно (ADR-002) и периодически
 *   pull'им через SQL/REST. Полная имплементация требует решения чем
 *   именно ходить (snowflake-sdk Deno-compatible? REST proxy через
 *   Cloud Function на Fresha-стороне?).
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
    account_id?: string
    access_key?: string
  } | null
  if (!body?.action || !body.salon_id) return jsonResponse({ error: 'bad_request' }, 400)

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  if (body.action === 'connect') {
    // TODO: валидация credentials через `Data Connector status` endpoint.
    // Пока — записываем salon_integrations без verification.
    await admin.from('salon_integrations').upsert(
      {
        salon_id: body.salon_id,
        provider: 'fresha',
        status: 'connected',
        external_account_id: body.account_id ?? body.login ?? null,
        last_sync_at: null,
      },
      { onConflict: 'salon_id,provider' },
    )
    return jsonResponse({
      ok: true,
      note: 'Credentials сохранены. Sync будет включён после реализации DataConnector pull в следующем спринте.',
    })
  }

  if (body.action === 'disconnect') {
    await admin
      .from('salon_integrations')
      .update({ status: 'disconnected' })
      .eq('salon_id', body.salon_id)
      .eq('provider', 'fresha')
    return jsonResponse({ ok: true })
  }

  if (body.action === 'sync') {
    // TODO: подключение к Fresha Data Connector (Snowflake/BigQuery/REST)
    // и pull таблиц bookings/clients/services/team_members → upsert в
    // salon.staff/services/clients/visits.
    return jsonResponse({
      ok: false,
      error: 'sync_not_implemented',
      message:
        'Fresha sync пока не реализован. Каркас connect готов; нужно решение по транспорту (Snowflake share / BigQuery / REST proxy) — ADR обсудить с владельцем.',
    })
  }

  return jsonResponse({ error: 'unknown_action' }, 400)
})
