import { HelpCircle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link, NavLink } from 'react-router-dom'

import { LogoLockup } from '@/components/ui/logo'
import { ReferralButton } from '@/components/ui/ReferralButton'
import { ThemeToggleButton } from '@/components/ui/ThemeToggleButton'
import { cn } from '@/lib/utils/cn'
import { NAV_ITEMS } from './nav-config'

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

  return (
    <aside className="border-border bg-card sticky top-0 flex h-screen w-[232px] flex-shrink-0 flex-col self-start border-r px-3.5 pb-4 pt-5">
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
                  <span>{t(item.i18nKey)}</span>
                </>
              )}
            </NavLink>
          )
        })}
      </nav>

      {/* Footer: реферал + тема + help */}
      <div className="border-border mt-3 flex flex-col gap-2 border-t pt-3">
        <ReferralButton variant="sidebar" />
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
    </aside>
  )
}
