/**
 * google-places-search — proxy для Google Places API New (Text Search).
 *
 * Зачем: UI в Settings ищет место по названию («Зефир салон Warszawa»),
 * получает несколько кандидатов с фото/адресом, юзер выбирает нужное
 * и мы записываем google_place_id + координаты в БД.
 *
 * Прокси нужен потому что `GOOGLE_PLACES_API_KEY` не должен оказаться в
 * браузере. Авторизация — обычный Supabase user JWT (RLS не нужно,
 * читаем только публичные данные Google).
 *
 * Body: { query: string } — обязательное, минимум 2 символа.
 * Response: { places: Array<{ id, name, address, location, photo_name }> }
 */

import { corsHeaders, preflight } from '../_shared/cors.ts'

const GOOGLE_KEY = Deno.env.get('GOOGLE_PLACES_API_KEY') ?? ''

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'content-type': 'application/json' },
  })
}

type PlaceResult = {
  id: string
  name: string
  address: string | null
  location: { lat: number; lng: number } | null
  photo_name: string | null
  rating: number | null
  rating_count: number | null
  google_maps_uri: string | null
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return preflight()
  if (req.method !== 'POST') return jsonResponse({ error: 'method_not_allowed' }, 405)
  if (!GOOGLE_KEY) return jsonResponse({ error: 'google_api_not_configured' }, 503)

  let body: { query?: string; language?: string } = {}
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: 'invalid_json' }, 400)
  }
  const query = (body.query ?? '').trim()
  if (query.length < 2) {
    return jsonResponse({ error: 'query_too_short' }, 400)
  }

  // Places API New — Text Search.
  // FieldMask: только то что нужно, чтобы не платить за лишнее.
  const r = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'X-Goog-Api-Key': GOOGLE_KEY,
      'X-Goog-FieldMask':
        'places.id,places.displayName,places.formattedAddress,places.location,' +
        'places.photos,places.rating,places.userRatingCount,places.googleMapsUri',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      textQuery: query,
      languageCode: body.language ?? 'en',
      maxResultCount: 10,
    }),
  })

  if (!r.ok) {
    const text = await r.text()
    console.warn('places searchText failed', r.status, text.slice(0, 300))
    return jsonResponse(
      { error: 'google_api_error', status: r.status, message: text.slice(0, 200) },
      502,
    )
  }

  const data = (await r.json()) as {
    places?: Array<{
      id: string
      displayName?: { text?: string }
      formattedAddress?: string
      location?: { latitude: number; longitude: number }
      photos?: Array<{ name?: string }>
      rating?: number
      userRatingCount?: number
      googleMapsUri?: string
    }>
  }

  const places: PlaceResult[] = (data.places ?? []).map((p) => ({
    id: p.id,
    name: p.displayName?.text ?? 'Unknown',
    address: p.formattedAddress ?? null,
    location: p.location ? { lat: p.location.latitude, lng: p.location.longitude } : null,
    photo_name: p.photos?.[0]?.name ?? null,
    rating: p.rating ?? null,
    rating_count: p.userRatingCount ?? null,
    google_maps_uri: p.googleMapsUri ?? null,
  }))

  return jsonResponse({ places })
})
