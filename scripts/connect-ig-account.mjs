/**
 * One-shot скрипт: подключает Instagram Business аккаунт (flow B — Instagram
 * Login API) к мессенджеру FinSalon для owner-салона.
 *
 * Использование:
 *   node scripts/connect-ig-account.mjs [<IG_LONG_LIVED_TOKEN>]
 *
 * Если токен не передан — берём TEST_IG_ALIKOWA_TOKEN из apps/web/.env.local.
 *
 * Шаги:
 *   1. GET /me?fields=user_id,username,name → IG user_id, имя
 *   2. POST /<user_id>/subscribed_apps?subscribed_fields=messages,messaging_postbacks
 *      → подписка на webhook нашего App
 *   3. Encrypt token через MESSENGER_SECRETS_KEY (AES-256-GCM)
 *   4. Upsert messenger_integrations: salon_id=<owner>, channel='instagram',
 *      external_account_id=<ig_user_id>, credentials.ig_access_enc=<encrypted>
 *
 * Env (apps/web/.env.local):
 *   VITE_SUPABASE_URL                  — prod URL
 *   SUPABASE_SERVICE_ROLE_KEY          — service role
 *   MESSENGER_SECRETS_KEY              — 32 байта base64 (Supabase secrets too)
 *   TEST_IG_ALIKOWA_TOKEN              — fallback токен если аргумент не передан
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const __dirname0 = path.dirname(fileURLToPath(import.meta.url))
const requireFromWeb = createRequire(path.join(__dirname0, '..', 'apps', 'web', 'package.json'))
const { createClient } = requireFromWeb('@supabase/supabase-js')

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const envPath = path.join(__dirname, '..', 'apps', 'web', '.env.local')
const envContent = fs.readFileSync(envPath, 'utf8')
for (const rawLine of envContent.split(/\r?\n/)) {
  const line = rawLine.replace(/\r$/, '')
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m && !process.env[m[1]]) {
    let v = m[2]
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1)
    process.env[m[1]] = v
  }
}

const TOKEN = process.argv[2] || process.env.TEST_IG_ALIKOWA_TOKEN
if (!TOKEN || TOKEN.length < 30) {
  console.error(
    'usage: node scripts/connect-ig-account.mjs [<TOKEN>]  (или установи TEST_IG_ALIKOWA_TOKEN в .env.local)',
  )
  process.exit(2)
}

const SUPABASE_URL = process.env.VITE_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const SECRETS_KEY_B64 = process.env.MESSENGER_SECRETS_KEY

if (!SUPABASE_URL || !SERVICE_KEY || !SECRETS_KEY_B64) {
  console.error(
    'missing env: VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / MESSENGER_SECRETS_KEY',
  )
  process.exit(2)
}

function encrypt(plaintext) {
  const key = Buffer.from(SECRETS_KEY_B64, 'base64')
  if (key.length !== 32) {
    throw new Error(`MESSENGER_SECRETS_KEY must decode to 32 bytes (got ${key.length})`)
  }
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, ct, tag]).toString('base64')
}

async function igGet(url) {
  const r = await fetch(url)
  const text = await r.text()
  let json
  try {
    json = JSON.parse(text)
  } catch {
    throw new Error(`IG GET → non-JSON: ${text.slice(0, 200)}`)
  }
  if (!r.ok || json.error) {
    throw new Error(`IG GET → ${r.status}: ${JSON.stringify(json.error ?? json)}`)
  }
  return json
}

async function igPost(url, body) {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(),
  })
  const text = await r.text()
  let json
  try {
    json = JSON.parse(text)
  } catch {
    throw new Error(`IG POST → non-JSON: ${text.slice(0, 200)}`)
  }
  if (!r.ok || json.error) {
    throw new Error(`IG POST → ${r.status}: ${JSON.stringify(json.error ?? json)}`)
  }
  return json
}

async function main() {
  console.log('▶ Fetching IG profile (/me) ...')
  const me = await igGet(
    `https://graph.instagram.com/v21.0/me?fields=user_id,username,name&access_token=${encodeURIComponent(TOKEN)}`,
  )
  // /me у Instagram Login API возвращает `user_id` отдельно от `id`. На всякий
  // случай берём оба.
  const userId = String(me.user_id ?? me.id ?? '')
  if (!userId) throw new Error(`no user_id in /me response: ${JSON.stringify(me)}`)
  const username = me.username ?? ''
  const name = me.name ?? username ?? `IG ${userId.slice(-6)}`
  console.log(`✓ IG profile: id=${userId} username=${username} name=${name}`)

  console.log('▶ Subscribing app to messages webhook ...')
  try {
    const sub = await igPost(`https://graph.instagram.com/v21.0/${userId}/subscribed_apps`, {
      subscribed_fields: 'messages,messaging_postbacks',
      access_token: TOKEN,
    })
    console.log(`✓ Subscribed: ${JSON.stringify(sub)}`)
  } catch (e) {
    console.warn(`  (subscribe failed, продолжаем: ${e.message})`)
  }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const OWNER_UID = '7f56f78e-e6e5-4292-994c-72f934ac9cc3'
  console.log(`▶ Looking up salon for owner ${OWNER_UID} ...`)
  const { data: members, error: e1 } = await admin
    .from('salon_members')
    .select('salon_id, role, salons:salons!inner(id, name)')
    .eq('user_id', OWNER_UID)
    .eq('role', 'owner')
  if (e1) throw e1
  if (!members || members.length === 0) throw new Error('no salon found for owner')
  const salon = members[0]
  const salonId = salon.salon_id
  console.log(`✓ Salon: id=${salonId} name="${salon.salons?.name ?? '—'}"`)

  console.log('▶ Encrypting token ...')
  const encrypted = encrypt(TOKEN)
  console.log(`  encrypted payload length: ${encrypted.length} chars`)

  console.log('▶ Upserting messenger_integrations ...')
  const { error: e2 } = await admin.from('messenger_integrations').upsert(
    {
      salon_id: salonId,
      channel: 'instagram',
      external_account_id: userId,
      display_name: name,
      status: 'connected',
      credentials: { ig_access_enc: encrypted, ig_user_id: userId, flow: 'instagram_login' },
      webhook_secret: null,
      last_error: null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'salon_id,channel' },
  )
  if (e2) throw e2

  console.log('')
  console.log('═══════════════════════════════════════════════════════')
  console.log('  ✓ Instagram-аккаунт подключён к FinSalon (flow B)')
  console.log(`  IG user: ${name} (${userId})`)
  console.log(`  Salon:   ${salon.salons?.name ?? salonId}`)
  console.log('  Status:  connected · webhook subscribed')
  console.log('═══════════════════════════════════════════════════════')
  console.log('Дальше: напиши в IG DM этому аккаунту с другого аккаунта — ')
  console.log('сообщение должно появиться в /messenger.')
}

main().catch((e) => {
  console.error('✗ FAILED:', e.message)
  process.exit(1)
})
