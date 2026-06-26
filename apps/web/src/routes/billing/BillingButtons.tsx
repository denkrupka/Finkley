import { AlertTriangle, Check, FileText, Sparkles } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useEntitlements } from '@/hooks/useEntitlements'
import type { SalonSubscription } from '@/hooks/useSubscription'
import { PAID_PLANS, PLAN_NAME_KEY, PLAN_PRICE_EUR, type Plan } from '@/lib/entitlements'
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
 * Биллинг (фича L): карточка текущего тарифа + «Сменить тариф» (модалка-пикер
 * 6-уровневой модели ADR-033) + «Инвойсы и платежи».
 *
 * Stripe-пути (best-practice, эндпоинты уже есть, ничего не выдумываем):
 * - Новая подписка (нет активной Stripe-подписки) → create-checkout-session
 *   (Checkout Session, mode=subscription, динамические payment methods).
 * - Смена тарифа при активной подписке + история инвойсов/платежей →
 *   create-portal-session (Stripe Customer Portal: апгрейд/даунгрейд с
 *   пропорцией, отмена, карта, инвойсы, история — всё self-service).
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
  const [pickerOpen, setPickerOpen] = useState(false)
  const [params] = useSearchParams()
  const { plan: currentPlan } = useEntitlements(salonId)
  const suggested = params.get('plan') as Plan | null

  const stripeAvailable = !!import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY
  // Активная Stripe-подписка (есть customer + статус живой) → смена тарифа и
  // инвойсы идут через Customer Portal. Иначе платный план оформляется
  // через Checkout.
  const hasStripeCustomer = !!subscription?.stripe_customer_id
  const hasActiveSub =
    !!subscription &&
    (subscription.status === 'active' ||
      subscription.status === 'trialing' ||
      subscription.status === 'past_due')

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

  // Клик по тарифу в пикере: если у салона уже есть активная Stripe-подписка —
  // ведём в портал (там корректная смена с пропорцией). Иначе — Checkout.
  function pickPlan(plan: Plan) {
    if (hasActiveSub && hasStripeCustomer) {
      void openPortal()
    } else {
      void startCheckout(plan)
    }
  }

  return (
    <div className="flex flex-col items-end gap-2.5">
      <CurrentPlanPill plan={currentPlan} t={t} />
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button
          variant="primary"
          size="md"
          onClick={() => setPickerOpen(true)}
          data-testid="billing-change-plan"
        >
          <Sparkles className="size-4" strokeWidth={1.8} />
          {t('billing.change_plan', { defaultValue: 'Сменить тариф' })}
        </Button>
        {hasStripeCustomer ? (
          <Button
            variant="outline"
            size="md"
            onClick={openPortal}
            disabled={pending === 'portal'}
            data-testid="billing-invoices"
          >
            <FileText className="size-4" strokeWidth={1.8} />
            {pending === 'portal'
              ? t('common.loading')
              : t('billing.invoices_button', { defaultValue: 'Инвойсы и платежи' })}
          </Button>
        ) : null}
      </div>

      <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{t('billing.picker_title', { defaultValue: 'Выбор тарифа' })}</DialogTitle>
            <DialogDescription>
              {hasActiveSub
                ? t('billing.picker_subtitle_active', {
                    defaultValue:
                      'Смена тарифа откроет портал биллинга — там можно перейти на другой тариф или отменить подписку.',
                  })
                : t('billing.picker_subtitle_new', {
                    defaultValue: 'Выбери тариф — оплата через защищённую страницу Stripe.',
                  })}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 px-5 pb-5 sm:grid-cols-2">
            {PAID_PLANS.map((plan) => {
              const highlight = suggested === plan
              const isCurrent = currentPlan === plan
              return (
                <div
                  key={plan}
                  className={cn(
                    'flex flex-col rounded-xl border p-4',
                    highlight
                      ? 'border-brand-navy ring-brand-navy/20 ring-2'
                      : 'border-border bg-card',
                  )}
                >
                  <div className="flex items-baseline justify-between">
                    <span className="text-brand-navy text-sm font-bold">
                      {t(PLAN_NAME_KEY[plan])}
                    </span>
                    <span className="text-brand-navy num text-2xl font-extrabold">
                      €{PLAN_PRICE_EUR[plan]}
                      <span className="text-muted-foreground ml-1 text-xs font-normal">
                        {t('billing.per_month', { defaultValue: '/мес' })}
                      </span>
                    </span>
                  </div>
                  <ul className="mt-3 flex-1 space-y-1.5">
                    {PLAN_FEATURES[plan].map((f) => (
                      <li key={f} className="text-foreground flex items-start gap-1.5 text-xs">
                        <Check
                          className="text-brand-sage mt-0.5 size-3.5 shrink-0"
                          strokeWidth={2.5}
                        />
                        {f}
                      </li>
                    ))}
                  </ul>
                  <Button
                    onClick={() => pickPlan(plan)}
                    disabled={pending !== null || isCurrent}
                    size="md"
                    variant={highlight ? 'primary' : 'outline'}
                    className="mt-4"
                    data-testid={`billing-checkout-${plan}`}
                  >
                    {isCurrent
                      ? t('billing.current_label', { defaultValue: 'Текущий' })
                      : pending === plan
                        ? t('common.loading')
                        : t('billing.choose_plan', { defaultValue: 'Выбрать' })}
                  </Button>
                </div>
              )
            })}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

/** Бейдж текущего тарифа (реальный план из effectivePlan). */
function CurrentPlanPill({
  plan,
  t,
}: {
  plan: Plan
  t: (key: string, opts?: Record<string, unknown>) => string
}) {
  const priceSuffix =
    plan === 'demo' || plan === 'free' ? '' : ` · €${PLAN_PRICE_EUR[plan]}${t('billing.per_month')}`
  return (
    <span className="border-brand-yellow-deep/40 inline-flex items-center gap-1.5 rounded-full border bg-gradient-to-br from-[#FFFCEB] to-[#FFF4D1] px-2.5 py-1">
      <span className="from-brand-gold grid size-4 place-items-center rounded-full bg-gradient-to-br to-[#E5C078] text-[9px] font-extrabold leading-none text-white">
        ★
      </span>
      <span className="text-brand-navy-ink text-xs font-bold">
        {t('billing.current_plan', { plan: t(PLAN_NAME_KEY[plan]) })}
        {priceSuffix}
      </span>
    </span>
  )
}
