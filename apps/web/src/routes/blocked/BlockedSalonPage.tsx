import { Lock } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link, useParams } from 'react-router-dom'

import { useMySalons } from '@/hooks/useSalons'

/**
 * Страница «Ваш салон заблокирован». Показывается, когда юзер пытается войти
 * в салон, который super-админ заблокировал (`salons.blocked_at is not null`).
 */
export function BlockedSalonPage() {
  const { t } = useTranslation()
  const { salonId } = useParams<{ salonId: string }>()
  const { data: salons } = useMySalons()

  const salon = salons?.find((s) => s.id === salonId)
  const reason = salon?.blocked_reason

  const otherSalons = (salons ?? []).filter((s) => s.id !== salonId && !s.blocked_at)

  return (
    <div className="bg-background flex min-h-screen flex-col items-center justify-center p-6">
      <div className="border-border bg-card shadow-finmd flex max-w-md flex-col items-center gap-4 rounded-lg border p-8 text-center">
        <Lock className="text-destructive size-12" strokeWidth={1.2} />
        <h1 className="text-foreground text-xl font-bold">
          {t('blocked.salon.title', { name: salon?.name ?? '—' })}
        </h1>
        <p className="text-muted-foreground text-sm">{t('blocked.salon.body')}</p>
        {reason ? (
          <p className="text-foreground bg-muted/40 rounded-md px-3 py-2 text-xs">
            {t('blocked.salon.reason_label')}: {reason}
          </p>
        ) : null}
        <p className="text-muted-foreground text-xs">
          {t('blocked.salon.contact')}{' '}
          <a className="text-primary underline" href="mailto:support@finkley.app">
            support@finkley.app
          </a>
        </p>
        {otherSalons.length > 0 ? (
          <div className="border-border w-full border-t pt-3">
            <p className="text-muted-foreground mb-2 text-xs">{t('blocked.salon.switch_to')}</p>
            <div className="flex flex-col gap-1">
              {otherSalons.map((s) => (
                <Link
                  key={s.id}
                  to={`/${s.id}/dashboard`}
                  className="hover:bg-muted/60 rounded-md px-3 py-2 text-sm font-semibold"
                >
                  {s.name}
                </Link>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}
