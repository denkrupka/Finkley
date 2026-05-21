/**
 * reviews-sync — импорт отзывов с Google Places + Booksy.
 *
 * Вызывается:
 *   - вручную из UI (Reports/Отзывы → «Импорт»)
 *   - cron раз в день (см. миграцию ниже / отдельный schedule)
 *
 * Источники:
 *   1. Google Places API (place_id = salons.google_place_id).
 *      GET /v1/places/{place_id}?fields=rating,userRatingCount,reviews
 *      Требуется env GOOGLE_PLACES_API_KEY. Если ключа нет — Google skip.
 *   2. Booksy — best-effort fetch публичной страницы salons.booksy_url,
 *      парсинг встроенного JSON `__NEXT_DATA__` (структура их сайта).
 *      Если структура изменилась — silent skip, без падения.
 *
 * Upsert в reviews по (salon_id, source, external_id). Idempotent.
 *
 * Body: { salon_id: string } — обязательное.
 *       { token?: string }   — внутренний secret для cron-вызова.
 */

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'

import { corsHeaders, preflight } from '../_shared/cors.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const GOOGLE_KEY = Deno.env.get('GOOGLE_PLACES_API_KEY') ?? ''

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'content-type': 'application/json' },
  })
}

type SalonRow = {
  id: string
  name: string | null
  google_place_id: string | null
  google_place_url: string | null
  booksy_url: string | null
}

type ReviewInsert = {
  salon_id: string
  source: 'google' | 'booksy'
  visibility: 'public'
  rating: number | null
  body: string | null
  author_name: string | null
  external_id: string
  external_url: string | null
  posted_at: string
}

/**
 * Google Places API v1 — fetch reviews + rating.
 * Возвращает массив normalized отзывов (до 5 — лимит Google).
 */
async function syncGooglePlace(placeId: string): Promise<{
  rating: number | null
  count: number
  reviews: Array<{
    external_id: string
    rating: number | null
    body: string | null
    author_name: string | null
    posted_at: string
    external_url: string | null
  }>
}> {
  if (!GOOGLE_KEY) return { rating: null, count: 0, reviews: [] }
  const url = `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`
  const r = await fetch(url, {
    headers: {
      'X-Goog-Api-Key': GOOGLE_KEY,
      'X-Goog-FieldMask': 'id,rating,userRatingCount,reviews',
    },
  })
  if (!r.ok) {
    return { rating: null, count: 0, reviews: [] }
  }
  const data = (await r.json()) as {
    rating?: number
    userRatingCount?: number
    reviews?: Array<{
      name?: string
      relativePublishTimeDescription?: string
      rating?: number
      text?: { text?: string }
      originalText?: { text?: string }
      authorAttribution?: { displayName?: string; uri?: string }
      publishTime?: string
    }>
  }
  const reviews = (data.reviews ?? []).map((g, i) => ({
    // name: places/PLACE/reviews/REVIEW — берём последний segment как external_id
    external_id: g.name?.split('/').pop() ?? `g_${placeId}_${i}`,
    rating: g.rating ?? null,
    body: g.text?.text ?? g.originalText?.text ?? null,
    author_name: g.authorAttribution?.displayName ?? null,
    posted_at: g.publishTime ?? new Date().toISOString(),
    external_url: g.authorAttribution?.uri ?? null,
  }))
  return {
    rating: data.rating ?? null,
    count: data.userRatingCount ?? 0,
    reviews,
  }
}

/**
 * Booksy — best-effort. Скрейпим публичную страницу салона и пытаемся
 * вытянуть отзывы из встроенного `__NEXT_DATA__`. Структура их сайта
 * меняется, поэтому всё в try/catch — silent skip на любой ошибке.
 */
async function syncBooksyReviews(booksyUrl: string): Promise<
  Array<{
    external_id: string
    rating: number | null
    body: string | null
    author_name: string | null
    posted_at: string
    external_url: string | null
  }>
> {
  try {
    const r = await fetch(booksyUrl, {
      headers: {
        'user-agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
        accept: 'text/html',
      },
    })
    if (!r.ok) return []
    const html = await r.text()
    // __NEXT_DATA__ Booksy инжектит как <script id="__NEXT_DATA__" type="application/json">...</script>
    const m = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]+?)<\/script>/)
    if (!m || !m[1]) return []
    const next = JSON.parse(m[1]) as Record<string, unknown>
    // Best-effort: рекурсивно ищем массив reviews с полями rating + comment/text.
    const found: Array<Record<string, unknown>> = []
    const visit = (v: unknown, depth = 0) => {
      if (depth > 12 || !v) return
      if (Array.isArray(v)) {
        for (const x of v) visit(x, depth + 1)
        return
      }
      if (typeof v === 'object') {
        const o = v as Record<string, unknown>
        if (
          ('rating' in o || 'stars' in o) &&
          ('comment' in o || 'text' in o || 'body' in o) &&
          typeof (o.rating ?? o.stars) !== 'undefined'
        ) {
          found.push(o)
        }
        for (const k of Object.keys(o)) visit(o[k], depth + 1)
      }
    }
    visit(next)
    return found.slice(0, 50).map((row, i) => {
      const rating = (row.rating ?? row.stars) as number | null
      const body = (row.comment ?? row.text ?? row.body ?? null) as string | null
      const name = (row.author_name ??
        row.client_name ??
        (row.client as Record<string, string>)?.name ??
        null) as string | null
      const ts = (row.created_at ?? row.date ?? row.created ?? null) as string | null
      return {
        external_id: String(row.id ?? row._id ?? `b_${i}_${String(body ?? '').slice(0, 20)}`),
        rating: typeof rating === 'number' ? Math.round(rating) : null,
        body: body ? String(body) : null,
        author_name: name ? String(name) : null,
        posted_at: ts ? new Date(ts).toISOString() : new Date().toISOString(),
        external_url: null,
      }
    })
  } catch {
    return []
  }
}

async function processSalon(admin: SupabaseClient, salon: SalonRow): Promise<{ imported: number }> {
  let imported = 0
  const inserts: ReviewInsert[] = []

  // Google
  if (salon.google_place_id) {
    const g = await syncGooglePlace(salon.google_place_id)
    for (const r of g.reviews) {
      inserts.push({
        salon_id: salon.id,
        source: 'google',
        visibility: 'public',
        rating: r.rating,
        body: r.body,
        author_name: r.author_name,
        external_id: r.external_id,
        external_url: r.external_url ?? salon.google_place_url,
        posted_at: r.posted_at,
      })
    }
  }

  // Booksy
  if (salon.booksy_url) {
    const b = await syncBooksyReviews(salon.booksy_url)
    for (const r of b) {
      inserts.push({
        salon_id: salon.id,
        source: 'booksy',
        visibility: 'public',
        rating: r.rating,
        body: r.body,
        author_name: r.author_name,
        external_id: r.external_id,
        external_url: salon.booksy_url,
        posted_at: r.posted_at,
      })
    }
  }

  // Upsert батчем — конфликт по уникальному (salon_id, source, external_id).
  if (inserts.length > 0) {
    const { error } = await admin
      .from('reviews')
      .upsert(inserts, { onConflict: 'salon_id,source,external_id', ignoreDuplicates: false })
    if (!error) imported = inserts.length
    else console.warn('reviews upsert failed', error.message)
  }

  return { imported }
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
    /* pg_cron шлёт без body */
  }

  const expectedSecret = Deno.env.get('REVIEWS_SYNC_CRON_SECRET') ?? ''
  const isCron = !body.salon_id && !!body.token

  // Если cron-mode — проверка secret + проход по всем салонам с place_id/booksy.
  // Если UI-вызов — обязателен salon_id, авторизация через user JWT (RLS).
  if (isCron) {
    if (expectedSecret && body.token !== expectedSecret) {
      return jsonResponse({ error: 'unauthorized' }, 401)
    }
  } else {
    if (!body.salon_id) return jsonResponse({ error: 'salon_id_required' }, 400)
    // RLS проверим через клиент с пользовательским JWT — если юзер не member,
    // запрос на salons вернёт пусто и мы 403.
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

  let totalImported = 0
  if (isCron) {
    const { data: salons } = await admin
      .from('salons')
      .select('id, name, google_place_id, google_place_url, booksy_url')
      .or('google_place_id.not.is.null,booksy_url.not.is.null')
    for (const s of (salons ?? []) as SalonRow[]) {
      const { imported } = await processSalon(admin, s)
      totalImported += imported
    }
  } else {
    const { data: salon } = await admin
      .from('salons')
      .select('id, name, google_place_id, google_place_url, booksy_url')
      .eq('id', body.salon_id!)
      .maybeSingle()
    if (!salon) return jsonResponse({ error: 'salon_not_found' }, 404)
    const { imported } = await processSalon(admin, salon as SalonRow)
    totalImported = imported
  }

  return jsonResponse({ ok: true, imported: totalImported })
})
