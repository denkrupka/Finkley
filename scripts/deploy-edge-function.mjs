// Деплой edge function на prod (или staging при TARGET=staging) через
// Supabase Management API. Обходит supabase CLI 2.98.2, который не понимает
// новый формат токена sbp_v0_*.
//
// Использование:
//   node scripts/deploy-edge-function.mjs <slug> [--no-verify-jwt]
//   TARGET=staging node scripts/deploy-edge-function.mjs <slug>
//
// Env (читаются из apps/web/.env.local):
//   SUPABASE_ACCESS_TOKEN
//   VITE_SUPABASE_URL       — prod project ref
//   VITE_SUPABASE_URL_TEST  — staging project ref (используется при TARGET=staging)
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'
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
if (!TOKEN) throw new Error('SUPABASE_ACCESS_TOKEN missing')

const target = (process.env.TARGET ?? 'prod').toLowerCase()
const urlVar = target === 'staging' ? 'VITE_SUPABASE_URL_TEST' : 'VITE_SUPABASE_URL'
const url = env[urlVar] ?? ''
const REF = url.match(/https:\/\/([a-z0-9]+)\.supabase\.co/)?.[1]
if (!REF) throw new Error(`Cannot resolve project ref from ${urlVar}`)

const slug = process.argv[2]
if (!slug) {
  console.error('Usage: node scripts/deploy-edge-function.mjs <slug> [--no-verify-jwt]')
  process.exit(1)
}
const noVerifyJwt = process.argv.includes('--no-verify-jwt')

const fnDir = join(ROOT, 'supabase/functions', slug)
try {
  statSync(fnDir)
} catch {
  console.error(`Function dir not found: ${fnDir}`)
  process.exit(1)
}

// Собираем все .ts файлы функции в multipart payload. Management API требует:
// - metadata: JSON {entrypoint_path, verify_jwt, ...}
// - file: каждый файл функции отдельным полем (имя поля = path относительно
//   корня функции, e.g. "index.ts", "_shared/utils.ts")
function listFiles(dir, prefix = '') {
  const out = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const rel = prefix ? `${prefix}/${entry}` : entry
    if (statSync(full).isDirectory()) {
      out.push(...listFiles(full, rel))
    } else if (entry.endsWith('.ts') || entry.endsWith('.json')) {
      out.push({ rel, full })
    }
  }
  return out
}

// Также подтягиваем _shared если функция использует
const sharedDir = join(ROOT, 'supabase/functions/_shared')
let sharedFiles = []
try {
  if (statSync(sharedDir).isDirectory()) {
    // Простая эвристика: смотрим импорты из _shared в файлах функции
    const fnFiles = listFiles(fnDir)
    const usesShared = fnFiles.some((f) =>
      readFileSync(f.full, 'utf8').includes("from '../_shared/"),
    )
    if (usesShared) {
      sharedFiles = listFiles(sharedDir).map((f) => ({
        rel: `../_shared/${f.rel}`,
        full: f.full,
      }))
    }
  }
} catch {}

const allFiles = [...listFiles(fnDir), ...sharedFiles]

console.log(`Deploying ${slug} to ${REF} (${allFiles.length} files)...`)

const fd = new FormData()
fd.append(
  'metadata',
  new Blob(
    [
      JSON.stringify({
        name: slug,
        verify_jwt: !noVerifyJwt,
        entrypoint_path: 'index.ts',
      }),
    ],
    { type: 'application/json' },
  ),
)
for (const f of allFiles) {
  const content = readFileSync(f.full)
  // path в FormData = относительный путь, который Supabase примет как файл
  fd.append('file', new Blob([content], { type: 'application/typescript' }), f.rel)
}

// Endpoint /functions/deploy?slug= — официальный способ деплоя через
// Management API. Создаёт если нет, обновляет если есть.
const endpoint = `https://api.supabase.com/v1/projects/${REF}/functions/deploy?slug=${slug}`
const res = await fetch(endpoint, {
  method: 'POST',
  headers: { Authorization: `Bearer ${TOKEN}` },
  body: fd,
})
const text = await res.text()
if (!res.ok) {
  console.error(`HTTP ${res.status}: ${text}`)
  process.exit(1)
}
console.log(`✓ Deployed: ${text.slice(0, 200)}`)
