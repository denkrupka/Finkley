import { AlertTriangle, Check } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { useEntitlements } from '@/hooks/useEntitlements'
import type { SalonSubscription } from '@/hooks/useSubscription'
import { PAID_PLANS, PLAN_PRICE_EUR, type Plan } from '@/lib/entitlements'
import { cn } from '@/lib/utils/cn'
import { supabase } from '@/lib/supabase/client'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string

/** Краткий список того, что входит в каждый платный тариф (для пикера). */
const PLAN_FEATURES: Record<Plan, string[]> = {
  free: ['Доходы'],
  t19: ['Доходы', 'Расходы', 'Отчёты', 'Мессенджер'],
  t49: ['Всё из €19', 'Маркетинг', 'AI-помощник'],
  t69: ['Всё из €49', 'Финансы (P&L, ДДС)', 'Склад'],
  t99: ['Всё из €69', 'Несколько салонов'],
  demo: [],
}

async function callEdgeFunction(name: string, body: unknown): Promise<{ url: string }> {
  const { data: sessionData } = await supabase.auth.getSession()
  const token = sessionData.session?.access_token
  if (!token) throw new Error('not_authenticated')
  const res = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  const json = (await res.json()) as { url?: string; error?: string; message?: string }
  if (!res.ok || !json.url) {
    throw new Error(json.message || json.error || `HTTP ${res.status}`)
  }
  return { url: json.url }
}

/**
 * Биллинг: пикер тарифов (€19/€49/€69/€99) с оформлением подписки или, если
 * подписка активна, кнопка «Управление подпиской» (Stripe Customer Portal).
 */
export function BillingButtons({
  salonId,
  subscription,
}: {
  salonId: string
  subscription: SalonSubscription | null
}) {
  const { t } = useTranslation()
  const [pending, setPending] = useState<Plan | 'portal' | null>(null)
  const [params] = useSearchParams()
  const { plan: currentPlan } = useEntitlements(salonId)
  const suggested = params.get('plan') as Plan | null

  const stripeAvailable = !!import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY
  const hasActive =
    subscription && (subscription.status === 'active' || subscription.status === 'trialing')

  if (!stripeAvailable) {
    return (
      <div className="flex max-w-md items-start gap-2 rounded-md border border-amber-300 bg-amber-50/60 px-3 py-2 text-xs leading-snug text-amber-900">
        <AlertTriangle className="mt-0.5 size-4 shrink-0" strokeWidth={2} />
        <div>
          <p className="font-bold">
            {t('billing.unavailable_title', { defaultValue: 'Платежи временно недоступны' })}
          </p>
          <p className="mt-0.5">
            {t('billing.unavailable_body', {
              defaultValue:
                'Это техническая проблема на нашей стороне. Напиши в поддержку: support@finkley.app — подключим тебя вручную.',
            })}
          </p>
        </div>
      </div>
    )
  }

  async function startCheckout(plan: Plan) {
    setPending(plan)
    try {
      const { url } = await callEdgeFunction('create-checkout-session', { salonId, plan })
      window.location.href = url
    } catch (err) {
      toast.error(t('billing.checkout_error'), {
        description: err instanceof Error ? err.message : String(err),
      })
      setPending(null)
    }
  }

  async function openPortal() {
    setPending('portal')
    try {
      const { url } = await callEdgeFunction('create-portal-session', { salonId })
      window.location.href = url
    } catch (err) {
      toast.error(t('billing.portal_error'), {
        description: err instanceof Error ? err.message : String(err),
      })
      setPending(null)
    }
  }

  if (hasActive) {
    return (
      <div className="space-y-3">
        <p className="text-muted-foreground text-sm">
          {t('billing.current_plan', {
            plan: currentPlan === 'demo' ? 'Demo' : `€${PLAN_PRICE_EUR[currentPlan] ?? ''}`,
            defaultValue: 'Текущий тариф: {{plan}}',
          })}
        </p>
        <Button
          variant="outline"
          onClick={openPortal}
          disabled={pending === 'portal'}
          size="md"
          data-testid="billing-portal"
        >
          {pending === 'portal' ? t('common.loading') : t('billing.portal_button')}
        </Button>
      </div>
    )
  }

  return (
    <div className="grid max-w-3xl gap-3 sm:grid-cols-2">
      {PAID_PLANS.map((plan) => {
        const highlight = suggested === plan
        return (
          <div
            key={plan}
            className={cn(
              'flex flex-col rounded-xl border p-4',
              highlight ? 'border-brand-navy ring-brand-navy/20 ring-2' : 'border-border bg-card',
            )}
          >
            <div className="flex items-baseline justify-between">
              <span className="text-brand-navy num text-2xl font-extrabold">
                €{PLAN_PRICE_EUR[plan]}
              </span>
              <span className="text-muted-foreground text-xs">
                {t('billing.per_month', { defaultValue: '/мес' })}
              </span>
            </div>
            <ul className="mt-3 flex-1 space-y-1.5">
              {PLAN_FEATURES[plan].map((f) => (
                <li key={f} className="text-foreground flex items-start gap-1.5 text-xs">
                  <Check className="text-brand-sage mt-0.5 size-3.5 shrink-0" strokeWidth={2.5} />
                  {f}
                </li>
              ))}
            </ul>
            <Button
              onClick={() => startCheckout(plan)}
              disabled={pending !== null}
              size="md"
              variant={highlight ? 'primary' : 'outline'}
              className="mt-4"
              data-testid={`billing-checkout-${plan}`}
            >
              {pending === plan
                ? t('common.loading')
                : t('billing.choose_plan', { defaultValue: 'Выбрать' })}
            </Button>
          </div>
        )
      })}
    </div>
  )
}
