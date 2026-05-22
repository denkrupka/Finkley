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
    // ВАЖНО: originalText (язык клиента) приоритет над text (Google
    // авто-перевод на язык запроса). Юзер хочет видеть оригинал —
    // что реально написал клиент.
    body: g.originalText?.text ?? g.text?.text ?? null,
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
 * Booksy reviews через customer_api REST endpoint.
 *
 * Booksy SPA дёргает этот же endpoint при загрузке отзывов на странице
 * салона. Web-API key публичный (вшит в их frontend), не требует OAuth.
 * Найден через HAR-анализ страницы pl.booksy.com.
 *
 * Endpoint:
 *   GET https://{region}.booksy.com/core/v2/customer_api/businesses/{id}/reviews/
 *     ?reviews_page=N&reviews_per_page=50&ordering=-created
 *
 * Region выбирается по locale prefix в URL салона:
 *   /pl-pl/... → pl.booksy.com
 *   /en-gb/... → us.booksy.com (Booksy us — основной EN регион)
 *   etc.
 *
 * Business_id — первое число в slug-сегменте URL:
 *   .../135992_wonderful-beauty_... → 135992
 *
 * Возвращает массив отзывов в нашем формате. Тянет до 100 (2 страницы)
 * за один вызов, чтобы не перегружать SMSAPI rate-limit Booksy.
 */
const BOOKSY_WEB_API_KEY = 'web-e3d812bf-d7a2-445d-ab38-55589ae6a121'

type BooksyReviewItem = {
  id: number
  rank: number
  review: string | null
  title: string | null
  user?: { first_name?: string; last_name?: string }
  created: string
  reply_content?: string | null
  reply_created?: string | null
  reply_author?: string | null
}

function parseBooksyUrl(url: string): { region: string; businessId: string } | null {
  // https://booksy.com/pl-pl/135992_wonderful-beauty_... или
  // https://pl.booksy.com/pl-pl/135992_... (новый формат)
  const m = url.match(/booksy\.com\/([a-z]{2})-([a-z]{2})\/(\d+)_/i)
  if (!m) return null
  const lang = m[1].toLowerCase()
  const businessId = m[3]
  // pl-pl → pl, en-gb → us (для EN Booksy использует us-регион)
  const region = lang === 'pl' ? 'pl' : lang === 'en' ? 'us' : lang
  return { region, businessId }
}

async function syncBooksyReviews(booksyUrl: string): Promise<
  Array<{
    external_id: string
    rating: number | null
    body: string | null
    author_name: string | null
    posted_at: string
    external_url: string | null
    reply_text: string | null
    reply_author: string | null
    reply_posted_at: string | null
  }>
> {
  const parsed = parseBooksyUrl(booksyUrl)
  if (!parsed) return []
  const { region, businessId } = parsed

  const out: Array<{
    external_id: string
    rating: number | null
    body: string | null
    author_name: string | null
    posted_at: string
    external_url: string | null
    reply_text: string | null
    reply_author: string | null
    reply_posted_at: string | null
  }> = []

  // Тянем все страницы пока есть. Safety cap 30 × 50 = 1500 отзывов.
  // Manual dedup в processSalon отсекает дубликаты при повторных запусках.
  const MAX_PAGES = 30
  const PER_PAGE = 50
  for (let page = 1; page <= MAX_PAGES; page++) {
    try {
      const u = `https://${region}.booksy.com/core/v2/customer_api/businesses/${businessId}/reviews/?reviews_page=${page}&reviews_per_page=${PER_PAGE}&ordering=-created`
      const r = await fetch(u, {
        headers: {
          accept: 'application/json',
          'accept-language': 'pl-PL, pl',
          'user-agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
          referer: 'https://booksy.com/',
          'x-api-key': BOOKSY_WEB_API_KEY,
          'x-app-version': '3.0',
        },
      })
      if (!r.ok) {
        console.warn(`booksy reviews page=${page} HTTP ${r.status}`)
        break
      }
      const data = (await r.json()) as { reviews?: BooksyReviewItem[] }
      const list = data.reviews ?? []
      if (list.length === 0) break
      for (const rv of list) {
        const author = [rv.user?.first_name, rv.user?.last_name].filter(Boolean).join(' ').trim()
        out.push({
          external_id: `booksy_${rv.id}`,
          rating: typeof rv.rank === 'number' ? Math.round(rv.rank) : null,
          // Booksy: review.title — заголовок (часто пуст), review.review — тело.
          // Ответ салона хранится отдельно (см. reply_*).
          body: (rv.title ? `${rv.title}\n\n` : '') + (rv.review ?? ''),
          author_name: author || null,
          posted_at: rv.created
            ? new Date(
                rv.created.includes('T') ? rv.created : `${rv.created}T00:00:00`,
              ).toISOString()
            : new Date().toISOString(),
          external_url: booksyUrl,
          reply_text: rv.reply_content || null,
          reply_author: rv.reply_author || null,
          reply_posted_at: rv.reply_created
            ? new Date(
                rv.reply_created.includes('T') ? rv.reply_created : `${rv.reply_created}T00:00:00`,
              ).toISOString()
            : null,
        })
      }
      if (list.length < PER_PAGE) break
    } catch (e) {
      console.warn(`booksy reviews page=${page} failed:`, e)
      break
    }
  }
  return out
}

type ProcessResult = {
  imported: number
  google_reviews_fetched: number
  booksy_reviews_fetched: number
  /** Booksy reviews через customer_api REST endpoint (web-key, no OAuth). */
  booksy_supported: boolean
  upsert_error?: string
  google_error?: string
}

async function processSalon(admin: SupabaseClient, salon: SalonRow): Promise<ProcessResult> {
  let imported = 0
  let googleFetched = 0
  let booksyFetched = 0
  let googleError: string | undefined
  let upsertError: string | undefined
  const inserts: ReviewInsert[] = []

  // Google
  if (salon.google_place_id) {
    try {
      const g = await syncGooglePlace(salon.google_place_id)
      googleFetched = g.reviews.length
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
    } catch (e) {
      googleError = e instanceof Error ? e.message : String(e)
      console.warn(`google sync failed for salon ${salon.id}:`, googleError)
    }
  }

  // Booksy
  if (salon.booksy_url) {
    try {
      const b = await syncBooksyReviews(salon.booksy_url)
      booksyFetched = b.length
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
          reply_text: r.reply_text,
          reply_author: r.reply_author,
          reply_posted_at: r.reply_posted_at,
        })
      }
    } catch (e) {
      console.warn(`booksy sync failed for salon ${salon.id}:`, e)
    }
  }

  // Manual dedup вместо upsert: уникальный индекс `ux_reviews_external` —
  // partial (WHERE external_id is not null), и PostgreSQL не принимает его
  // как valid ON CONFLICT target. Поэтому: загружаем existing external_ids,
  // фильтруем новые, инсертим только их.
  if (inserts.length > 0) {
    const sources = Array.from(new Set(inserts.map((i) => i.source)))
    const { data: existing } = await admin
      .from('reviews')
      .select('source, external_id')
      .eq('salon_id', salon.id)
      .in('source', sources)
      .not('external_id', 'is', null)
    const taken = new Set<string>(
      ((existing ?? []) as Array<{ source: string; external_id: string | null }>).map(
        (r) => `${r.source}::${r.external_id}`,
      ),
    )
    const fresh = inserts.filter((r) => !taken.has(`${r.source}::${r.external_id}`))
    if (fresh.length > 0) {
      const { error, data } = await admin.from('reviews').insert(fresh).select('id')
      if (!error) {
        imported = (data as unknown[] | null)?.length ?? fresh.length
      } else {
        upsertError = error.message
        console.warn(`reviews insert failed for salon ${salon.id}:`, error.message)
      }
    }
    // Backfill reply_*: для уже импортированных reviews которые имели только body
    // без отдельных reply-полей, апдейтим если в свежем payload есть reply_text.
    const duplicatesWithReply = inserts.filter(
      (r) =>
        taken.has(`${r.source}::${r.external_id}`) &&
        (r as { reply_text?: string | null }).reply_text,
    )
    for (const r of duplicatesWithReply) {
      await admin
        .from('reviews')
        .update({
          reply_text: (r as { reply_text?: string | null }).reply_text,
          reply_author: (r as { reply_author?: string | null }).reply_author,
          reply_posted_at: (r as { reply_posted_at?: string | null }).reply_posted_at,
        })
        .eq('salon_id', salon.id)
        .eq('source', r.source)
        .eq('external_id', r.external_id)
        .is('reply_text', null)
    }
  }

  return {
    imported,
    google_reviews_fetched: googleFetched,
    booksy_reviews_fetched: booksyFetched,
    booksy_supported: true,
    ...(upsertError ? { upsert_error: upsertError } : {}),
    ...(googleError ? { google_error: googleError } : {}),
  }
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
  const debug: Array<{ salon_id: string; salon_name: string | null } & ProcessResult> = []
  if (isCron) {
    const { data: salons } = await admin
      .from('salons')
      .select('id, name, google_place_id, google_place_url, booksy_url')
      .or('google_place_id.not.is.null,booksy_url.not.is.null')
    for (const s of (salons ?? []) as SalonRow[]) {
      const res = await processSalon(admin, s)
      totalImported += res.imported
      debug.push({ salon_id: s.id, salon_name: s.name, ...res })
    }
  } else {
    const { data: salon } = await admin
      .from('salons')
      .select('id, name, google_place_id, google_place_url, booksy_url')
      .eq('id', body.salon_id!)
      .maybeSingle()
    if (!salon) return jsonResponse({ error: 'salon_not_found' }, 404)
    const res = await processSalon(admin, salon as SalonRow)
    totalImported = res.imported
    debug.push({ salon_id: (salon as SalonRow).id, salon_name: (salon as SalonRow).name, ...res })
  }

  return jsonResponse({ ok: true, imported: totalImported, debug })
})
