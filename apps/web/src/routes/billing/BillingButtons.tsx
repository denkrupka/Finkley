import { Check, CreditCard, FileText, Settings2, Sparkles } from 'lucide-react'
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
import { type BillingInterval, formatMonthlyPrice } from '@/lib/billing-interval'
import { PAID_PLANS, PLAN_NAME_KEY, PLAN_PRICE_EUR, type Plan } from '@/lib/entitlements'
import { cn } from '@/lib/utils/cn'
import { supabase } from '@/lib/supabase/client'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string

/** Платные тарифы (PAID_PLANS типизирован как Plan[], сужаем для контента). */
type PaidPlan = 't19' | 't49' | 't69' | 't99'

/** Тариф, выделяемый как «Популярный» (по выбору владельца — Полный). */
const POPULAR_PLAN: PaidPlan = 't69'

/**
 * Детальный список фич каждого платного тарифа — i18n-ключи. Копирайт
 * зеркалит landing/pricing (`apps/landing/src/i18n/content/pricing.ts`),
 * чтобы пикер в приложении продавал так же, как страница тарифов.
 */
const PLAN_FEATURE_KEYS: Record<PaidPlan, string[]> = {
  t19: [
    'billing.plans.t19.f1',
    'billing.plans.t19.f2',
    'billing.plans.t19.f3',
    'billing.plans.t19.f4',
  ],
  t49: [
    'billing.plans.t49.f1',
    'billing.plans.t49.f2',
    'billing.plans.t49.f3',
    'billing.plans.t49.f4',
  ],
  t69: [
    'billing.plans.t69.f1',
    'billing.plans.t69.f2',
    'billing.plans.t69.f3',
    'billing.plans.t69.f4',
    'billing.plans.t69.f5',
  ],
  t99: [
    'billing.plans.t99.f1',
    'billing.plans.t99.f2',
    'billing.plans.t99.f3',
    'billing.plans.t99.f4',
  ],
}

const PLAN_BLURB_KEY: Record<PaidPlan, string> = {
  t19: 'billing.plans.t19.blurb',
  t49: 'billing.plans.t49.blurb',
  t69: 'billing.plans.t69.blurb',
  t99: 'billing.plans.t99.blurb',
}

/** Маленькая продающая плашка под именем тарифа (или undefined). */
const PLAN_TAGLINE_KEY: Partial<Record<PaidPlan, string>> = {
  t19: 'billing.plans.t19.tagline',
  t99: 'billing.plans.t99.tagline',
}

type TFn = (key: string, opts?: Record<string, unknown>) => string

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
 * Биллинг (фича L): продающая карточка подписки + «Сменить тариф» (модалка-
 * пикер 6-уровневой модели ADR-033, оформлен как landing/pricing).
 *
 * Stripe-пути (best-practice, эндпоинты уже есть, ничего не выдумываем):
 * - Новая подписка (нет активной Stripe-подписки) → create-checkout-session
 *   (Checkout Session, mode=subscription, динамические payment methods).
 * - Смена тарифа / способ оплаты / инвойсы / отмена при активной подписке →
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
  const { t, i18n } = useTranslation()
  const [pending, setPending] = useState<Plan | 'portal' | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  // ADR-035 — годовой биллинг −15%, дефолт ГОД (показываем скидочную цену /мес).
  const [billingInterval, setBillingInterval] = useState<BillingInterval>('year')
  const [params] = useSearchParams()
  const { plan: currentPlan } = useEntitlements(salonId)
  const suggested = params.get('plan') as Plan | null

  // Активная Stripe-подписка (есть customer + статус живой) → смена тарифа и
  // инвойсы идут через Customer Portal. Иначе платный план оформляется
  // через Checkout.
  const hasStripeCustomer = !!subscription?.stripe_customer_id
  const hasActiveSub =
    !!subscription &&
    (subscription.status === 'active' ||
      subscription.status === 'trialing' ||
      subscription.status === 'past_due')

  async function startCheckout(plan: Plan) {
    setPending(plan)
    try {
      const { url } = await callEdgeFunction('create-checkout-session', {
        salonId,
        plan,
        interval: billingInterval,
      })
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
    <div className="flex flex-col items-stretch gap-3 lg:items-end">
      <CurrentPlanPill plan={currentPlan} t={t} />

      {hasStripeCustomer ? (
        <ManageSubscriptionSections
          t={t}
          onManage={openPortal}
          onChangePlan={() => setPickerOpen(true)}
          pending={pending === 'portal'}
        />
      ) : (
        <DemoUpgradeCta t={t} onChoose={() => setPickerOpen(true)} />
      )}

      <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
        <DialogContent className="w-[min(1120px,calc(100vw-2rem))] sm:!w-[min(1120px,calc(100vw-2rem))] sm:!max-w-[1120px]">
          <DialogHeader>
            <DialogTitle>{t('billing.picker_title', { defaultValue: 'Выбор тарифа' })}</DialogTitle>
            <DialogDescription>
              {hasActiveSub
                ? t('billing.picker_subtitle_active', {
                    defaultValue:
                      'Смена тарифа откроет портал биллинга — там можно перейти на другой тариф или отменить подписку.',
                  })
                : t('billing.picker_subtitle_demo', {
                    defaultValue:
                      'Демо — 14 дней бесплатно, карта не нужна. После — выбери тариф или останься на бесплатном.',
                  })}
            </DialogDescription>
          </DialogHeader>

          <div className="flex justify-center px-5 pb-1">
            <IntervalToggle value={billingInterval} onChange={setBillingInterval} t={t} />
          </div>

          <div className="grid gap-4 px-5 pb-3 sm:grid-cols-2 lg:grid-cols-4">
            {(PAID_PLANS as PaidPlan[]).map((plan) => {
              const isPopular = plan === POPULAR_PLAN
              const isSuggested = suggested === plan
              const isCurrent = currentPlan === plan
              return (
                <PlanCard
                  key={plan}
                  plan={plan}
                  t={t}
                  interval={billingInterval}
                  locale={i18n.language}
                  isPopular={isPopular}
                  isSuggested={isSuggested}
                  isCurrent={isCurrent}
                  pending={pending === plan}
                  disabled={pending !== null || isCurrent}
                  onChoose={() => pickPlan(plan)}
                />
              )
            })}
          </div>

          <p className="text-muted-foreground px-5 pb-5 text-center text-xs">
            {t('billing.picker_fine_print', {
              defaultValue:
                'Цены окончательные. Оплата через Stripe · Visa / Mastercard. Отмена в один клик.',
            })}
          </p>
        </DialogContent>
      </Dialog>
    </div>
  )
}

/**
 * Сегмент-переключатель интервала оплаты (ГОД · −15% / Месяц). Активная
 * кнопка — brand-navy. Дефолт — ГОД (см. BillingButtons).
 */
function IntervalToggle({
  value,
  onChange,
  t,
}: {
  value: BillingInterval
  onChange: (v: BillingInterval) => void
  t: TFn
}) {
  const options: { key: BillingInterval; label: string; badge?: string }[] = [
    {
      key: 'year',
      label: t('billing.interval.year', { defaultValue: 'Год' }),
      badge: t('billing.interval.year_badge', { defaultValue: '−15%' }),
    },
    { key: 'month', label: t('billing.interval.month', { defaultValue: 'Месяц' }) },
  ]
  return (
    <div className="bg-muted inline-flex items-center gap-1 rounded-full p-1" role="tablist">
      {options.map((opt) => {
        const active = value === opt.key
        return (
          <button
            key={opt.key}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(opt.key)}
            data-testid={`billing-interval-${opt.key}`}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-sm font-semibold transition-colors',
              active
                ? 'bg-brand-navy text-white shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {opt.label}
            {opt.badge ? (
              <span
                className={cn(
                  'rounded-full px-1.5 py-0.5 text-[10px] font-bold leading-none',
                  active
                    ? 'bg-brand-gold text-brand-navy-ink'
                    : 'bg-brand-sage-soft text-brand-sage-deep',
                )}
              >
                {opt.badge}
              </span>
            ) : null}
          </button>
        )
      })}
    </div>
  )
}

/** Карточка одного тарифа в пикере (оформление landing/pricing). */
function PlanCard({
  plan,
  t,
  interval,
  locale,
  isPopular,
  isSuggested,
  isCurrent,
  pending,
  disabled,
  onChoose,
}: {
  plan: PaidPlan
  t: TFn
  interval: BillingInterval
  locale: string
  isPopular: boolean
  isSuggested: boolean
  isCurrent: boolean
  pending: boolean
  disabled: boolean
  onChoose: () => void
}) {
  const tagline = PLAN_TAGLINE_KEY[plan]
  const priceLabel = formatMonthlyPrice(PLAN_PRICE_EUR[plan], interval, locale)
  return (
    <div
      className={cn(
        'relative flex flex-col rounded-2xl p-5 transition-shadow',
        isPopular
          ? 'bg-brand-navy text-white shadow-xl'
          : isSuggested
            ? 'border-brand-navy ring-brand-navy/15 bg-card border ring-2'
            : 'border-border bg-card border',
      )}
    >
      {isPopular ? (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2">
          <span className="bg-brand-gold text-brand-navy-ink inline-flex items-center gap-1 rounded-full px-3 py-1 text-[11px] font-bold uppercase tracking-wider shadow-sm">
            <Sparkles className="size-3" strokeWidth={2.5} />
            {t('billing.popular_badge', { defaultValue: 'Популярный' })}
          </span>
        </div>
      ) : null}

      <div
        className={cn(
          'text-base font-extrabold tracking-tight',
          isPopular ? 'text-white' : 'text-brand-navy',
        )}
      >
        {t(PLAN_NAME_KEY[plan])}
      </div>

      {tagline ? (
        <span
          className={cn(
            'mt-1.5 inline-flex w-fit items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide',
            isPopular ? 'bg-white/15 text-white' : 'bg-brand-sage-soft text-brand-sage-deep',
          )}
        >
          {t(tagline)}
        </span>
      ) : null}

      <div className="mt-3 flex items-baseline gap-1.5">
        <span
          className={cn(
            'num text-3xl font-extrabold tracking-tight',
            isPopular ? 'text-white' : 'text-brand-navy',
          )}
        >
          €{priceLabel}
        </span>
        <span className={cn('text-sm', isPopular ? 'text-white/70' : 'text-muted-foreground')}>
          {t('billing.per_month', { defaultValue: '/мес' })}
        </span>
      </div>

      {interval === 'year' ? (
        <span className={cn('mt-1 text-xs', isPopular ? 'text-white/70' : 'text-muted-foreground')}>
          {t('billing.per_month_annual', { defaultValue: 'при оплате за год' })}
        </span>
      ) : null}

      <p
        className={cn(
          'mt-2 min-h-[2.5rem] text-xs leading-relaxed',
          isPopular ? 'text-white/80' : 'text-muted-foreground',
        )}
      >
        {t(PLAN_BLURB_KEY[plan])}
      </p>

      <ul className="mt-4 flex-1 space-y-2">
        {PLAN_FEATURE_KEYS[plan].map((key) => (
          <li
            key={key}
            className={cn(
              'flex items-start gap-2 text-xs',
              isPopular ? 'text-white/90' : 'text-foreground',
            )}
          >
            <Check
              className={cn(
                'mt-0.5 size-3.5 shrink-0',
                isPopular ? 'text-brand-gold' : 'text-brand-sage',
              )}
              strokeWidth={2.5}
            />
            {t(key)}
          </li>
        ))}
      </ul>

      <Button
        onClick={onChoose}
        disabled={disabled}
        size="md"
        variant={isPopular ? 'secondary' : isSuggested ? 'primary' : 'outline'}
        className={cn('mt-5', isPopular && 'text-brand-navy bg-white hover:bg-white/90')}
        data-testid={`billing-checkout-${plan}`}
      >
        {isCurrent
          ? t('billing.current_label', { defaultValue: 'Текущий' })
          : pending
            ? t('common.loading')
            : t('billing.choose_plan', { defaultValue: 'Выбрать' })}
      </Button>
    </div>
  )
}

/**
 * Секции управления для юзеров с активной Stripe-подпиской. Все строки ведут
 * в Customer Portal (метод оплаты, инвойсы, отмена — портал покрывает нативно).
 * Плюс отдельная кнопка «Сменить тариф» (открывает пикер).
 */
function ManageSubscriptionSections({
  t,
  onManage,
  onChangePlan,
  pending,
}: {
  t: TFn
  onManage: () => void
  onChangePlan: () => void
  pending: boolean
}) {
  const rows: { icon: typeof CreditCard; label: string; hint: string; testid: string }[] = [
    {
      icon: CreditCard,
      label: t('billing.section_payment_method', { defaultValue: 'Способ оплаты' }),
      hint: t('billing.section_payment_method_hint', { defaultValue: 'Карта и платёжные данные' }),
      testid: 'billing-payment-method',
    },
    {
      icon: FileText,
      label: t('billing.section_invoices', { defaultValue: 'Инвойсы и платежи' }),
      hint: t('billing.section_invoices_hint', { defaultValue: 'История списаний и счета' }),
      testid: 'billing-invoices',
    },
    {
      icon: Settings2,
      label: t('billing.section_manage', { defaultValue: 'Управление подпиской' }),
      hint: t('billing.section_manage_hint', { defaultValue: 'Пауза, отмена, реквизиты' }),
      testid: 'billing-manage',
    },
  ]

  return (
    <div className="w-full lg:w-80">
      <Button
        variant="primary"
        size="md"
        onClick={onChangePlan}
        className="w-full"
        data-testid="billing-change-plan"
      >
        <Sparkles className="size-4" strokeWidth={1.8} />
        {t('billing.change_plan', { defaultValue: 'Сменить тариф' })}
      </Button>

      <div className="border-border divide-border mt-3 divide-y overflow-hidden rounded-lg border">
        {rows.map(({ icon: Icon, label, hint, testid }) => (
          <button
            key={testid}
            type="button"
            onClick={onManage}
            disabled={pending}
            data-testid={testid}
            className="hover:bg-muted/40 flex w-full items-center gap-3 px-3.5 py-3 text-left transition-colors disabled:opacity-50"
          >
            <span className="bg-muted text-brand-navy grid size-9 shrink-0 place-items-center rounded-md">
              <Icon className="size-4" strokeWidth={1.8} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="text-foreground block text-sm font-semibold">{label}</span>
              <span className="text-muted-foreground block truncate text-xs">{hint}</span>
            </span>
            <span className="text-muted-foreground text-xs">
              {pending
                ? t('common.loading')
                : t('billing.section_open', { defaultValue: 'Открыть' })}
            </span>
          </button>
        ))}
      </div>
      <p className="text-muted-foreground mt-2 text-center text-[11px] leading-snug">
        {t('billing.portal_note', {
          defaultValue: 'Откроется защищённый портал Stripe — там карта, счета и отмена.',
        })}
      </p>
    </div>
  )
}

/** CTA для demo/free (нет Stripe-клиента): акцент на выборе тарифа. */
function DemoUpgradeCta({ t, onChoose }: { t: TFn; onChoose: () => void }) {
  return (
    <div className="w-full lg:w-80">
      <Button
        variant="primary"
        size="md"
        onClick={onChoose}
        className="w-full"
        data-testid="billing-change-plan"
      >
        <Sparkles className="size-4" strokeWidth={1.8} />
        {t('billing.choose_plan_cta', { defaultValue: 'Выбрать тариф' })}
      </Button>
      <p className="text-muted-foreground mt-2 text-center text-xs leading-snug">
        {t('billing.demo_hint', {
          defaultValue:
            'Демо — 14 дней бесплатно, карта не нужна. Потом выбери тариф или останься на бесплатном.',
        })}
      </p>
    </div>
  )
}

/** Бейдж текущего тарифа (реальный план из effectivePlan). */
function CurrentPlanPill({ plan, t }: { plan: Plan; t: TFn }) {
  const priceSuffix =
    plan === 'demo' || plan === 'free' ? '' : ` · €${PLAN_PRICE_EUR[plan]}${t('billing.per_month')}`
  return (
    <span className="border-brand-yellow-deep/40 inline-flex items-center gap-1.5 self-start rounded-full border bg-gradient-to-br from-[#FFFCEB] to-[#FFF4D1] px-2.5 py-1 lg:self-end">
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
