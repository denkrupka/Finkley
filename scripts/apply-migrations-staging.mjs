// Применяет supabase/migrations/*.sql на prod ИЛИ staging через Management
// API. Используется как обходной путь, если supabase CLI не понимает новый
// формат токена sbp_v0_*.
//
// Run:
//   node scripts/apply-migrations-staging.mjs            # → staging (default)
//   node scripts/apply-migrations-staging.mjs prod       # → prod
//
// Required env (читаются из apps/web/.env.local):
//   SUPABASE_ACCESS_TOKEN
//   VITE_SUPABASE_URL       (для prod)
//   VITE_SUPABASE_URL_TEST  (для staging)
import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

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

const env = readEnv()
const TOKEN = env.SUPABASE_ACCESS_TOKEN
if (!TOKEN) throw new Error('SUPABASE_ACCESS_TOKEN missing in .env.local')

const target = (process.argv[2] ?? 'staging').toLowerCase()
const urlVar = target === 'prod' ? 'VITE_SUPABASE_URL' : 'VITE_SUPABASE_URL_TEST'
const refMatch = (env[urlVar] ?? '').match(/https:\/\/([a-z0-9]+)\.supabase\.co/)
const REF = refMatch?.[1]
if (!REF) throw new Error(`Cannot resolve project ref from ${urlVar}`)

console.log(`Target ${target}: ${REF}`)

async function exec(sql) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: sql }),
  })
  const text = await res.text()
  if (!res.ok) {
    let err
    try { err = JSON.parse(text) } catch { err = text }
    throw new Error(`HTTP ${res.status}: ${typeof err === 'string' ? err : JSON.stringify(err)}`)
  }
  return text
}

const dir = join(ROOT, 'supabase/migrations')
const files = readdirSync(dir).filter(f => f.endsWith('.sql')).sort()

console.log(`Found ${files.length} migration files`)

// Сначала запишем metadata: создаём supabase_migrations.schema_migrations если нет
// (CLI создаёт автоматически; через API сделаем то же).
await exec(`
  create schema if not exists supabase_migrations;
  create table if not exists supabase_migrations.schema_migrations (
    version text primary key,
    name text,
    statements text[]
  );
`)

for (const file of files) {
  const version = file.match(/^(\d{14})/)?.[1]
  if (!version) {
    console.log(`SKIP ${file} (no version prefix)`)
    continue
  }

  // Уже применена?
  const checkSql = `select 1 from supabase_migrations.schema_migrations where version='${version}'`
  const existing = await exec(checkSql)
  if (existing.trim() && existing.trim() !== '[]') {
    console.log(`✓ ${file} — already applied`)
    continue
  }

  const sql = readFileSync(join(dir, file), 'utf8')
  console.log(`→ ${file} (${sql.length} chars)…`)

  try {
    await exec(sql)
    // Помечаем как применённую
    await exec(
      `insert into supabase_migrations.schema_migrations(version, name) values ('${version}', '${file.replace(/'/g, "''")}') on conflict do nothing`
    )
    console.log(`✓ ${file}`)
  } catch (e) {
    console.error(`✗ ${file}: ${e.message}`)
    process.exit(1)
  }
}

console.log('\nAll migrations applied to staging.')
