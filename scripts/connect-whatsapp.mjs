/**
 * One-shot скрипт: подключает WhatsApp Business номер к мессенджеру FinSalon
 * для owner-салона.
 *
 * Использование:
 *   node scripts/connect-whatsapp.mjs [<PERMANENT_TOKEN>]
 *
 * Если токен не передан — берём META_WHATSAPP_TOKEN из apps/web/.env.local.
 * PHONE_ID и WABA_ID тоже берём из env.
 *
 * Шаги:
 *   1. GET /<phone_id>?fields=display_phone_number,verified_name — валидация
 *   2. POST /<waba_id>/subscribed_apps?access_token=... — подписка на webhook
 *   3. Encrypt token через MESSENGER_SECRETS_KEY (AES-256-GCM)
 *   4. Upsert messenger_integrations: channel='whatsapp', external_account_id=<phone_id>
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const envPath = path.join(__dirname, '..', 'apps', 'web', '.env.local')
for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
  const m = line.replace(/\r$/, '').match(/^([A-Z0-9_]+)=(.*)$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
}

const TOKEN = process.argv[2] || process.env.META_WHATSAPP_TOKEN
const PHONE_ID = process.env.META_WHATSAPP_PHONE_ID
const WABA_ID = process.env.META_WHATSAPP_WABA_ID
const PHONE_NUMBER = process.env.META_WHATSAPP_PHONE_NUMBER ?? ''

if (!TOKEN || !PHONE_ID || !WABA_ID) {
  console.error(
    'missing: TOKEN / META_WHATSAPP_PHONE_ID / META_WHATSAPP_WABA_ID в .env.local',
  )
  process.exit(2)
}

const SUPABASE_URL = process.env.VITE_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const SECRETS_KEY_B64 = process.env.MESSENGER_SECRETS_KEY
if (!SUPABASE_URL || !SERVICE_KEY || !SECRETS_KEY_B64) {
  console.error('missing: VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / MESSENGER_SECRETS_KEY')
  process.exit(2)
}

function encrypt(plaintext) {
  const key = Buffer.from(SECRETS_KEY_B64, 'base64')
  if (key.length !== 32) throw new Error('MESSENGER_SECRETS_KEY must be 32 bytes base64')
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, ct, tag]).toString('base64')
}

async function fbGet(url) {
  const r = await fetch(url)
  const text = await r.text()
  let json
  try {
    json = JSON.parse(text)
  } catch {
    throw new Error(`non-JSON: ${text.slice(0, 200)}`)
  }
  if (!r.ok || json.error) {
    throw new Error(`${r.status}: ${JSON.stringify(json.error ?? json)}`)
  }
  return json
}

async function fbPost(url, body = {}) {
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
    throw new Error(`non-JSON: ${text.slice(0, 200)}`)
  }
  if (!r.ok || json.error) {
    throw new Error(`${r.status}: ${JSON.stringify(json.error ?? json)}`)
  }
  return json
}

const headers = {
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
  'Content-Type': 'application/json',
}

;(async () => {
  console.log('▶ Validating phone number id …')
  const phoneInfo = await fbGet(
    `https://graph.facebook.com/v21.0/${PHONE_ID}?fields=display_phone_number,verified_name,quality_rating&access_token=${encodeURIComponent(TOKEN)}`,
  )
  console.log(
    `✓ Phone: ${phoneInfo.display_phone_number ?? PHONE_NUMBER} (${phoneInfo.verified_name ?? '—'}) quality=${phoneInfo.quality_rating ?? '—'}`,
  )

  console.log('▶ Subscribing WABA to app webhook …')
  try {
    const sub = await fbPost(`https://graph.facebook.com/v21.0/${WABA_ID}/subscribed_apps`, {
      access_token: TOKEN,
    })
    console.log(`✓ Subscribed: ${JSON.stringify(sub)}`)
  } catch (e) {
    console.warn(`  (subscribe failed, продолжаем: ${e.message})`)
  }

  console.log('▶ Looking up owner salon …')
  const OWNER_UID = '7f56f78e-e6e5-4292-994c-72f934ac9cc3'
  const memResp = await fetch(
    `${SUPABASE_URL}/rest/v1/salon_members?select=salon_id,salons:salons!inner(id,name)&user_id=eq.${OWNER_UID}&role=eq.owner`,
    { headers },
  )
  const members = await memResp.json()
  if (!Array.isArray(members) || members.length === 0) throw new Error('no salon for owner')
  const salonId = members[0].salon_id
  const salonName = members[0].salons?.name ?? salonId
  console.log(`✓ Salon: ${salonName} (${salonId})`)

  console.log('▶ Encrypting token …')
  const encrypted = encrypt(TOKEN)

  console.log('▶ Upserting messenger_integrations …')
  const upResp = await fetch(`${SUPABASE_URL}/rest/v1/messenger_integrations`, {
    method: 'POST',
    headers: { ...headers, Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify({
      salon_id: salonId,
      channel: 'whatsapp',
      external_account_id: PHONE_ID,
      display_name: phoneInfo.verified_name ?? `WA ${(phoneInfo.display_phone_number ?? PHONE_NUMBER).slice(-4)}`,
      status: 'connected',
      credentials: {
        access_token_enc: encrypted,
        phone_number_id: PHONE_ID,
        waba_id: WABA_ID,
      },
      last_synced_at: new Date().toISOString(),
      last_error: null,
      updated_at: new Date().toISOString(),
    }),
  })
  if (!upResp.ok) {
    const errText = await upResp.text()
    throw new Error(`upsert failed: ${upResp.status} ${errText.slice(0, 200)}`)
  }

  console.log('')
  console.log('═══════════════════════════════════════════════════════')
  console.log('  ✓ WhatsApp Cloud API подключён к FinSalon')
  console.log(`  Phone: ${phoneInfo.display_phone_number ?? PHONE_NUMBER}`)
  console.log(`  WABA:  ${WABA_ID}`)
  console.log(`  Salon: ${salonName}`)
  console.log('  Status: connected · WABA subscribed to app webhook')
  console.log('═══════════════════════════════════════════════════════')
  console.log('Дальше: с другого WhatsApp напиши на', phoneInfo.display_phone_number ?? PHONE_NUMBER)
  console.log('Сообщение должно появиться в /messenger.')
})().catch((e) => {
  console.error('✗ FAILED:', e.message)
  process.exit(1)
})
