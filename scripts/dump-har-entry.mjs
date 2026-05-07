// Дамп всех headers + body конкретного entry из HAR.
// Usage: node scripts/dump-har-entry.mjs <har> <url-substring>
import { readFileSync } from 'node:fs'

const [, , path, urlSub] = process.argv
if (!path || !urlSub) {
  console.error('Usage: node scripts/dump-har-entry.mjs <har> <url-substring>')
  process.exit(1)
}

const har = JSON.parse(readFileSync(path, 'utf8'))
const entries = har.log?.entries ?? []

const matches = entries.filter((e) => e.request.url.includes(urlSub))
console.log(`Found ${matches.length} entries matching "${urlSub}"`)
console.log('---')

for (const e of matches.slice(0, 3)) {
  console.log(`\n### ${e.request.method} ${e.request.url}`)
  console.log(`Status: ${e.response.status}`)
  console.log('\nRequest headers:')
  for (const h of e.request.headers ?? []) {
    const v = h.value.length > 250 ? h.value.slice(0, 250) + '…' : h.value
    console.log(`  ${h.name}: ${v}`)
  }
  if (e.request.postData?.text) {
    console.log(`\nRequest body (${e.request.postData.mimeType}):`)
    const t = e.request.postData.text
    console.log('  ' + (t.length > 1500 ? t.slice(0, 1500) + '…' : t))
  }
  console.log('\nResponse headers:')
  for (const h of e.response.headers ?? []) {
    const v = h.value.length > 250 ? h.value.slice(0, 250) + '…' : h.value
    console.log(`  ${h.name}: ${v}`)
  }
  const body = e.response.content?.text ?? ''
  if (body) {
    console.log(`\nResponse body (${e.response.content.mimeType}, ${body.length} chars):`)
    console.log('  ' + (body.length > 2000 ? body.slice(0, 2000) + '…' : body))
  }
}
