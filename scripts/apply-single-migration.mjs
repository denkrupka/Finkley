// One-shot: apply a single SQL file via Management API to staging + prod
// AND записать в supabase_migrations.schema_migrations чтобы CI runner
// её игнорил (иначе он попытается применить ещё раз и упадёт).
//
// Используется когда нужно срочно выкатить миграцию мимо CI (например,
// pre-existing migration в очереди мешает проходить). Регулярный путь —
// commit + push, CI сам всё применит.
import { readFileSync } from 'node:fs'
import { basename, join, dirname } from 'node:path'
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

// Извлекаем version (14-digit prefix) из имени файла — это формат имён миграций
// Supabase. Если не миграция (e.g. ad-hoc cleanup в scripts/) — пропускаем
// бухгалтерию.
const fileName = basename(file)
const versionMatch = fileName.match(/^(\d{14})_(.+)\.sql$/)
const version = versionMatch?.[1]
const isMigration = !!version && file.includes('migrations')

const targets = [
  { label: 'staging', urlVar: 'VITE_SUPABASE_URL_TEST' },
  { label: 'prod', urlVar: 'VITE_SUPABASE_URL' },
]

for (const t of targets) {
  const url = env[t.urlVar] ?? ''
  const ref = url.match(/https:\/\/([a-z0-9]+)\.supabase\.co/)?.[1]
  const exec = async (query) => {
    const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ query }),
    })
    const text = await res.text()
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${text}`)
    return text
  }

  try {
    await exec(sql)
    if (isMigration) {
      // Помечаем как применённую (idempotent через ON CONFLICT)
      const escapedName = fileName.replace(/'/g, "''")
      await exec(
        `insert into supabase_migrations.schema_migrations(version, name) values ('${version}', '${escapedName}') on conflict do nothing`,
      )
      console.log(`[${t.label}] ✓ applied to ${ref} (tracked as ${version})`)
    } else {
      console.log(`[${t.label}] ✓ applied to ${ref} (ad-hoc, not tracked)`)
    }
  } catch (e) {
    console.error(`[${t.label}] ${e.message}`)
    process.exit(1)
  }
}
