/**
 * google-places-photo — прокси для Google Places photo media endpoint.
 *
 * Зачем: показывать превью фото места в UI поиска (Settings → Профиль).
 * Прокси нужен потому что `GOOGLE_PLACES_API_KEY` не должен светиться в
 * URL картинки в браузере.
 *
 * GET /functions/v1/google-places-photo?name=places/X/photos/Y&w=200
 *   - name (required) — photo resource name из google-places-search
 *   - w    (optional, default 200) — maxWidthPx
 *
 * Response: image/jpeg (или то что вернёт Google), Cache-Control 24h.
 */

import { corsHeaders, preflight } from '../_shared/cors.ts'

const GOOGLE_KEY = Deno.env.get('GOOGLE_PLACES_API_KEY') ?? ''

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return preflight()
  if (req.method !== 'GET') {
    return new Response('method_not_allowed', { status: 405, headers: corsHeaders })
  }
  if (!GOOGLE_KEY) {
    return new Response('google_api_not_configured', { status: 503, headers: corsHeaders })
  }

  const url = new URL(req.url)
  const name = url.searchParams.get('name')
  const maxWidth = parseInt(url.searchParams.get('w') ?? '200', 10)
  if (!name || !name.startsWith('places/')) {
    return new Response('invalid_name', { status: 400, headers: corsHeaders })
  }
  // Защита от слишком больших / отрицательных значений.
  const w = Number.isFinite(maxWidth) && maxWidth >= 32 && maxWidth <= 1600 ? maxWidth : 200

  // Places API New media endpoint. skipHttpRedirect=false вернёт сам бинарник.
  const apiUrl =
    `https://places.googleapis.com/v1/${encodeURI(name)}/media?` +
    new URLSearchParams({
      key: GOOGLE_KEY,
      maxWidthPx: String(w),
      skipHttpRedirect: 'true',
    }).toString()

  const r = await fetch(apiUrl)
  if (!r.ok) {
    return new Response(`google_photo_${r.status}`, {
      status: r.status,
      headers: corsHeaders,
    })
  }

  // skipHttpRedirect=true → Google вернёт JSON {photoUri: '...'}.
  const data = (await r.json()) as { photoUri?: string }
  if (!data.photoUri) {
    return new Response('no_photo_uri', { status: 502, headers: corsHeaders })
  }

  // Делаем второй request за самой картинкой, проксируем body.
  const img = await fetch(data.photoUri)
  if (!img.ok) {
    return new Response('photo_fetch_failed', { status: 502, headers: corsHeaders })
  }
  const contentType = img.headers.get('content-type') ?? 'image/jpeg'
  return new Response(img.body, {
    status: 200,
    headers: {
      ...corsHeaders,
      'content-type': contentType,
      // Кеш на 24h — фото меняются редко, переключатели в UI шустрее.
      'cache-control': 'public, max-age=86400',
    },
  })
})
