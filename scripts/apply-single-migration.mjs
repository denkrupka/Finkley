// One-shot: apply a single SQL file via Management API to staging + prod,
// bypassing the migrations bookkeeping (use when you have a hot fix and the
// main migration runner is blocked on an unrelated failure).
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')

const raw = readFileSync(join(ROOT, 'apps/web/.env.local'), 'utf8')
const env = {}
for (const line of raw.split(/\r?\n/)) {
  const m = line.match(/^([A-Z_]+)=(.*)$/)
  if (m) env[m[1]] = m[2].trim()
}

const file = process.argv[2]
if (!file) {
  console.error('Usage: node scripts/apply-single-migration.mjs <path-to-sql>')
  process.exit(1)
}
const sql = readFileSync(file, 'utf8')

const targets = [
  { label: 'staging', urlVar: 'VITE_SUPABASE_URL_TEST' },
  { label: 'prod', urlVar: 'VITE_SUPABASE_URL' },
]

for (const t of targets) {
  const url = env[t.urlVar] ?? ''
  const ref = url.match(/https:\/\/([a-z0-9]+)\.supabase\.co/)?.[1]
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ query: sql }),
  })
  const text = await res.text()
  if (!res.ok) {
    console.error(`[${t.label}] HTTP ${res.status}: ${text}`)
    process.exit(1)
  }
  console.log(`[${t.label}] ✓ applied to ${ref}`)
}
