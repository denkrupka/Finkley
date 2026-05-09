/**
 * banking-aspsps — listing банков (ASPSPs) для выбранной страны.
 *
 * Просто проксирует Enable Banking GET /aspsps?country=PL в браузер.
 * Страница connect/Bank picker дёргает это для рендеринга списка.
 *
 * Auth: только авторизованный юзер. Нагрузка минимальная (10-30 banks
 * per country), ошибки EB прозрачно прокидываем.
 */

import { getUserFromRequest } from '../_shared/auth.ts'
import { corsHeaders, preflight } from '../_shared/cors.ts'
import { signEnableBankingJwt } from '../_shared/enable-banking.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const APP_ID = Deno.env.get('ENABLE_BANKING_APP_ID') ?? ''
const PRIVATE_KEY = Deno.env.get('ENABLE_BANKING_PRIVATE_KEY') ?? ''

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'content-type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return preflight()
  if (req.method !== 'GET') return jsonResponse({ error: 'method_not_allowed' }, 405)
  if (!APP_ID || !PRIVATE_KEY) {
    return jsonResponse({ error: 'enable_banking_not_configured' }, 500)
  }

  const user = await getUserFromRequest(req, SUPABASE_URL, SERVICE_KEY)
  if (!user) return jsonResponse({ error: 'unauthorized' }, 401)

  const url = new URL(req.url)
  const country = url.searchParams.get('country') ?? 'PL'
  if (!/^[A-Z]{2}$/.test(country)) return jsonResponse({ error: 'bad_country' }, 400)

  try {
    const jwt = await signEnableBankingJwt(APP_ID, PRIVATE_KEY)
    const ebRes = await fetch(`https://api.enablebanking.com/aspsps?country=${country}`, {
      headers: { authorization: `Bearer ${jwt}` },
    })
    const text = await ebRes.text()
    if (!ebRes.ok) {
      return jsonResponse({ error: 'enable_banking_error', status: ebRes.status, body: text }, 502)
    }
    const data = JSON.parse(text) as {
      aspsps: Array<{
        name: string
        country: string
        psu_types: string[]
        logo?: string
        beta?: boolean
        sandbox?: boolean
      }>
    }
    // Фильтруем sandbox-банки в production. Если ENABLE_BANKING_ALLOW_SANDBOX
    // задан — оставляем (полезно в staging).
    const allowSandbox = Deno.env.get('ENABLE_BANKING_ALLOW_SANDBOX') === '1'
    const aspsps = (data.aspsps ?? [])
      .filter((a) => allowSandbox || !a.sandbox)
      .map((a) => ({
        name: a.name,
        country: a.country,
        psu_types: a.psu_types,
        logo: a.logo,
        beta: a.beta ?? false,
      }))
    return jsonResponse({ aspsps })
  } catch (e) {
    console.error('banking-aspsps', e)
    return jsonResponse(
      { error: 'enable_banking_error', detail: e instanceof Error ? e.message : String(e) },
      502,
    )
  }
})
