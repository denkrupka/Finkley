/**
 * dataport-nip-lookup — поиск компании по польскому NIP.
 *
 * Источник: публичный White List API Минфина РП (wl-api.mf.gov.pl).
 * Бесплатно, без ключа, официально поддерживается государством.
 * Возвращает name + address для авто-заполнения контрагента.
 *
 * Endpoint: GET https://wl-api.mf.gov.pl/api/search/nip/{nip}?date=YYYY-MM-DD
 * Response: { result: { subject: { name, nip, workingAddress, residenceAddress, ... } } }
 *
 * Если subject не найден — возвращаем 404 с тихим сообщением; фронт
 * gracefully degradeит (юзер заполнит руками).
 *
 * Имя функции исторически «dataport-nip-lookup» — оставлено для
 * совместимости с фронтом; внутри теперь MF API.
 *
 * Auth: JWT обязателен (вызывается из SPA).
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'

import { corsHeaders, preflight } from '../_shared/cors.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? ''

type Body = { nip?: string }

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'content-type': 'application/json' },
  })
}

function normalizeNip(input: string): string {
  return input.replace(/[^0-9]/g, '')
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return preflight()
  if (req.method !== 'POST') return jsonResponse({ error: 'method_not_allowed' }, 405)

  const authHeader = req.headers.get('Authorization') || req.headers.get('authorization') || ''
  if (!authHeader.startsWith('Bearer ')) return jsonResponse({ error: 'unauthorized' }, 401)

  // Authenticated caller.
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  })
  const { data: u, error: userErr } = await userClient.auth.getUser()
  if (userErr || !u?.user) return jsonResponse({ error: 'unauthorized' }, 401)

  let body: Body
  try {
    body = (await req.json()) as Body
  } catch {
    return jsonResponse({ error: 'invalid_json' }, 400)
  }
  const nip = normalizeNip(body.nip ?? '')
  if (nip.length !== 10) return jsonResponse({ error: 'invalid_nip' }, 400)

  // Дата по запросу MF API — сегодня. Формат YYYY-MM-DD.
  const today = new Date().toISOString().slice(0, 10)
  const url = `https://wl-api.mf.gov.pl/api/search/nip/${nip}?date=${today}`

  try {
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
    })
    if (res.status === 404) {
      return jsonResponse({ ok: true, nip, name: '', address: '', not_found: true })
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      return jsonResponse(
        { error: 'mf_api_error', status: res.status, detail: text.slice(0, 500) },
        502,
      )
    }
    const data = (await res.json()) as {
      result?: {
        subject?: {
          name?: string
          workingAddress?: string
          residenceAddress?: string
        } | null
      }
    }
    const subject = data.result?.subject
    if (!subject) {
      return jsonResponse({ ok: true, nip, name: '', address: '', not_found: true })
    }
    return jsonResponse({
      ok: true,
      nip,
      name: subject.name ?? '',
      // У ИП обычно residenceAddress (адрес проживания), у компаний
      // workingAddress (юр.адрес/место ведения деятельности). Берём
      // приоритетно working, fallback на residence.
      address: subject.workingAddress ?? subject.residenceAddress ?? '',
    })
  } catch (e) {
    return jsonResponse(
      { error: 'fetch_failed', message: e instanceof Error ? e.message : String(e) },
      500,
    )
  }
})
