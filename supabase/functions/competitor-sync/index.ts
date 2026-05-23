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
  /** Полное имя варианта (base + label) — то, что показывалось на Booksy. */
  name: string
  /** Имя «головной» услуги без label варианта — для группировки в UI. */
  parent_name: string
  treatment_name?: string
  /** Финальная цена для клиента (после промо/saver-скидки если есть). */
  price_cents: number
  /** Original price до скидки — нужно для отображения зачёркнутого. */
  original_price_cents: number
  /** Размер скидки в % если есть активный promotion (или null). */
  discount_pct: number | null
  /** Omnibus — минимальная цена за последние 30 дней (regulatory). */
  omnibus_cents?: number | null
  duration_min: number
  staffer_ids: number[]
}

/** Booksy возвращает omnibus_price иногда числом (159), иногда строкой ("159,00 zł"). */
function parseBooksyMoney(v: unknown): number | null {
  if (v == null) return null
  if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v * 100) : null
  if (typeof v === 'string') {
    // "159,00 zł" → 159.00
    const m = v.replace(/\s|zł|PLN|€|\$/g, '').replace(',', '.')
    const n = Number.parseFloat(m)
    return Number.isFinite(n) ? Math.round(n * 100) : null
  }
  return null
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
              omnibus_price?: number | string | null
              staffer_id?: number[]
              // Активная promo-скидка (saver / app promotion): {rate, discount_amount, price:{price:number}}
              promotion?: {
                rate?: number
                discount_amount?: number
                price?: { price?: number; formatted_price?: string }
              } | null
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
            const originalCents = Math.round(v.price * 100)
            // Booksy promotion = saver/app-promo скидка. price.price — финальная
            // цена клиента (то что зачёркивает оригинал на странице). Если promotion
            // нет — используем оригинальную цену.
            const promoPrice = v.promotion?.price?.price
            const finalCents =
              typeof promoPrice === 'number' && promoPrice > 0
                ? Math.round(promoPrice * 100)
                : originalCents
            const label = v.label ? `${baseName} — ${v.label}` : baseName
            services.push({
              id: typeof v.id === 'number' ? v.id : undefined,
              name: label,
              parent_name: baseName,
              treatment_name: treatmentName,
              price_cents: finalCents,
              original_price_cents: originalCents,
              discount_pct:
                typeof v.promotion?.rate === 'number' && v.promotion.rate > 0
                  ? v.promotion.rate
                  : null,
              omnibus_cents: parseBooksyMoney(v.omnibus_price),
              duration_min: typeof v.duration === 'number' ? v.duration : 0,
              staffer_ids: Array.isArray(v.staffer_id) ? v.staffer_id : [],
            })
          }
        } else if (typeof svc.price === 'number') {
          const cents = Math.round(svc.price * 100)
          services.push({
            name: baseName,
            parent_name: baseName,
            treatment_name: treatmentName,
            price_cents: cents,
            original_price_cents: cents,
            discount_pct: null,
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
  /** Имя «головной» услуги без label варианта — для отображения и group-key. */
  name: string
  /** Список label'ов variants, влитых в эту строку (для tooltip «вкл. варианты»). */
  variant_labels: string[]
  duration_min: number
  /** Кол-во уникальных мастеров, способных оказывать любой из variants группы. */
  staff_count: number
  /** Свободные слоты за 7 дней — СУММА по уникальным staffer'ам (не по variants).
   *  Это исключает «двойной счёт» когда staffer делает manicure + pedicure: его
   *  timeslots — это его календарь, общий для всех его услуг. */
  free_slots_7d: number
  /** Дней с хотя бы одним свободным окном среди объединения всех staffer'ов. */
  days_covered: number
  /** TRUE если у services вообще не было publicly bookable variants (Stały
   *  klient / Nowy klient). UI покажет с пометкой «бронирование закрыто». */
  closed_to_public: boolean
}

/** Один запрос timeslots на staffer × variant. Возвращает count free + days. */
async function fetchOneTimeslots(
  parsed: { region: string; businessId: string },
  fingerprint: string,
  stafferId: number,
  variantId: number,
  startStr: string,
  endStr: string,
): Promise<{ freeSlots: number; daysWithSlots: Set<string> } | null> {
  try {
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
          staffer_id: stafferId,
          business_id: Number(parsed.businessId),
          service_variant_id: variantId,
          meta: {},
        }),
      },
    )
    if (!draftRes.ok) return null
    const draft = (await draftRes.json()) as { appointment?: { id?: string } }
    const apptId = draft.appointment?.id
    if (!apptId) return null
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
    if (!slotsRes.ok) return null
    const slotsData = (await slotsRes.json()) as {
      timeslots?: Record<string, Array<{ t: string }>>
    }
    const daysWithSlots = new Set<string>()
    let freeSlots = 0
    for (const [day, arr] of Object.entries(slotsData.timeslots ?? {})) {
      const n = arr?.length ?? 0
      if (n > 0) {
        freeSlots += n
        daysWithSlots.add(day)
      }
    }
    return { freeSlots, daysWithSlots }
  } catch (e) {
    console.warn(`fetchOneTimeslots staffer=${stafferId} variant=${variantId} failed`, e)
    return null
  }
}

/**
 * Собирает occupancy для группы variants, дедуплицируя по staffer.
 *
 * Логика: timeslots Booksy — это календарь staffer'а. Если один и тот же
 * staffer делает 4 variants (manicure base/+kolor/+french/+koloryzacja), его
 * timeslots ОДИНАКОВЫЕ для всех variants. Раньше мы дёргали timeslots для
 * каждого variant отдельно и суммировали → 4× overcount.
 *
 * Теперь:
 *   1. Группируем variants по parent_name (свернём 4 Laminacja brwi в одну группу).
 *   2. На КАЖДОГО уникального staffer_id в группе делаем 1 запрос timeslots
 *      (используя любой variant, который он делает).
 *   3. Свободные слоты = СУММА по этим staffer'ам (их календари независимы).
 *   4. Дней с окнами = UNION дат, в которых хотя бы один staffer свободен.
 *
 * Если ни один staffer не вернул слотов — `closed_to_public: true` (вариант
 * существует, но публичное бронирование закрыто: Stały klient и т.п.).
 */
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

  // 1. Группируем variants по parent_name.
  const byParent = new Map<string, BooksyVariant[]>()
  for (const v of variants) {
    if (!v.id) continue
    const key = v.parent_name || v.name
    const list = byParent.get(key) ?? []
    list.push(v)
    byParent.set(key, list)
  }

  // 2. Кэш timeslots по staffer_id — каждый staffer = 1 запрос, ре-используется
  //    для всех групп где он участвует.
  const stafferCache = new Map<number, { freeSlots: number; days: Set<string> }>()
  async function getOrFetchStafferSlots(
    stafferId: number,
    sampleVariantId: number,
  ): Promise<{ freeSlots: number; days: Set<string> } | null> {
    const cached = stafferCache.get(stafferId)
    if (cached) return cached
    const res = await fetchOneTimeslots(
      parsed,
      fingerprint,
      stafferId,
      sampleVariantId,
      startStr,
      endStr,
    )
    if (!res) {
      stafferCache.set(stafferId, { freeSlots: 0, days: new Set() })
      return null
    }
    const entry = { freeSlots: res.freeSlots, days: res.daysWithSlots }
    stafferCache.set(stafferId, entry)
    // Пауза между разными staffer'ами — Booksy rate-limit friendly.
    await new Promise((r) => setTimeout(r, 200))
    return entry
  }

  // 3. Для каждой parent-группы — собираем уникальные staffer'ы и тянем их слоты.
  for (const [parentName, group] of byParent.entries()) {
    const uniqueStaffers = new Set<number>()
    for (const v of group) {
      for (const sid of v.staffer_ids) uniqueStaffers.add(sid)
    }
    if (uniqueStaffers.size === 0) {
      // Нет публичных мастеров — variant exists, but booking restricted.
      out.push({
        name: parentName,
        variant_labels: group.map((v) => v.name.replace(parentName, '').replace(/^\s*[—-]\s*/, '')),
        duration_min: group[0]?.duration_min ?? 0,
        staff_count: 0,
        free_slots_7d: 0,
        days_covered: 0,
        closed_to_public: true,
      })
      continue
    }

    let totalSlots = 0
    const allDays = new Set<string>()
    for (const sid of uniqueStaffers) {
      // Берём первый variant, который этот staffer может делать.
      const sampleVariant = group.find((v) => v.staffer_ids.includes(sid))
      if (!sampleVariant?.id) continue
      const slots = await getOrFetchStafferSlots(sid, sampleVariant.id)
      if (!slots) continue
      totalSlots += slots.freeSlots
      for (const d of slots.days) allDays.add(d)
    }

    out.push({
      name: parentName,
      variant_labels: group.map((v) => v.name.replace(parentName, '').replace(/^\s*[—-]\s*/, '')),
      duration_min: group[0]?.duration_min ?? 0,
      staff_count: uniqueStaffers.size,
      free_slots_7d: totalSlots,
      days_covered: allDays.size,
      closed_to_public: totalSlots === 0,
    })
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
// Instagram / Facebook content — собирает followers/posts/avg_likes/avg_comments
// через Socialblade (proxied через ScraperAPI residential pool). Meta плотно
// блокирует datacenter IPs — без residential proxy avg_likes/comments недоступны.
// Fallback: direct og:description (только followers/posts).
// =============================================================================

const SCRAPERAPI_KEY = Deno.env.get('SCRAPERAPI_KEY') ?? ''

/** Extract username из instagram_url. https://www.instagram.com/buro_spa/ → 'buro_spa'. */
function instagramUsername(url: string): string | null {
  const m = url.match(/instagram\.com\/([^\/?#]+)/i)
  if (!m || !m[1]) return null
  const u = m[1].replace(/^@/, '').trim()
  return u && u !== 'p' && u !== 'explore' && u !== 'reel' ? u : null
}

/** Парсер Socialblade /instagram/user/{username} HTML.
 *  Структура: `<p class="...">LABEL</p><p class="...">VALUE</p>` где
 *  LABEL ∈ {followers, following, media count, engagement rate,
 *           average likes, average comments}. */
function parseSocialbladeInsta(html: string): {
  followers?: number
  following?: number
  posts?: number
  engagement_rate?: number
  avg_likes?: number
  avg_comments?: number
} {
  const out: Record<string, number> = {}
  const labels: Array<[string, string]> = [
    ['followers', 'followers'],
    ['following', 'following'],
    ['media count', 'posts'],
    ['engagement rate', 'engagement_rate'],
    ['average likes', 'avg_likes'],
    ['average comments', 'avg_comments'],
  ]
  for (const [label, key] of labels) {
    const re = new RegExp(label + '<\\/p>\\s*<p[^>]*>([^<]+)<', 'i')
    const m = html.match(re)
    if (m && m[1]) {
      const raw = m[1].trim().replace(/,/g, '').replace(/[%\s]/g, '')
      const n = parseFloat(raw)
      if (Number.isFinite(n)) out[key] = n
    }
  }
  return out
}

/** Возвращает stats Instagram через Socialblade. Тратит 1 ScraperAPI credit.
 *  Если ScraperAPI ключ не задан или username некорректен — null. */
async function fetchInstaViaSocialblade(instaUrl: string): Promise<Record<string, number> | null> {
  if (!SCRAPERAPI_KEY) return null
  const username = instagramUsername(instaUrl)
  if (!username) return null
  const target = `https://socialblade.com/instagram/user/${encodeURIComponent(username)}`
  const proxied = `https://api.scraperapi.com/?api_key=${SCRAPERAPI_KEY}&url=${encodeURIComponent(target)}`
  try {
    const r = await fetch(proxied)
    if (!r.ok) {
      console.warn(`socialblade ${username}: HTTP ${r.status}`)
      return null
    }
    const html = await r.text()
    if (html.includes('We could not find that user') || html.includes('user could not be found')) {
      console.warn(`socialblade ${username}: account not tracked`)
      return null
    }
    const parsed = parseSocialbladeInsta(html)
    if (parsed.followers == null) {
      console.warn(`socialblade ${username}: no followers parsed (page format changed?)`)
      return null
    }
    return parsed
  } catch (e) {
    console.warn(`socialblade ${username} threw:`, e)
    return null
  }
}

async function fetchContent(
  instaUrl: string | null,
  fbUrl: string | null,
): Promise<Snapshot['data'] | null> {
  // Meta (Instagram + Facebook) детектит datacenter IPs и серует им SPA-shell
  // даже с crawler UA. Пробуем несколько UA по очереди — иногда удаётся пройти.
  // Если ни один не выдал og:description — оставляем поля пустыми
  // (UI покажет «—» и хинт «добавьте через настройки»).
  const SCRAPER_UAS = [
    'Twitterbot/1.0',
    'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
    'WhatsApp/2.0',
    'Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)',
    'Mozilla/5.0 (compatible; FinkleyBot/1.0; +https://finkley.app)',
  ]
  const SCRAPER_BASE_HEADERS = {
    'accept-language': 'pl-PL,pl;q=0.9,en;q=0.5',
    accept: 'text/html,application/xhtml+xml,application/xml;q=0.9',
  }
  async function fetchWithFallbackUAs(url: string): Promise<{ html: string; status: number }> {
    for (const ua of SCRAPER_UAS) {
      try {
        const r = await fetch(url, { headers: { ...SCRAPER_BASE_HEADERS, 'user-agent': ua } })
        if (!r.ok) continue
        const html = await r.text()
        if (html.includes('og:description')) return { html, status: r.status }
        // Без og:description пробуем следующий UA — текущий вернул SPA-shell.
      } catch (e) {
        console.warn(`fetch ${url} with UA="${ua.slice(0, 30)}" threw`, e)
      }
    }
    // Все UA провалились — возвращаем пустую строку.
    return { html: '', status: 0 }
  }
  const out: Record<string, number | string> = {}
  if (instaUrl) {
    // Primary path: Socialblade через ScraperAPI (residential pool). Возвращает
    // followers/posts + avg_likes/comments — недоступны через прямой og:description.
    const sb = await fetchInstaViaSocialblade(instaUrl)
    if (sb && sb.followers != null) {
      out.followers = sb.followers
      if (sb.following != null) out.following = sb.following
      if (sb.posts != null) out.posts = sb.posts
      if (sb.engagement_rate != null) out.engagement_rate = sb.engagement_rate
      if (sb.avg_likes != null) out.avg_likes = sb.avg_likes
      if (sb.avg_comments != null) out.avg_comments = sb.avg_comments
      out.instagram_url = instaUrl
      console.log(`instagram via socialblade ${instaUrl}: ${JSON.stringify(sb)}`)
    } else {
      // Fallback: direct fetch через UA-chain (только followers/posts если повезёт).
      try {
        const { html, status } = await fetchWithFallbackUAs(instaUrl)
        const counts = html ? parseInstaOgDescription(html) : {}
        console.log(
          `instagram direct ${instaUrl}: status=${status} len=${html.length} parsed=${JSON.stringify(counts)}`,
        )
        if (counts.followers != null) {
          out.followers = counts.followers
          if (counts.posts != null) out.posts = counts.posts
          if (counts.following != null) out.following = counts.following
          const ppm = estimatePostsPerMonth(html, counts.posts)
          if (ppm != null) out.posts_per_month = ppm
          out.instagram_url = instaUrl
        }
      } catch (e) {
        console.warn(`instagram fallback ${instaUrl} threw:`, e)
      }
    }
  }
  if (fbUrl) {
    try {
      // Primary: direct fetch with bot UAs (FB иногда отдаёт og:description с PL формулировкой «X osób lubi to»).
      let { html, status } = await fetchWithFallbackUAs(fbUrl)
      let likes = html ? parseFbLikes(html) : null
      // Fallback через ScraperAPI residential pool — если direct не достал og.
      if (likes == null && SCRAPERAPI_KEY) {
        const proxied = `https://api.scraperapi.com/?api_key=${SCRAPERAPI_KEY}&url=${encodeURIComponent(fbUrl)}`
        const r = await fetch(proxied)
        if (r.ok) {
          html = await r.text()
          status = r.status
          likes = parseFbLikes(html)
          console.log(`facebook via scraperapi ${fbUrl}: likes=${likes}`)
        }
      }
      console.log(`facebook fetch ${fbUrl}: status=${status} len=${html.length} likes=${likes}`)
      if (likes != null) {
        out.fb_likes = likes
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

/** Грубый стемминг + токенизация для name-match (синхронизирован с UI
 *  apps/web/src/routes/reports-hub/CompetitorsTab.tsx → normalizeServiceName). */
function syncNormalizeName(s: string): string[] {
  const STOP = new Set([
    'и',
    'на',
    'с',
    'для',
    'от',
    'до',
    'без',
    'innej',
    'inny',
    'stylistce',
    'stylistki',
  ])
  const stripped = s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ł/gi, 'l')
    .replace(/ё/gi, 'е')
    .toLowerCase()
    .replace(/[^a-zа-яёії\s+]/giu, ' ')
  const suffixes = [
    'ego',
    'ymi',
    'ami',
    'ach',
    'ych',
    'owy',
    'owa',
    'owe',
    'ova',
    'ovy',
    'ные',
    'ной',
    'ная',
    'ные',
    'ym',
    'em',
    'ej',
    'ie',
    'ов',
    'ой',
    'ые',
    'ый',
    'ая',
    'ое',
    'ия',
    'ия',
  ]
  function stem(t: string): string {
    if (t.length <= 4) return t
    for (const suf of suffixes) {
      if (t.length - suf.length >= 4 && t.endsWith(suf)) {
        return t.slice(0, t.length - suf.length)
      }
    }
    return t
  }
  return stripped
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOP.has(w))
    .map(stem)
}

function jaccard(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0
  const sa = new Set(a)
  const sb = new Set(b)
  let inter = 0
  for (const x of sa) if (sb.has(x)) inter++
  return inter / (sa.size + sb.size - inter)
}

/** Выбирает variants из catalog для занятости.
 *  Если watched != null/empty — берёт ТОЛЬКО те, чья имя fuzzy-матчит хотя бы
 *  одну услугу из watched. Иначе fallback на первые `fallbackTopN`. */
function pickVariantsForOccupancy(
  catalog: BooksyVariant[],
  watched: string[] | null,
  maxCount: number,
  fallbackTopN: number,
): BooksyVariant[] {
  const usable = catalog.filter((v) => v.id && v.staffer_ids.length > 0)
  if (!watched || watched.length === 0) {
    return usable.slice(0, fallbackTopN)
  }
  const watchedTokens = watched.map((w) => syncNormalizeName(w))
  const scored: Array<{ v: BooksyVariant; score: number }> = []
  for (const v of usable) {
    const t = syncNormalizeName(v.parent_name)
    let best = 0
    for (const ws of watchedTokens) {
      const s = jaccard(ws, t)
      if (s > best) best = s
    }
    if (best >= 0.3) scored.push({ v, score: best })
  }
  scored.sort((a, b) => b.score - a.score)
  // Если ни один не подошёл — fallback на первые fallbackTopN (чтобы хоть что-то
  // показать; user видит, что watched не пересекается с каталогом конкурента).
  if (scored.length === 0) return usable.slice(0, fallbackTopN)
  return scored.slice(0, maxCount).map((x) => x.v)
}

async function syncOwnSalon(
  admin: SupabaseClient,
  s: OwnSalonRow,
  watchedServices: string[] | null,
): Promise<number> {
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

    // Booksy catalog + occupancy для своего салона — чтобы Reports → Конкуренты/
    // Загруженность могло показать нашу строку сверху для прямого сравнения.
    const ownCatalog = await fetchBooksyCatalog(s.booksy_url)
    const ownParsed = parseBooksyUrl(s.booksy_url)
    if (ownCatalog && ownParsed) {
      const topVariants = pickVariantsForOccupancy(ownCatalog.services, watchedServices, 10, 5)
      if (topVariants.length > 0) {
        const occ = await fetchBooksyOccupancy(ownParsed, topVariants)
        if (occ.length > 0) {
          inserts.push({
            salon_id: s.id,
            kind: 'occupancy',
            data: { services: occ, total_staff: ownCatalog.staff.length },
            source: 'booksy',
            snapshot_date: TODAY,
          })
        }
      }
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
  watchedServices: string[] | null,
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

      // Загруженность: для top-N variants создаём draft + тянем timeslots на 7 дней.
      // Это даёт нам сравнимый метрик «свободные слоты у конкурента». Если у
      // юзера задан watched_services — выбираем variants по fuzzy-name-match;
      // иначе fallback на первые 5 (чтобы хоть что-то показать).
      // Booksy API требует конкретный staffer_id → фильтруем variants с пустым
      // массивом мастеров (Konsultacja и пр. — там booking не работает).
      const parsed = parseBooksyUrl(c.booksy_url)
      if (parsed) {
        const topVariants = pickVariantsForOccupancy(catalog.services, watchedServices, 10, 5)
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
  const salonWatchedMap = new Map<string, string[] | null>()
  if (salonIds.length > 0) {
    const { data: salons } = await admin.from('salons').select('id, city').in('id', salonIds)
    for (const s of (salons ?? []) as Array<{ id: string; city: string | null }>) {
      salonCityMap.set(s.id, s.city)
    }
    const { data: cms } = await admin
      .from('competitor_monitoring_settings')
      .select('salon_id, watched_services')
      .in('salon_id', salonIds)
    for (const r of (cms ?? []) as Array<{ salon_id: string; watched_services: string[] | null }>) {
      salonWatchedMap.set(
        r.salon_id,
        Array.isArray(r.watched_services) && r.watched_services.length > 0
          ? r.watched_services
          : null,
      )
    }
  }

  let snapshots = 0
  for (const c of (competitors ?? []) as CompetitorRow[]) {
    const city = salonCityMap.get(c.salon_id) ?? null
    const watched = salonWatchedMap.get(c.salon_id) ?? null
    snapshots += await syncOneCompetitor(admin, c, city, watched)
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
    let watched = salonWatchedMap.get(s.id) ?? null
    // Если в общем map не нашли — пробуем отдельно (на случай own_salon без
    // конкурентов).
    if (!watched) {
      const { data: cmsRow } = await admin
        .from('competitor_monitoring_settings')
        .select('watched_services')
        .eq('salon_id', s.id)
        .maybeSingle()
      const ws = (cmsRow as { watched_services?: string[] } | null)?.watched_services
      if (Array.isArray(ws) && ws.length > 0) watched = ws
    }
    ownSnapshots += await syncOwnSalon(admin, s, watched)
  }

  return jsonResponse({
    ok: true,
    competitors: competitors?.length ?? 0,
    snapshots,
    own_salons: ownSalons?.length ?? 0,
    own_snapshots: ownSnapshots,
  })
})
