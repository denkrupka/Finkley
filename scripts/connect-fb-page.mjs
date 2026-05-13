/**
 * One-shot скрипт: подключает Facebook Page к мессенджеру FinSalon.
 *
 * Шаги:
 *   1. GET /me?access_token=...  → page_id + page_name (валидация токена)
 *   2. POST /{page_id}/subscribed_apps?subscribed_fields=messages,messaging_postbacks
 *      → подписка страницы на webhook нашего App
 *   3. Encrypt token через MESSENGER_SECRETS_KEY (AES-256-GCM)
 *   4. Upsert messenger_integrations для owner-salon, channel=facebook,
 *      status=connected.
 *
 * Использование:
 *   node scripts/connect-fb-page.mjs <PAGE_ACCESS_TOKEN>
 *
 * Env (читает из apps/web/.env.local):
 *   VITE_SUPABASE_URL — prod URL
 *   SUPABASE_SERVICE_ROLE_KEY — service role
 *   MESSENGER_SECRETS_KEY — 32 байта base64 (то же что в edge functions)
 *
 * Скрипт НЕ логирует токен — только page_id, page_name, и результаты вызовов.
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

// Резолвим @supabase/supabase-js из apps/web/node_modules — пакет
// устанавливается в воркспейс, а не в root.
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

const TOKEN = process.argv[2]
if (!TOKEN || TOKEN.length < 30) {
  console.error('usage: node scripts/connect-fb-page.mjs <PAGE_ACCESS_TOKEN>')
  process.exit(2)
}

const SUPABASE_URL = process.env.VITE_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const SECRETS_KEY_B64 = process.env.MESSENGER_SECRETS_KEY

if (!SUPABASE_URL || !SERVICE_KEY || !SECRETS_KEY_B64) {
  console.error('missing env: VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / MESSENGER_SECRETS_KEY')
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
  // WebCrypto (Deno) ожидает iv ‖ (ciphertext ‖ tag)
  return Buffer.concat([iv, ct, tag]).toString('base64')
}

async function fbGet(path) {
  const url = `https://graph.facebook.com/v21.0/${path}${path.includes('?') ? '&' : '?'}access_token=${encodeURIComponent(TOKEN)}`
  const r = await fetch(url)
  const text = await r.text()
  let json
  try {
    json = JSON.parse(text)
  } catch {
    throw new Error(`fb get ${path} → non-JSON: ${text.slice(0, 200)}`)
  }
  if (!r.ok || json.error) {
    throw new Error(`fb get ${path} → ${r.status}: ${JSON.stringify(json.error ?? json)}`)
  }
  return json
}

async function fbPost(path, body = {}) {
  const url = `https://graph.facebook.com/v21.0/${path}?access_token=${encodeURIComponent(TOKEN)}`
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const text = await r.text()
  let json
  try {
    json = JSON.parse(text)
  } catch {
    throw new Error(`fb post ${path} → non-JSON: ${text.slice(0, 200)}`)
  }
  if (!r.ok || json.error) {
    throw new Error(`fb post ${path} → ${r.status}: ${JSON.stringify(json.error ?? json)}`)
  }
  return json
}

async function main() {
  console.log('▶ Inspecting token via /debug_token ...')
  // /debug_token не требует pages_read_engagement и работает с любым page token.
  // Возвращает profile_id = page_id, scopes, app_id, expiry.
  const dbgUrl = `https://graph.facebook.com/v21.0/debug_token?input_token=${encodeURIComponent(TOKEN)}&access_token=${encodeURIComponent(TOKEN)}`
  const dbgResp = await fetch(dbgUrl)
  const dbgJson = await dbgResp.json()
  if (!dbgJson.data?.is_valid) {
    throw new Error(`token invalid: ${JSON.stringify(dbgJson)}`)
  }
  const me = {
    id: String(dbgJson.data.profile_id),
    name: `FB Page ${String(dbgJson.data.profile_id).slice(-6)}`,
    scopes: dbgJson.data.scopes ?? [],
    app_id: dbgJson.data.app_id,
    expires_at: dbgJson.data.expires_at,
  }
  console.log(
    `✓ Token valid: page_id=${me.id} app_id=${me.app_id} scopes=[${me.scopes.join(',')}] expires_at=${
      me.expires_at === 0 ? 'never' : new Date(me.expires_at * 1000).toISOString()
    }`,
  )

  // Попытаемся подтянуть имя страницы (нужен pages_read_engagement или public access).
  try {
    const nameResp = await fbGet(`${me.id}?fields=name`)
    if (nameResp.name) {
      me.name = nameResp.name
      console.log(`  Page name: "${me.name}"`)
    }
  } catch {
    console.log(`  (имя страницы недоступно — токен без pages_read_engagement, используем "${me.name}")`)
  }

  console.log('▶ Subscribing page to app webhook ...')
  const sub = await fbPost(`${me.id}/subscribed_apps`, {
    subscribed_fields: 'messages,messaging_postbacks,messaging_optins,message_deliveries,message_reads',
  })
  console.log(`✓ Subscribed: ${JSON.stringify(sub)}`)

  // Подтверждаем что подписка применилась
  try {
    const check = await fbGet(`${me.id}/subscribed_apps`)
    console.log(`  Current subscribed_apps: ${JSON.stringify(check.data ?? check)}`)
  } catch (e) {
    console.log(`  (verify subscription failed: ${e.message})`)
  }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  // Owner UID из памяти / .env_local
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
      channel: 'facebook',
      external_account_id: me.id,
      display_name: me.name,
      status: 'connected',
      credentials: { page_access_enc: encrypted, page_id: me.id },
      webhook_secret: null,
      last_error: null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'salon_id,channel' },
  )
  if (e2) throw e2

  console.log('')
  console.log('═══════════════════════════════════════════════════════')
  console.log('  ✓ Facebook Page подключена к FinSalon')
  console.log(`  Page:  ${me.name} (${me.id})`)
  console.log(`  Salon: ${salon.salons?.name ?? salonId}`)
  console.log('  Status: connected · webhook subscribed')
  console.log('═══════════════════════════════════════════════════════')
  console.log('Дальше: напишите в FB Messenger вашей странице с другого')
  console.log('аккаунта — сообщение должно появиться в /messenger.')
}

main().catch((e) => {
  console.error('✗ FAILED:', e.message)
  process.exit(1)
})
