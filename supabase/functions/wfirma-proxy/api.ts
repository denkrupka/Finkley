/**
 * api.ts — клиент к публичному wFirma API (api2.wfirma.pl).
 *
 * Auth: 3 хедера accessKey + secretKey + appKey (см. ADR-012).
 * Format: XML POST/GET, мы используем outputFormat=json для удобства.
 */

const API_BASE = 'https://api2.wfirma.pl'

export type WfirmaApiCreds = {
  accessKey: string
  secretKey: string
  appKey: string
  companyId?: string
}

type WfirmaApiResp<T> = {
  status: { code: string }
} & T

export type WfirmaCompany = {
  id: string
  name: string
  nip: string
  vat_payer?: string
}

// WfirmaExpense type удалён — pull-синк больше не используется (06.06).

function authHeaders(creds: WfirmaApiCreds): HeadersInit {
  return {
    accessKey: creds.accessKey,
    secretKey: creds.secretKey,
    appKey: creds.appKey,
    Accept: 'application/json',
  }
}

/**
 * Вызов JSON-эндпоинта wFirma. Тело — JSON-payload в формате wFirma:
 *   { api: { <module>: { ... } } }
 */
export async function wfirmaCall<T = unknown>(
  path: string,
  creds: WfirmaApiCreds,
  payload?: unknown,
): Promise<{ ok: true; data: T } | { ok: false; status: number; code: string; raw: string }> {
  const url = new URL(`${API_BASE}${path}`)
  url.searchParams.set('inputFormat', 'json')
  url.searchParams.set('outputFormat', 'json')
  if (creds.companyId) url.searchParams.set('company_id', creds.companyId)

  const res = await fetch(url.toString(), {
    method: 'POST',
    headers: { ...authHeaders(creds), 'Content-Type': 'application/json' },
    body: payload ? JSON.stringify(payload) : '{}',
  })
  const raw = await res.text()
  let parsed: WfirmaApiResp<T> | null = null
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { ok: false, status: res.status, code: 'PARSE_ERROR', raw: raw.slice(0, 400) }
  }
  if (!parsed || parsed.status?.code !== 'OK') {
    return {
      ok: false,
      status: res.status,
      code: parsed?.status?.code ?? `HTTP_${res.status}`,
      raw: raw.slice(0, 400),
    }
  }
  return { ok: true, data: parsed as T }
}

/**
 * Список компаний пользователя. Чаще всего одна — берём первую.
 * Возвращает { id, name, nip, vat_payer }.
 */
export async function wfirmaCompaniesFind(
  creds: WfirmaApiCreds,
): Promise<{ ok: true; companies: WfirmaCompany[] } | { ok: false; code: string }> {
  type Resp = { companies?: { company?: WfirmaCompany | WfirmaCompany[] } }
  const res = await wfirmaCall<Resp>('/companies/find', creds)
  if (!res.ok) return { ok: false, code: res.code }
  const c = res.data.companies?.company
  const arr = !c ? [] : Array.isArray(c) ? c : [c]
  return { ok: true, companies: arr }
}

// NOTE 06.06: wfirmaExpensesFind/Get/PDF/Add удалены — pull-синк больше не
// используется (миграция 20260606000001_drop_wfirma_sync). wFirma теперь
// получает расходы через OCR upload (см. ocr-flow.ts в commit 2).
