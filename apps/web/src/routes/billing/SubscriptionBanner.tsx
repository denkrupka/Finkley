import { differenceInDays, parseISO } from 'date-fns'
import { useTranslation } from 'react-i18next'
import { Link, useParams } from 'react-router-dom'

import { useSalon } from '@/hooks/useSalons'
import { isSubscriptionActive, useSubscription } from '@/hooks/useSubscription'
import { cn } from '@/lib/utils/cn'

/**
 * Баннер о статусе подписки. Отображается над контентом salon-страниц.
 * Три состояния:
 * - триал заканчивается ≤ 3 дня — yellow
 * - подписка истекла → red read-only
 * - всё ОК — null
 */
export function SubscriptionBanner() {
  const { t } = useTranslation()
  const { salonId } = useParams<{ salonId: string }>()
  const { data: salon } = useSalon(salonId)
  const { data: sub } = useSubscription(salonId)

  if (!salon || !salonId) return null

  const active = isSubscriptionActive(sub ?? null, salon.created_at)

  // Истёкшая подписка — read-only режим
  if (!active) {
    return (
      <Banner variant="danger">
        <span>{t('billing.banner.expired_title')}</span>
        <Link
          to={`/${salonId}/settings`}
          className="text-destructive ml-3 rounded-full bg-white px-3 py-1 text-xs font-bold hover:bg-white/90"
        >
          {t('billing.banner.cta_upgrade')}
        </Link>
      </Banner>
    )
  }

  // Триал ≤ 3 дня
  if (sub?.status === 'trialing' && sub.trial_ends_at) {
    const daysLeft = differenceInDays(parseISO(sub.trial_ends_at), new Date())
    if (daysLeft <= 3 && daysLeft >= 0) {
      return (
        <Banner variant="warn">
          <span>{t('billing.banner.trial_ending', { count: Math.max(0, daysLeft) })}</span>
          <Link
            to={`/${salonId}/settings`}
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
