/**
 * competitor-sync — периодический сбор данных о конкурентах.
 *
 * Cron раз в день (08:00 UTC). Для каждого конкурента + каждого активного
 * источника собираем один snapshot:
 *   - rating  ← Google Places (если задан google_place_id)
 *   - price   ← Booksy publication scrape (best-effort)
 *   - occupancy ← Booksy availability slots (best-effort, доля занятых)
 *   - content ← Instagram/Facebook public pages (best-effort, посты/подписчики)
 *
 * Все сборщики обёрнуты в try/catch: если источник сломался или вернул
 * пусто — просто пропускаем без падения функции. Идея: даже частичные
 * snapshots полезны.
 *
 * Body: { salon_id?: string, token?: string }
 *   - salon_id — синхронить только этого салона (UI-вызов)
 *   - token    — REST cron secret (sched-вызов)
 *   - оба пусто → синхронить ВСЕХ (опасно, рекомендуется только cron)
 */

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'

import { corsHeaders, preflight } from '../_shared/cors.ts'
import {
  estimatePostsPerMonth,
  parseFbLikes,
  parseInstaOgDescription,
} from '../_shared/social-metrics.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const GOOGLE_KEY = Deno.env.get('GOOGLE_PLACES_API_KEY') ?? ''

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'content-type': 'application/json' },
  })
}

type CompetitorRow = {
  id: string
  salon_id: string
  name: string
  booksy_url: string | null
  google_place_id: string | null
  instagram_url: string | null
  facebook_url: string | null
}

type Snapshot = {
  competitor_id: string
  kind: 'price' | 'occupancy' | 'rating' | 'content'
  data: Record<string, unknown>
  source: 'booksy' | 'google' | 'instagram' | 'facebook' | 'manual'
  snapshot_date: string
}

const TODAY = new Date().toISOString().slice(0, 10)

// =============================================================================
// Google Places — rating + count.
// =============================================================================
async function fetchGoogleRating(placeId: string): Promise<Snapshot['data'] | null> {
  if (!GOOGLE_KEY) return null
  const url = `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`
  try {
    const r = await fetch(url, {
      headers: { 'X-Goog-Api-Key': GOOGLE_KEY, 'X-Goog-FieldMask': 'rating,userRatingCount' },
    })
    if (!r.ok) return null
    const data = (await r.json()) as { rating?: number; userRatingCount?: number }
    if (data.rating == null) return null
    return { rating: data.rating, count: data.userRatingCount ?? 0 }
  } catch {
    return null
  }
}

// =============================================================================
// Booksy — price (best-effort scrape).
// =============================================================================
async function fetchBooksyData(
  booksyUrl: string,
): Promise<{ prices: Snapshot['data'] | null; occupancy: Snapshot['data'] | null }> {
  try {
    const r = await fetch(booksyUrl, {
      headers: {
        'user-agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
        accept: 'text/html',
      },
    })
    if (!r.ok) return { prices: null, occupancy: null }
    const html = await r.text()
    const m = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]+?)<\/script>/)
    if (!m || !m[1]) return { prices: null, occupancy: null }
    const next = JSON.parse(m[1]) as Record<string, unknown>

    // Поиск услуг с ценой: rec'ы у которых есть {name, price/priceFrom/cost}.
    const prices: Record<string, number> = {}
    let availabilityTaken = 0
    let availabilityTotal = 0
    const visit = (v: unknown, depth = 0) => {
      if (depth > 14 || !v) return
      if (Array.isArray(v)) {
        for (const x of v) visit(x, depth + 1)
        return
      }
      if (typeof v === 'object') {
        const o = v as Record<string, unknown>
        const nameRaw = (o.name ?? o.title) as string | undefined
        const priceRaw = (o.price ?? o.priceFrom ?? o.priceMin ?? o.cost) as unknown
        if (
          nameRaw &&
          (typeof priceRaw === 'number' ||
            (typeof priceRaw === 'string' && !Number.isNaN(parseFloat(priceRaw))))
        ) {
          const cents =
            typeof priceRaw === 'number'
              ? Math.round(priceRaw * 100)
              : Math.round(parseFloat(priceRaw as string) * 100)
          if (cents > 0 && cents < 10_000_000 && !prices[nameRaw]) {
            prices[nameRaw] = cents
          }
        }
        // Слоты availability: ищем массивы с {start, available/busy}.
        if ('available' in o && typeof o.available === 'boolean') {
          availabilityTotal += 1
          if (o.available === false) availabilityTaken += 1
        }
        for (const k of Object.keys(o)) visit(o[k], depth + 1)
      }
    }
    visit(next)

    return {
      prices: Object.keys(prices).length > 0 ? { prices } : null,
      occupancy:
        availabilityTotal > 5
          ? {
              occupancy_pct: Math.round((availabilityTaken * 100) / availabilityTotal),
              taken: availabilityTaken,
              total: availabilityTotal,
            }
          : null,
    }
  } catch {
    return { prices: null, occupancy: null }
  }
}

// =============================================================================
// Instagram / Facebook public — best-effort через og: meta тегов.
// Полный Meta Graph требует app review; здесь scraping публичной страницы.
// =============================================================================
async function fetchContent(
  instaUrl: string | null,
  fbUrl: string | null,
): Promise<Snapshot['data'] | null> {
  const out: Record<string, number | string> = {}
  if (instaUrl) {
    try {
      const r = await fetch(instaUrl, {
        headers: { 'user-agent': 'Mozilla/5.0 (compatible; FinkleyBot/1.0)' },
      })
      if (r.ok) {
        const html = await r.text()
        const counts = parseInstaOgDescription(html)
        if (counts.followers != null) out.followers = counts.followers
        if (counts.posts != null) out.posts = counts.posts
        if (counts.following != null) out.following = counts.following
        // Частота постов — best-effort на основе ISO/timestamp дат в HTML.
        const ppm = estimatePostsPerMonth(html, counts.posts)
        if (ppm != null) out.posts_per_month = ppm
        out.instagram_url = instaUrl
      }
    } catch {
      /* ignore */
    }
  }
  if (fbUrl) {
    try {
      const r = await fetch(fbUrl, {
        headers: { 'user-agent': 'Mozilla/5.0 (compatible; FinkleyBot/1.0)' },
      })
      if (r.ok) {
        const html = await r.text()
        const likes = parseFbLikes(html)
        if (likes != null) out.fb_likes = likes
        // На FB-странице публичные посты обычно имеют datetime атрибуты —
        // тоже попробуем оценить частоту, если ещё не получили от Insta.
        if (out.posts_per_month == null) {
          const ppm = estimatePostsPerMonth(html)
          if (ppm != null) out.posts_per_month = ppm
        }
        out.facebook_url = fbUrl
      }
    } catch {
      /* ignore */
    }
  }
  return Object.keys(out).length > 0 ? out : null
}

// =============================================================================
// Per-competitor sync.
// =============================================================================
async function syncOneCompetitor(admin: SupabaseClient, c: CompetitorRow): Promise<number> {
  const snapshots: Snapshot[] = []

  if (c.google_place_id) {
    const rating = await fetchGoogleRating(c.google_place_id)
    if (rating) {
      snapshots.push({
        competitor_id: c.id,
        kind: 'rating',
        data: rating,
        source: 'google',
        snapshot_date: TODAY,
      })
    }
  }

  if (c.booksy_url) {
    const b = await fetchBooksyData(c.booksy_url)
    if (b.prices) {
      snapshots.push({
        competitor_id: c.id,
        kind: 'price',
        data: b.prices,
        source: 'booksy',
        snapshot_date: TODAY,
      })
    }
    if (b.occupancy) {
      snapshots.push({
        competitor_id: c.id,
        kind: 'occupancy',
        data: b.occupancy,
        source: 'booksy',
        snapshot_date: TODAY,
      })
    }
  }

  if (c.instagram_url || c.facebook_url) {
    const content = await fetchContent(c.instagram_url, c.facebook_url)
    if (content) {
      snapshots.push({
        competitor_id: c.id,
        kind: 'content',
        data: content,
        source: c.instagram_url ? 'instagram' : 'facebook',
        snapshot_date: TODAY,
      })
    }
  }

  if (snapshots.length === 0) return 0
  const { error } = await admin.from('competitor_snapshots').insert(snapshots)
  if (error) {
    console.warn('insert snapshots failed', c.id, error.message)
    return 0
  }
  return snapshots.length
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return preflight()
  if (req.method !== 'POST') return jsonResponse({ error: 'method_not_allowed' }, 405)
  if (!SUPABASE_URL || !SERVICE_KEY) {
    return jsonResponse({ error: 'function_not_configured' }, 500)
  }

  let body: { salon_id?: string; token?: string } = {}
  try {
    body = await req.json()
  } catch {
    /* cron без body */
  }

  const expectedSecret = Deno.env.get('COMPETITOR_SYNC_CRON_SECRET') ?? ''
  const isCron = !body.salon_id && !!body.token
  if (isCron && expectedSecret && body.token !== expectedSecret) {
    return jsonResponse({ error: 'unauthorized' }, 401)
  }

  if (!isCron && body.salon_id) {
    // UI-вызов — проверим RLS на свой салон.
    const authHeader = req.headers.get('authorization') ?? ''
    const userClient = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_ANON_KEY') ?? '', {
      global: { headers: { authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data: check } = await userClient
      .from('salons')
      .select('id')
      .eq('id', body.salon_id)
      .maybeSingle()
    if (!check) return jsonResponse({ error: 'forbidden' }, 403)
  }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  let q = admin
    .from('competitors')
    .select('id, salon_id, name, booksy_url, google_place_id, instagram_url, facebook_url')
    .eq('is_archived', false)
  if (body.salon_id) q = q.eq('salon_id', body.salon_id)
  const { data: competitors } = await q

  let snapshots = 0
  for (const c of (competitors ?? []) as CompetitorRow[]) {
    snapshots += await syncOneCompetitor(admin, c)
  }
  return jsonResponse({
    ok: true,
    competitors: competitors?.length ?? 0,
    snapshots,
  })
})
