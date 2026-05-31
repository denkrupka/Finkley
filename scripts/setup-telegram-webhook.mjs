#!/usr/bin/env node
/**
 * Настраивает Telegram webhook для @finkley_tg_bot на edge function
 * telegram-user-bot. Запускать локально владельцем после первого деплоя
 * (или после смены домена Supabase project'а).
 *
 * Запуск:
 *   TELEGRAM_BOT_TOKEN=<token> \
 *   SUPABASE_PROJECT_REF=<ref> \
 *   TELEGRAM_USER_WEBHOOK_SECRET=<secret> \
 *   node scripts/setup-telegram-webhook.mjs
 *
 * `secret_token` обязателен — без него любой может POST'ить на webhook URL.
 * После запуска прогони `node scripts/check-telegram-webhook.mjs` для
 * верификации.
 */

const TOKEN = process.env.TELEGRAM_BOT_TOKEN
const PROJECT_REF = process.env.SUPABASE_PROJECT_REF
const SECRET = process.env.TELEGRAM_USER_WEBHOOK_SECRET

if (!TOKEN) {
  console.error('Missing TELEGRAM_BOT_TOKEN env var')
  process.exit(2)
}
if (!PROJECT_REF) {
  console.error('Missing SUPABASE_PROJECT_REF env var (например: abcdefghijklm)')
  process.exit(2)
}
if (!SECRET) {
  console.error(
    'Missing TELEGRAM_USER_WEBHOOK_SECRET env var (любая случайная строка ≥16 байт)',
  )
  process.exit(2)
}

const url = `https://${PROJECT_REF}.supabase.co/functions/v1/telegram-user-bot`
const params = new URLSearchParams({
  url,
  secret_token: SECRET,
  allowed_updates: JSON.stringify(['message']),
  drop_pending_updates: 'true',
})

const res = await fetch(
  `https://api.telegram.org/bot${TOKEN}/setWebhook?${params.toString()}`,
  { method: 'POST' },
)
const json = await res.json()
if (!res.ok || !json.ok) {
  console.error('✗ setWebhook failed:', json)
  process.exit(1)
}
console.log(`✓ Webhook установлен на ${url}`)
console.log('  description:', json.description)
console.log('\nДальше — проверь:')
console.log('  TELEGRAM_BOT_TOKEN=… node scripts/check-telegram-webhook.mjs')
process.exit(0)
