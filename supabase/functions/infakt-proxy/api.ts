/**
 * Минимальный клиент inFakt API.
 * Документация (требует партнёрского доступа): https://api.infakt.pl/v3/
 *
 * Auth — header `X-inFakt-ApiKey: <api_token>`.
 *
 * NB: партнёрский доступ к API inFakt выдаётся по email-заявке (1-2 недели).
 * До получения ключей все запросы получают 401 — функция корректно отражает
 * это в UI как `infakt_invalid_credentials`.
 *
 * Endpoints:
 *   GET  /v3/account.json                      — smoke-test (info об аккаунте)
 *   GET  /v3/expenses.json?from=&to=&offset=
 *   POST /v3/expenses.json                     — push
 */

const BASE = 'https://api.infakt.pl'

export type InfaktCreds = { apiToken: string }

export type InfaktExpense = {
  id: string
  number: string | null
  expenseDate: string | null
  paymentDate: string | null
  amount: number | null
  currency: string
  vendorName: string | null
  vendorNip: string | null
  description: string | null
  ksefNumber: string | null
}

export type InfaktError = {
  ok: false
  code: 'NETWORK' | 'AUTH' | 'PARSE' | 'HTTP'
  status?: number
  message?: string
}

function authHeaders(creds: InfaktCreds): HeadersInit {
  return {
    'X-inFakt-ApiKey': creds.apiToken,
    Accept: 'application/json',
  }
}

export async function infaktPing(creds: InfaktCreds): Promise<{ ok: true } | InfaktError> {
  try {
    const res = await fetch(`${BASE}/v3/account.json`, { headers: authHeaders(creds) })
    if (res.status === 401 || res.status === 403) {
      return { ok: false, code: 'AUTH', status: res.status }
    }
    if (!res.ok) {
      const text = await res.text()
      return { ok: false, code: 'HTTP', status: res.status, message: text.slice(0, 300) }
    }
    return { ok: true }
  } catch (e) {
    return { ok: false, code: 'NETWORK', message: e instanceof Error ? e.message : String(e) }
  }
}

export async function infaktListExpenses(
  creds: InfaktCreds,
  opts: { sinceDate: string; offset: number },
): Promise<{ ok: true; expenses: InfaktExpense[]; hasMore: boolean } | InfaktError> {
  const today = new Date().toISOString().slice(0, 10)
  const params = new URLSearchParams({
    'q[paid_date_gteq]': opts.sinceDate,
    'q[paid_date_lteq]': today,
    offset: String(opts.offset),
    limit: '100',
  })
  try {
    const res = await fetch(`${BASE}/v3/expenses.json?${params.toString()}`, {
      headers: authHeaders(creds),
    })
    if (res.status === 401 || res.status === 403) {
      return { ok: false, code: 'AUTH', status: res.status }
    }
    if (!res.ok) {
      const text = await res.text()
      return { ok: false, code: 'HTTP', status: res.status, message: text.slice(0, 300) }
    }
    const json = (await res.json()) as {
      entities?: Array<Record<string, unknown>>
      metainfo?: { total_count?: number }
    }
    const arr = Array.isArray(json.entities) ? json.entities : []
    const expenses: InfaktExpense[] = arr.map((r) => ({
      id: String(r.id ?? r.uuid ?? ''),
      number: typeof r.number === 'string' ? r.number : null,
      expenseDate: typeof r.invoice_date === 'string' ? r.invoice_date.slice(0, 10) : null,
      paymentDate: typeof r.paid_date === 'string' ? r.paid_date.slice(0, 10) : null,
      amount:
        typeof r.gross_price === 'number'
          ? r.gross_price / 100
          : typeof r.gross_price === 'string'
            ? parseFloat(r.gross_price) / 100
            : null,
      currency: typeof r.currency === 'string' ? r.currency.toUpperCase() : 'PLN',
      vendorName: typeof r.seller_name === 'string' ? r.seller_name : null,
      vendorNip: typeof r.seller_tax_code === 'string' ? r.seller_tax_code : null,
      description: typeof r.description === 'string' ? r.description : null,
      ksefNumber: typeof r.ksef_number === 'string' ? r.ksef_number : null,
    }))
    const total = json.metainfo?.total_count
    const hasMore = typeof total === 'number' ? opts.offset + arr.length < total : arr.length >= 100
    return { ok: true, expenses: expenses.filter((e) => !!e.id), hasMore }
  } catch (e) {
    return { ok: false, code: 'NETWORK', message: e instanceof Error ? e.message : String(e) }
  }
}

/**
 * Best-effort PDF фактуры через `/v3/expenses/{id}/pdf`. Если inFakt
 * не отдаёт PDF (404/auth) — null.
 */
export async function infaktGetExpensePdf(
  creds: InfaktCreds,
  expenseId: string,
): Promise<Uint8Array | null> {
  try {
    const res = await fetch(`${BASE}/v3/expenses/${encodeURIComponent(expenseId)}/pdf`, {
      headers: { ...authHeaders(creds), Accept: 'application/pdf' },
    })
    if (!res.ok) return null
    const buf = new Uint8Array(await res.arrayBuffer())
    return buf.byteLength > 0 ? buf : null
  } catch {
    return null
  }
}

export type InfaktPushInput = {
  expenseAt: string
  amount: number // PLN
  currency: string
  vendor: string
  vendorNip: string | null
  description: string | null
  invoiceNumber: string | null
}

export async function infaktCreateExpense(
  creds: InfaktCreds,
  input: InfaktPushInput,
): Promise<{ ok: true; id: string } | InfaktError> {
  try {
    const body = {
      expense: {
        invoice_date: input.expenseAt,
        paid_date: input.expenseAt,
        gross_price: Math.round(input.amount * 100),
        currency: input.currency,
        seller_name: input.vendor,
        seller_tax_code: input.vendorNip,
        number: input.invoiceNumber,
        description: input.description,
      },
    }
    const res = await fetch(`${BASE}/v3/expenses.json`, {
      method: 'POST',
      headers: { ...authHeaders(creds), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (res.status === 401 || res.status === 403) {
      return { ok: false, code: 'AUTH', status: res.status }
    }
    if (!res.ok) {
      const text = await res.text()
      return { ok: false, code: 'HTTP', status: res.status, message: text.slice(0, 300) }
    }
    const json = (await res.json()) as { id?: number | string; uuid?: string }
    const id = json.id ?? json.uuid
    if (id == null) return { ok: false, code: 'PARSE', message: 'no_id_in_response' }
    return { ok: true, id: String(id) }
  } catch (e) {
    return { ok: false, code: 'NETWORK', message: e instanceof Error ? e.message : String(e) }
  }
}
