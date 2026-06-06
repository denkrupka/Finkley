/**
 * ocr-flow.ts — экспорт чека/фактуры в wFirma OCR через web-flow.
 *
 * Flow (см. HAR от 06.06):
 *   1. login (логин + выбор компании + wf_token, как в web-flow.ts)
 *   2. POST /common_files/add/DocumentOcr — multipart upload файла
 *      → returns { id: 1245242934 }
 *   3. POST /documents/addOcrFileToReadSystemFolder/<id> — триггер OCR
 *      → wFirma запускает OCR-парсинг и сама создаёт expense
 *
 * Auth: те же session cookies + x-wf-token что и web-flow генерации
 * ключей. Поэтому требует email+password (хранятся encrypted в
 * salon_integrations.credentials.email_enc / password_enc).
 */

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36'

const WFIRMA_HOST = 'https://wfirma.pl'

type CookieJar = Map<string, string>

function parseSetCookie(h: Headers, jar: CookieJar) {
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
  const patterns: RegExp[] = [
    /data-token=["']([0-9a-f]{40,}:[0-9a-f]+:\d+\+\d+)["']/,
    /wfToken["']?\s*[:=]\s*["']([0-9a-f:+]+)["']/,
    /x-wf-token["']?\s*[:=]\s*["']([0-9a-f:+]+)["']/,
    /data-wf-token=["']([0-9a-f:+]+)["']/,
    /name=["']wf_token["']\s+value=["']([0-9a-f:+]+)["']/,
    /"token"\s*:\s*"([0-9a-f]{40,}:[0-9a-f]+:\d+\+\d+)"/,
    /data-token="([^"]+)"/,
  ]
  for (const re of patterns) {
    const m = html.match(re)
    if (m?.[1]) return m[1]
  }
  return null
}

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

function isCompanySelectPage(html: string): boolean {
  return (
    html.includes('"here":"\\/user_companies') ||
    html.includes('user_companies/index') ||
    html.toLowerCase().includes('wybranej firmy')
  )
}

export type WebSession = {
  cookies: string
  wfToken: string
}

export type OcrFlowError =
  | 'login_failed'
  | 'token_extraction_failed'
  | 'upload_failed'
  | 'trigger_failed'

export type OcrFlowResult =
  | { ok: true; documentId: number }
  | { ok: false; reason: OcrFlowError; details?: string }

/**
 * Логин в wFirma web-панель и получение active session с wf_token.
 * Краткая версия web-flow.ts (без генерации API keys) — нужна для
 * выполнения web-only actions типа OCR upload.
 */
async function loginToWfirmaWeb(
  email: string,
  password: string,
  selectedCompanyId?: string,
): Promise<{ ok: true; session: WebSession } | { ok: false; reason: string; details?: string }> {
  const jar: CookieJar = new Map()

  // Step 1: GET /logowanie
  let res = await fetch(`${WFIRMA_HOST}/logowanie`, {
    method: 'GET',
    headers: { 'User-Agent': UA, Accept: 'text/html' },
  })
  parseSetCookie(res.headers, jar)
  await res.text()
  if (!jar.has('SESSION_WFIRMA_PL')) {
    return { ok: false, reason: 'no_session_cookie' }
  }

  // Step 2: POST /logowanie
  const loginBody = new URLSearchParams()
  loginBody.set('data[User][login]', email)
  loginBody.set('data[User][password]', password)
  loginBody.set('data[Invoice][id]', '')
  loginBody.set('data[Invoice][hash]', '')
  loginBody.set('data[User][lock]', '')
  loginBody.set('data[User][lockBottomMessage]', '')

  res = await fetch(`${WFIRMA_HOST}/logowanie`, {
    method: 'POST',
    redirect: 'follow',
    headers: {
      'User-Agent': UA,
      'Content-Type': 'application/x-www-form-urlencoded',
      Referer: `${WFIRMA_HOST}/logowanie`,
      Cookie: cookieHeader(jar),
    },
    body: loginBody.toString(),
  })
  parseSetCookie(res.headers, jar)
  const loginRespUrl = res.url || ''
  const loginRespBody = await res.text()
  const loginOk =
    jar.get('wasLogged') === 'yes' ||
    !loginRespUrl.includes('/logowanie') ||
    !(
      loginRespBody.toLowerCase().includes('password') ||
      loginRespBody.toLowerCase().includes('haslo')
    )
  if (!loginOk) {
    return { ok: false, reason: 'login_failed' }
  }

  // Step 3: GET /start — single-company OR picker
  res = await fetch(`${WFIRMA_HOST}/start`, {
    method: 'GET',
    redirect: 'follow',
    headers: { 'User-Agent': UA, Accept: 'text/html', Cookie: cookieHeader(jar) },
  })
  parseSetCookie(res.headers, jar)
  const startHtml = await res.text()

  // Step 4: company switch (если есть selectedCompanyId)
  if (selectedCompanyId || isCompanySelectPage(startHtml)) {
    if (selectedCompanyId) {
      // Login + setActive обе вызываем — соответствует web-flow.ts
      try {
        const r1 = await fetch(`${WFIRMA_HOST}/user_companies/login/${selectedCompanyId}`, {
          method: 'GET',
          redirect: 'follow',
          headers: { 'User-Agent': UA, Cookie: cookieHeader(jar) },
        })
        parseSetCookie(r1.headers, jar)
        await r1.text()
      } catch {
        /* ignore */
      }
      try {
        const r2 = await fetch(`${WFIRMA_HOST}/user_companies/setActive/${selectedCompanyId}`, {
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
  }

  // Финальный /start чтобы получить wf_token (он в HTML или cookies)
  res = await fetch(`${WFIRMA_HOST}/start`, {
    method: 'GET',
    redirect: 'follow',
    headers: { 'User-Agent': UA, Accept: 'text/html', Cookie: cookieHeader(jar) },
  })
  parseSetCookie(res.headers, jar)
  const finalHtml = await res.text()
  const wfToken = extractDataToken(finalHtml) ?? tokenFromCookies(jar)
  if (!wfToken) {
    return { ok: false, reason: 'no_wf_token', details: finalHtml.slice(0, 500) }
  }

  return { ok: true, session: { cookies: cookieHeader(jar), wfToken } }
}

/**
 * Шаг 1 OCR: POST /common_files/add/DocumentOcr — multipart upload файла.
 * Возвращает file id из CommonFile.
 */
async function uploadCommonFile(
  session: WebSession,
  file: { name: string; mime: string; bytes: Uint8Array },
): Promise<{ ok: true; fileId: number } | { ok: false; details: string }> {
  const formData = new FormData()
  formData.append('file', new Blob([file.bytes], { type: file.mime }), file.name)

  const res = await fetch(`${WFIRMA_HOST}/common_files/add/DocumentOcr`, {
    method: 'POST',
    headers: {
      accept: 'application/json, text/javascript, */*; q=0.01',
      origin: WFIRMA_HOST,
      referer: `${WFIRMA_HOST}/start`,
      'user-agent': UA,
      'x-file-name': encodeURIComponent(file.name),
      'x-file-size': String(file.bytes.byteLength),
      'x-file-type': file.mime,
      'x-requested-with': 'XMLHttpRequest',
      'x-wf-token': session.wfToken,
      cookie: session.cookies,
    },
    body: formData,
  })

  const text = await res.text()
  if (!res.ok) {
    return { ok: false, details: `HTTP ${res.status}: ${text.slice(0, 400)}` }
  }

  let json: { status?: string; data?: { CommonFile?: { id?: number } } }
  try {
    json = JSON.parse(text)
  } catch {
    return { ok: false, details: `non-JSON response: ${text.slice(0, 400)}` }
  }
  if (json.status !== 'OK') {
    return { ok: false, details: `status=${json.status}: ${text.slice(0, 400)}` }
  }
  const fileId = json.data?.CommonFile?.id
  if (!fileId || typeof fileId !== 'number') {
    return { ok: false, details: `no file id in response: ${text.slice(0, 400)}` }
  }
  return { ok: true, fileId }
}

/**
 * Шаг 2 OCR: POST /documents/addOcrFileToReadSystemFolder/<id> — триггер
 * парсинга. wFirma подхватит файл и сама создаст expense + распознает поля.
 */
async function triggerOcrProcessing(
  session: WebSession,
  fileId: number,
): Promise<{ ok: true } | { ok: false; details: string }> {
  const res = await fetch(`${WFIRMA_HOST}/documents/addOcrFileToReadSystemFolder/${fileId}`, {
    method: 'POST',
    headers: {
      accept: '*/*',
      origin: WFIRMA_HOST,
      referer: `${WFIRMA_HOST}/start`,
      'user-agent': UA,
      'x-requested-with': 'XMLHttpRequest',
      'x-wf-token': session.wfToken,
      cookie: session.cookies,
    },
  })
  const text = await res.text()
  if (!res.ok) {
    return { ok: false, details: `HTTP ${res.status}: ${text.slice(0, 400)}` }
  }
  try {
    const json = JSON.parse(text) as { status?: string }
    if (json.status !== 'OK') {
      return { ok: false, details: `status=${json.status}: ${text.slice(0, 400)}` }
    }
  } catch {
    return { ok: false, details: `non-JSON response: ${text.slice(0, 400)}` }
  }
  return { ok: true }
}

/**
 * Полный flow: login → upload → trigger OCR. Возвращает documentId если
 * успешно (это id который в Document → CommonFile, можно использовать
 * для последующих запросов).
 */
export async function pushReceiptToWfirmaOcr(
  email: string,
  password: string,
  selectedCompanyId: string | undefined,
  file: { name: string; mime: string; bytes: Uint8Array },
): Promise<OcrFlowResult> {
  const login = await loginToWfirmaWeb(email, password, selectedCompanyId)
  if (!login.ok) {
    return {
      ok: false,
      reason: login.reason === 'no_wf_token' ? 'token_extraction_failed' : 'login_failed',
      details: login.details ?? login.reason,
    }
  }
  const upload = await uploadCommonFile(login.session, file)
  if (!upload.ok) {
    return { ok: false, reason: 'upload_failed', details: upload.details }
  }
  const trigger = await triggerOcrProcessing(login.session, upload.fileId)
  if (!trigger.ok) {
    return { ok: false, reason: 'trigger_failed', details: trigger.details }
  }
  return { ok: true, documentId: upload.fileId }
}
