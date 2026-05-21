/**
 * competitor-discover — автоподбор конкурентов через Google Places Nearby Search.
 *
 * Запускается из UI (Reports/Конкуренты/Параметры → «Автоподбор»).
 *
 * Логика:
 *   1. Берём salons.lat / salons.lng (или geocodим адрес, если их нет).
 *   2. Google Places Nearby Search (v1) в радиусе settings.auto_pick_radius_m
 *      (по умолчанию 2000м) с includedPrimaryTypes=[beauty_salon, hair_care, nail_salon, spa].
 *   3. Фильтруем своих и уже добавленных по google_place_id.
 *   4. Вставляем минимум 10 (если столько найдено) с is_auto_picked=true.
 *
 * Body: { salon_id: string } — обязательное (UI-вызов).
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'

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

type SalonGeo = {
  id: string
  name: string
  lat: number | null
  lng: number | null
  address: string | null
  google_place_id: string | null
  salon_type: string | null
}

/** Маппинг salon_type → Google Places primary types для фильтрации. */
const SALON_TYPE_PLACE_TYPES: Record<string, string[]> = {
  hair: ['hair_salon', 'hair_care', 'beauty_salon'],
  nails: ['nail_salon', 'beauty_salon'],
  spa: ['spa', 'beauty_salon'],
  barber: ['barber_shop'],
}
const DEFAULT_PLACE_TYPES = ['beauty_salon', 'hair_care', 'nail_salon', 'spa', 'barber_shop']

/** Geocode адреса через Google Geocoding API (если у салона нет lat/lng). */
async function geocodeAddress(address: string): Promise<{ lat: number; lng: number } | null> {
  if (!GOOGLE_KEY) return null
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(
    address,
  )}&key=${GOOGLE_KEY}`
  const r = await fetch(url)
  if (!r.ok) return null
  const data = (await r.json()) as {
    status: string
    results?: Array<{ geometry?: { location?: { lat: number; lng: number } } }>
  }
  const loc = data.results?.[0]?.geometry?.location
  if (!loc) return null
  return { lat: loc.lat, lng: loc.lng }
}

type DiscoveredPlace = { place_id: string; name: string; url: string | null }

/**
 * Places API (New) — POST :searchNearby. Фильтрует по типу салона
 * (если задан) — например для nails-салона ищем только nail_salon +
 * beauty_salon, чтобы не подмешивать парикмахерские.
 */
async function placesNearby(
  lat: number,
  lng: number,
  radiusM: number,
  includedTypes: string[],
): Promise<DiscoveredPlace[]> {
  if (!GOOGLE_KEY) return []
  const r = await fetch('https://places.googleapis.com/v1/places:searchNearby', {
    method: 'POST',
    headers: {
      'X-Goog-Api-Key': GOOGLE_KEY,
      'X-Goog-FieldMask': 'places.id,places.displayName,places.googleMapsUri,places.primaryType',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      includedPrimaryTypes: includedTypes,
      maxResultCount: 20,
      locationRestriction: {
        circle: {
          center: { latitude: lat, longitude: lng },
          radius: radiusM,
        },
      },
    }),
  })
  if (!r.ok) {
    const txt = await r.text()
    console.warn('places searchNearby failed', r.status, txt.slice(0, 300))
    return []
  }
  const data = (await r.json()) as {
    places?: Array<{
      id: string
      displayName?: { text?: string }
      googleMapsUri?: string
    }>
  }
  return (data.places ?? []).map((p) => ({
    place_id: p.id,
    name: p.displayName?.text ?? 'Unknown',
    url: p.googleMapsUri ?? null,
  }))
}

/**
 * Places API (New) — POST :searchText с locationBias circle.
 * Используется когда у салона есть watched_services — ищем по конкретной
 * услуге (например "manicure") в радиусе. Возвращает более релевантные
 * результаты, чем Nearby по типу.
 */
async function placesSearchByService(
  lat: number,
  lng: number,
  radiusM: number,
  textQuery: string,
): Promise<DiscoveredPlace[]> {
  if (!GOOGLE_KEY) return []
  const r = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'X-Goog-Api-Key': GOOGLE_KEY,
      'X-Goog-FieldMask': 'places.id,places.displayName,places.googleMapsUri,places.primaryType',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      textQuery,
      maxResultCount: 20,
      locationBias: {
        circle: {
          center: { latitude: lat, longitude: lng },
          radius: radiusM,
        },
      },
    }),
  })
  if (!r.ok) {
    const txt = await r.text()
    console.warn('places searchText failed', r.status, txt.slice(0, 300))
    return []
  }
  const data = (await r.json()) as {
    places?: Array<{
      id: string
      displayName?: { text?: string }
      googleMapsUri?: string
    }>
  }
  return (data.places ?? []).map((p) => ({
    place_id: p.id,
    name: p.displayName?.text ?? 'Unknown',
    url: p.googleMapsUri ?? null,
  }))
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return preflight()
  if (req.method !== 'POST') return jsonResponse({ error: 'method_not_allowed' }, 405)
  if (!SUPABASE_URL || !SERVICE_KEY) {
    return jsonResponse({ error: 'function_not_configured' }, 500)
  }

  let body: { salon_id?: string } = {}
  try {
    body = await req.json()
  } catch {
    // empty body — невалидно для UI-вызова
  }
  if (!body.salon_id) return jsonResponse({ error: 'salon_id_required' }, 400)

  // Auth check через user JWT (RLS на salons).
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

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data: salonRaw } = await admin
    .from('salons')
    .select('id, name, lat, lng, address, google_place_id, salon_type')
    .eq('id', body.salon_id)
    .maybeSingle()
  if (!salonRaw) return jsonResponse({ error: 'salon_not_found' }, 404)
  const salon = salonRaw as SalonGeo

  // Получаем lat/lng — из salon или через geocode адреса.
  let lat = salon.lat
  let lng = salon.lng
  if ((lat == null || lng == null) && salon.address) {
    const geo = await geocodeAddress(salon.address)
    if (geo) {
      lat = geo.lat
      lng = geo.lng
      // Сохраним обратно, чтобы не геокодить при каждом запуске.
      await admin.from('salons').update({ lat, lng }).eq('id', salon.id)
    }
  }
  if (lat == null || lng == null) {
    return jsonResponse({ error: 'no_geo', message: 'address_or_coords_required' }, 400)
  }

  const { data: settingsRaw } = await admin
    .from('competitor_monitoring_settings')
    .select('auto_pick_radius_m, watched_services')
    .eq('salon_id', salon.id)
    .maybeSingle()
  const settings = settingsRaw as {
    auto_pick_radius_m?: number
    watched_services?: string[] | null
  } | null
  const radius = settings?.auto_pick_radius_m ?? 2000
  const watchedServices = (settings?.watched_services ?? []).filter(
    (s): s is string => typeof s === 'string' && s.trim().length > 0,
  )

  // Тип салона → фильтр по primary types. Default — все beauty-related.
  const placeTypes =
    (salon.salon_type && SALON_TYPE_PLACE_TYPES[salon.salon_type]) || DEFAULT_PLACE_TYPES

  // 1. Nearby по типу салона — даёт релевантную «соседнюю выборку».
  // 2. Если есть watched_services — каждое имя как textQuery с locationBias
  //    (более прицельный поиск под услугу). Dedup по place_id.
  // 3. Объединяем результаты. Итоговый cap 20 строк.
  const nearby = await placesNearby(Number(lat), Number(lng), radius, placeTypes)
  const byService: DiscoveredPlace[] = []
  for (const svc of watchedServices.slice(0, 3)) {
    // Не более 3 service-запросов чтобы не сжечь Google квоту.
    const svcResults = await placesSearchByService(Number(lat), Number(lng), radius, svc)
    for (const p of svcResults) byService.push(p)
  }

  // Объединяем с dedup и приоритетом nearby (Google Nearby точнее по locationRestriction).
  const merged = new Map<string, DiscoveredPlace>()
  for (const p of nearby) merged.set(p.place_id, p)
  for (const p of byService) if (!merged.has(p.place_id)) merged.set(p.place_id, p)
  const found = Array.from(merged.values())

  if (found.length === 0) {
    return jsonResponse({ ok: true, added: 0, total_found: 0 })
  }

  // Уже добавленные конкуренты + сам салон — исключаем по place_id.
  const { data: existing } = await admin
    .from('competitors')
    .select('google_place_id')
    .eq('salon_id', salon.id)
  const taken = new Set<string>(
    (existing ?? [])
      .map((e: { google_place_id: string | null }) => e.google_place_id)
      .filter((x: string | null): x is string => !!x),
  )
  if (salon.google_place_id) taken.add(salon.google_place_id)

  const candidates = found.filter((p) => !taken.has(p.place_id))
  if (candidates.length === 0) {
    return jsonResponse({ ok: true, added: 0, total_found: found.length })
  }

  const rows = candidates.slice(0, 20).map((p) => ({
    salon_id: salon.id,
    name: p.name,
    google_place_id: p.place_id,
    google_place_url: p.url,
    is_auto_picked: true,
  }))

  const { error } = await admin.from('competitors').insert(rows)
  if (error) {
    return jsonResponse({ error: error.message }, 500)
  }
  return jsonResponse({ ok: true, added: rows.length, total_found: found.length })
})
