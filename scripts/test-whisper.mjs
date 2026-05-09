// Pull the actual OGG from bug-attachments storage and try to transcribe.
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
const groqKey = process.argv[2]
const storagePath = process.argv[3]
if (!groqKey || !storagePath) {
  console.error('Usage: node scripts/test-whisper.mjs <groq_key> <storage_path>')
  process.exit(1)
}

// Download from storage
const dl = await fetch(`${url}/storage/v1/object/bug-attachments/${encodeURI(storagePath)}`, {
  headers: { apikey: key, Authorization: `Bearer ${key}` },
})
if (!dl.ok) {
  console.error('storage download failed', dl.status, await dl.text())
  process.exit(1)
}
const bytes = new Uint8Array(await dl.arrayBuffer())
console.log(`downloaded ${bytes.length} bytes, content-type: ${dl.headers.get('content-type')}`)

// Send to Groq Whisper
const form = new FormData()
form.append('file', new Blob([bytes], { type: 'audio/ogg' }), 'voice.oga')
form.append('model', 'whisper-large-v3-turbo')
form.append('response_format', 'text')
form.append('language', 'ru')

const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
  method: 'POST',
  headers: { authorization: `Bearer ${groqKey}` },
  body: form,
})
console.log('status:', res.status)
const text = await res.text()
console.log('response:', text)
