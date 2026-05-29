#!/usr/bin/env node
// Применяет supabase/migrations/*.sql через прямое подключение к Postgres
// через session pooler (`aws-0-eu-west-1.pooler.supabase.com:5432`).
//
// Background: Supabase Management API /database/query c 28 мая 2026 принудительно
// открывает read-only transaction (PreventCommandIfReadOnly utility.c:407),
// что блокирует все DDL (CREATE SCHEMA / TABLE / FUNCTION / ALTER / etc.).
// Direct host `db.PROJECT_REF.supabase.co` больше не резолвится для всех
// проектов — Supabase перевели на pooler-only access.
//
// Обход: подключаемся через session pooler (порт 5432), в начале сессии
// делаем `set session default_transaction_read_only = off` + явный
// `begin read write` перед DDL. Так миграции применяются как обычно.
//
// Run:
//   SUPABASE_DB_PASSWORD=... node scripts/apply-migrations-via-pooler.mjs <ref>
//
// CI usage:
//   - target=staging: PASSWORD = secrets.SUPABASE_DB_PASSWORD_TEST,
//     REF извлекается из secrets.VITE_SUPABASE_URL_TEST
//   - target=prod:    PASSWORD = secrets.SUPABASE_DB_PASSWORD_PROD,
//     REF извлекается из secrets.VITE_SUPABASE_URL_PROD
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import pg from 'pg'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')

const REF = process.argv[2] ?? process.env.SUPABASE_PROJECT_REF
const PASSWORD = process.env.SUPABASE_DB_PASSWORD
const REGION = process.env.SUPABASE_DB_REGION ?? 'eu-west-1'

if (!REF) throw new Error('Project ref missing (argv[2] or SUPABASE_PROJECT_REF)')
if (!PASSWORD) throw new Error('SUPABASE_DB_PASSWORD env missing')

const client = new pg.Client({
  host: `aws-0-${REGION}.pooler.supabase.com`,
  port: 5432,
  user: `postgres.${REF}`,
  password: PASSWORD,
  database: 'postgres',
  ssl: { rejectUnauthorized: false },
})

console.log(`Connecting to ${REF} (region ${REGION}) via pooler…`)
await client.connect()
console.log('Connected.')

// Default pooler session forces RO — переключаем явно.
await client.query(`set session default_transaction_read_only = off`)

// Ensure migrations table exists.
await client.query('begin read write')
await client.query(`
  create schema if not exists supabase_migrations;
  create table if not exists supabase_migrations.schema_migrations (
    version text primary key,
    name text,
    statements text[]
  );
`)
await client.query('commit')

const dir = join(ROOT, 'supabase/migrations')
const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()
console.log(`Found ${files.length} migration files`)

let applied = 0
let skipped = 0
for (const file of files) {
  const version = file.match(/^(\d{14})/)?.[1]
  if (!version) continue
  const { rows } = await client.query(
    `select 1 from supabase_migrations.schema_migrations where version=$1`,
    [version],
  )
  if (rows.length > 0) {
    skipped++
    continue
  }
  const sql = readFileSync(join(dir, file), 'utf8')
  console.log(`→ ${file} (${sql.length} chars)…`)
  try {
    await client.query('begin read write')
    await client.query(sql)
    await client.query(
      `insert into supabase_migrations.schema_migrations(version, name) values ($1, $2) on conflict do nothing`,
      [version, file],
    )
    await client.query('commit')
    console.log(`✓ ${file}`)
    applied++
  } catch (e) {
    await client.query('rollback').catch(() => {})
    console.error(`✗ ${file}: ${e.message}`)
    await client.end()
    process.exit(1)
  }
}

await client.end()
console.log(`\nDone. Applied: ${applied}, skipped (already): ${skipped}`)
