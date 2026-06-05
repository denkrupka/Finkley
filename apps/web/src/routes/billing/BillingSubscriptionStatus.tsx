import { useTranslation } from 'react-i18next'

import type { SalonSubscription } from '@/hooks/useSubscription'

const TRIAL_DAYS = 14
const MS_PER_DAY = 24 * 60 * 60 * 1000

/**
 * Bug 68c67e0a (Den 05.06): «вкладка Подписка показывает только мутный
 * статус, данные не загружаются». Решение — рендерить осмысленные строки:
 * • для активной подписки — дата следующего списания / окончания
 * • для триала — сколько дней осталось + дата окончания
 * • без подписки — countdown grace-периода от salon.created_at + 14 дней
 */
export function BillingSubscriptionStatus({
  subscription,
  salonCreatedAt,
}: {
  subscription: SalonSubscription | null
  salonCreatedAt: string | null | undefined
}) {
  const { t, i18n } = useTranslation()

  const lines = buildLines(subscription, salonCreatedAt, i18n.language, t)
  if (lines.length === 0) return null

  return (
    <div className="mt-1 space-y-0.5">
      {lines.map((line, i) => (
        <p key={i} className="text-muted-foreground text-sm">
          {line}
        </p>
      ))}
    </div>
  )
}

function buildLines(
  sub: SalonSubscription | null,
  salonCreatedAt: string | null | undefined,
  locale: string,
  t: (key: string, opts?: Record<string, unknown>) => string,
): string[] {
  const fmtDate = (iso: string) => formatDate(iso, locale)

  if (!sub) {
    // Триал ещё не оформлен в Stripe — считаем grace-период от salon.created_at.
    if (!salonCreatedAt) return [t('settings.billing.no_subscription')]
    const created = new Date(salonCreatedAt)
    const trialEnd = new Date(created.getTime() + TRIAL_DAYS * MS_PER_DAY)
    const daysLeft = daysBetween(new Date(), trialEnd)
    if (daysLeft < 0) {
      return [t('settings.billing.trial_expired'), t('settings.billing.no_subscription')]
    }
    if (daysLeft === 0) {
      return [t('settings.billing.trial_active_today')]
    }
    return [
      t('settings.billing.trial_active', {
        days: daysLeft,
        daysWord: pluralDays(daysLeft, t),
        date: fmtDate(trialEnd.toISOString()),
      }),
    ]
  }

  const status = sub.status
  const out: string[] = []

  if (status === 'trialing') {
    const end = sub.trial_ends_at ?? sub.current_period_end
    const daysLeft = daysBetween(new Date(), new Date(end))
    if (daysLeft > 0) {
      out.push(
        t('settings.billing.trial_active', {
          days: daysLeft,
          daysWord: pluralDays(daysLeft, t),
          date: fmtDate(end),
        }),
      )
    } else if (daysLeft === 0) {
      out.push(t('settings.billing.trial_active_today'))
    } else {
      out.push(t('settings.billing.trial_expired'))
    }
    return out
  }

  if (status === 'active') {
    if (sub.cancel_at_period_end) {
      out.push(t('settings.billing.ends_on', { date: fmtDate(sub.current_period_end) }))
    } else {
      out.push(t('settings.billing.renews_on', { date: fmtDate(sub.current_period_end) }))
    }
    return out
  }

  // Все остальные статусы — обычная строка status_<code>.
  out.push(t(`settings.billing.status_${status}`, { defaultValue: status }))
  if (status === 'canceled') {
    out.push(t('settings.billing.ends_on', { date: fmtDate(sub.current_period_end) }))
  }
  return out
}

function daysBetween(from: Date, to: Date): number {
  const start = new Date(from.getFullYear(), from.getMonth(), from.getDate())
  const end = new Date(to.getFullYear(), to.getMonth(), to.getDate())
  return Math.round((end.getTime() - start.getTime()) / MS_PER_DAY)
}

function formatDate(iso: string, locale: string): string {
  try {
    return new Intl.DateTimeFormat(locale, {
      day: '2-digit',
      month: 'long',
      year: 'numeric',
    }).format(new Date(iso))
  } catch {
    return iso.slice(0, 10)
  }
}

function pluralDays(n: number, t: (k: string) => string): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return t('settings.billing.days_one')
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14))
    return t('settings.billing.days_few')
  return t('settings.billing.days_many')
}
