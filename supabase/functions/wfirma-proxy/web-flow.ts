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

function extractDataToken(html: string): string | null {
  const m = html.match(/data-token="([^"]+)"/)
  return m?.[1] ?? null
}

/**
 * Парсит HTML страницы /user_companies/indexTable в список компаний.
 * Каскад regex от специфичного к общему — wFirma периодически переименовывает
 * CSS-классы, поэтому страхуемся.
 *
 * Возвращает уникальные id (Map), имя берём из первого матча по этому id.
 */
function parseCompaniesFromHtml(html: string): WebFlowCompanyChoice[] {
  const found = new Map<string, string>()

  const patterns: RegExp[] = [
    // Cascade 1 (текущий): class="active-brand" между id и текстом
    /\/user_companies\/login\/(\d+)"[^>]*class="[^"]*active-brand[^"]*"[^>]*>([^<]+)</g,
    // Cascade 2: любой класс/атрибут после id
    /\/user_companies\/login\/(\d+)"[^>]*>\s*([^<]+?)\s*</g,
    // Cascade 3: id + ближайший непустой текст в пределах 200 символов
    /\/user_companies\/login\/(\d+)[^>]*>([\s\S]{0,200}?)</g,
  ]

  for (const re of patterns) {
    for (const m of html.matchAll(re)) {
      const id = m[1]
      const rawName = (m[2] ?? '').trim()
      if (!id || found.has(id)) continue
      // Чистим от вложенных тегов и спан-маркеров
      const name = rawName
        .replace(/<[^>]+>/g, '')
        .replace(/\s+/g, ' ')
        .trim()
      if (name) found.set(id, name)
    }
    if (found.size > 0) break
  }

  // Если никто из паттернов не дал name, но id-шники нашли — генерим placeholder
  if (found.size === 0) {
    const idsOnly = new Set<string>()
    for (const m of html.matchAll(/\/user_companies\/login\/(\d+)/g)) {
      if (m[1]) idsOnly.add(m[1])
    }
    let i = 1
    for (const id of idsOnly) {
      found.set(id, `Firma ${i++}`)
    }
  }

  return Array.from(found.entries()).map(([id, name]) => ({ id, name }))
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

  // Step 2: POST /logowanie — login
  const loginBody = new URLSearchParams()
  loginBody.set('data[User][login]', email)
  loginBody.set('data[User][password]', password)
  res = await fetch('https://wfirma.pl/logowanie', {
    method: 'POST',
    redirect: 'manual',
    headers: {
      'User-Agent': UA,
      'Content-Type': 'application/x-www-form-urlencoded',
      Cookie: cookieHeader(jar),
    },
    body: loginBody.toString(),
  })
  parseSetCookie(res.headers, jar)
  await res.text()
  if (jar.get('wasLogged') !== 'yes') {
    return { ok: false, reason: 'wfirma_login_failed' }
  }

  // Step 3: GET /user_companies/indexTable — find company_id
  res = await fetch('https://wfirma.pl/user_companies/indexTable', {
    method: 'GET',
    headers: {
      'User-Agent': UA,
      'X-Requested-With': 'XMLHttpRequest',
      Cookie: cookieHeader(jar),
    },
  })
  parseSetCookie(res.headers, jar)
  const companiesHtml = await res.text()

  // Каскад regex для парсинга. wFirma периодически меняет HTML/CSS-классы,
  // поэтому пробуем по убыванию специфичности.
  const companies = parseCompaniesFromHtml(companiesHtml)
  if (companies.length === 0) {
    // Логируем для отладки — sample HTML без приватных данных
    const sample = companiesHtml.slice(0, 500).replace(/\s+/g, ' ')
    console.warn('wfirma: no companies parsed, html sample:', sample)
    return {
      ok: false,
      reason: 'wfirma_no_companies',
      details: 'parser_no_match — структура wFirma могла измениться',
    }
  }
  // Если фирм несколько — UI должен показать селектор. Возвращаем список
  // и НЕ создаём ключи (создание происходит при повторном вызове с
  // `selectedCompanyId`).
  let chosen: WebFlowCompanyChoice
  if (companies.length === 1) {
    chosen = companies[0]!
  } else if (selectedCompanyId) {
    const found = companies.find((c) => c.id === selectedCompanyId)
    if (!found) {
      return { ok: false, reason: 'wfirma_no_companies', details: 'selected_id_not_in_account' }
    }
    chosen = found
  } else {
    return { ok: false, reason: 'choose_company', companies }
  }
  const companyId = chosen.id
  const companyName = chosen.name

  // Step 4: GET /user_companies/login/{company_id} — enter company, parse X-Wf-Token
  res = await fetch(`https://wfirma.pl/user_companies/login/${companyId}`, {
    method: 'GET',
    redirect: 'follow',
    headers: { 'User-Agent': UA, Cookie: cookieHeader(jar) },
  })
  parseSetCookie(res.headers, jar)
  const enterHtml = await res.text()
  const wfToken = extractDataToken(enterHtml)
  if (!wfToken) {
    return { ok: false, reason: 'wfirma_form_changed', details: 'no data-token after enter' }
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
