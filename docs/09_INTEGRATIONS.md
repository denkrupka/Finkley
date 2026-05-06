# 09. Integrations

Все внешние сервисы — что используют, как настраивать, какие edge functions их вызывают.

## Stripe

**Используется для:** платежи, подписки, VAT (через Stripe Tax).

### Настройка

1. Аккаунт Stripe, активирован (требуется юр.инфо: PL JDG)
2. Stripe Tax → Activate
3. Tax registration: PL VAT, EU OSS если нужно
4. Создать Product "Finkley Standard"
5. Создать Price: €15 monthly recurring
6. Включить Customer Portal
7. Webhook endpoint: `https://<prod-ref>.functions.supabase.co/stripe-webhook`
8. События: `checkout.session.completed`, `customer.subscription.*`, `invoice.payment_succeeded`, `invoice.payment_failed`

### Чекаут флоу

Клиент:

```typescript
async function startCheckout(salonId: string) {
  const { data } = await supabase.functions.invoke('create-checkout-session', {
    body: { salonId, priceId: import.meta.env.VITE_STRIPE_PRICE_ID },
  })
  window.location.href = data.url
}
```

Edge function `create-checkout-session`:

```typescript
import Stripe from 'https://esm.sh/stripe@14?target=denonext'

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!)

export async function handler(req: Request) {
  const { salonId, priceId } = await req.json()
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    line_items: [{ price: priceId, quantity: 1 }],
    subscription_data: { trial_period_days: 14 },
    customer_email: user.email,
    metadata: { salon_id: salonId },
    automatic_tax: { enabled: true },
    success_url: `${SITE_URL}/${salonId}/billing?success=true`,
    cancel_url: `${SITE_URL}/${salonId}/billing?canceled=true`,
  })
  return new Response(JSON.stringify({ url: session.url }))
}
```

### Webhook

```typescript
const sig = req.headers.get('stripe-signature')!
const body = await req.text()
const event = stripe.webhooks.constructEvent(body, sig, Deno.env.get('STRIPE_WEBHOOK_SECRET')!)

switch (event.type) {
  case 'checkout.session.completed': {
    const session = event.data.object
    const sub = await stripe.subscriptions.retrieve(session.subscription as string)
    await supabaseAdmin.from('salon_subscriptions').upsert({
      salon_id: session.metadata.salon_id,
      stripe_customer_id: session.customer,
      stripe_subscription_id: sub.id,
      stripe_price_id: sub.items.data[0].price.id,
      status: sub.status,
      trial_ends_at: sub.trial_end ? new Date(sub.trial_end * 1000).toISOString() : null,
      current_period_start: new Date(sub.current_period_start * 1000).toISOString(),
      current_period_end: new Date(sub.current_period_end * 1000).toISOString(),
    })
    break
  }
  // ... остальные events
}
return new Response('ok')
```

ADR: `decisions/006-stripe-integration.md`

---

## Postmark

**Используется для:** транзакционные email + SMTP для Supabase Auth.

### Настройка

1. Server "Finkley Production" в Postmark
2. Verify domain: DKIM, SPF, DMARC
3. Sender Signature: `noreply@finkley.eu`
4. Templates: welcome, email-confirmation, password-reset, trial-ending, payment-succeeded, payment-failed, subscription-canceled, weekly-digest

### Supabase Auth с Postmark SMTP

Settings → Authentication → SMTP:

- Host: `smtp.postmarkapp.com`
- Port: 587
- Username/Password: API token Postmark
- Sender: `noreply@finkley.eu`

### Edge function `send-email`

```typescript
import { ServerClient } from 'https://esm.sh/postmark@4'
const postmark = new ServerClient(Deno.env.get('POSTMARK_SERVER_TOKEN')!)

export async function sendTemplatedEmail({ to, templateAlias, templateModel }) {
  return await postmark.sendEmailWithTemplate({
    From: 'Finkley <noreply@finkley.eu>',
    To: to,
    TemplateAlias: templateAlias,
    TemplateModel: templateModel,
    MessageStream: 'outbound',
  })
}
```

---

## Anthropic API (OCR)

**Стадия 3.** Claude Haiku 4.5 для парсинга чеков.

```typescript
export const OCR_SYSTEM_PROMPT = `
Извлеки поля чека и верни JSON:
{
  "date": "YYYY-MM-DD",
  "total_cents": <integer>,
  "currency": "PLN" | "EUR" | "USD",
  "contractor": "<имя>",
  "vat_cents": <integer или null>,
  "invoice_number": "<номер или null>",
  "category_guess": "rent" | "supplies" | "utilities" | "marketing" | "training" | "other",
  "items": [{ "name": "...", "amount_cents": <integer> }],
  "confidence": <float 0..1>
}
Если поле отсутствует — null.
`
```

```typescript
import Anthropic from 'https://esm.sh/@anthropic-ai/sdk@0.30'
const anthropic = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY')! })

export async function handler(req: Request) {
  const { storagePath } = await req.json()
  const { data: file } = await supabaseAdmin.storage.from('receipts').download(storagePath)
  const base64 = btoa(String.fromCharCode(...new Uint8Array(await file.arrayBuffer())))

  try {
    const result = await anthropic.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 1024,
      system: OCR_SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: base64 } },
            { type: 'text', text: 'Распарсь этот чек.' },
          ],
        },
      ],
    })
    return new Response(result.content[0].type === 'text' ? result.content[0].text : '{}')
  } catch (e) {
    return await groqFallback(base64)
  }
}
```

Стоимость: ~$0.001 на чек.

---

## Booksy

**Стратегия:** в стадии 1–2 не делаем. CSV-импорт с дня 1.

В стадии 3 — research-спайк (TASK-27): берём бесплатный паттерн прокси-логина владельца с sasovsky, адаптируем для Booksy.

### Что делает Booksy login

1. Юзер вводит email/пароль Booksy
2. Бэкенд логинится через прокси-паттерн владельца
3. Перехватывается `x-access-token`
4. Токен шифруется (AES-256-GCM) и сохраняется в `integration_credentials.encrypted_payload`

### Структура `encrypted_payload`

```json
{
  "access_token": "...",
  "refresh_token": "...",
  "token_expires_at": "2026-...",
  "biz_id": "<businessId>",
  "user_email": "<email для refresh>"
}
```

### Edge function `booksy-sync` (cron каждые 30 мин)

1. Для каждого salon с активным `integration_credentials provider='booksy'`:
2. Расшифровать токен
3. GET `/core/v2/me/business/{biz_id}/bookings?date_from=...`
4. GET `/core/v2/me/business/{biz_id}/pos/transactions?date_from=...`
5. Маппить в visits с `source='booksy'`, `external_id=booking_id`
6. Upsert по unique(salon_id, source, external_id)
7. При 401 — попытка refresh
8. При 3 fail подряд — email "переподключите Booksy"

### Cron через pg_cron

```sql
create extension if not exists pg_cron;

select cron.schedule(
  'booksy-sync', '*/30 * * * *',
  $$ select net.http_post(
       'https://<ref>.functions.supabase.co/booksy-sync',
       '{}'::jsonb, 'application/json'::text,
       headers := jsonb_build_object('Authorization', 'Bearer ' || current_setting('cron.secret'))
     ) $$
);
```

ADR: `decisions/005-booksy-integration-strategy.md`

---

## wFirma (PL only)

**Стадия 3.**

### API

- docs.wfirma.pl
- Авторизация: `accessKey` + `secretKey`
- Endpoint: `https://api2.wfirma.pl/`

### Хранение

`integration_credentials.encrypted_payload`:

```json
{
  "access_key": "...",
  "secret_key": "...",
  "company_id": "<wFirma company ID>"
}
```

### `wfirma-sync` (cron раз в час)

1. Для каждого PL salon с активным wFirma integration
2. Расшифровать креды
3. GET `/invoices/find` — закупочные фактуры за месяц
4. Маппить в expenses (source='wfirma')
5. Upsert

### `wfirma-push-expense`

- Принимает expense_id
- Собирает XML/JSON для `/invoices/add`
- POST → invoice_id wFirma
- Сохраняет в `expenses.metadata.wfirma_invoice_id`

### KSeF

wFirma уже отправляет в KSeF от имени юзера. Мы следим за статусом через `/invoices/find`.

---

## Telegram Login

### Настройка

1. @BotFather → `/newbot` → токен
2. `/setdomain` → `finkley.eu`
3. Виджет на `/login`:

```html
<script
  async
  src="https://telegram.org/js/telegram-widget.js?22"
  data-telegram-login="<bot_username>"
  data-size="large"
  data-auth-url="https://finkley.eu/auth/telegram/callback"
  data-request-access="write"
></script>
```

### Edge function `telegram-auth`

```typescript
import { createHmac } from 'https://deno.land/std/crypto/mod.ts'

const BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN')!

function verifyTelegramAuth(data: Record<string, string>): boolean {
  const checkHash = data.hash
  const dataCheckString = Object.keys(data)
    .filter((k) => k !== 'hash')
    .sort()
    .map((k) => `${k}=${data[k]}`)
    .join('\n')
  const secretKey = createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest()
  const hmac = createHmac('sha256', secretKey).update(dataCheckString).digest('hex')
  return hmac === checkHash
}

export async function handler(req: Request) {
  const params = Object.fromEntries(new URL(req.url).searchParams)
  if (!verifyTelegramAuth(params)) return new Response('invalid', { status: 401 })
  if (Date.now() / 1000 - Number(params.auth_date) > 300)
    return new Response('stale', { status: 401 })

  const tgId = Number(params.id)
  const { data: existing } = await supabaseAdmin
    .from('profiles')
    .select('id')
    .eq('telegram_id', tgId)
    .single()

  let userId: string
  if (existing) {
    userId = existing.id
  } else {
    const { data: newUser } = await supabaseAdmin.auth.admin.createUser({
      email: `tg_${tgId}@telegram.finkley.eu`,
      email_confirm: true,
      user_metadata: { full_name: `${params.first_name} ${params.last_name || ''}`.trim() },
    })
    userId = newUser.user!.id
    await supabaseAdmin.from('profiles').update({ telegram_id: tgId }).eq('id', userId)
  }

  const { data: session } = await supabaseAdmin.auth.admin.generateLink({
    type: 'magiclink',
    email: `tg_${tgId}@telegram.finkley.eu`,
  })
  return new Response(JSON.stringify({ redirect: session.properties.action_link }))
}
```

ADR: `decisions/009-telegram-auth.md`

---

## Sentry

### Клиент

```typescript
import * as Sentry from '@sentry/react'

Sentry.init({
  dsn: import.meta.env.VITE_SENTRY_DSN,
  environment: import.meta.env.MODE,
  tracesSampleRate: 0.1,
  beforeSend(event) {
    if (event.request?.headers) {
      delete event.request.headers['authorization']
      delete event.request.headers['cookie']
    }
    return event
  },
})
```

### Edge functions

```typescript
import * as Sentry from 'https://esm.sh/@sentry/deno'
Sentry.init({ dsn: Deno.env.get('SENTRY_DSN_SERVER')! })
```

---

## Аналитика

**Plausible cloud:** $9/мес минимум. Trial 30 дней.

**Goatcounter:** бесплатно, no-cookie, EU-friendly:

```html
<script
  data-goatcounter="https://finkley.goatcounter.com/count"
  async
  src="//gc.zgo.at/count.js"
></script>
```

**Рекомендация:** старт на goatcounter, при росте — Plausible.

---

## Сводка cron-задач

| Задача                       | Частота           | Edge function       |
| ---------------------------- | ----------------- | ------------------- |
| Booksy sync                  | каждые 30 мин     | `booksy-sync`       |
| wFirma sync                  | каждый час        | `wfirma-sync`       |
| Trial ending email           | каждый день 09:00 | `check-trials`      |
| Weekly digest (стадия 4)     | пн 09:00          | `weekly-digest`     |
| Generate insights (стадия 4) | каждый день 04:00 | `generate-insights` |
| Hard delete deleted salons   | каждый день 03:00 | `purge-deleted`     |
| Recalc benchmarks (стадия 4) | каждый день 05:00 | `recalc-benchmarks` |

Все через `pg_cron` + `net.http_post` к собственным functions.
