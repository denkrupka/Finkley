import { MoreHorizontal } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { NavLink } from 'react-router-dom'

import { cn } from '@/lib/utils/cn'
import { BOTTOM_NAV_ITEMS } from './nav-config'

/**
 * Mobile bottom-nav (5 пунктов). По прототипу
 * `Design/project/screens-4-5-mobile.jsx` → `MobileDashboard`:
 * Главная / Визиты / Расходы / AI / Ещё.
 *
 * 5-й слот «Ещё» ведёт в /settings (хаб всего что не уместилось — staff,
 * reports, profile, integrations).
 *
 * FAB «+ Визит» живёт ОТДЕЛЬНО (см. <FAB />), плавает над bottom-nav.
 */
export function BottomNav({ salonId }: { salonId: string }) {
  const { t } = useTranslation()

  return (
    <nav
      className="border-border bg-card fixed inset-x-0 bottom-0 z-30 grid h-16 grid-cols-5 border-t lg:hidden"
      aria-label="bottom navigation"
    >
      {BOTTOM_NAV_ITEMS.map((item) => {
        const Icon = item.icon
        return (
          <NavLink
            key={item.id}
            to={`/${salonId}/${item.id}`}
            className={({ isActive }) =>
              cn(
                'flex flex-col items-center justify-center gap-1 text-[10px]',
                isActive ? 'text-brand-navy font-bold' : 'text-muted-foreground',
              )
            }
          >
            {({ isActive }) => (
              <>
                <Icon
                  className={cn('size-5', isActive ? 'text-brand-navy' : 'text-muted-foreground')}
                  strokeWidth={1.7}
                />
                <span>{t(item.i18nKey)}</span>
              </>
            )}
          </NavLink>
        )
      })}
      {/* «Ещё» */}
      <NavLink
        to={`/${salonId}/settings`}
        className={({ isActive }) =>
          cn(
            'flex flex-col items-center justify-center gap-1 text-[10px]',
            isActive ? 'text-brand-navy font-bold' : 'text-muted-foreground',
          )
        }
      >
        {({ isActive }) => (
          <>
            <MoreHorizontal
              className={cn('size-5', isActive ? 'text-brand-navy' : 'text-muted-foreground')}
              strokeWidth={1.7}
            />
            <span>{t('nav.more')}</span>
          </>
        )}
      </NavLink>
    </nav>
  )
}
