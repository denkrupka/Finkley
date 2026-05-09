// Загрузить секрет из файла на диске в Supabase Function Secrets (staging+prod).
// Удобно для PEM-ключей, чтобы не копи-пастить multi-line через терминал.
//
// Usage:
//   node scripts/set-secret-from-file.mjs ENABLE_BANKING_PRIVATE_KEY "C:\path\to\file.pem"
import { readFileSync } from 'node:fs'
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
if (!TOKEN) throw new Error('SUPABASE_ACCESS_TOKEN missing')

const NAME = process.argv[2]
const PATH = process.argv[3]
if (!NAME || !PATH) {
  console.error('Usage: node scripts/set-secret-from-file.mjs <NAME> <path-to-file>')
  process.exit(1)
}

const VALUE = readFileSync(PATH, 'utf8')
console.log(`Read ${VALUE.length} chars from ${PATH}`)

const targets = [
  { label: 'staging', urlVar: 'VITE_SUPABASE_URL_TEST' },
  { label: 'prod', urlVar: 'VITE_SUPABASE_URL' },
]

for (const t of targets) {
  const url = env[t.urlVar] ?? ''
  const ref = url.match(/https:\/\/([a-z0-9]+)\.supabase\.co/)?.[1]
  if (!ref) {
    console.error(`[${t.label}] cannot resolve ref from ${t.urlVar}`)
    process.exit(1)
  }
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/secrets`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify([{ name: NAME, value: VALUE }]),
  })
  const text = await res.text()
  if (!res.ok) {
    console.error(`[${t.label}] HTTP ${res.status}: ${text}`)
    process.exit(1)
  }
  console.log(`[${t.label}] ✓ ${NAME} set on ${ref} (${VALUE.length} chars)`)
}
