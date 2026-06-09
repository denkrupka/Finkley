import { MoreHorizontal } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { NavLink } from 'react-router-dom'

import { usePermissions } from '@/hooks/usePermissions'
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
  // Bug (баг-трекер): мобильный bottom-nav не фильтровался по правам — мастер
  // видел «Расходы» и «AI», хотя в десктоп-сайдбаре они скрыты. Фильтруем так
  // же, как Sidebar (dashboard всегда; остальное — can(id,'view')).
  const { can } = usePermissions(salonId)
  const items = BOTTOM_NAV_ITEMS.filter((i) => i.id === 'dashboard' || can(i.id, 'view'))

  return (
    <nav
      className="border-border bg-card fixed inset-x-0 bottom-0 z-30 grid h-16 border-t lg:hidden"
      style={{ gridTemplateColumns: `repeat(${items.length + 1}, minmax(0, 1fr))` }}
      aria-label="bottom navigation"
    >
      {items.map((item) => {
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
