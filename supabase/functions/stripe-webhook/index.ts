/**
 * stripe-webhook edge function
 *
 * Принимает webhook events от Stripe, валидирует подпись, обновляет
 * `salon_subscriptions` в БД, инициирует email-уведомления.
 * Идемпотентно через `stripe_webhook_events.event_id`.
 *
 * Регистрация webhook'а:
 *   Stripe Dashboard → Developers → Webhooks → Add endpoint
 *   URL: https://<project>.supabase.co/functions/v1/stripe-webhook
 *   Events:
 *     - checkout.session.completed
 *     - customer.subscription.created
 *     - customer.subscription.updated
 *     - customer.subscription.deleted
 *     - customer.subscription.trial_will_end
 *     - invoice.payment_succeeded
 *     - invoice.payment_failed
 *
 * ENV:
 *   STRIPE_SECRET_KEY
 *   STRIPE_WEBHOOK_SECRET (whsec_…)
 *   APP_URL  (https://finkley.app/app/)
 *   FUNCTION_INTERNAL_SECRET — для вызова send-email
 *
 * Деплой: --no-verify-jwt (Stripe не шлёт Supabase-аут).
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.6'
import { sendEmail, type EmailTemplate } from '../_shared/notify.ts'
import { getOwnerByStripeCustomer, getOwnerBySubscriptionId } from '../_shared/salon-lookup.ts'
import { verifyStripeSignature } from '../_shared/stripe.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const WEBHOOK_SECRET = Deno.env.get('STRIPE_WEBHOOK_SECRET') ?? ''
const APP_URL = Deno.env.get('APP_URL') ?? 'https://finkley.app/app/'

type StripeEvent = {
  id: string
  type: string
  data: { object: Record<string, unknown> }
}

type SubObj = {
  id: string
  customer: string
  status: string
  trial_end: number | null
  current_period_start: number
  current_period_end: number
  cancel_at_period_end: boolean
  items: { data: Array<{ price: { id: string } }> }
  metadata?: { salon_id?: string }
}

type CheckoutObj = {
  id: string
  customer: string
  subscription: string
  metadata?: { salon_id?: string }
}

type InvoiceObj = {
  id: string
  customer: string
  subscription: string | null
  amount_paid?: number
  amount_due?: number
  total: number
  currency: string
  hosted_invoice_url?: string | null
  next_payment_attempt?: number | null
  period_end?: number | null
}

function ts(v: number | null | undefined): string | null {
  return v ? new Date(v * 1000).toISOString() : null
}

function fmtAmount(cents: number, currency: string): string {
  return new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency: (currency || 'EUR').toUpperCase(),
  }).format(cents / 100)
}

function fmtDate(unix: number | null | undefined): string {
  if (!unix) return '—'
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  }).format(new Date(unix * 1000))
}

function daysUntil(unix: number | null | undefined): number {
  if (!unix) return 0
  return Math.max(0, Math.ceil((unix * 1000 - Date.now()) / (1000 * 60 * 60 * 24)))
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405 })

  if (!WEBHOOK_SECRET || !SUPABASE_URL || !SERVICE_ROLE) {
    return new Response('not configured', { status: 500 })
  }

  const sigHeader = req.headers.get('stripe-signature') || req.headers.get('Stripe-Signature') || ''
  const rawBody = await req.text()
  const valid = await verifyStripeSignature(rawBody, sigHeader, WEBHOOK_SECRET)
  if (!valid) {
    console.warn('stripe-webhook: invalid signature')
    return new Response('invalid signature', { status: 400 })
  }

  let event: StripeEvent
  try {
    event = JSON.parse(rawBody) as StripeEvent
  } catch {
    return new Response('invalid json', { status: 400 })
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  // Идемпотентность: пытаемся вставить event.id; если уже есть — выходим.
  const { error: insErr } = await admin
    .from('stripe_webhook_events')
    .insert({ event_id: event.id, event_type: event.type, payload: event })
  if (insErr) {
    if (insErr.code === '23505') {
      // duplicate event — Stripe ретраит, всё ОК
      return new Response('duplicate', { status: 200 })
    }
    console.error('insert webhook event failed', insErr)
    return new Response('db error', { status: 500 })
  }

  // Обработка: side-effects изолируем в try/catch чтобы не падать на одной ошибке.
  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as unknown as CheckoutObj
        const salonId = session.metadata?.salon_id
        if (!salonId) break
        // Полное состояние подписки получим в customer.subscription.created/updated.
        await admin.from('salon_subscriptions').upsert(
          {
            salon_id: salonId,
            stripe_customer_id: session.customer,
            stripe_subscription_id: session.subscription,
            stripe_price_id: '',
            status: 'incomplete',
            current_period_start: new Date().toISOString(),
            current_period_end: new Date().toISOString(),
          },
          { onConflict: 'salon_id' },
        )
        break
      }

      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const sub = event.data.object as unknown as SubObj
        const salonId = sub.metadata?.salon_id
        if (!salonId) break
        await admin.from('salon_subscriptions').upsert(
          {
            salon_id: salonId,
            stripe_customer_id: sub.customer,
            stripe_subscription_id: sub.id,
            stripe_price_id: sub.items.data[0]?.price.id ?? '',
            status: sub.status,
            trial_ends_at: ts(sub.trial_end),
            current_period_start: ts(sub.current_period_start)!,
            current_period_end: ts(sub.current_period_end)!,
            cancel_at_period_end: sub.cancel_at_period_end,
          },
          { onConflict: 'salon_id' },
        )

        // Email при финальном cancel'е
        if (event.type === 'customer.subscription.deleted') {
          const owner = await getOwnerBySubscriptionId(sub.id)
          if (owner) {
            await sendTemplated('subscription_canceled', owner, {
              period_end_date: fmtDate(sub.current_period_end),
              export_url: `${APP_URL}${owner.salon_id}/settings`,
              resubscribe_url: `${APP_URL}${owner.salon_id}/settings`,
            })
          }
        }
        break
      }

      case 'customer.subscription.trial_will_end': {
        const sub = event.data.object as unknown as SubObj
        const owner = await getOwnerBySubscriptionId(sub.id)
        if (!owner) break
        await sendTemplated('trial_ending', owner, {
          days_left: daysUntil(sub.trial_end),
          app_url: `${APP_URL}${owner.salon_id}/dashboard`,
          billing_url: `${APP_URL}${owner.salon_id}/settings`,
          revenue_during_trial: '—',
          visits_during_trial: '—',
        })
        break
      }

      case 'invoice.payment_succeeded': {
        const inv = event.data.object as unknown as InvoiceObj
        const owner = await getOwnerByStripeCustomer(inv.customer)
        if (!owner) break
        await sendTemplated('payment_succeeded', owner, {
          amount: fmtAmount(inv.amount_paid ?? inv.total ?? 0, inv.currency),
          period_end_date: fmtDate(inv.period_end),
          invoice_url: inv.hosted_invoice_url ?? `${APP_URL}${owner.salon_id}/settings`,
        })
        break
      }

      case 'invoice.payment_failed': {
        const inv = event.data.object as unknown as InvoiceObj
        const owner = await getOwnerByStripeCustomer(inv.customer)
        if (!owner) break
        await sendTemplated('payment_failed', owner, {
          amount: fmtAmount(inv.amount_due ?? inv.total ?? 0, inv.currency),
          retry_date: fmtDate(inv.next_payment_attempt),
          billing_url: `${APP_URL}${owner.salon_id}/settings`,
        })
        break
      }

      default:
        console.log('stripe-webhook: ignoring', event.type)
    }
  } catch (err) {
    console.error('webhook handler failed', err)
    return new Response('handler error', { status: 500 })
  }

  return new Response('ok', { status: 200 })
})

/**
 * Тонкая обёртка с дефолтными переменными для шаблонов писем
 * (full_name, salon_name, owner_name всегда подставляются).
 */
async function sendTemplated(
  template: EmailTemplate,
  owner: { email: string; full_name: string; salon_name: string },
  vars: Record<string, string | number | null>,
): Promise<void> {
  await sendEmail(template, owner.email, {
    full_name: owner.full_name || owner.salon_name,
    salon_name: owner.salon_name,
    owner_name: 'команда Finkley',
    ...vars,
  })
}
