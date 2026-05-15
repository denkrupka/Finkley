/**
 * dataport-nip-lookup — поиск контрагента по польскому NIP через Data PORT API.
 *
 * Вызывается из ExpenseFormModal/CounterpartyEditModal когда пользователь
 * вводит NIP и нажимает «найти» — заполняет name + address из реестра.
 *
 * Data PORT (https://dataport.pl) — публичный реестр польских компаний;
 * по NIP отдаёт name, REGON, KRS, адрес и т.д.
 *
 * ENV:
 *   DATAPORT_API_KEY  — приватный ключ владельца
 *
 * Auth: JWT обязателен (это вызывается из SPA пользователя).
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'

import { corsHeaders, preflight } from '../_shared/cors.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
const DATAPORT_KEY = Deno.env.get('DATAPORT_API_KEY') ?? ''

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
  if (!DATAPORT_KEY) return jsonResponse({ error: 'function_not_configured' }, 500)

  const authHeader = req.headers.get('Authorization') || req.headers.get('authorization') || ''
  if (!authHeader.startsWith('Bearer ')) return jsonResponse({ error: 'unauthorized' }, 401)

  // Verify caller is authenticated.
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

  try {
    // Data PORT API endpoint — структура ответа задокументирована
    // на dataport.pl; примерный shape: { name, nip, regon, address: {...} }.
    const res = await fetch(`https://api.dataport.pl/v1/companies/${nip}`, {
      headers: {
        Authorization: `Bearer ${DATAPORT_KEY}`,
        Accept: 'application/json',
      },
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      return jsonResponse(
        { error: 'dataport_error', status: res.status, detail: text.slice(0, 500) },
        res.status === 404 ? 404 : 502,
      )
    }
    const data = (await res.json()) as Record<string, unknown>
    // Нормализуем ответ к универсальной shape, чтобы фронт не зависел от
    // структуры Data PORT'а напрямую.
    const name = (data.name as string) ?? (data.companyName as string) ?? ''
    const address =
      (data.address as string) ??
      (data.formattedAddress as string) ??
      (typeof data.addressData === 'object' && data.addressData
        ? [
            (data.addressData as Record<string, string>).street,
            (data.addressData as Record<string, string>).postalCode,
            (data.addressData as Record<string, string>).city,
          ]
            .filter(Boolean)
            .join(', ')
        : '')
    return jsonResponse({ ok: true, nip, name, address, raw: data })
  } catch (e) {
    return jsonResponse(
      { error: 'fetch_failed', message: e instanceof Error ? e.message : String(e) },
      500,
    )
  }
})
