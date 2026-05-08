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

export type WfirmaExpense = {
  id: string
  total?: string
  netto?: string
  vat?: string
  currency?: string
  date?: string
  paid_date?: string
  number?: string
  name?: string
  description?: string
  contractor?: { id?: string; name?: string; nip?: string }
  ksef_id?: string
  type?: string // invoice | bill | vat_exempt
}

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

/** Закупочные фактуры за период. */
export async function wfirmaExpensesFind(
  creds: WfirmaApiCreds,
  sinceISO: string,
): Promise<{ ok: true; expenses: WfirmaExpense[] } | { ok: false; code: string }> {
  // wFirma `/expenses/find` принимает фильтр по date >= since
  const payload = {
    api: {
      expenses: {
        parameters: {
          conditions: {
            condition: [{ field: 'date', operator: 'ge', value: sinceISO }],
          },
          limit: 200,
          page: 1,
          order: { asc: 'date' },
        },
      },
    },
  }
  type Resp = { expenses?: { expense?: WfirmaExpense | WfirmaExpense[] } }
  const res = await wfirmaCall<Resp>('/expenses/find', creds, payload)
  if (!res.ok) return { ok: false, code: res.code }
  const e = res.data.expenses?.expense
  const arr = !e ? [] : Array.isArray(e) ? e : [e]
  return { ok: true, expenses: arr }
}

/**
 * Скачать PDF одной закупочной фактуры. wFirma поддерживает endpoint
 * `/expenses/download/{id}?page=invoice` который отдаёт application/pdf.
 *
 * Возвращаем bytes, либо null если wFirma вернула не PDF (например текстовая
 * квитанция bill, без файла). Sync не должен падать из-за этого — используется
 * best-effort.
 */
export async function wfirmaExpensePdf(
  creds: WfirmaApiCreds,
  expenseId: string,
): Promise<Uint8Array | null> {
  const url = new URL(`${API_BASE}/expenses/download/${expenseId}`)
  url.searchParams.set('page', 'invoice')
  if (creds.companyId) url.searchParams.set('company_id', creds.companyId)
  try {
    const res = await fetch(url.toString(), {
      method: 'GET',
      headers: authHeaders(creds),
    })
    if (!res.ok) return null
    const ct = res.headers.get('content-type') ?? ''
    if (!ct.toLowerCase().includes('pdf')) return null
    const buf = await res.arrayBuffer()
    if (buf.byteLength === 0) return null
    return new Uint8Array(buf)
  } catch (e) {
    console.warn('wfirmaExpensePdf failed', expenseId, e)
    return null
  }
}

/** Полные детали одной фактуры (включая ksef_id, contractor.nip). */
export async function wfirmaExpenseGet(
  creds: WfirmaApiCreds,
  expenseId: string,
): Promise<{ ok: true; expense: WfirmaExpense } | { ok: false; code: string }> {
  type Resp = { expenses?: { expense?: WfirmaExpense } }
  const res = await wfirmaCall<Resp>(`/expenses/get/${expenseId}`, creds)
  if (!res.ok) return { ok: false, code: res.code }
  if (!res.data.expenses?.expense) return { ok: false, code: 'NOT_FOUND' }
  return { ok: true, expense: res.data.expenses.expense }
}

/**
 * Создать расход в wFirma из нашего expense.
 * Если у nас есть NIP контрагента — type=invoice (фактура), иначе bill (rachunek).
 * Сумма в злотых (decimal). wFirma сама конвертит EUR/USD по курсу NBP.
 */
export type PushExpenseInput = {
  expenseAt: string // YYYY-MM-DD
  amount: number // decimal в исходной валюте (например 123.45)
  currency: string // 'PLN' | 'EUR' | ...
  vendor: string
  vendorNip?: string | null
  description?: string | null
  invoiceNumber?: string | null
}

export async function wfirmaExpenseAdd(
  creds: WfirmaApiCreds,
  input: PushExpenseInput,
): Promise<{ ok: true; wfirmaId: string } | { ok: false; code: string; raw?: string }> {
  const isInvoice = !!input.vendorNip && /^\d{10}$/.test(input.vendorNip.replace(/\D/g, ''))
  const expenseType = isInvoice ? 'invoice' : 'bill'

  // wFirma payload — упрощённый, без VAT-разбивки (для MVP).
  // Это покрывает большинство кейсов «пустой расход за услуги/товары».
  const payload = {
    api: {
      expenses: {
        expense: {
          type: expenseType,
          name: input.description?.slice(0, 80) || input.vendor,
          number: input.invoiceNumber || `Finkley-${input.expenseAt}`,
          date: input.expenseAt,
          paid_date: input.expenseAt,
          currency: input.currency,
          total: input.amount.toFixed(2),
          contractor_detail: isInvoice
            ? {
                name: input.vendor,
                nip: input.vendorNip,
                country: 'PL',
              }
            : {
                name: input.vendor,
              },
        },
      },
    },
  }
  type Resp = { expenses?: { expense?: { id?: string } } }
  const res = await wfirmaCall<Resp>('/expenses/add', creds, payload)
  if (!res.ok) return { ok: false, code: res.code, raw: res.raw }
  const id = res.data.expenses?.expense?.id
  if (!id) return { ok: false, code: 'NO_ID_IN_RESPONSE' }
  return { ok: true, wfirmaId: id }
}
