// Quick: dump a bug_report row by short_id from prod to inspect attachments.
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

const url = env.VITE_SUPABASE_URL
const key = env.SUPABASE_SERVICE_ROLE_KEY
const shortId = process.argv[2]
if (!shortId) {
  console.error('Usage: node scripts/check-bug.mjs <short_id>')
  process.exit(1)
}

const res = await fetch(
  `${url}/rest/v1/bug_reports?id=gte.${shortId}-0000-0000-0000-000000000000&id=lte.${shortId}-ffff-ffff-ffff-ffffffffffff&select=*`,
  { headers: { apikey: key, Authorization: `Bearer ${key}` } },
)
const data = await res.json()
console.log(JSON.stringify(data, null, 2))
