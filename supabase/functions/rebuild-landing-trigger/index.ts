/**
 * rebuild-landing-trigger — пересборка статического лендинга finkley.app.
 *
 * Лендинг (Astro SSG) тянет media_posts из Supabase на этапе БИЛДА
 * (apps/landing/src/lib/db-posts.ts). Поэтому статья, добавленная/опубликованная
 * в админке (/admin/media), появляется на finkley.app/media ТОЛЬКО после
 * пересборки сайта. Эта функция дёргает GitHub Actions (deploy-web.yml) через
 * repository_dispatch (event_type: rebuild-landing) — билд + деплой Pages
 * занимает ~1-2 минуты.
 *
 * Вызывается: автоматически при публикации статьи (draft=false) и кнопкой
 * «Пересобрать сайт» в админке.
 *
 * Body: {} (ничего не нужно)
 * Auth: Bearer <user JWT>; разрешено только app_admins.
 * Секреты: GH_DISPATCH_TOKEN (тот же, что у treatwell-sync-trigger),
 *          GH_DISPATCH_REPO (default denkrupka/Finkley).
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

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data: userData, error: userErr } = await admin.auth.getUser(jwt)
  if (userErr || !userData?.user) return json({ error: 'unauthorized' }, 401)

  // Только app_admins могут триггерить пересборку (тот же гейт, что у /admin/media).
  const { data: isAdmin } = await admin
    .from('app_admins')
    .select('user_id')
    .eq('user_id', userData.user.id)
    .maybeSingle()
  if (!isAdmin) return json({ error: 'forbidden' }, 403)

  if (!GH_DISPATCH_TOKEN) return json({ ok: true, dispatched: false, note: 'token_not_configured' })

  let dispatched = false
  try {
    const r = await fetch(`https://api.github.com/repos/${GH_REPO}/dispatches`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${GH_DISPATCH_TOKEN}`,
        accept: 'application/vnd.github+json',
        'content-type': 'application/json',
        'user-agent': 'finkley-rebuild-landing-trigger',
      },
      body: JSON.stringify({ event_type: 'rebuild-landing' }),
    })
    dispatched = r.status === 204
    if (!dispatched) console.warn('dispatch failed', r.status, (await r.text()).slice(0, 200))
  } catch (e) {
    console.warn('dispatch exception', (e as Error).message)
  }
  return json({ ok: true, dispatched })
})
