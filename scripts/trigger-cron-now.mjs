// Дёргает cron edge functions вручную (без ожидания cron-tick).
// Используется для тестового запуска после конфигурации secrets.
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')

const env = {}
for (const line of readFileSync(join(ROOT, 'apps/web/.env.local'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z_]+)=(.*)$/)
  if (m) env[m[1]] = m[2].trim().replace(/^"(.*)"$/, '$1')
}

const supabaseUrl = env.VITE_SUPABASE_URL
const anonKey = env.VITE_SUPABASE_ANON_KEY

async function call(fn, secret) {
  const url = `${supabaseUrl}/functions/v1/${fn}`
  console.log(`\n→ ${fn}`)
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      apikey: anonKey,
      authorization: `Bearer ${anonKey}`,
    },
    body: JSON.stringify({ token: secret }),
  })
  const text = await r.text()
  console.log(`  HTTP ${r.status}`)
  console.log(`  ${text.slice(0, 500)}`)
}

await call('reviews-sync', env.REVIEWS_SYNC_CRON_SECRET)
await call('competitor-sync', env.COMPETITOR_SYNC_CRON_SECRET)
