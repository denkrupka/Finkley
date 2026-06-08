/**
 * treatwell-connect — сохраняет credentials Treatwell (логин/пароль), которые
 * клиент ввёл в форму портала, и ставит интеграцию в статус 'pending'. Сам
 * логин/синк выполняет GitHub-воркер (treatwell-sync.yml) — НЕ Supabase Edge,
 * т.к. с IP Supabase Cloudflare режет Capsolver-токен (см. treatwell-worker).
 *
 * Если задан секрет GH_DISPATCH_TOKEN — шлёт repository_dispatch для мгновенного
 * синка; иначе синк подхватит ежечасный cron воркера.
 *
 * Body: { salon_id, login, password }
 * Auth: Bearer <user JWT> — проверяем членство в салоне.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'

import { corsHeaders, preflight } from '../_shared/cors.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const GH_DISPATCH_TOKEN = Deno.env.get('GH_DISPATCH_TOKEN') ?? ''
const GH_REPO = Deno.env.get('GH_DISPATCH_REPO') ?? 'denkrupka/Finkley'

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'content-type': 'application/json' },
  })
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return preflight()
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)
  if (!SUPABASE_URL || !SERVICE_KEY) return json({ error: 'not_configured' }, 500)

  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!jwt) return json({ error: 'unauthorized' }, 401)

  const body = (await req.json().catch(() => null)) as {
    salon_id?: string
    login?: string
    password?: string
  } | null
  if (!body?.salon_id || !body.login || !body.password) return json({ error: 'bad_request' }, 400)

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  // Проверяем что вызывающий — член салона.
  const { data: userData, error: userErr } = await admin.auth.getUser(jwt)
  if (userErr || !userData?.user) return json({ error: 'unauthorized' }, 401)
  const { data: member } = await admin
    .from('salon_members')
    .select('salon_id')
    .eq('salon_id', body.salon_id)
    .eq('user_id', userData.user.id)
    .maybeSingle()
  if (!member) return json({ error: 'forbidden' }, 403)

  // Сохраняем креды + ставим pending.
  const { error: upErr } = await admin.from('salon_integrations').upsert(
    {
      salon_id: body.salon_id,
      provider: 'treatwell',
      status: 'pending',
      credentials: { login: body.login, password: body.password },
      last_error: null,
    },
    { onConflict: 'salon_id,provider' },
  )
  if (upErr) return json({ error: 'save_failed', detail: upErr.message }, 500)

  // Мгновенный синк (если настроен GH-токен), иначе подхватит cron.
  let dispatched = false
  if (GH_DISPATCH_TOKEN) {
    try {
      const r = await fetch(`https://api.github.com/repos/${GH_REPO}/dispatches`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${GH_DISPATCH_TOKEN}`,
          accept: 'application/vnd.github+json',
          'content-type': 'application/json',
          'user-agent': 'finkley-treatwell-connect',
        },
        body: JSON.stringify({
          event_type: 'treatwell-sync',
          client_payload: { salon_id: body.salon_id },
        }),
      })
      dispatched = r.status === 204
      if (!dispatched) console.warn('dispatch failed', r.status, (await r.text()).slice(0, 200))
    } catch (e) {
      console.warn('dispatch exception', (e as Error).message)
    }
  }

  return json({ ok: true, status: 'pending', dispatched })
})
