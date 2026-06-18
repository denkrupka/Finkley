/**
 * Минимальный Stripe HTTP клиент для edge functions.
 *
 * Не используем npm-пакет `stripe` — он толстый, тянет node-полифилы и неприятен
 * в Deno-runtime. Делаем тонкие fetch-обёртки на нужный subset API:
 * - POST /v1/checkout/sessions
 * - POST /v1/billing_portal/sessions
 * - GET  /v1/customers
 * - POST /v1/customers
 *
 * Webhook signature verification — отдельная функция `verifyStripeSignature`
 * с константно-временным сравнением.
 */

const API = 'https://api.stripe.com/v1'

function form(body: Record<string, unknown>): URLSearchParams {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(body)) {
    if (value === undefined || value === null) continue
    if (typeof value === 'object') {
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        if (v === undefined || v === null) continue
        params.append(`${key}[${k}]`, String(v))
      }
    } else {
      params.append(key, String(value))
    }
  }
  return params
}

async function call<T>(path: string, secret: string, body?: Record<string, unknown>): Promise<T> {
  const res = await fetch(API + path, {
    method: body ? 'POST' : 'GET',
    headers: {
      Authorization: `Bearer ${secret}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body ? form(body).toString() : undefined,
  })
  const json = (await res.json()) as T & { error?: { message?: string; type?: string } }
  if (!res.ok) {
    throw new Error(`stripe ${path}: ${json.error?.message ?? res.statusText}`)
  }
  return json
}

export type StripeCheckoutSession = {
  id: string
  url: string
  customer: string | null
  subscription: string | null
}

export async function createCheckoutSession(
  secret: string,
  input: {
    price: string
    customerEmail: string
    salonId: string
    successUrl: string
    cancelUrl: string
    /** дней триала; 0 = без триала */
    trialDays?: number
    /** существующий stripe_customer_id, если уже создан */
    customerId?: string | null
  },
): Promise<StripeCheckoutSession> {
  const body: Record<string, unknown> = {
    mode: 'subscription',
    'line_items[0][price]': input.price,
    'line_items[0][quantity]': 1,
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
    'metadata[salon_id]': input.salonId,
    'subscription_data[metadata][salon_id]': input.salonId,
    // Владелец освобождён от НДС (оборот < 240k/год, mały podatnik) → налог НЕ
    // добавляем: клиент платит ровно сумму тарифа (нетто = брутто). Когда
    // появится обязанность по НДС — вернуть automatic_tax + tax_id_collection.
    automatic_tax: { enabled: 'false' },
    billing_address_collection: 'auto',
    // Включаем встроенный «Add promotion code» на Stripe Checkout странице.
    // Юзер вводит BETA3M (или другой активный promo) — Stripe сам валидирует
    // и применяет скидку. Свой UI не нужен.
    allow_promotion_codes: 'true',
  }
  if (input.trialDays && input.trialDays > 0) {
    body['subscription_data[trial_period_days]'] = input.trialDays
  }
  if (input.customerId) {
    // Существующий customer — Stripe позволит обновить его address/name
    // данными из чекаута (нужно для automatic_tax: VAT-логика по адресу).
    body.customer = input.customerId
    body.customer_update = { address: 'auto', name: 'auto' }
  } else {
    // Новый customer — Stripe создаст его сам из email + введённых данных,
    // customer_update тут запрещён ("can only be used with customer").
    body.customer_email = input.customerEmail
  }
  return call<StripeCheckoutSession>('/checkout/sessions', secret, body)
}

/**
 * One-time payment checkout (mode=payment) для разовых покупок
 * с inline price_data — не нужно создавать Product в Stripe Dashboard.
 * Используется для SMS-пакетов и покупки sender names.
 */
export async function createOneTimeCheckout(
  secret: string,
  input: {
    /** Сумма в наименьших единицах валюты (для PLN — гроши). */
    amountMinor: number
    currency: string
    productName: string
    productDescription?: string
    customerEmail?: string
    customerId?: string | null
    salonId: string
    /** Произвольные метаданные — попадут в session.metadata в webhook. */
    metadata: Record<string, string>
    successUrl: string
    cancelUrl: string
  },
): Promise<StripeCheckoutSession> {
  const body: Record<string, unknown> = {
    mode: 'payment',
    'line_items[0][price_data][currency]': input.currency,
    'line_items[0][price_data][unit_amount]': input.amountMinor,
    'line_items[0][price_data][product_data][name]': input.productName,
    'line_items[0][quantity]': 1,
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
    'metadata[salon_id]': input.salonId,
    'payment_intent_data[metadata][salon_id]': input.salonId,
    // VAT-exempt владелец — налог не добавляем (нетто = брутто).
    automatic_tax: { enabled: 'false' },
    billing_address_collection: 'auto',
  }
  if (input.productDescription) {
    body['line_items[0][price_data][product_data][description]'] = input.productDescription
  }
  for (const [k, v] of Object.entries(input.metadata)) {
    body[`metadata[${k}]`] = v
    body[`payment_intent_data[metadata][${k}]`] = v
  }
  if (input.customerId) {
    body.customer = input.customerId
    body.customer_update = { address: 'auto', name: 'auto' }
  } else if (input.customerEmail) {
    body.customer_email = input.customerEmail
  }
  return call<StripeCheckoutSession>('/checkout/sessions', secret, body)
}

export type StripePortalSession = { id: string; url: string }

export async function createPortalSession(
  secret: string,
  input: { customerId: string; returnUrl: string },
): Promise<StripePortalSession> {
  return call<StripePortalSession>('/billing_portal/sessions', secret, {
    customer: input.customerId,
    return_url: input.returnUrl,
  })
}

/**
 * Проверка подписи Stripe (webhook).
 * Формат заголовка `Stripe-Signature`:
 *   t=<timestamp>,v1=<sig>,v0=<old_sig>
 *
 * https://docs.stripe.com/webhooks#verify-manually
 */
export async function verifyStripeSignature(
  rawBody: string,
  signatureHeader: string,
  secret: string,
  toleranceSec = 300,
): Promise<boolean> {
  const parts = signatureHeader.split(',').reduce(
    (acc, p) => {
      const [k, v] = p.trim().split('=')
      if (k && v) acc[k] = v
      return acc
    },
    {} as Record<string, string>,
  )
  const t = parts.t
  const v1 = parts.v1
  if (!t || !v1) return false
  const ageSec = Math.abs(Math.floor(Date.now() / 1000) - Number(t))
  if (Number.isNaN(ageSec) || ageSec > toleranceSec) return false

  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(`${t}.${rawBody}`))
  const computed = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')

  // Constant-time compare
  if (computed.length !== v1.length) return false
  let diff = 0
  for (let i = 0; i < computed.length; i++) {
    diff |= computed.charCodeAt(i) ^ v1.charCodeAt(i)
  }
  return diff === 0
}
