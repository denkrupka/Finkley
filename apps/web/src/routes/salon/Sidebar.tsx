import { Bug, HelpCircle } from 'lucide-react'
import { lazy, Suspense, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, NavLink } from 'react-router-dom'

import { LogoLockup } from '@/components/ui/logo'
import { ReferralButton } from '@/components/ui/ReferralButton'
import { ThemeToggleButton } from '@/components/ui/ThemeToggleButton'
import { useUnreadMessengerCount } from '@/hooks/useMessenger'
import { useUnreadNegativeReviewsCount } from '@/hooks/useReviews'
import { cn } from '@/lib/utils/cn'
import { NAV_ITEMS } from './nav-config'

/** Лениво — html2canvas-pro весит ~80KB, грузим только когда юзер откроет. */
const TesterBugModal = lazy(() =>
  import('@/components/tester/TesterBugModal').then((m) => ({ default: m.TesterBugModal })),
)

type Props = {
  salonId: string
  /** Для mobile-drawer — закрыть после клика по пункту */
  onNavigate?: () => void
}

/**
 * Sidebar 232×fullheight. Sticky на десктопе — всегда видна при прокрутке.
 * Сверху лого, по центру навигация, в подвале — Help / Реферал / Тема.
 */
export function Sidebar({ salonId, onNavigate }: Props) {
  const { t } = useTranslation()
  const [bugOpen, setBugOpen] = useState(false)
  const { data: unreadNegative = 0 } = useUnreadNegativeReviewsCount(salonId)
  const { data: unreadMessenger = 0 } = useUnreadMessengerCount(salonId)

  return (
    <aside className="border-border bg-card flex h-screen w-[232px] flex-shrink-0 flex-col border-r px-3.5 pb-4 pt-5">
      {/* Logo */}
      <div className="mb-5 px-2">
        <LogoLockup size={28} />
      </div>

      {/* Nav */}
      <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon
          return (
            <NavLink
              key={item.id}
              to={`/${salonId}/${item.id}`}
              onClick={onNavigate}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 rounded-md px-3 py-2.5 text-sm transition-colors',
                  isActive
                    ? 'bg-primary text-primary-foreground font-semibold'
                    : 'text-foreground hover:bg-accent/50 font-medium',
                )
              }
            >
              {({ isActive }) => (
                <>
                  <Icon
                    className={cn(
                      'size-[18px] shrink-0',
                      isActive ? 'text-primary-foreground' : 'text-muted-foreground',
                    )}
                    strokeWidth={1.7}
                  />
                  <span className="flex-1">{t(item.i18nKey)}</span>
                  {item.id === 'reports' && unreadNegative > 0 ? (
                    <span
                      className={cn(
                        'inline-flex min-w-[20px] items-center justify-center rounded-full px-1.5 text-[10px] font-bold leading-none',
                        isActive
                          ? 'bg-primary-foreground text-primary'
                          : 'bg-destructive text-destructive-foreground',
                      )}
                      title={t('nav.reports_unread_negative', { count: unreadNegative })}
                    >
                      {unreadNegative > 99 ? '99+' : unreadNegative}
                    </span>
                  ) : null}
                  {item.id === 'messenger' && unreadMessenger > 0 ? (
                    <span
                      className={cn(
                        'inline-flex min-w-[20px] items-center justify-center rounded-full px-1.5 text-[10px] font-bold leading-none',
                        isActive
                          ? 'bg-primary-foreground text-primary'
                          : 'bg-destructive text-destructive-foreground',
                      )}
                      title={t('nav.messenger_unread', { count: unreadMessenger })}
                    >
                      {unreadMessenger > 99 ? '99+' : unreadMessenger}
                    </span>
                  ) : null}
                </>
              )}
            </NavLink>
          )
        })}
      </nav>

      {/* Footer: реферал + «Сообщить о баге» + тема + help. Кнопка-баг —
          между ReferralButton и Help. Раньше эта кнопка жила только в
          жёлтой ленте Tester'а (TesterBanner) и была доступна только
          тестерам; теперь — всем юзерам по запросу владельца. */}
      <div className="border-border mt-3 flex flex-col gap-2 border-t pt-3">
        <ReferralButton variant="sidebar" />
        <button
          type="button"
          onClick={() => setBugOpen(true)}
          className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md bg-amber-500/15 px-2 text-[12px] font-semibold text-amber-900 transition-colors hover:bg-amber-500/25 dark:text-amber-200"
        >
          <Bug className="size-3.5" strokeWidth={2} />
          {t('nav.report_bug')}
        </button>
        <div className="flex items-center gap-2">
          <ThemeToggleButton variant="sidebar" />
          <Link
            to={`/${salonId}/help`}
            onClick={onNavigate}
            className="text-muted-foreground hover:text-foreground inline-flex flex-1 items-center gap-1.5 px-1.5 text-[11px] font-medium"
          >
            <HelpCircle className="size-3.5" strokeWidth={1.7} />
            {t('nav.help')}
          </Link>
        </div>
      </div>

      {bugOpen ? (
        <Suspense fallback={null}>
          <TesterBugModal onClose={() => setBugOpen(false)} />
        </Suspense>
      ) : null}
    </aside>
  )
}
