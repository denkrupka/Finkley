/**
 * capsolver-host-test.mjs — проверяет, принимает ли Treatwell Capsolver-токен
 * с ЭТОГО хоста (IP/TLS). Локально (обычная Node-машина) токен принимается
 * (ответ NOT_RECOGNISED на фейковый email = капча пройдена). На Supabase Edge
 * тот же токен отвергался (NOT_VERIFIED_CAPTCHA — IP/TLS Supabase режется
 * Cloudflare). Этот тест отвечает: годится ли GitHub Actions как бесплатный
 * хост для логина Treatwell.
 *
 * Интерпретация ответа /api/authentication.json (dummy creds):
 *   NOT_RECOGNISED / NOT_AUTHENTICATED → ✅ капча ПРОЙДЕНА (логин просто неверный)
 *   NOT_VERIFIED_CAPTCHA               → ❌ хост режется Cloudflare
 *   ACCOUNT/PROFILE_AUTHENTICATED      → ✅ (если переданы реальные creds)
 *
 * Env: CAPSOLVER_API_KEY (обяз.), TREATWELL_LOGIN/PASSWORD (опц.)
 */
const KEY = process.env.CAPSOLVER_API_KEY
const BASE = process.env.TREATWELL_BASE || 'https://connect.treatwell.de'
const SITEKEY = '0x4AAAAAABgnyMs1otzyQX5B' // .de из бандла connect-app
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'
const LOGIN = process.env.TREATWELL_LOGIN || 'finsalon-probe-not-real@example.com'
const PASSWORD = process.env.TREATWELL_PASSWORD || 'definitely-wrong-9X7q'
const DUMMY = !process.env.TREATWELL_LOGIN

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
function extractCookies(sc) {
  if (!sc) return ''
  return sc
    .split(/,(?=\s*[A-Za-z0-9_-]+=)/)
    .map((c) => c.split(';')[0].trim())
    .filter(Boolean)
    .join('; ')
}

if (!KEY) {
  console.error('FATAL: CAPSOLVER_API_KEY не задан')
  process.exit(2)
}

async function solve() {
  const cr = await fetch('https://api.capsolver.com/createTask', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      clientKey: KEY,
      task: { type: 'AntiTurnstileTaskProxyLess', websiteURL: `${BASE}/login`, websiteKey: SITEKEY },
    }),
  })
  const cj = await cr.json()
  if (cj.errorId || !cj.taskId) throw new Error('createTask: ' + JSON.stringify(cj))
  for (let i = 0; i < 30; i++) {
    await sleep(3000)
    const r = await fetch('https://api.capsolver.com/getTaskResult', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ clientKey: KEY, taskId: cj.taskId }),
    })
    const j = await r.json()
    if (j.errorId) throw new Error('getTaskResult: ' + JSON.stringify(j))
    if (j.status === 'ready') return { token: j.solution?.token, ua: j.solution?.userAgent }
  }
  throw new Error('capsolver timeout')
}

const { token, ua } = await solve()
console.log('[host-test] режим:', DUMMY ? 'dummy creds' : 'реальные creds')
console.log('[host-test] capsolver token len:', token?.length, '| solution.userAgent:', ua ?? '(none)')

let cookies = ''
try {
  const p = await fetch(`${BASE}/login`, { headers: { accept: 'text/html', 'user-agent': ua || UA } })
  cookies = extractCookies(p.headers.get('set-cookie'))
  await p.text()
} catch {}

const r = await fetch(`${BASE}/api/authentication.json`, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    accept: 'application/json, text/plain, */*',
    'x-requested-with': 'XMLHttpRequest',
    origin: BASE,
    referer: `${BASE}/login`,
    'user-agent': ua || UA,
    ...(cookies ? { cookie: cookies } : {}),
  },
  body: JSON.stringify({ user: LOGIN, password: PASSWORD, persistentLogin: true, turnstileToken: token }),
})
const txt = await r.text()
console.log(`[host-test] HTTP ${r.status} → ${txt.slice(0, 250)}`)

console.log('\n===== ВЕРДИКТ =====')
if (/NOT_VERIFIED_CAPTCHA/i.test(txt)) {
  console.log('❌ NOT_VERIFIED_CAPTCHA — этот хост режется Cloudflare (как Supabase). Нужен другой хост.')
  process.exit(1)
}
if (/ACCOUNT_AUTHENTICATED|PROFILE_AUTHENTICATED/i.test(txt)) {
  console.log('✅✅ ПОЛНЫЙ ВХОД — капча пройдена И creds верны. Этот хост годится.')
  process.exit(0)
}
if (/NOT_RECOGNISED|NOT_AUTHENTICATED|invalidCredentials/i.test(txt)) {
  console.log('✅ КАПЧА ПРОЙДЕНА с этого хоста (логин неверный — это ок для dummy).')
  console.log('   → GitHub Actions годится как бесплатный хост для логина Treatwell.')
  process.exit(0)
}
console.log('❓ Непонятный ответ — см. выше. Возможно изменилась форма/код.')
process.exit(1)
