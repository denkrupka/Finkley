import { differenceInDays, parseISO } from 'date-fns'
import { useTranslation } from 'react-i18next'
import { Link, useParams } from 'react-router-dom'

import { useEntitlements } from '@/hooks/useEntitlements'
import { useSalon } from '@/hooks/useSalons'
import { useSubscription } from '@/hooks/useSubscription'
import { cn } from '@/lib/utils/cn'

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Баннер о статусе подписки над salon-страницами (T7-модель тарифов).
 *
 * - Проблема с оплатой реальной Stripe-подписки (past_due/unpaid) → red.
 * - Демо заканчивается ≤3 дней → yellow с CTA «Выбрать тариф».
 * - Free и активный платный тариф → НИЧЕГО (раньше Free ложно показывался как
 *   «подписка истекла»; теперь апсейл делают плашки секций + «Настройка Finkley»).
 */
export function SubscriptionBanner() {
  const { t } = useTranslation()
  const { salonId } = useParams<{ salonId: string }>()
  const { data: salon } = useSalon(salonId)
  const { data: sub, isLoading: subLoading } = useSubscription(salonId)
  const { plan, isLoaded } = useEntitlements(salonId)

  if (!salon || !salonId || subLoading || !isLoaded) return null

  // Проблема с оплатой реальной Stripe-подписки — призываем обновить карту.
  if (sub && (sub.status === 'past_due' || sub.status === 'unpaid')) {
    return (
      <Banner variant="danger">
        <span>
          {t('billing.banner.payment_failed', {
            defaultValue: 'Оплата не прошла — обновите карту, чтобы не потерять доступ.',
          })}
        </span>
        <Link
          to={`/${salonId}/settings?tab=billing`}
          className="text-destructive ml-3 rounded-full bg-white px-3 py-1 text-xs font-bold hover:bg-white/90"
        >
          {t('billing.banner.cta_fix_payment', { defaultValue: 'Обновить оплату' })}
        </Link>
      </Banner>
    )
  }

  // Демо заканчивается ≤3 дней (Stripe-trial или implicit-trial от created_at+14).
  if (plan === 'demo') {
    const trialEndMs = sub?.trial_ends_at
      ? parseISO(sub.trial_ends_at).getTime()
      : parseISO(salon.created_at).getTime() + 14 * DAY_MS
    const daysLeft = differenceInDays(new Date(trialEndMs), new Date())
    if (daysLeft >= 0 && daysLeft <= 3) {
      return (
        <Banner variant="warn">
          <span>{t('billing.banner.trial_ending', { count: Math.max(0, daysLeft) })}</span>
          <Link
            to={`/${salonId}/settings?tab=billing`}
            className="bg-brand-navy hover:bg-brand-navy-soft ml-3 rounded-full px-3 py-1 text-xs font-bold text-white"
          >
            {t('billing.banner.cta_subscribe')}
          </Link>
        </Banner>
      )
    }
  }

  return null
}

function Banner({ variant, children }: { variant: 'warn' | 'danger'; children: React.ReactNode }) {
  return (
    <div
      className={cn(
        'flex items-center justify-center px-4 py-2 text-sm font-medium',
        variant === 'warn'
          ? 'bg-brand-yellow text-brand-navy'
          : 'bg-destructive text-destructive-foreground',
      )}
    >
      {children}
    </div>
  )
}
