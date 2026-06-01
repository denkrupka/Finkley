/**
 * telegram-webhook-status — диагностика @finkley_tg_bot webhook без логина
 * в Telegram. Дёргает getWebhookInfo через Bot API и возвращает читаемый
 * статус.
 *
 * Use case: владелец в админке хочет понять, почему /start link_<code>
 * не привязывает Telegram (см. реальный баг 01.06.2026).
 *
 * GET (без auth) — возвращает { ok, webhook_url, pending_updates,
 *                                last_error_message, allowed_updates }
 * Token берётся из TELEGRAM_BOT_TOKEN env (тот же что в telegram-user-bot).
 */

import { corsHeaders, preflight } from '../_shared/cors.ts'

const BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN') ?? ''

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'content-type': 'application/json' },
  })
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return preflight()
  if (!BOT_TOKEN) {
    return jsonResponse(
      {
        ok: false,
        error: 'TELEGRAM_BOT_TOKEN не настроен в Supabase Secrets',
      },
      500,
    )
  }
  try {
    const r = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getWebhookInfo`)
    const data = (await r.json()) as {
      ok: boolean
      result?: {
        url?: string
        has_custom_certificate?: boolean
        pending_update_count?: number
        last_error_date?: number
        last_error_message?: string
        max_connections?: number
        allowed_updates?: string[]
      }
    }
    if (!data.ok || !data.result) {
      return jsonResponse({ ok: false, error: 'telegram_api_error', raw: data }, 502)
    }
    const info = data.result
    const isHealthy =
      !!info.url &&
      info.url.includes('telegram-user-bot') &&
      !info.last_error_message &&
      (info.pending_update_count ?? 0) < 100
    return jsonResponse({
      ok: true,
      healthy: isHealthy,
      webhook_url: info.url ?? null,
      pending_updates: info.pending_update_count ?? 0,
      last_error: info.last_error_message ?? null,
      last_error_at: info.last_error_date
        ? new Date(info.last_error_date * 1000).toISOString()
        : null,
      allowed_updates: info.allowed_updates ?? ['*'],
      diagnosis: !info.url
        ? 'Webhook не настроен — /start не привяжет Telegram. Запусти scripts/setup-telegram-webhook.mjs.'
        : info.last_error_message
          ? `Telegram не может доставить webhook: ${info.last_error_message}`
          : (info.pending_update_count ?? 0) > 50
            ? 'Webhook очередь забита — edge function падает или медленно отвечает'
            : 'OK',
    })
  } catch (e) {
    return jsonResponse({ ok: false, error: (e as Error).message }, 500)
  }
})
