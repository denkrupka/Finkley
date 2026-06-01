/**
 * Минимальный клиент Fakturownia REST API.
 * Документация: https://app.fakturownia.pl/api
 *
 * Auth — `api_token` query parameter.
 *
 * Fakturownia не разделяет sales/purchase в URL — есть единый ресурс
 * `/invoices.json` с фильтром `income=no` для покупных (расходных).
 *
 * Endpoints:
 *   GET  /invoices.json?income=no&period=...&page=...&per_page=...&api_token=...
 *   GET  /invoices/{id}.json?api_token=...
 *   GET  /invoices/{id}.pdf?api_token=...
 *   POST /invoices.json  (body: { api_token, invoice: {...} })
 *
 * Базовый URL — `https://<subdomain>.fakturownia.pl`. Юзер указывает subdomain
 * при подключении (часть ДО `.fakturownia.pl`).
 */

export type FakturowniaCreds = {
  subdomain: string
  apiToken: string
}

export type FakturowniaExpense = {
  id: number
  number: string | null
  expense_date: string | null // yyyy-mm-dd (issue_date)
  payment_date: string | null
  amount: number | null // brutto
  /** price_net — нетто из Fakturownia, для VAT-расчёта. */
  amount_net: number | null
  /** price_tax — сумма НДС, для расчёта ставки = tax/net*100. */
  amount_tax: number | null
  currency: string | null
  buyer_name: string | null // фактически = nasza firma (sprzedawca в income=yes; в income=no — то наоборот, sprzedawca = поставщик)
  seller_name: string | null
  seller_tax_no: string | null // NIP поставщика
  ksef_number: string | null // NumerKSeF, если фактура из КСеФ
  category: string | null
  description: string | null
  paid: boolean
}

export type FakturowniaError = {
  ok: false
  code: 'NETWORK' | 'AUTH' | 'PARSE' | 'HTTP'
  status?: number
  message?: string
}

function baseUrl(subdomain: string): string {
  // Чистим subdomain от опечаток (юзер мог вписать https://, .fakturownia.pl и т.п.)
  const clean = subdomain
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\.fakturownia\.pl.*$/, '')
    .replace(/\/.*$/, '')
  return `https://${clean}.fakturownia.pl`
}

/**
 * Smoke-тест credentials: просим первую страницу invoices.json. 200 + JSON
 * означает что (а) subdomain правильный, (б) api_token валиден.
 */
export async function fakturowniaPing(
  creds: FakturowniaCreds,
): Promise<{ ok: true } | FakturowniaError> {
  try {
    const url = `${baseUrl(creds.subdomain)}/invoices.json?per_page=1&api_token=${encodeURIComponent(creds.apiToken)}`
    const res = await fetch(url, { headers: { Accept: 'application/json' } })
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

/**
 * Список покупных фактур (income=no) от заданной даты. Возвращает список +
 * флаг hasMore для дальнейшей пагинации.
 *
 * Fakturownia поддерживает `period` (this_month/last_month/...) и точные
 * `date_from`/`date_to`. Используем `date_from` для инкрементального синка.
 */
export async function fakturowniaListExpenses(
  creds: FakturowniaCreds,
  opts: { sinceDate: string; page: number; perPage: number },
): Promise<{ ok: true; expenses: FakturowniaExpense[]; hasMore: boolean } | FakturowniaError> {
  try {
    const params = new URLSearchParams({
      api_token: creds.apiToken,
      income: 'no',
      page: String(opts.page),
      per_page: String(opts.perPage),
      date_from: opts.sinceDate,
      period: 'more',
    })
    const res = await fetch(`${baseUrl(creds.subdomain)}/invoices.json?${params.toString()}`, {
      headers: { Accept: 'application/json' },
    })
    if (res.status === 401 || res.status === 403) {
      return { ok: false, code: 'AUTH', status: res.status }
    }
    if (!res.ok) {
      const text = await res.text()
      return { ok: false, code: 'HTTP', status: res.status, message: text.slice(0, 300) }
    }
    const arr = (await res.json()) as Array<Record<string, unknown>>
    const expenses: FakturowniaExpense[] = (Array.isArray(arr) ? arr : []).map((r) => ({
      id: typeof r.id === 'number' ? r.id : Number(r.id),
      number: typeof r.number === 'string' ? r.number : null,
      expense_date: typeof r.issue_date === 'string' ? r.issue_date.slice(0, 10) : null,
      payment_date: typeof r.payment_to === 'string' ? r.payment_to.slice(0, 10) : null,
      amount:
        typeof r.price_gross === 'string'
          ? parseFloat(r.price_gross)
          : ((r.price_gross as number) ?? null),
      amount_net:
        typeof r.price_net === 'string'
          ? parseFloat(r.price_net)
          : typeof r.price_net === 'number'
            ? r.price_net
            : null,
      amount_tax:
        typeof r.price_tax === 'string'
          ? parseFloat(r.price_tax)
          : typeof r.price_tax === 'number'
            ? r.price_tax
            : null,
      currency: typeof r.currency === 'string' ? r.currency.toUpperCase() : 'PLN',
      // В income=no: «продавец» с точки зрения Fakturownia — это поставщик
      // (sprzedawca в фактуре закупа). «Buyer» — наша фирма.
      seller_name: typeof r.seller_name === 'string' ? r.seller_name : null,
      seller_tax_no: typeof r.seller_tax_no === 'string' ? r.seller_tax_no : null,
      buyer_name: typeof r.buyer_name === 'string' ? r.buyer_name : null,
      ksef_number: typeof r.ksef_number === 'string' ? r.ksef_number : null,
      category: typeof r.category === 'string' ? r.category : null,
      description: typeof r.description === 'string' ? r.description : null,
      paid: r.paid === true || r.paid === 'true',
    }))
    return { ok: true, expenses, hasMore: expenses.length === opts.perPage }
  } catch (e) {
    return { ok: false, code: 'NETWORK', message: e instanceof Error ? e.message : String(e) }
  }
}

/**
 * Best-effort скачивание PDF фактуры через `/invoices/{id}.pdf?api_token=...`.
 * На 404 — null без ошибки (некоторые черновики не имеют PDF).
 */
export async function fakturowniaGetExpensePdf(
  creds: FakturowniaCreds,
  expenseId: string,
): Promise<Uint8Array | null> {
  try {
    const url = `${baseUrl(creds.subdomain)}/invoices/${encodeURIComponent(expenseId)}.pdf?api_token=${encodeURIComponent(creds.apiToken)}`
    const res = await fetch(url, { headers: { Accept: 'application/pdf' } })
    if (!res.ok) return null
    const buf = new Uint8Array(await res.arrayBuffer())
    return buf.byteLength > 0 ? buf : null
  } catch {
    return null
  }
}

export type FakturowniaPushInput = {
  expenseAt: string // yyyy-mm-dd
  amount: number // brutto
  currency: string
  vendor: string
  vendorNip: string | null
  description: string | null
  invoiceNumber: string | null
}

/**
 * Создаёт расходную фактуру (income=no). В Fakturownia это та же сущность
 * `Invoice` что и продажная, только с другим направлением. Заполняем
 * `seller_*` нашим контрагентом-поставщиком, `buyer_*` фактической нашей
 * фирмой (но Fakturownia берёт buyer из аккаунта если не указано).
 */
export async function fakturowniaCreateExpense(
  creds: FakturowniaCreds,
  input: FakturowniaPushInput,
): Promise<{ ok: true; id: string } | FakturowniaError> {
  try {
    const body = {
      api_token: creds.apiToken,
      invoice: {
        kind: 'vat',
        income: false,
        number: input.invoiceNumber ?? undefined,
        issue_date: input.expenseAt,
        sell_date: input.expenseAt,
        currency: input.currency,
        description: input.description ?? input.vendor,
        seller_name: input.vendor,
        seller_tax_no: input.vendorNip ?? undefined,
        positions: [
          {
            name: input.description ?? input.vendor,
            tax: 23,
            total_price_gross: input.amount.toFixed(2),
            quantity: 1,
          },
        ],
      },
    }
    const res = await fetch(`${baseUrl(creds.subdomain)}/invoices.json`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
    })
    if (res.status === 401 || res.status === 403) {
      return { ok: false, code: 'AUTH', status: res.status }
    }
    if (!res.ok) {
      const text = await res.text()
      return { ok: false, code: 'HTTP', status: res.status, message: text.slice(0, 300) }
    }
    const json = (await res.json()) as { id?: number | string }
    if (json.id == null) return { ok: false, code: 'PARSE', message: 'no_id_in_response' }
    return { ok: true, id: String(json.id) }
  } catch (e) {
    return { ok: false, code: 'NETWORK', message: e instanceof Error ? e.message : String(e) }
  }
}
