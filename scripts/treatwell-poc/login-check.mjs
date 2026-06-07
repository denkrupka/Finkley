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
const LOGIN = process.env.TREATWELL_LOGIN ?? ''
const PASSWORD = process.env.TREATWELL_PASSWORD ?? ''
const HEADLESS = process.env.TREATWELL_HEADLESS === '1'

const SHOT = 'treatwell-login.png'

function log(...a) {
  console.log('[tw-poc]', ...a)
}

if (!LOGIN || !PASSWORD) {
  console.error('[tw-poc] FATAL: TREATWELL_LOGIN / TREATWELL_PASSWORD не заданы')
  process.exit(2)
}

/** Печатает result-коды auth-ответов по мере их прихода. */
const authResults = []

async function main() {
  log('launch CloakBrowser', { headless: HEADLESS, base: BASE })
  const browser = await launch({ headless: HEADLESS })
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

  // Ждём, пока Turnstile проставит токен в скрытое поле. CloakBrowser должен
  // решить челлендж автоматически. Поллим до 90с.
  log('wait for turnstile token…')
  let tokenSeen = false
  for (let i = 0; i < 45; i++) {
    const val = await page
      .evaluate(() => {
        const el =
          document.querySelector('input[name="cf-turnstile-response"]') ||
          document.querySelector('input[name="turnstileToken"]') ||
          document.querySelector('.cf-turnstile input[type="hidden"]')
        return el && 'value' in el ? el.value : ''
      })
      .catch(() => '')
    if (val && val.length > 10) {
      tokenSeen = true
      log('turnstile token present, len=', val.length)
      break
    }
    await page.waitForTimeout(2000)
  }
  if (!tokenSeen) log('WARN: turnstile token не появился за 90с — сабмитим как есть')

  log('submit')
  const submitSel = 'button[type="submit"], button:has-text("Anmelden"), button:has-text("Log in"), button:has-text("Sign in")'
  // Кликаем и ждём auth-ответ (или таймаут).
  await Promise.allSettled([
    page.waitForResponse((r) => /authentication\.json|login\.json/.test(r.url()), {
      timeout: 60_000,
    }),
    page.click(submitSel).catch(() => page.keyboard.press('Enter')),
  ])

  // Дать SPA дорисоваться/редиректнуться.
  await page.waitForTimeout(4000)

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

  console.log('\n===== РЕЗУЛЬТАТ =====')
  console.log('auth responses:', JSON.stringify(authResults, null, 2))
  if (authOk || (leftLogin && !captchaRejected && !badCreds)) {
    console.log('✅ ВХОД ПРОШЁЛ — CloakBrowser с этой машины обходит Turnstile.')
    process.exit(0)
  }
  if (captchaRejected) {
    console.log('❌ NOT_VERIFIED_CAPTCHA — Turnstile НЕ пройден с этого IP.')
    console.log('   → нужен резидентный прокси (launch({proxy})) или headed-режим.')
    process.exit(1)
  }
  if (badCreds) {
    console.log('⚠️  NOT_AUTHENTICATED — капча ПРОШЛА, но логин/пароль отвергнуты.')
    console.log('   → проверь TREATWELL_LOGIN/PASSWORD. Capt­cha-барьер при этом решён!')
    process.exit(1)
  }
  console.log('❓ Непонятный исход — смотри скриншот-артефакт и лог выше.')
  process.exit(1)
}

main().catch((e) => {
  console.error('[tw-poc] EXCEPTION', e?.stack || e)
  process.exit(1)
})
