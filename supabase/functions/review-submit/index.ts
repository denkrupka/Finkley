/**
 * review-submit — public endpoint для FlySMS-flow.
 *
 * GET /review-submit?token=...&open=1 — клиент открыл письмо, помечаем opened_at.
 * POST { token, rating, body? } — клиент отправил оценку.
 *   Если rating === 5 → возвращаем google_place_url (клиент перейдёт по нему).
 *   Если rating 1-4 → сохраняем reviews row (visibility='private'), возвращаем
 *   текст подтверждения. Если body не задан — клиент попадает на форму.
 *
 * Auth: token из review_requests. Нет user JWT.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'

import { corsHeaders, preflight } from '../_shared/cors.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'content-type': 'application/json' },
  })
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return preflight()
  if (!SUPABASE_URL || !SERVICE_KEY) {
    return jsonResponse({ error: 'function_not_configured' }, 500)
  }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const url = new URL(req.url)
  const tokenFromQuery = url.searchParams.get('token')

  // GET: open-pixel или просто info-получение.
  if (req.method === 'GET') {
    if (!tokenFromQuery) return jsonResponse({ error: 'missing_token' }, 400)
    const { data: rr } = await admin
      .from('review_requests')
      .select('id, salon_id, visit_id, expires_at')
      .eq('token', tokenFromQuery)
      .maybeSingle()
    if (!rr) return jsonResponse({ error: 'not_found' }, 404)
    if (new Date(rr.expires_at as string).getTime() < Date.now()) {
      return jsonResponse({ error: 'expired' }, 410)
    }
    // Помечаем opened_at (если ещё нет).
    await admin
      .from('review_requests')
      .update({ opened_at: new Date().toISOString() })
      .eq('id', rr.id)
      .is('opened_at', null)

    const { data: salon } = await admin
      .from('salons')
      .select('id, name, logo_url, google_place_url, locale')
      .eq('id', rr.salon_id)
      .maybeSingle()
    return jsonResponse({
      ok: true,
      salon: salon
        ? {
            id: salon.id,
            name: salon.name,
            logo_url: salon.logo_url,
            google_place_url: salon.google_place_url,
            locale: salon.locale,
          }
        : null,
    })
  }

  if (req.method !== 'POST') return jsonResponse({ error: 'method_not_allowed' }, 405)

  let body: { token?: string; rating?: number; review_body?: string; author_name?: string }
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: 'invalid_json' }, 400)
  }
  if (!body.token || typeof body.rating !== 'number') {
    return jsonResponse({ error: 'bad_request' }, 400)
  }
  if (body.rating < 1 || body.rating > 5) {
    return jsonResponse({ error: 'invalid_rating' }, 400)
  }

  const { data: rr } = await admin
    .from('review_requests')
    .select('id, salon_id, visit_id, client_id, expires_at, submitted_at')
    .eq('token', body.token)
    .maybeSingle()
  if (!rr) return jsonResponse({ error: 'not_found' }, 404)
  if (new Date(rr.expires_at as string).getTime() < Date.now()) {
    return jsonResponse({ error: 'expired' }, 410)
  }
  if (rr.submitted_at) {
    return jsonResponse({ error: 'already_submitted' }, 409)
  }

  // staff_id и client_id из visit для контекста отзыва
  let staffId: string | null = null
  let clientId: string | null = (rr.client_id as string) ?? null
  if (rr.visit_id) {
    const { data: v } = await admin
      .from('visits')
      .select('staff_id, client_id')
      .eq('id', rr.visit_id)
      .maybeSingle()
    staffId = (v?.staff_id as string) ?? null
    clientId = clientId ?? (v?.client_id as string) ?? null
  }

  // Если 5 ⭐ → НЕ сохраняем в reviews (клиент пойдёт в Google). Но помечаем
  // submitted_at и возвращаем URL прямого write-review.
  if (body.rating === 5) {
    await admin
      .from('review_requests')
      .update({ submitted_at: new Date().toISOString() })
      .eq('id', rr.id)
    const { data: salon } = await admin
      .from('salons')
      .select('google_place_url, google_place_id')
      .eq('id', rr.salon_id)
      .maybeSingle()
    // Предпочитаем write-review URL который сразу открывает форму отзыва.
    // Fallback на google_place_url (просто карта места) если place_id не задан.
    const placeId = (salon as { google_place_id?: string | null } | null)?.google_place_id
    const writeReviewUrl = placeId
      ? `https://search.google.com/local/writereview?placeid=${encodeURIComponent(placeId)}`
      : ((salon as { google_place_url?: string | null } | null)?.google_place_url ?? null)
    return jsonResponse({
      ok: true,
      action: 'redirect_google',
      google_place_url: writeReviewUrl,
    })
  }

  // Иначе (1-4 ⭐) сохраняем внутренний отзыв.
  const { error: insErr } = await admin.from('reviews').insert({
    salon_id: rr.salon_id,
    source: 'internal',
    visibility: 'private',
    rating: body.rating,
    body: body.review_body ?? null,
    author_name: body.author_name ?? null,
    client_id: clientId,
    staff_id: staffId,
    visit_id: rr.visit_id,
    posted_at: new Date().toISOString(),
  })
  if (insErr) {
    console.warn('insert review failed', insErr.message)
    return jsonResponse({ error: 'insert_failed' }, 500)
  }
  await admin
    .from('review_requests')
    .update({ submitted_at: new Date().toISOString() })
    .eq('id', rr.id)

  return jsonResponse({ ok: true, action: 'saved' })
})
