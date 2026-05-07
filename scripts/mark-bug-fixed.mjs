// Помечает баг как fixed и постит в Telegram-чат «Баги» автообъявление.
// Использует /functions/v1/telegram-bug-collector/announce-fix endpoint.
//
// Использование:
//   node scripts/mark-bug-fixed.mjs <short_id> "описание фикса"
//   node scripts/mark-bug-fixed.mjs <short_id> "описание фикса" <commit_sha>
//
// Пример:
//   node scripts/mark-bug-fixed.mjs ed12345a "Поменял типы файлов в БД с text на uuid[]"
//
// Env (читаются из apps/web/.env.local):
//   VITE_SUPABASE_URL
// Auth (по приоритету):
//   1) SUPABASE_SECRET_KEY (sb_secret_*) — новый формат, Supabase инжектит
//      его же в env Edge Function как SUPABASE_SERVICE_ROLE_KEY
//   2) FUNCTION_INTERNAL_SECRET — server-to-server секрет
//   3) SUPABASE_SERVICE_ROLE_KEY (legacy JWT eyJ...) — fallback, может не
//      работать после миграции на новый формат API keys
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execSync } from 'node:child_process'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')

function readEnv() {
  const raw = readFileSync(join(ROOT, 'apps/web/.env.local'), 'utf8')
  const env = {}
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^([A-Z_]+)=(.*)$/)
    if (m) env[m[1]] = m[2].trim()
  }
  return env
}

const [, , shortId, description, commitArg] = process.argv
if (!shortId) {
  console.error(
    'Usage: node scripts/mark-bug-fixed.mjs <short_id> "<описание>" [<commit_sha>]',
  )
  process.exit(1)
}

const env = readEnv()
const url = env.VITE_SUPABASE_URL
const secretKey = env.SUPABASE_SECRET_KEY // new sb_secret_* format
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY // legacy JWT
const functionSecret = env.FUNCTION_INTERNAL_SECRET

if (!url) throw new Error('VITE_SUPABASE_URL missing in .env.local')
if (!secretKey && !functionSecret && !serviceKey) {
  throw new Error('Need SUPABASE_SECRET_KEY, FUNCTION_INTERNAL_SECRET, or SUPABASE_SERVICE_ROLE_KEY')
}

let commitSha = commitArg
if (!commitSha) {
  try {
    commitSha = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim()
  } catch {
    commitSha = undefined
  }
}

const endpoint = `${url}/functions/v1/telegram-bug-collector/announce-fix`
const authHeaders = secretKey
  ? { Authorization: `Bearer ${secretKey}` }
  : functionSecret
    ? { 'X-Finkley-Secret': functionSecret }
    : { Authorization: `Bearer ${serviceKey}` }

const res = await fetch(endpoint, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    ...authHeaders,
  },
  body: JSON.stringify({
    short_id: shortId,
    fix_description: description ?? '',
    commit_sha: commitSha,
  }),
})

const body = await res.text()
if (!res.ok) {
  console.error(`HTTP ${res.status}: ${body}`)
  process.exit(1)
}
console.log(`✓ ${body}`)
