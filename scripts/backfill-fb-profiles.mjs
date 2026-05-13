/**
 * Бэкфил display_name + avatar_url для существующих FB-conversations,
 * у которых display_name остался дефолтным `User XXXXXX` из-за того, что
 * webhook не смог подтянуть профиль (раньше fetch падал на ?fields=name).
 *
 * Использование:
 *   node scripts/backfill-fb-profiles.mjs <PAGE_ACCESS_TOKEN>
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const envPath = path.join(__dirname, '..', 'apps', 'web', '.env.local')
for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
  const m = line.replace(/\r$/, '').match(/^([A-Z0-9_]+)=(.*)$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
}

const TOKEN = process.argv[2]
if (!TOKEN) {
  console.error('usage: node scripts/backfill-fb-profiles.mjs <PAGE_ACCESS_TOKEN>')
  process.exit(2)
}

const SB_URL = process.env.VITE_SUPABASE_URL
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const head = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json' }

const qs = new URLSearchParams()
qs.set('select', 'id,external_user_id,display_name')
qs.set('channel', 'eq.facebook')
qs.set('display_name', 'like.User *')
const listUrl = `${SB_URL}/rest/v1/messenger_conversations?${qs.toString()}`
const r = await fetch(listUrl, { headers: head })
if (!r.ok) {
  console.error('list failed:', r.status, await r.text())
  process.exit(1)
}
const convos = await r.json()
console.log(`▶ FB conversations needing backfill: ${convos.length}`)

for (const c of convos) {
  const u = new URL(`https://graph.facebook.com/v21.0/${c.external_user_id}`)
  u.searchParams.set('fields', 'first_name,last_name,profile_pic')
  u.searchParams.set('access_token', TOKEN)
  const r2 = await fetch(u.toString())
  const j = await r2.json()
  if (j.error) {
    console.log(`  ✗ ${c.external_user_id}: ${j.error.message}`)
    continue
  }
  const name = [j.first_name, j.last_name].filter(Boolean).join(' ').trim()
  if (!name && !j.profile_pic) {
    console.log(`  – ${c.external_user_id}: empty`)
    continue
  }
  const upd = {}
  if (name) upd.display_name = name
  if (j.profile_pic) upd.avatar_url = j.profile_pic
  const ur = await fetch(`${SB_URL}/rest/v1/messenger_conversations?id=eq.${c.id}`, {
    method: 'PATCH',
    headers: head,
    body: JSON.stringify(upd),
  })
  console.log(
    `  ${ur.ok ? '✓' : '✗'} ${c.external_user_id} → ${name || '(no name)'}${j.profile_pic ? ' [avatar]' : ''}`,
  )
}
console.log('▶ done')
