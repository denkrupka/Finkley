/**
 * Универсальный CORS-handler для edge functions, которые вызываются с браузера.
 * Использование:
 *
 *   if (req.method === 'OPTIONS') return preflight()
 *   ...
 *   return new Response(body, { headers: { ...corsHeaders, ... } })
 *
 * `*` в Allow-Origin OK, потому что:
 * - функции защищены своими секретами (HMAC для telegram-auth, signed payload для stripe-webhook)
 * - либо они принимают только access_token Supabase юзера
 *
 * Если когда-нибудь захотим строже — заменить на whitelist VITE_APP_URL+staging домена.
 */
export const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, accept',
}

export function preflight(): Response {
  return new Response(null, { status: 204, headers: corsHeaders })
}
