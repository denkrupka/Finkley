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
import { planForPriceId } from '../_shared/plans.ts'
import { getOwnerByStripeCustomer, getOwnerBySubscriptionId } from '../_shared/salon-lookup.ts'
import { captureException } from '../_shared/sentry.ts'
import { createSmsApiSender } from '../_shared/smsapi-sender.ts'
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
  /** Для mode='subscription' — id подписки. Для one-time покупок (sms_*) — null. */
  subscription: string | null
  payment_intent: string | null
  mode: 'subscription' | 'payment' | 'setup'
  metadata?: {
    salon_id?: string
    kind?: 'sms_package' | 'sms_sender'
    purchase_id?: string
    sender_id?: string
    sender_name?: string
    package_size?: string
  }
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
        const kind = session.metadata?.kind

        // SMS-пакет: пополняем salons.sms_balance на package_size,
        // помечаем purchase paid. Идемпотентность — ловим по unique
        // stripe_session_id ниже, если status уже paid — пропускаем.
        if (kind === 'sms_package') {
          const purchaseId = session.metadata?.purchase_id
          if (!purchaseId) break
          const { data: purchase } = await admin
            .from('salon_sms_purchases')
            .select('id, salon_id, package_size, status')
            .eq('id', purchaseId)
            .maybeSingle()
          const pur = purchase as {
            id: string
            salon_id: string
            package_size: number
            status: string
          } | null
          if (!pur) {
            console.warn('sms_package: purchase not found', purchaseId)
            break
          }
          if (pur.status === 'paid') break // idempotent
          // Атомарный bump баланса. Считаем .rpc или inline UPDATE с SQL +
          // через REST .update(... value: balance + size) недоступно —
          // делаем 2 шага через .select().
          const { data: salonNow } = await admin
            .from('salons')
            .select('sms_balance')
            .eq('id', pur.salon_id)
            .maybeSingle()
          const currentBalance = (salonNow as { sms_balance: number } | null)?.sms_balance ?? 0
          await admin
            .from('salons')
            .update({ sms_balance: currentBalance + pur.package_size })
            .eq('id', pur.salon_id)
          await admin
            .from('salon_sms_purchases')
            .update({
              status: 'paid',
              paid_at: new Date().toISOString(),
              stripe_payment_intent_id: session.payment_intent,
            })
            .eq('id', purchaseId)
          break
        }

        // SMS sender: оплата прошла → регистрируем sender в SMSAPI,
        // status переходит в pending_smsapi до APPROVED.
        if (kind === 'sms_sender') {
          const senderId = session.metadata?.sender_id
          const senderName = session.metadata?.sender_name
          if (!senderId || !senderName) break
          const { data: existing } = await admin
            .from('salon_sms_senders')
            .select('id, status')
            .eq('id', senderId)
            .maybeSingle()
          const ex = existing as { id: string; status: string } | null
          if (!ex) break
          if (ex.status === 'active' || ex.status === 'pending_smsapi') break // idempotent

          // Сначала фиксируем платёж в БД, чтобы потеря SMSAPI не отнимала деньги.
          await admin
            .from('salon_sms_senders')
            .update({
              status: 'pending_smsapi',
              paid_at: new Date().toISOString(),
              stripe_payment_intent_id: session.payment_intent,
            })
            .eq('id', senderId)

          // Регистрация в SMSAPI (не блокирующая — если упало, owner
          // увидит status pending_smsapi и сможет ретраить).
          const r = await createSmsApiSender(senderName)
          if (r.ok && r.status === 'APPROVED') {
            await admin
              .from('salon_sms_senders')
              .update({ status: 'active', activated_at: new Date().toISOString() })
              .eq('id', senderId)
          } else if (!r.ok) {
            console.warn('createSmsApiSender failed:', r.error)
          }
          // Если PENDING_APPROVAL — ждём, status уже pending_smsapi.
          break
        }

        // Subscription (existing flow) — полное состояние подписки получим
        // в customer.subscription.created/updated.
        if (session.subscription) {
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
        }
        break
      }

      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const sub = event.data.object as unknown as SubObj
        const salonId = sub.metadata?.salon_id
        if (!salonId) break
        const priceId = sub.items.data[0]?.price.id ?? ''
        await admin.from('salon_subscriptions').upsert(
          {
            salon_id: salonId,
            stripe_customer_id: sub.customer,
            stripe_subscription_id: sub.id,
            stripe_price_id: priceId,
            // T7 — тариф из price_id (price→plan map).
            plan: planForPriceId(priceId),
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
    await captureException(err, { fn: 'stripe-webhook', event_type: event.type })
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
  owner: { email: string; full_name: string; salon_name: string; locale?: string },
  vars: Record<string, string | number | null>,
): Promise<void> {
  const localeBase = (owner.locale ?? 'ru').split('-')[0]?.toLowerCase() ?? 'ru'
  const ownerNameByLocale: Record<string, string> = {
    ru: 'команда Finkley',
    pl: 'zespół Finkley',
    en: 'Finkley team',
  }
  await sendEmail(
    template,
    owner.email,
    {
      full_name: owner.full_name || owner.salon_name,
      salon_name: owner.salon_name,
      owner_name: ownerNameByLocale[localeBase] ?? ownerNameByLocale.ru,
      ...vars,
    },
    owner.locale,
  )
}
