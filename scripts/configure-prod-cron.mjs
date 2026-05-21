// Конфигурирует pg_cron + Function Secrets на проде ОДНОЙ командой.
// Используется ОДИН РАЗ после деплоя миграций 20260521000016/17/20
// (review_request_cron, client_overdue_pushes, sync_cron).
//
// Что делает:
//   1. Генерит 4 случайных 32-hex cron-secret'а (если уже в env — переиспользует).
//   2. PATCH Supabase project secrets: REVIEW_REQUEST_CRON_SECRET,
//      CLIENT_OVERDUE_CRON_SECRET, REVIEWS_SYNC_CRON_SECRET,
//      COMPETITOR_SYNC_CRON_SECRET. Плюс: если в env заданы
//      GOOGLE_PLACES_API_KEY / SMS_PROVIDER / SMS_API_KEY / SMS_FROM —
//      прокидывает их тоже.
//   3. ALTER DATABASE postgres SET app.supabase_url + app.<secret>.
//   4. Перерегистрирует pg_cron jobs прямо сейчас (без ожидания
//      следующего деплоя миграции 20260521000020).
//
// Run:
//   node scripts/configure-prod-cron.mjs            # → prod (default)
//   node scripts/configure-prod-cron.mjs staging    # → staging
//
// Required env (в apps/web/.env.local):
//   SUPABASE_ACCESS_TOKEN  — личный токен Supabase Management API
//   VITE_SUPABASE_URL      — для prod (production project)
//   VITE_SUPABASE_URL_TEST — для staging
import { readFileSync, appendFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomBytes } from 'node:crypto'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')

function readEnv() {
  const raw = readFileSync(join(ROOT, 'apps/web/.env.local'), 'utf8')
  const env = {}
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^([A-Z_]+)=(.*)$/)
    if (m) env[m[1]] = m[2].trim().replace(/^"(.*)"$/, '$1')
  }
  return env
}

const env = readEnv()
const TOKEN = env.SUPABASE_ACCESS_TOKEN
if (!TOKEN) throw new Error('SUPABASE_ACCESS_TOKEN missing in apps/web/.env.local')

const target = (process.argv[2] ?? 'prod').toLowerCase()
const urlVar = target === 'prod' ? 'VITE_SUPABASE_URL' : 'VITE_SUPABASE_URL_TEST'
const SUPABASE_URL = env[urlVar]
const refMatch = (SUPABASE_URL ?? '').match(/https:\/\/([a-z0-9]+)\.supabase\.co/)
const REF = refMatch?.[1]
if (!REF || !SUPABASE_URL) throw new Error(`Cannot resolve project ref from ${urlVar}`)

console.log(`Target ${target}: ${REF} (${SUPABASE_URL})`)

// =============================================================================
// Cron secrets — переиспользуем из env если заданы, иначе генерим.
// =============================================================================
function ensureSecret(name) {
  if (env[name]) {
    console.log(`  ${name} — reusing from .env.local`)
    return env[name]
  }
  const s = randomBytes(16).toString('hex')
  console.log(`  ${name} — generated new (32 hex)`)
  return s
}

const cronSecrets = {
  REVIEW_REQUEST_CRON_SECRET: ensureSecret('REVIEW_REQUEST_CRON_SECRET'),
  CLIENT_OVERDUE_CRON_SECRET: ensureSecret('CLIENT_OVERDUE_CRON_SECRET'),
  REVIEWS_SYNC_CRON_SECRET: ensureSecret('REVIEWS_SYNC_CRON_SECRET'),
  COMPETITOR_SYNC_CRON_SECRET: ensureSecret('COMPETITOR_SYNC_CRON_SECRET'),
}

// Опциональные — прокидываются только если есть в env.
const optionalSecrets = {}
for (const key of [
  'GOOGLE_PLACES_API_KEY',
  'SMS_PROVIDER',
  'SMS_API_KEY',
  'SMS_API_SECRET',
  'SMS_FROM',
]) {
  if (env[key]) {
    optionalSecrets[key] = env[key]
    console.log(`  ${key} — taking from .env.local`)
  }
}

// =============================================================================
// Step 1: Set Function Secrets via Management API.
// Endpoint: POST /v1/projects/{ref}/secrets
// =============================================================================
console.log('\n[1/3] Setting Function Secrets via Management API…')
const secretsPayload = Object.entries({ ...cronSecrets, ...optionalSecrets }).map(
  ([name, value]) => ({ name, value }),
)
const secretsRes = await fetch(`https://api.supabase.com/v1/projects/${REF}/secrets`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${TOKEN}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify(secretsPayload),
})
if (!secretsRes.ok) {
  const t = await secretsRes.text()
  throw new Error(`Set secrets failed: HTTP ${secretsRes.status}: ${t.slice(0, 500)}`)
}
console.log(`  ✓ ${secretsPayload.length} secrets set (${Object.keys(cronSecrets).length} cron + ${Object.keys(optionalSecrets).length} optional)`)

// =============================================================================
// Step 2: Register pg_cron jobs.
//
// Изначально планировался ALTER DATABASE postgres SET app.* (для миграции
// 20260521000020), но Supabase managed Postgres не разрешает alter database
// через Management API (42501 permission denied). Поэтому регистрируем
// cron jobs напрямую с embedded URL+secret — обходим зависимость от app.*.
// =============================================================================
async function execSql(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: sql }),
  })
  const text = await r.text()
  if (!r.ok) {
    throw new Error(`HTTP ${r.status}: ${text.slice(0, 500)}`)
  }
  return text
}

console.log('\n[2/2] (Re-)registering pg_cron jobs…')

// Нужны cron-настройки на текущей session — но ALTER DATABASE применяется
// только к будущим соединениям. Чтобы не ждать reconnect — встраиваем URL/secret
// прямо в format() при schedule(). Это то же поведение что migration 20260521000020.
//
// IMPORTANT: net.http_post вызывается на уровне cron worker'а — он подхватит
// ALTER DATABASE settings при следующем cron-tick'е. Сейчас регистрируем jobs.

const cronJobs = [
  {
    name: 'send_review_request',
    schedule: '0 */6 * * *', // каждые 6 часов
    url: `${SUPABASE_URL}/functions/v1/send-review-request`,
    secret: cronSecrets.REVIEW_REQUEST_CRON_SECRET,
  },
  {
    name: 'client_overdue_push',
    schedule: '0 9 * * *', // каждый день 09:00 UTC
    url: `${SUPABASE_URL}/functions/v1/client-overdue-push`,
    secret: cronSecrets.CLIENT_OVERDUE_CRON_SECRET,
  },
  {
    name: 'reviews_sync',
    schedule: '0 7 * * *', // каждый день 07:00 UTC
    url: `${SUPABASE_URL}/functions/v1/reviews-sync`,
    secret: cronSecrets.REVIEWS_SYNC_CRON_SECRET,
  },
  {
    name: 'competitor_sync',
    schedule: '0 8 * * *', // каждый день 08:00 UTC
    url: `${SUPABASE_URL}/functions/v1/competitor-sync`,
    secret: cronSecrets.COMPETITOR_SYNC_CRON_SECRET,
  },
]

for (const job of cronJobs) {
  const escUrl = job.url.replace(/'/g, "''")
  const escSecret = job.secret.replace(/'/g, "''")
  const sql = `
    do $$
    begin
      perform cron.unschedule(jobid) from cron.job where jobname = '${job.name}';
      perform cron.schedule(
        '${job.name}',
        '${job.schedule}',
        format(
          $cron$
          select net.http_post(
            url := %L,
            headers := jsonb_build_object('content-type', 'application/json'),
            body := jsonb_build_object('token', %L)
          ) as request_id
          $cron$,
          '${escUrl}',
          '${escSecret}'
        )
      );
    end
    $$;
  `
  await execSql(sql)
  console.log(`  ✓ ${job.name} → ${job.schedule}`)
}

// =============================================================================
// Step 3: Persist generated secrets в apps/web/.env.local чтобы повторный
// запуск переиспользовал их (иначе Function Secrets и pg_cron разъедутся).
//
// Дописываем только те ключи, которых ещё нет в .env.local.
// =============================================================================
const envPath = join(ROOT, 'apps/web/.env.local')
const existing = readFileSync(envPath, 'utf8')
const toAppend = []
for (const [name, val] of Object.entries(cronSecrets)) {
  if (!new RegExp(`^${name}=`, 'm').test(existing)) {
    toAppend.push(`${name}=${val}`)
  }
}
if (toAppend.length > 0) {
  const prefix = existing.endsWith('\n') ? '' : '\n'
  appendFileSync(envPath, `${prefix}# Auto-added by scripts/configure-prod-cron.mjs (${new Date().toISOString()})\n${toAppend.join('\n')}\n`)
  console.log(`\n[3/3] Wrote ${toAppend.length} secrets to apps/web/.env.local`)
} else {
  console.log('\n[3/3] All cron-secrets already in apps/web/.env.local — nothing to append.')
}

console.log('\n✅ Done. Cron-secrets (masked):')
for (const [name, val] of Object.entries(cronSecrets)) {
  console.log(`  ${name} = ${val.slice(0, 8)}…`)
}
