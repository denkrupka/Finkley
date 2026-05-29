#!/usr/bin/env node
// Wrapper: применяет миграции на staging/prod через pooler (см.
// apply-migrations-via-pooler.mjs). Старая версия использовала Management
// API /database/query, который с 28 мая 2026 принудительно в read-only
// режиме (PreventCommandIfReadOnly, SQLSTATE 25006) — DDL не проходят.
//
// Имя файла сохранено для обратной совместимости с deploy-supabase.yml.
//
// Run:
//   node scripts/apply-migrations-staging.mjs staging
//   node scripts/apply-migrations-staging.mjs prod
//
// Required env (читаются из apps/web/.env.local или CI):
//   - VITE_SUPABASE_URL          (для prod, чтобы извлечь PROJECT_REF)
//   - VITE_SUPABASE_URL_TEST     (для staging)
//   - SUPABASE_DB_PASSWORD_PROD  (для prod, GitHub secret)
//   - SUPABASE_DB_PASSWORD_TEST  (для staging, GitHub secret)
//   - SUPABASE_DB_REGION         (optional, default 'eu-west-1')
import { readFileSync, existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')

function readEnv() {
  const path = join(ROOT, 'apps/web/.env.local')
  if (!existsSync(path)) return {}
  const raw = readFileSync(path, 'utf8')
  const env = {}
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^([A-Z_]+)=(.*)$/)
    if (m) env[m[1]] = m[2].trim()
  }
  return env
}

const fileEnv = readEnv()
const target = (process.argv[2] ?? 'staging').toLowerCase()

const urlVar = target === 'prod' ? 'VITE_SUPABASE_URL' : 'VITE_SUPABASE_URL_TEST'
const pwdVar = target === 'prod' ? 'SUPABASE_DB_PASSWORD_PROD' : 'SUPABASE_DB_PASSWORD_TEST'

const url = process.env[urlVar] ?? fileEnv[urlVar]
const password = process.env[pwdVar] ?? fileEnv[pwdVar]
const region = process.env.SUPABASE_DB_REGION ?? fileEnv.SUPABASE_DB_REGION ?? 'eu-west-1'

const refMatch = (url ?? '').match(/https:\/\/([a-z0-9]+)\.supabase\.co/)
const REF = refMatch?.[1]
if (!REF) throw new Error(`Cannot resolve project ref from ${urlVar}: ${url}`)
if (!password) throw new Error(`${pwdVar} missing (env or .env.local)`)

console.log(`Target ${target}: ${REF} (region ${region})`)

// Запускаем pooler-based applier как child process, чтобы не плодить
// дубль кода. Передаём ref в argv, password через env.
const child = spawn(
  process.execPath,
  [join(__dirname, 'apply-migrations-via-pooler.mjs'), REF],
  {
    stdio: 'inherit',
    env: {
      ...process.env,
      SUPABASE_DB_PASSWORD: password,
      SUPABASE_DB_REGION: region,
    },
  },
)

child.on('exit', (code) => process.exit(code ?? 1))
