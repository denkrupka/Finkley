/**
 * stripe-webhook edge function
 *
 * Принимает webhook events от Stripe, валидирует подпись, обновляет
 * `salon_subscriptions` в БД. Идемпотентно через `stripe_webhook_events.event_id`.
 *
 * Регистрация webhook'а:
 *   Stripe Dashboard → Developers → Webhooks → Add endpoint
 *   URL: https://<project>.supabase.co/functions/v1/stripe-webhook
 *   Events:
 *     - checkout.session.completed
 *     - customer.subscription.created
 *     - customer.subscription.updated
 *     - customer.subscription.deleted
 *     - invoice.payment_succeeded
 *     - invoice.payment_failed
 *
 * ENV:
 *   STRIPE_SECRET_KEY
 *   STRIPE_WEBHOOK_SECRET (whsec_…)
 *
 * Деплой: --no-verify-jwt (Stripe не шлёт Supabase-аут).
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.6'
import { verifyStripeSignature } from '../_shared/stripe.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const WEBHOOK_SECRET = Deno.env.get('STRIPE_WEBHOOK_SECRET') ?? ''

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

function ts(v: number | null | undefined): string | null {
  return v ? new Date(v * 1000).toISOString() : null
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

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as unknown as CheckoutObj
        const salonId = session.metadata?.salon_id
        if (!salonId) break
        // Сразу после checkout subscription может ещё не быть expanded;
        // полное состояние получим в customer.subscription.created/updated.
        // Здесь просто обновляем customer_id если нужно.
        await admin.from('salon_subscriptions').upsert(
          {
            salon_id: salonId,
            stripe_customer_id: session.customer,
            stripe_subscription_id: session.subscription,
            stripe_price_id: '', // обновится в subscription.created
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
        break
      }

      case 'invoice.payment_succeeded':
      case 'invoice.payment_failed': {
        // Эмиттер email — обновим status в subscription отдельно через
        // customer.subscription.updated (Stripe всегда шлёт оба события).
        // TODO: отправить email через send-email function (TASK-19).
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
