// Dump open bug_reports from prod (newest first) for triage.
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

const res = await fetch(
  `${url}/rest/v1/bug_reports?status=eq.open&order=reported_at.desc&select=id,kind,severity,area,sender_first_name,reported_at,message_text,ai_summary,ai_steps_to_repro,attachments,notes`,
  { headers: { apikey: key, Authorization: `Bearer ${key}` } },
)
const data = await res.json()
console.log(JSON.stringify(data, null, 2))
