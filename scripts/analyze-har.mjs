// Анализ HAR-файла из браузерных DevTools.
// Достаёт: список hosts, POST-запросы (особенно auth), Set-Cookie headers,
// Authorization headers и относящиеся к ним endpoints.

import { readFileSync } from 'node:fs'

const path = process.argv[2]
if (!path) {
  console.error('Usage: node scripts/analyze-har.mjs <path-to-har>')
  process.exit(1)
}

const har = JSON.parse(readFileSync(path, 'utf8'))
const entries = har.log?.entries ?? []

console.log(`Total entries: ${entries.length}`)

// 1. Hosts overview
const hosts = new Map()
for (const e of entries) {
  try {
    const url = new URL(e.request.url)
    hosts.set(url.host, (hosts.get(url.host) ?? 0) + 1)
  } catch {}
}
console.log('\n=== Hosts ===')
for (const [host, count] of [...hosts.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`${count.toString().padStart(4)}  ${host}`)
}

// 2. POST requests
const posts = entries.filter((e) => e.request.method === 'POST')
console.log(`\n=== POST requests: ${posts.length} ===`)
for (const e of posts.slice(0, 80)) {
  const url = e.request.url.length > 120 ? e.request.url.slice(0, 120) + '…' : e.request.url
  console.log(`[${e.response.status}] ${url}`)
}

// 3. Auth-related endpoints (login/token/session/csrf/auth/oauth)
const authPatterns = /(login|token|session|csrf|auth|oauth|signin|signup|register|me\b)/i
const authEntries = entries.filter((e) => authPatterns.test(e.request.url))
console.log(`\n=== Auth-related (${authEntries.length}) ===`)
for (const e of authEntries.slice(0, 60)) {
  const url = e.request.url.length > 140 ? e.request.url.slice(0, 140) + '…' : e.request.url
  console.log(`${e.request.method.padEnd(5)} [${e.response.status}] ${url}`)
}

// 4. Anatomy первого login-запроса (если есть)
const loginEntry = entries.find(
  (e) => /login/i.test(e.request.url) && e.request.method === 'POST',
)
if (loginEntry) {
  console.log('\n=== First login POST anatomy ===')
  console.log('URL:', loginEntry.request.url)
  console.log('Status:', loginEntry.response.status)
  console.log('Request headers:')
  for (const h of loginEntry.request.headers ?? []) {
    if (/^(content-type|accept|origin|referer|user-agent|x-|cookie|authorization)/i.test(h.name)) {
      const v = h.value.length > 200 ? h.value.slice(0, 200) + '…' : h.value
      console.log(`  ${h.name}: ${v}`)
    }
  }
  if (loginEntry.request.postData) {
    const text = loginEntry.request.postData.text ?? ''
    console.log(
      `Request body (${loginEntry.request.postData.mimeType}, ${text.length} chars):`,
    )
    console.log('  ' + (text.length > 1000 ? text.slice(0, 1000) + '…' : text))
  }
  console.log('Response headers:')
  for (const h of loginEntry.response.headers ?? []) {
    if (/^(set-cookie|content-type|location|x-)/i.test(h.name)) {
      const v = h.value.length > 200 ? h.value.slice(0, 200) + '…' : h.value
      console.log(`  ${h.name}: ${v}`)
    }
  }
  const respText = loginEntry.response.content?.text ?? ''
  if (respText) {
    console.log(
      `Response body (${loginEntry.response.content.mimeType}, ${respText.length} chars):`,
    )
    console.log('  ' + (respText.length > 1500 ? respText.slice(0, 1500) + '…' : respText))
  }
}

// 5. Все Authorization headers (типы токенов)
const authHeaders = new Set()
for (const e of entries) {
  for (const h of e.request.headers ?? []) {
    if (h.name.toLowerCase() === 'authorization') {
      const prefix = h.value.split(' ')[0] ?? ''
      authHeaders.add(prefix)
    }
  }
}
console.log(`\n=== Authorization-header schemes seen: ${[...authHeaders].join(', ') || 'none'}`)

// 6. Все Set-Cookie names (что-то sets для определения session-cookie)
const cookieNames = new Map()
for (const e of entries) {
  for (const h of e.response.headers ?? []) {
    if (h.name.toLowerCase() === 'set-cookie') {
      const name = h.value.split('=')[0]?.trim()
      if (name) cookieNames.set(name, (cookieNames.get(name) ?? 0) + 1)
    }
  }
}
console.log('\n=== Cookies set by responses ===')
for (const [name, count] of [...cookieNames.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20)) {
  console.log(`  ${count.toString().padStart(4)}  ${name}`)
}
