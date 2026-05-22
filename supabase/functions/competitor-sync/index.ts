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
/**
 * Резолвит Google Place ID из имени конкурента через Text Search API v1.
 * Если задан city — добавляем его в запрос для точности (несколько салонов
 * с одинаковым именем в разных городах — разрешим в пользу того что в нашем).
 * Используется fallback'ом для конкурентов добавленных ручным URL без place_id.
 */
async function resolveGooglePlaceId(name: string, city?: string | null): Promise<string | null> {
  if (!GOOGLE_KEY) return null
  const textQuery = city ? `${name}, ${city}` : name
  try {
    const r = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'X-Goog-Api-Key': GOOGLE_KEY,
        'X-Goog-FieldMask': 'places.id',
      },
      body: JSON.stringify({ textQuery, maxResultCount: 1 }),
    })
    if (!r.ok) return null
    const data = (await r.json()) as { places?: Array<{ id?: string }> }
    return data.places?.[0]?.id ?? null
  } catch {
    return null
  }
}

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
// Booksy aggregate rating через customer_api REST endpoint.
// (Тот же endpoint что в reviews-sync для отзывов — но запрашиваем 1 страницу
// с 1 отзывом, чтобы вытащить `business.reviews_count` + `business.reviews_stars`
// из обёртки. Это работает на современном Booksy CSR, в отличие от HTML scrape.)
// =============================================================================
const BOOKSY_WEB_API_KEY = 'web-e3d812bf-d7a2-445d-ab38-55589ae6a121'

function parseBooksyUrl(url: string): { region: string; businessId: string } | null {
  const m = url.match(/booksy\.com\/([a-z]{2})-([a-z]{2})\/(\d+)_/i)
  if (!m) return null
  const lang = m[1].toLowerCase()
  const region = lang === 'pl' ? 'pl' : lang === 'en' ? 'us' : lang
  return { region, businessId: m[3] }
}

// =============================================================================
// Booksy services catalog через customer_api/businesses/{id}.
// Возвращает массив бронируемых variants с ценами/длительностью/staff_ids.
// Покрывает все услуги конкурента — основа для матча с нашими услугами в UI Цены.
// =============================================================================
type BooksyVariant = {
  id?: number
  name: string
  treatment_name?: string
  price_cents: number
  omnibus_cents?: number | null
  duration_min: number
  staffer_ids: number[]
}

async function fetchBooksyCatalog(booksyUrl: string): Promise<{
  services: BooksyVariant[]
  staff: Array<{ id: number; name: string }>
} | null> {
  const parsed = parseBooksyUrl(booksyUrl)
  if (!parsed) return null
  try {
    const u = `https://${parsed.region}.booksy.com/core/v2/customer_api/businesses/${parsed.businessId}`
    const r = await fetch(u, {
      headers: {
        accept: 'application/json',
        'x-api-key': BOOKSY_WEB_API_KEY,
        'x-app-version': '3.0',
        'x-fingerprint': crypto.randomUUID(),
        referer: 'https://booksy.com/',
        'user-agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/537.36 Chrome/120.0 Safari/537.36',
      },
    })
    if (!r.ok) return null
    const data = (await r.json()) as {
      business?: {
        service_categories?: Array<{
          services?: Array<{
            name?: string
            treatment?: { name?: string }
            price?: number
            variants?: Array<{
              id?: number
              label?: string
              duration?: number
              price?: number
              omnibus_price?: number | null
              staffer_id?: number[]
            }>
          }>
        }>
        staff?: Array<{ id?: number; name?: string }>
      }
    }
    const biz = data.business
    if (!biz) return null

    const services: BooksyVariant[] = []
    for (const cat of biz.service_categories ?? []) {
      for (const svc of cat.services ?? []) {
        const treatmentName = svc.treatment?.name
        const baseName = svc.name ?? treatmentName ?? ''
        if (!baseName) continue
        if (svc.variants && svc.variants.length > 0) {
          for (const v of svc.variants) {
            if (typeof v.price !== 'number') continue
            const label = v.label ? `${baseName} — ${v.label}` : baseName
            services.push({
              id: typeof v.id === 'number' ? v.id : undefined,
              name: label,
              treatment_name: treatmentName,
              price_cents: Math.round(v.price * 100),
              omnibus_cents:
                typeof v.omnibus_price === 'number' ? Math.round(v.omnibus_price * 100) : null,
              duration_min: typeof v.duration === 'number' ? v.duration : 0,
              staffer_ids: Array.isArray(v.staffer_id) ? v.staffer_id : [],
            })
          }
        } else if (typeof svc.price === 'number') {
          services.push({
            name: baseName,
            treatment_name: treatmentName,
            price_cents: Math.round(svc.price * 100),
            duration_min: 0,
            staffer_ids: [],
          })
        }
      }
    }
    const staff = (biz.staff ?? [])
      .filter((s) => typeof s.id === 'number' && typeof s.name === 'string')
      .map((s) => ({ id: s.id as number, name: s.name as string }))
    if (services.length === 0) return null
    return { services, staff }
  } catch (e) {
    console.warn('fetchBooksyCatalog failed', e)
    return null
  }
}

// =============================================================================
// Booksy occupancy: draft-flow (create + timeslots) для топ-N variants за 7 дней.
// На каждый variant создаём draft, тянем timeslots на ближайшие 7 дней,
// считаем свободные слоты. Чем меньше слотов = тем выше загрузка.
// =============================================================================

type OccupancyService = {
  name: string
  variant_id: number | undefined
  duration_min: number
  staff_count: number
  free_slots_7d: number
  days_covered: number
}

async function fetchBooksyOccupancy(
  parsed: { region: string; businessId: string },
  variants: BooksyVariant[],
): Promise<OccupancyService[]> {
  const out: OccupancyService[] = []
  const fingerprint = crypto.randomUUID()
  const today = new Date()
  const end = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000)
  const startStr = today.toISOString().slice(0, 10)
  const endStr = end.toISOString().slice(0, 10)

  for (const v of variants) {
    if (!v.id) continue // вариант без id — нет смысла дёргать draft
    try {
      // 1. Create draft
      const draftRes = await fetch(
        `https://${parsed.region}.booksy.com/core/v2/customer_api/drafts/create`,
        {
          method: 'POST',
          headers: {
            accept: 'application/json',
            'content-type': 'application/json',
            'x-api-key': BOOKSY_WEB_API_KEY,
            'x-app-version': '3.0',
            'x-fingerprint': fingerprint,
            referer: 'https://booksy.com/',
            'user-agent':
              'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/537.36 Chrome/120.0 Safari/537.36',
          },
          body: JSON.stringify({
            staffer_id: null,
            business_id: Number(parsed.businessId),
            service_variant_id: v.id,
            meta: {},
          }),
        },
      )
      if (!draftRes.ok) {
        console.warn(`booksy draft.create variant=${v.id} HTTP ${draftRes.status}`)
        continue
      }
      const draft = (await draftRes.json()) as { appointment?: { id?: string } }
      const apptId = draft.appointment?.id
      if (!apptId) continue

      // 2. Timeslots на 7 дней
      const slotsRes = await fetch(
        `https://${parsed.region}.booksy.com/core/v2/customer_api/drafts/${apptId}/timeslots`,
        {
          method: 'POST',
          headers: {
            accept: 'application/json',
            'content-type': 'application/json',
            'x-api-key': BOOKSY_WEB_API_KEY,
            'x-app-version': '3.0',
            'x-fingerprint': fingerprint,
            referer: 'https://booksy.com/',
            'user-agent':
              'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/537.36 Chrome/120.0 Safari/537.36',
          },
          body: JSON.stringify({ start: startStr, end: endStr }),
        },
      )
      if (!slotsRes.ok) {
        console.warn(`booksy timeslots variant=${v.id} HTTP ${slotsRes.status}`)
        continue
      }
      const slotsData = (await slotsRes.json()) as {
        timeslots?: Record<string, Array<{ t: string }>>
      }
      const days = Object.entries(slotsData.timeslots ?? {})
      const freeSlots = days.reduce((s, [, arr]) => s + (arr?.length ?? 0), 0)
      const daysCovered = days.filter(([, arr]) => (arr?.length ?? 0) > 0).length

      out.push({
        name: v.name,
        variant_id: v.id,
        duration_min: v.duration_min,
        staff_count: v.staffer_ids.length,
        free_slots_7d: freeSlots,
        days_covered: daysCovered,
      })

      // Маленькая пауза чтобы не получить rate-limit.
      await new Promise((r) => setTimeout(r, 200))
    } catch (e) {
      console.warn(`booksy occupancy variant=${v.id} failed`, e)
    }
  }
  return out
}

async function fetchBooksyAggregate(
  booksyUrl: string,
): Promise<{ rating: number; count: number } | null> {
  const parsed = parseBooksyUrl(booksyUrl)
  if (!parsed) return null
  try {
    const u = `https://${parsed.region}.booksy.com/core/v2/customer_api/businesses/${parsed.businessId}/reviews/?reviews_page=1&reviews_per_page=1&ordering=-created`
    const r = await fetch(u, {
      headers: {
        accept: 'application/json',
        'x-api-key': BOOKSY_WEB_API_KEY,
        'x-app-version': '3.0',
        referer: 'https://booksy.com/',
        'user-agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/537.36 Chrome/120.0 Safari/537.36',
      },
    })
    if (!r.ok) return null
    const data = (await r.json()) as {
      reviews?: Array<{ business?: { reviews_count?: number; reviews_stars?: number } }>
    }
    const biz = data.reviews?.[0]?.business
    if (!biz) return null
    const rating = typeof biz.reviews_stars === 'number' ? biz.reviews_stars : null
    const count = typeof biz.reviews_count === 'number' ? biz.reviews_count : null
    if (rating == null || count == null) return null
    return { rating, count }
  } catch {
    return null
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

/**
 * Sync метрик для своего салона (для отображения первой строкой в
 * Reports → Конкуренты — справедливое сравнение со списком). Источники
 * те же что у конкурентов — scrape Instagram/Facebook + Google rating
 * (если задан place_id). Запись в отдельную таблицу own_salon_metrics
 * (миграция 20260522000003) с upsert на (salon, kind, source, date).
 */
type OwnSalonRow = {
  id: string
  google_place_id: string | null
  booksy_url: string | null
  instagram_url: string | null
  facebook_url: string | null
}

async function syncOwnSalon(admin: SupabaseClient, s: OwnSalonRow): Promise<number> {
  type OwnInsert = {
    salon_id: string
    kind: 'rating' | 'content' | 'occupancy'
    data: Record<string, unknown>
    source: 'scrape_instagram' | 'scrape_facebook' | 'google'
    snapshot_date: string
  }
  const inserts: OwnInsert[] = []

  if (s.google_place_id) {
    const rating = await fetchGoogleRating(s.google_place_id)
    if (rating) {
      inserts.push({
        salon_id: s.id,
        kind: 'rating',
        data: rating,
        source: 'google',
        snapshot_date: TODAY,
      })
    }
  }

  // Booksy aggregate rating для своего салона — для отображения в Reports/
  // Конкуренты/Рейтинг в одной строке с конкурентами.
  if (s.booksy_url) {
    const bRating = await fetchBooksyAggregate(s.booksy_url)
    if (bRating) {
      inserts.push({
        salon_id: s.id,
        kind: 'rating',
        data: bRating,
        source: 'booksy',
        snapshot_date: TODAY,
      })
    }
  }

  // Content (Insta + FB scrape). Один row на источник — для прозрачности.
  if (s.instagram_url) {
    const c = await fetchContent(s.instagram_url, null)
    if (c) {
      inserts.push({
        salon_id: s.id,
        kind: 'content',
        data: c,
        source: 'scrape_instagram',
        snapshot_date: TODAY,
      })
    }
  }
  if (s.facebook_url) {
    const c = await fetchContent(null, s.facebook_url)
    if (c) {
      inserts.push({
        salon_id: s.id,
        kind: 'content',
        data: c,
        source: 'scrape_facebook',
        snapshot_date: TODAY,
      })
    }
  }

  if (inserts.length === 0) return 0
  // Идемпотентный upsert на уникальный ключ (salon, kind, source, date).
  // Если today уже есть запись — overwrite (новый run перезапишет старые числа).
  const { error } = await admin
    .from('own_salon_metrics')
    .upsert(inserts, { onConflict: 'salon_id,kind,source,snapshot_date' })
  if (error) {
    console.warn('own_salon_metrics upsert failed', s.id, error.message)
    return 0
  }
  return inserts.length
}

// =============================================================================
// Per-competitor sync.
// =============================================================================
async function syncOneCompetitor(
  admin: SupabaseClient,
  c: CompetitorRow,
  ownSalonCity: string | null,
): Promise<number> {
  const snapshots: Snapshot[] = []

  // Если place_id не задан — попробуем резолвить через Places Text Search.
  // С передачей city нашего салона: несколько BURO SPA в Польше → выбираем
  // того что в нашем городе (предположение «конкурент в том же городе»).
  let placeId = c.google_place_id
  if (!placeId && c.name) {
    placeId = await resolveGooglePlaceId(c.name, ownSalonCity)
    if (placeId) {
      await admin.from('competitors').update({ google_place_id: placeId }).eq('id', c.id)
    }
  }
  if (placeId) {
    const rating = await fetchGoogleRating(placeId)
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

  // Booksy aggregate rating (через customer_api — не зависит от __NEXT_DATA__).
  if (c.booksy_url) {
    const bRating = await fetchBooksyAggregate(c.booksy_url)
    if (bRating) {
      snapshots.push({
        competitor_id: c.id,
        kind: 'rating',
        data: bRating,
        source: 'booksy',
        snapshot_date: TODAY,
      })
    }
  }

  if (c.booksy_url) {
    // Новый путь — customer_api/businesses/{id} (REST). Покрывает все услуги с
    // ценами + variants + staff_ids. Если упало (старый формат URL и т.п.) —
    // fallback на старый HTML scrape через __NEXT_DATA__.
    const catalog = await fetchBooksyCatalog(c.booksy_url)
    if (catalog) {
      snapshots.push({
        competitor_id: c.id,
        kind: 'price',
        data: { services: catalog.services, staff: catalog.staff },
        source: 'booksy',
        snapshot_date: TODAY,
      })

      // Загруженность: для top-5 variants создаём draft + тянем timeslots на 7 дней.
      // Это даёт нам сравнимый метрик «свободные слоты у конкурента». Ограничение
      // 5 — чтобы не дёргать Booksy 100 раз и не словить rate-limit.
      const parsed = parseBooksyUrl(c.booksy_url)
      if (parsed) {
        const topVariants = catalog.services.filter((v) => v.id).slice(0, 5)
        if (topVariants.length > 0) {
          const occ = await fetchBooksyOccupancy(parsed, topVariants)
          if (occ.length > 0) {
            snapshots.push({
              competitor_id: c.id,
              kind: 'occupancy',
              data: { services: occ, total_staff: catalog.staff.length },
              source: 'booksy',
              snapshot_date: TODAY,
            })
          }
        }
      }
    } else {
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

  // Подгружаем city для каждого салона у которого есть конкуренты — нужен
  // для точного резолва Google Place ID (Text Search по «name, city»).
  const salonIds = Array.from(new Set((competitors ?? []).map((c) => c.salon_id)))
  const salonCityMap = new Map<string, string | null>()
  if (salonIds.length > 0) {
    const { data: salons } = await admin.from('salons').select('id, city').in('id', salonIds)
    for (const s of (salons ?? []) as Array<{ id: string; city: string | null }>) {
      salonCityMap.set(s.id, s.city)
    }
  }

  let snapshots = 0
  for (const c of (competitors ?? []) as CompetitorRow[]) {
    const city = salonCityMap.get(c.salon_id) ?? null
    snapshots += await syncOneCompetitor(admin, c, city)
  }

  // Также метрики СВОЕГО салона — для отображения первой строкой
  // в Reports → Конкуренты (справедливое сравнение).
  let ownSnapshots = 0
  let ownQ = admin
    .from('salons')
    .select('id, google_place_id, booksy_url, instagram_url, facebook_url')
    .or(
      'google_place_id.not.is.null,booksy_url.not.is.null,instagram_url.not.is.null,facebook_url.not.is.null',
    )
  if (body.salon_id) ownQ = ownQ.eq('id', body.salon_id)
  const { data: ownSalons } = await ownQ
  for (const s of (ownSalons ?? []) as OwnSalonRow[]) {
    ownSnapshots += await syncOwnSalon(admin, s)
  }

  return jsonResponse({
    ok: true,
    competitors: competitors?.length ?? 0,
    snapshots,
    own_salons: ownSalons?.length ?? 0,
    own_snapshots: ownSnapshots,
  })
})
