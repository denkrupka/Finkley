// Генерация пары VAPID-ключей для Web Push (RFC 8292 / RFC 8291).
// Запуск: node scripts/generate-vapid.mjs
//
// Public — в env VITE_VAPID_PUBLIC_KEY (билд) И в Supabase secret VAPID_PUBLIC_KEY.
// Private — только в Supabase Edge Function secret VAPID_PRIVATE_KEY.
// Subject — в Supabase secret VAPID_SUBJECT (mailto:... или https://...).
import { generateKeyPairSync } from 'node:crypto'

const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })

const pubJwk = publicKey.export({ format: 'jwk' })
const privJwk = privateKey.export({ format: 'jwk' })

const x = Buffer.from(pubJwk.x, 'base64url')
const y = Buffer.from(pubJwk.y, 'base64url')
const pubRaw = Buffer.concat([Buffer.from([0x04]), x, y])
const privBytes = Buffer.from(privJwk.d, 'base64url')

const toB64url = (b) =>
  b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

console.log('# Скопируй в .env.local + GitHub Secrets:')
console.log('VITE_VAPID_PUBLIC_KEY=' + toB64url(pubRaw))
console.log()
console.log('# Скопируй в Supabase → Edge Functions → Secrets:')
console.log('VAPID_PUBLIC_KEY=' + toB64url(pubRaw))
console.log('VAPID_PRIVATE_KEY=' + toB64url(privBytes))
console.log('VAPID_SUBJECT=mailto:support@finkley.app')
