/**
 * login-check.mjs — PoC проверки входа в Treatwell Connect через CloakBrowser.
 *
 * Цель: однозначно ответить на вопрос «проходит ли вход с машины GitHub
 * Actions». Текущая боевая схема (Capsolver решает Turnstile + POST с
 * датацентр-IP Supabase Edge) проваливается с `NOT_VERIFIED_CAPTCHA`, потому
 * что Cloudflare привязывает решённый токен к IP, который его решал. Реальный
 * браузер решает капчу и логинится с ОДНОГО IP — рассинхрона нет.
 *
 * Скрипт НЕ синкает данные и НЕ пишет в БД. Он только:
 *   1. открывает /login,
 *   2. вводит email+пароль,
 *   3. ждёт авто-решения Turnstile (CloakBrowser),
 *   4. сабмитит и читает ответ /api/authentication.json,
 *   5. печатает result + сохраняет скриншот для артефакта.
 *
 * Коды выхода: 0 — вошли (ACCOUNT/PROFILE_AUTHENTICATED), 1 — не вошли.
 *
 * Env:
 *   TREATWELL_LOGIN, TREATWELL_PASSWORD   — обязательны
 *   TREATWELL_BASE                        — опц., по умолч. connect.treatwell.de
 *   TREATWELL_HEADLESS                    — '1' → headless; иначе headed (под Xvfb)
 */

import { launch } from 'cloakbrowser'

const BASE = process.env.TREATWELL_BASE ?? 'https://connect.treatwell.de'
const HEADLESS = process.env.TREATWELL_HEADLESS === '1'

// ── Режим проверки ──
// Главный вопрос PoC: «проходит ли Turnstile с этой машины?» — а НЕ «верный ли
// пароль». Поэтому реальные учётки НЕ нужны: если зайти с заведомо неверным
// паролем и Treatwell ответит NOT_AUTHENTICATED (а не NOT_VERIFIED_CAPTCHA),
// значит капча ПРОЙДЕНА (просто пароль неверный) — для нас это успех.
// Секреты в GitHub добавлять не надо. Если учётки всё же переданы — проверим
// полный вход (до ACCOUNT_AUTHENTICATED).
const DUMMY = !process.env.TREATWELL_LOGIN || !process.env.TREATWELL_PASSWORD
const LOGIN = process.env.TREATWELL_LOGIN || 'finsalon-turnstile-probe@example.com'
const PASSWORD = process.env.TREATWELL_PASSWORD || 'definitely-wrong-pw-9X7q!'

const SHOT = 'treatwell-login.png'

function log(...a) {
  console.log('[tw-poc]', ...a)
}

log(DUMMY ? 'РЕЖИМ: dummy (проверяем только обход Turnstile, секреты не нужны)' : 'РЕЖИМ: реальные учётки')

/** Печатает result-коды auth-ответов по мере их прихода. */
const authResults = []

// Опциональный резидентный прокси (TREATWELL_PROXY=http://user:pass@host:port).
// Turnstile упирается в РЕПУТАЦИЮ IP: с датацентр-IP (GitHub/VPS) капча не
// проходит даже со стелс-фингерпринтом. Резидентный exit-IP это лечит. geoip
// подгоняет timezone/locale под IP прокси — иначе фингерпринт противоречив.
const PROXY = process.env.TREATWELL_PROXY || ''

async function main() {
  log('launch CloakBrowser', { headless: HEADLESS, base: BASE, proxy: PROXY ? 'on' : 'off' })
  const browser = await launch({
    headless: HEADLESS,
    humanize: true,
    ...(PROXY ? { proxy: PROXY, geoip: true } : {}),
  })
  const page = await browser.newPage()

  // Перехватываем ответ авторизации — это самый честный сигнал что произошло.
  page.on('response', async (res) => {
    const url = res.url()
    if (/\/api\/.*authentication\.json|\/api\/login\.json/.test(url)) {
      let body = ''
      try {
        body = await res.text()
      } catch {
        body = '<no-body>'
      }
      authResults.push({ url, status: res.status(), body: body.slice(0, 300) })
      log('AUTH RESPONSE', res.status(), url, '→', body.slice(0, 200))
    }
  })

  log('goto /login')
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded', timeout: 60_000 })

  // SPA рендерится не сразу — ждём поля.
  const emailSel = 'input[type="email"], input[name="user"], input[name="email"], input[name="login"]'
  const passSel = 'input[type="password"]'
  await page.waitForSelector(emailSel, { timeout: 45_000 })
  await page.waitForSelector(passSel, { timeout: 45_000 })

  log('fill credentials')
  await page.fill(emailSel, LOGIN)
  await page.fill(passSel, PASSWORD)

  // Ждём авто-решения Turnstile. CloakBrowser решает челлендж через стелс +
  // humanize. Сигналы решения: токен в DOM ИЛИ window.turnstile.getResponse()
  // ИЛИ submit-кнопка стала активной. Поллим до 120с, лог каждые ~15с.
  async function turnstileToken() {
    return page
      .evaluate(() => {
        const el =
          document.querySelector('input[name="cf-turnstile-response"]') ||
          document.querySelector('input[name="turnstileToken"]') ||
          document.querySelector('.cf-turnstile input[type="hidden"]')
        const fromInput = el && 'value' in el ? el.value : ''
        let fromApi = ''
        try {
          // window.turnstile.getResponse() без widgetId вернёт токен активного виджета
          fromApi = window.turnstile?.getResponse?.() || ''
        } catch {
          /* ignore */
        }
        return fromInput || fromApi || ''
      })
      .catch(() => '')
  }
  log('wait for turnstile solve…')
  let tokenSeen = false
  for (let i = 0; i < 60; i++) {
    const val = await turnstileToken()
    if (val && val.length > 10) {
      tokenSeen = true
      log('turnstile SOLVED, token len=', val.length)
      break
    }
    if (i > 0 && i % 8 === 0) log(`  …ещё нет токена (${i * 2}с)`)
    await page.waitForTimeout(2000)
  }
  if (!tokenSeen) log('WARN: токен Turnstile не появился за 120с')

  const submitSel =
    'button[type="submit"], button:has-text("Anmelden"), button:has-text("Log in"), button:has-text("Sign in")'

  // Сабмитим и ждём auth-ответ. Если первый ответ NOT_VERIFIED_CAPTCHA —
  // капча могла дорешаться позже: ждём и пробуем ещё (до 3 попыток).
  for (let attempt = 1; attempt <= 3; attempt++) {
    const before = authResults.length
    log(`submit (попытка ${attempt})`)
    await Promise.allSettled([
      page.waitForResponse((r) => /authentication\.json|login\.json/.test(r.url()), {
        timeout: 45_000,
      }),
      page.click(submitSel).catch(() => page.keyboard.press('Enter')),
    ])
    await page.waitForTimeout(2500)
    const last = authResults[authResults.length - 1]
    const gotNew = authResults.length > before
    if (gotNew && last && !/NOT_VERIFIED_CAPTCHA/.test(last.body)) break // прошли капчу
    if (attempt < 3) {
      log('  ответ всё ещё NOT_VERIFIED_CAPTCHA — ждём 20с, даём капче дорешаться…')
      await page.waitForTimeout(20_000)
    }
  }

  // Дать SPA дорисоваться/редиректнуться.
  await page.waitForTimeout(3000)

  const finalUrl = page.url()
  const cookies = await page.context().cookies()
  await page.screenshot({ path: SHOT, fullPage: true }).catch(() => {})

  log('final url:', finalUrl)
  log('cookies count:', cookies.length, '| names:', cookies.map((c) => c.name).join(','))

  const authOk = authResults.some((r) => /ACCOUNT_AUTHENTICATED|PROFILE_AUTHENTICATED/.test(r.body))
  const captchaRejected = authResults.some((r) => /NOT_VERIFIED_CAPTCHA/.test(r.body))
  const badCreds = authResults.some((r) => /NOT_AUTHENTICATED/.test(r.body))
  // Резервный сигнал: ушли с /login и появилась сессионная кука.
  const leftLogin = !finalUrl.includes('/login')

  await browser.close()

  // Turnstile считаем пройденным, если backend дошёл до проверки учёток —
  // т.е. вернул ЛЮБОЙ из ACCOUNT_AUTHENTICATED / PROFILE_AUTHENTICATED /
  // NOT_AUTHENTICATED (последнее = «капча ок, пароль неверный»). Заблокирован
  // Turnstile — только если видим NOT_VERIFIED_CAPTCHA.
  const turnstilePassed = authOk || badCreds

  console.log('\n===== РЕЗУЛЬТАТ =====')
  console.log('режим:', DUMMY ? 'dummy (неверный пароль ожидаем)' : 'реальные учётки')
  console.log('auth responses:', JSON.stringify(authResults, null, 2))

  if (captchaRejected && !turnstilePassed) {
    console.log('❌ NOT_VERIFIED_CAPTCHA — Turnstile НЕ пройден с IP этой машины.')
    console.log('   → CloakBrowser не пробил капчу здесь. Нужен резидентный прокси')
    console.log('     (launch({proxy})) или headed-режим (он уже включён под Xvfb).')
    process.exit(1)
  }
  if (turnstilePassed) {
    console.log('✅ TURNSTILE ПРОЙДЕН — CloakBrowser с этой машины обходит капчу.')
    if (authOk) {
      console.log('   + полный вход удался (ACCOUNT/PROFILE_AUTHENTICATED).')
    } else if (DUMMY && badCreds) {
      console.log('   Ответ NOT_AUTHENTICATED — это ОЖИДАЕМО: пароль заведомо неверный.')
      console.log('   Главное: капча пройдена. Можно строить полный синк.')
    } else if (badCreds) {
      console.log('   ⚠️ Но NOT_AUTHENTICATED — реальные логин/пароль отвергнуты, проверь их.')
    }
    process.exit(0)
  }
  if (leftLogin) {
    console.log('✅ Похоже, вошли (ушли с /login). Turnstile, скорее всего, пройден.')
    process.exit(0)
  }
  console.log('❓ Непонятный исход — ни captcha-отказа, ни auth-ответа. Смотри скриншот-артефакт.')
  console.log('   Возможно, изменилась форма логина (селекторы) — проверь treatwell-login.png.')
  process.exit(1)
}

main().catch((e) => {
  console.error('[tw-poc] EXCEPTION', e?.stack || e)
  process.exit(1)
})
