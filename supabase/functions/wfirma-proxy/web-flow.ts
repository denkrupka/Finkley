/**
 * web-flow.ts — auto-login через wfirma.pl web-панель (X2 Hybrid, ADR-012).
 *
 * Реверс: GET /logowanie → POST /logowanie → /user_companies/login/{id} →
 * /api_user_keys/add/ → /users/sudo → confirmView → access+secret keys.
 */

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36'

export type WebFlowError =
  | 'wfirma_login_failed'
  | 'wfirma_no_companies'
  | 'wfirma_form_changed'
  | 'wfirma_captcha'
  | 'wfirma_keygen_failed'

export type WebFlowKeys = {
  accessKey: string
  secretKey: string
  companyId: string
  companyName: string
  companyNip: string
}

/** Список фирм пользователя в его аккаунте wFirma — для выбора в UI. */
export type WebFlowCompanyChoice = {
  id: string
  name: string
}

export type WebFlowResult =
  | { ok: true; data: WebFlowKeys }
  | { ok: false; reason: 'choose_company'; companies: WebFlowCompanyChoice[] }
  | { ok: false; reason: WebFlowError; details?: string }

type CookieJar = Map<string, string>

function parseSetCookie(h: Headers, jar: CookieJar) {
  // Deno fetch объединяет несколько Set-Cookie через запятую неудачно для дат —
  // используем getSetCookie() (Deno >= 1.41).
  const list = (h as Headers & { getSetCookie?: () => string[] }).getSetCookie?.() ?? []
  for (const sc of list) {
    const eq = sc.indexOf('=')
    const sem = sc.indexOf(';')
    if (eq < 0) continue
    const name = sc.slice(0, eq).trim()
    const value = sc.slice(eq + 1, sem < 0 ? sc.length : sem).trim()
    if (value === '' || value === 'deleted') jar.delete(name)
    else jar.set(name, value)
  }
}

function cookieHeader(jar: CookieJar): string {
  return Array.from(jar.entries())
    .map(([k, v]) => `${k}=${v}`)
    .join('; ')
}

/**
 * Извлекает wf_token из HTML страницы. Каскад из 6 паттернов — копия из
 * рабочего бота `bookysync-bot/services/wfirma_web.py:_extract_wf_token`.
 * Формат токена: `40-hex-chars:hex:digits+digits`.
 */
function extractDataToken(html: string): string | null {
  const patterns: RegExp[] = [
    /data-token=["']([0-9a-f]{40,}:[0-9a-f]+:\d+\+\d+)["']/,
    /wfToken["']?\s*[:=]\s*["']([0-9a-f:+]+)["']/,
    /x-wf-token["']?\s*[:=]\s*["']([0-9a-f:+]+)["']/,
    /data-wf-token=["']([0-9a-f:+]+)["']/,
    /name=["']wf_token["']\s+value=["']([0-9a-f:+]+)["']/,
    /"token"\s*:\s*"([0-9a-f]{40,}:[0-9a-f]+:\d+\+\d+)"/,
    // Catch-all: любой data-token (legacy)
    /data-token="([^"]+)"/,
  ]
  for (const re of patterns) {
    const m = html.match(re)
    if (m?.[1]) return m[1]
  }
  return null
}

/**
 * Fallback: ищет токен среди cookies (бот делает `_token_from_cookies`).
 * Имена: wf_token / wftoken / csrftoken / csrf_token.
 */
function tokenFromCookies(jar: CookieJar): string | null {
  for (const [k, v] of jar.entries()) {
    if (!v) continue
    const kl = k.toLowerCase()
    if (
      kl.includes('wf_token') ||
      kl.includes('wftoken') ||
      kl === 'csrftoken' ||
      kl === 'csrf_token'
    ) {
      return v
    }
  }
  return null
}

/** Маркеры страницы выбора фирмы — копия `_is_company_select_page` из бота. */
function isCompanySelectPage(html: string): boolean {
  return (
    html.includes('"here":"\\/user_companies') ||
    html.includes('user_companies/index') ||
    html.toLowerCase().includes('wybranej firmy')
  )
}

/**
 * Парсит HTML страницы выбора фирм в список компаний. Копия из бота
 * `bookysync-bot/services/wfirma_web.py:_parse_companies` —
 * один regex с DOTALL (`[\s\S]` в JS), покрывает и /login/{id} и
 * /setActive/{id}. Имя из inner-text, теги стрипаются.
 */
function parseCompaniesFromHtml(html: string): WebFlowCompanyChoice[] {
  const results: WebFlowCompanyChoice[] = []
  const seen = new Set<string>()

  // Главный паттерн: <a href="/user_companies/(login|setActive)/{id}">...</a>
  const mainRe =
    /<a[^>]*href=["']\/user_companies\/(?:login|setActive)\/(\d+)["'][^>]*>([\s\S]*?)<\/a>/g

  for (const m of html.matchAll(mainRe)) {
    const id = m[1]
    const raw = m[2] ?? ''
    if (!id || seen.has(id)) continue
    seen.add(id)
    const name =
      raw
        .replace(/<[^>]+>/g, '')
        .replace(/\s+/g, ' ')
        .trim() || `Firma #${id}`
    results.push({ id, name })
  }

  // Fallback: если основной паттерн ничего не дал — собираем хоть id.
  if (results.length === 0) {
    const idRe = /\/user_companies\/(?:login|setActive)\/(\d+)/g
    for (const m of html.matchAll(idRe)) {
      const id = m[1]
      if (!id || seen.has(id)) continue
      seen.add(id)
      results.push({ id, name: `Firma #${id}` })
    }
  }

  return results
}

function multipartBody(fields: Record<string, string>, boundary: string): string {
  let body = ''
  for (const [k, v] of Object.entries(fields)) {
    body += `--${boundary}\r\n`
    body += `Content-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`
  }
  body += `--${boundary}--\r\n`
  return body
}

export async function generateApiKeyViaWebFlow(
  email: string,
  password: string,
  options: { appName?: string; selectedCompanyId?: string } = {},
): Promise<WebFlowResult> {
  const appName = options.appName ?? 'Finkley'
  const selectedCompanyId = options.selectedCompanyId ?? null
  const jar: CookieJar = new Map()

  // Step 1: GET /logowanie — establish initial session cookie
  let res = await fetch('https://wfirma.pl/logowanie', {
    method: 'GET',
    headers: { 'User-Agent': UA, Accept: 'text/html' },
  })
  parseSetCookie(res.headers, jar)
  await res.text()
  if (!jar.has('SESSION_WFIRMA_PL')) {
    return {
      ok: false,
      reason: 'wfirma_form_changed',
      details: 'no SESSION_WFIRMA_PL on initial GET',
    }
  }

  // Step 2: POST /logowanie — login. 05.06: добавил 4 пустых поля из
  // рабочего бота (data[Invoice][id], data[Invoice][hash], data[User][lock],
  // data[User][lockBottomMessage]) — без них wfirma иногда не даёт `wasLogged=yes`
  // или редиректит на /logowanie снова. Также переключаю на redirect: follow —
  // wfirma делает 302 → /start с финальными cookies, manual режим эти cookies
  // не подцеплял.
  const loginBody = new URLSearchParams()
  loginBody.set('data[User][login]', email)
  loginBody.set('data[User][password]', password)
  loginBody.set('data[Invoice][id]', '')
  loginBody.set('data[Invoice][hash]', '')
  loginBody.set('data[User][lock]', '')
  loginBody.set('data[User][lockBottomMessage]', '')
  res = await fetch('https://wfirma.pl/logowanie', {
    method: 'POST',
    redirect: 'follow',
    headers: {
      'User-Agent': UA,
      'Content-Type': 'application/x-www-form-urlencoded',
      Referer: 'https://wfirma.pl/logowanie',
      Cookie: cookieHeader(jar),
    },
    body: loginBody.toString(),
  })
  parseSetCookie(res.headers, jar)
  const loginRespUrl = res.url || ''
  const loginRespBody = await res.text()
  // Проверка по wasLogged (наш старый сигнал) ИЛИ по поведению бота:
  // если финальный URL не содержит /logowanie И body не содержит password/haslo,
  // значит логин прошёл (попали на dashboard / picker).
  const loginOkByCookie = jar.get('wasLogged') === 'yes'
  const loginOkByRedirect =
    !loginRespUrl.includes('/logowanie') ||
    !(
      loginRespBody.toLowerCase().includes('password') ||
      loginRespBody.toLowerCase().includes('haslo')
    )
  if (!loginOkByCookie && !loginOkByRedirect) {
    return { ok: false, reason: 'wfirma_login_failed' }
  }

  // Step 3: GET /start — единый endpoint для всех 3 кейсов (KIKI bot reference,
  // owner 05.06). Раньше использовали /user_companies/indexTable — он
  // оказался устаревшим / не возвращал нужный HTML.
  //
  // Что встретим на /start после login:
  //   (а) Single-company аккаунт → HTML с wf_token в data-token / wfToken
  //       (готовая сессия, не нужен picker)
  //   (б) Multi-company → редирект на /user_companies/index, в HTML
  //       будут <a href="/user_companies/login/{id}">…</a> или
  //       <a href="/user_companies/setActive/{id}">…</a>
  //   (в) Detect: маркеры "wybranej firmy", "\/user_companies", и т.д.
  res = await fetch('https://wfirma.pl/start', {
    method: 'GET',
    redirect: 'follow',
    headers: { 'User-Agent': UA, Accept: 'text/html', Cookie: cookieHeader(jar) },
  })
  parseSetCookie(res.headers, jar)
  const startHtml = await res.text()

  // Точная логика бота (`login_step1`):
  //   1. ЕСЛИ /start — это picker фирм → парсим companies → возвращаем выбор
  //   2. ИНАЧЕ ищем wf_token в HTML или cookies → single-company готова
  //   3. Если ни picker, ни token — фейл ('nieoczekiwana strona po logowaniu')
  //
  // Раньше мы тестировали parseCompaniesFromHtml БЕЗ проверки маркеров и
  // выдавали 'no_companies' даже single-company юзерам.
  const pickerPage = isCompanySelectPage(startHtml)
  let chosen: WebFlowCompanyChoice
  let pickerCompanies: WebFlowCompanyChoice[] = []

  // Логируем что увидели — для дебага владельца через Management API.
  console.log('wfirma /start parsed:', {
    pickerPage,
    htmlLen: startHtml.length,
    cookieNames: Array.from(jar.keys()),
    selectedCompanyId,
  })

  if (pickerPage) {
    pickerCompanies = parseCompaniesFromHtml(startHtml)
    console.log(
      'wfirma picker companies:',
      pickerCompanies.map((c) => `${c.id}:${c.name}`).join(' | '),
    )
    if (pickerCompanies.length === 0) {
      // Picker маркер есть, но парсер не сматчил. Это значит wfirma изменили
      // HTML структуру — нужен sample. Но! Если юзер УЖЕ передал
      // selectedCompanyId (т.е. в прошлой попытке мы успешно её распарсили),
      // доверяем этому id — используем как trusted и идём дальше.
      if (selectedCompanyId) {
        console.warn(
          'wfirma: picker but no parse, falling back to trusted selectedCompanyId:',
          selectedCompanyId,
        )
        chosen = { id: selectedCompanyId, name: '' }
      } else {
        const sample = startHtml.slice(0, 2000).replace(/\s+/g, ' ')
        console.warn('wfirma: picker detected but no companies parsed. HTML sample:', sample)
        return {
          ok: false,
          reason: 'wfirma_no_companies',
          details: `picker_detected_but_parser_failed. HTML sample (2000ch): ${sample}`,
        }
      }
    } else if (pickerCompanies.length === 1) {
      chosen = pickerCompanies[0]!
    } else if (selectedCompanyId) {
      const found = pickerCompanies.find((c) => c.id === selectedCompanyId)
      if (!found) {
        // Парсер вернул фирмы, но selectedCompanyId среди них нет. Возможны
        // 2 причины:
        //   а) wfirma реально отдала другой набор (сессия/cache изменились)
        //   б) парсер сматчил неправильно (id съехал, попал лишний 0)
        // В обоих случаях юзер ЯВНО выбрал эту фирму минуту назад — доверяем.
        // Если он промахнулся, Step 4 (/login/{id}) вернёт ошибку 404/403,
        // и мы вернём `wfirma_form_changed` с понятным details.
        console.warn('wfirma: selectedCompanyId not in re-parsed list, trusting user choice:', {
          selectedCompanyId,
          parsedIds: pickerCompanies.map((c) => c.id),
        })
        chosen = { id: selectedCompanyId, name: '' }
      } else {
        chosen = found
      }
    } else {
      return { ok: false, reason: 'choose_company', companies: pickerCompanies }
    }
  } else {
    // Single-company: picker не показался, нужно достать token прямо из /start.
    const tokenInStart = extractDataToken(startHtml) ?? tokenFromCookies(jar)
    if (!tokenInStart) {
      const sample = startHtml.slice(0, 2000).replace(/\s+/g, ' ')
      console.warn('wfirma: no picker, no token. HTML sample:', sample)
      return {
        ok: false,
        reason: 'wfirma_form_changed',
        details: `no_picker_no_token. HTML sample (2000ch): ${sample}`,
      }
    }
    // Single-company готова. companyId пуст — wfirma знает текущую активную.
    // Но Step 6 требует CompanyContext[company_id]. Попробуем достать через
    // API endpoint, который вернёт активную company. Если не получится —
    // оставим пустым (worst case Step 6 вернёт ошибку с понятным сигналом).
    chosen = { id: '', name: 'default' }
  }
  const companyId = chosen.id
  const companyName = chosen.name

  // Step 4: выбор фирмы. Если companyId пуст (single-company) — пропускаем,
  // токен уже в /start HTML/cookies. Иначе по схеме бота `select_company`:
  // пробуем /login/{id}, фолбэк на /setActive/{id}, потом GET /start чтобы
  // достать финальный wf_token.
  let wfToken: string | null = null

  if (companyId) {
    res = await fetch(`https://wfirma.pl/user_companies/login/${companyId}`, {
      method: 'GET',
      redirect: 'follow',
      headers: { 'User-Agent': UA, Cookie: cookieHeader(jar) },
    })
    parseSetCookie(res.headers, jar)
    await res.text()
    // Бот делает оба endpoint'а independently, не зависит от status — мы
    // тоже всегда пробуем setActive если первый не дал нам активную сессию.
    try {
      const r2 = await fetch(`https://wfirma.pl/user_companies/setActive/${companyId}`, {
        method: 'GET',
        redirect: 'follow',
        headers: { 'User-Agent': UA, Cookie: cookieHeader(jar) },
      })
      parseSetCookie(r2.headers, jar)
      await r2.text()
    } catch {
      /* ignore */
    }
  }

  // Финальный GET /start — забираем wf_token (он в HTML или cookies).
  res = await fetch('https://wfirma.pl/start', {
    method: 'GET',
    redirect: 'follow',
    headers: { 'User-Agent': UA, Accept: 'text/html', Cookie: cookieHeader(jar) },
  })
  parseSetCookie(res.headers, jar)
  const enterHtml = await res.text()
  wfToken = extractDataToken(enterHtml) ?? tokenFromCookies(jar)

  if (!wfToken) {
    const sample = enterHtml.slice(0, 1000).replace(/\s+/g, ' ')
    console.warn('wfirma: no token after company switch. HTML sample:', sample)
    return {
      ok: false,
      reason: 'wfirma_form_changed',
      details: `no_token_after_switch. companyId=${companyId}. HTML sample (1000ch): ${sample}`,
    }
  }

  // Step 5: GET /api_user_keys/add/ — fetch create-key form, get fresh token
  res = await fetch(`https://wfirma.pl/api_user_keys/add/?_=${Date.now()}`, {
    method: 'GET',
    headers: {
      'User-Agent': UA,
      'X-Requested-With': 'XMLHttpRequest',
      'X-Wf-Token': wfToken,
      Referer: 'https://wfirma.pl/settings/index',
      Cookie: cookieHeader(jar),
    },
  })
  parseSetCookie(res.headers, jar)
  const formHtml = await res.text()
  const formToken = extractDataToken(formHtml)
  if (!formToken || !formHtml.includes('app_name')) {
    return { ok: false, reason: 'wfirma_form_changed', details: 'create-key form missing' }
  }

  // Step 6: POST /api_user_keys/add?dialogbox=1 — submit app name, expect 302 → /users/sudo
  const boundary1 = `----WebKitFormBoundary${crypto.randomUUID().replace(/-/g, '')}`
  res = await fetch('https://wfirma.pl/api_user_keys/add?dialogbox=1', {
    method: 'POST',
    redirect: 'manual',
    headers: {
      'User-Agent': UA,
      'X-Requested-With': 'XMLHttpRequest',
      'X-Wf-Token': formToken,
      'Content-Type': `multipart/form-data; boundary=${boundary1}`,
      Referer: 'https://wfirma.pl/settings/index',
      Cookie: cookieHeader(jar),
    },
    body: multipartBody(
      {
        'data[ApiUserKey][app_name]': appName,
        'CompanyContext[company_id]': companyId,
      },
      boundary1,
    ),
  })
  parseSetCookie(res.headers, jar)
  await res.text()
  const sudoLocation = res.headers.get('location') ?? res.headers.get('Location')
  if (res.status !== 302 || !sudoLocation || !sudoLocation.includes('/users/sudo')) {
    return {
      ok: false,
      reason: 'wfirma_form_changed',
      details: `unexpected create response ${res.status}`,
    }
  }
  const stackId = sudoLocation.match(/redirectStackId=([a-f0-9]+)/)?.[1]
  if (!stackId) {
    return { ok: false, reason: 'wfirma_form_changed', details: 'no redirectStackId' }
  }

  // Step 7: GET /users/sudo?...&redirectStackId={STACK_ID}
  res = await fetch(`https://wfirma.pl${sudoLocation}`, {
    method: 'GET',
    headers: {
      'User-Agent': UA,
      'X-Requested-With': 'XMLHttpRequest',
      'X-Wf-Token': formToken,
      Referer: 'https://wfirma.pl/settings/index',
      Cookie: cookieHeader(jar),
    },
  })
  parseSetCookie(res.headers, jar)
  const sudoHtml = await res.text()
  const sudoToken = extractDataToken(sudoHtml)
  if (!sudoToken || !sudoHtml.includes('password_auth')) {
    return { ok: false, reason: 'wfirma_form_changed', details: 'sudo form missing' }
  }
  // Если в sudo-форме есть капча или 2FA — деградируем сразу
  if (/captcha|hcaptcha|recaptcha/i.test(sudoHtml)) {
    return { ok: false, reason: 'wfirma_captcha' }
  }
  if (/UserOneTimePassword.*required|2FA|two[\- ]factor/i.test(sudoHtml)) {
    // 2FA включён → не можем автоматизировать. Помечаем как login_failed,
    // фронт деградирует на ручной ввод.
    return { ok: false, reason: 'wfirma_login_failed', details: '2fa_required' }
  }

  // Step 8: POST /users/sudo — confirm with password
  const boundary2 = `----WebKitFormBoundary${crypto.randomUUID().replace(/-/g, '')}`
  res = await fetch(`https://wfirma.pl/users/sudo?redirectStackId=${stackId}&dialogbox=1&ajax=1`, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      'User-Agent': UA,
      'X-Requested-With': 'XMLHttpRequest',
      'X-Wf-Token': sudoToken,
      'Content-Type': `multipart/form-data; boundary=${boundary2}`,
      Referer: 'https://wfirma.pl/settings/index',
      Cookie: cookieHeader(jar),
    },
    body: multipartBody(
      {
        'data[User][password_auth]': password,
        'data[UserOneTimePassword][number]': '',
        'CompanyContext[company_id]': companyId,
      },
      boundary2,
    ),
  })
  parseSetCookie(res.headers, jar)
  await res.text()
  if (res.status !== 302) {
    return { ok: false, reason: 'wfirma_login_failed', details: `sudo rejected ${res.status}` }
  }
  const backLocation = res.headers.get('location') ?? res.headers.get('Location')
  if (!backLocation || !backLocation.includes('redirectStackBack=1')) {
    return { ok: false, reason: 'wfirma_form_changed', details: 'no redirectStackBack after sudo' }
  }

  // Step 9: GET /api_user_keys/add?...&redirectStackBack=1 — finish creation
  res = await fetch(`https://wfirma.pl${backLocation}`, {
    method: 'GET',
    headers: {
      'User-Agent': UA,
      'X-Requested-With': 'XMLHttpRequest',
      'X-Wf-Token': sudoToken,
      Referer: 'https://wfirma.pl/settings/index',
      Cookie: cookieHeader(jar),
    },
  })
  parseSetCookie(res.headers, jar)
  const finishHtml = await res.text()
  const idMatch = finishHtml.match(/\\\/api_user_keys\\\/confirmView\\\/(\d+)/)
  const newKeyId = idMatch?.[1]
  const responseStatusMatch = finishHtml.match(/"responseStatus":"([^"]+)"/)
  if (!newKeyId || responseStatusMatch?.[1] !== 'OK') {
    return {
      ok: false,
      reason: 'wfirma_keygen_failed',
      details: `status=${responseStatusMatch?.[1]}`,
    }
  }

  // Step 10: GET /api_user_keys/confirmView/{id} — read access + secret
  res = await fetch(`https://wfirma.pl/api_user_keys/confirmView/${newKeyId}?_=${Date.now()}`, {
    method: 'GET',
    headers: {
      'User-Agent': UA,
      'X-Requested-With': 'XMLHttpRequest',
      'X-Wf-Token': sudoToken,
      Referer: 'https://wfirma.pl/settings/index',
      Cookie: cookieHeader(jar),
    },
  })
  const confirmHtml = await res.text()
  const accessKey = extractValueByLabel(confirmHtml, 'Access key')
  const secretKey = extractValueByLabel(confirmHtml, 'Secret key')
  if (!accessKey || !secretKey) {
    return { ok: false, reason: 'wfirma_form_changed', details: 'cannot parse confirmView' }
  }

  return {
    ok: true,
    data: {
      accessKey,
      secretKey,
      companyId,
      companyName,
      companyNip: '', // заполняется отдельно через api2.wfirma.pl/companies/find
    },
  }
}

/** Парсит шаблон `<div ...>VALUE</div><label ...>LABEL` из confirmView HTML. */
function extractValueByLabel(html: string, label: string): string | null {
  const re = new RegExp(
    `<div[^>]*class="mat-text used form-control-plaintext"[^>]*>\\s*([0-9a-f]{32})\\s*<\\/div>\\s*<label[^>]*>` +
      label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
  )
  return html.match(re)?.[1] ?? null
}
