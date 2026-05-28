#!/usr/bin/env node
/**
 * T151 — диагностика Telegram webhook для @finkley_tg_bot.
 *
 * Запускать локально или в CI:
 *   TELEGRAM_BOT_TOKEN=<token> node scripts/check-telegram-webhook.mjs
 *
 * Что проверяет:
 *   1. /getWebhookInfo — установлен ли URL, нет ли pending updates,
 *      last_error_message, secret_token присутствует.
 *   2. URL должен указывать на /functions/v1/telegram-user-bot прода/staging.
 *   3. allowed_updates содержит 'message' (юзер отправляет /start).
 *
 * Возвращает exit code 1 если что-то не так.
 */

const TOKEN = process.env.TELEGRAM_BOT_TOKEN
if (!TOKEN) {
  console.error('Missing TELEGRAM_BOT_TOKEN env var')
  process.exit(2)
}

const EXPECTED_URL_HOST = process.env.SUPABASE_FUNCTIONS_HOST ?? '.supabase.co/functions/v1/'
const EXPECTED_PATH = 'telegram-user-bot'

const TG_API = `https://api.telegram.org/bot${TOKEN}`

async function call(method) {
  const res = await fetch(`${TG_API}/${method}`)
  if (!res.ok) {
    throw new Error(`${method}: HTTP ${res.status}: ${await res.text()}`)
  }
  const json = await res.json()
  if (!json.ok) {
    throw new Error(`${method}: not ok — ${JSON.stringify(json)}`)
  }
  return json.result
}

let failures = 0

try {
  const me = await call('getMe')
  console.log(`✓ Bot identity: @${me.username} (id=${me.id})`)
} catch (e) {
  console.error(`✗ getMe failed: ${e.message}`)
  failures++
}

try {
  const info = await call('getWebhookInfo')
  if (!info.url) {
    console.error('✗ Webhook URL is empty — bot will not receive updates')
    failures++
  } else {
    console.log(`✓ Webhook URL: ${info.url}`)
    if (!info.url.includes(EXPECTED_URL_HOST)) {
      console.error(
        `✗ Webhook URL does not point to Supabase functions host (expected ${EXPECTED_URL_HOST})`,
      )
      failures++
    }
    if (!info.url.includes(EXPECTED_PATH)) {
      console.error(`✗ Webhook URL does not include ${EXPECTED_PATH}`)
      failures++
    }
  }
  if (info.last_error_message) {
    console.error(
      `✗ Last delivery error: ${info.last_error_message} (at ${new Date(info.last_error_date * 1000).toISOString()})`,
    )
    failures++
  } else {
    console.log('✓ No recent delivery errors')
  }
  if (info.pending_update_count > 50) {
    console.error(
      `✗ ${info.pending_update_count} pending updates — webhook stuck or processing slow`,
    )
    failures++
  } else {
    console.log(`✓ Pending updates: ${info.pending_update_count}`)
  }
  if (!info.has_custom_certificate && !info.url) {
    console.error('✗ No custom certificate AND no URL — webhook not configured')
    failures++
  }
  if (info.allowed_updates && !info.allowed_updates.includes('message')) {
    console.error(
      `✗ allowed_updates does not include 'message' — /start won't reach the bot`,
    )
    failures++
  } else {
    console.log('✓ Allowed updates includes "message" (or empty = all)')
  }
  if (info.secret_token === false) {
    console.error('✗ No secret token configured — anyone can POST to your webhook URL')
    failures++
  }
} catch (e) {
  console.error(`✗ getWebhookInfo failed: ${e.message}`)
  failures++
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed. To fix:`)
  console.error('  1. Run setWebhook with correct URL and secret_token')
  console.error(
    `     curl -X POST https://api.telegram.org/bot$TG_TOKEN/setWebhook -d url=https://<project>.supabase.co/functions/v1/telegram-user-bot -d secret_token=<secret>`,
  )
  console.error('  2. Deploy telegram-user-bot edge function')
  console.error('  3. Set TELEGRAM_USER_WEBHOOK_SECRET in Supabase secrets')
  process.exit(1)
}

console.log('\n✓ All telegram webhook checks passed')
