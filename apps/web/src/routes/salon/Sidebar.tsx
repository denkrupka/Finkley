import { useTranslation } from 'react-i18next'
import { NavLink } from 'react-router-dom'

import { LogoLockup } from '@/components/ui/logo'
import { cn } from '@/lib/utils/cn'
import { NAV_ITEMS } from './nav-config'

type Props = {
  salonId: string
  salonName: string
  salonCity?: string | null
  ownerInitials: string
  /** Для mobile-drawer — закрыть после клика по пункту */
  onNavigate?: () => void
}

/**
 * Sidebar 232×fullheight по референсу `Design/project/chrome.jsx` → `Sidebar`.
 * Сверху лого Finkley, в середине 8 пунктов навигации, внизу карточка тарифа
 * + блок аватар/имя/город.
 *
 * Для mobile используется в Sheet/Drawer — `onNavigate` закрывает drawer
 * при переходе.
 */
export function Sidebar({ salonId, salonName, salonCity, ownerInitials, onNavigate }: Props) {
  const { t } = useTranslation()

  return (
    <aside className="border-border bg-card flex h-full w-[232px] flex-shrink-0 flex-col border-r px-3.5 pb-4 pt-5">
      {/* Logo */}
      <div className="mb-5 px-2">
        <LogoLockup size={28} />
      </div>

      {/* Nav */}
      <nav className="flex flex-1 flex-col gap-0.5">
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

      {/* Pro plan card */}
      <div className="border-brand-yellow-deep/35 mt-4 rounded-xl border bg-gradient-to-br from-[#FFFCEB] to-[#FFF4D1] p-3">
        <div className="flex items-center gap-2.5">
          <div className="from-brand-gold grid size-7 place-items-center rounded-md bg-gradient-to-br to-[#E5C078] text-[11px] font-extrabold text-white">
            ★
          </div>
          <div className="flex-1 leading-tight">
            <div className="text-brand-navy text-[12px] font-bold">{t('plan.pro_label')}</div>
            <div className="text-muted-foreground text-[10.5px]">{t('plan.pro_until')}</div>
          </div>
        </div>
      </div>

      {/* Avatar + salon name */}
      <div className="mt-3 flex items-center gap-2.5 px-1.5 py-2">
        <div className="text-brand-navy grid size-8 place-items-center rounded-full bg-gradient-to-br from-[#E8C4B8] to-[#D4A599] text-xs font-bold">
          {ownerInitials}
        </div>
        <div className="min-w-0 flex-1 leading-tight">
          <div className="text-foreground truncate text-sm font-semibold">{salonName}</div>
          {salonCity ? (
            <div className="text-muted-foreground truncate text-[11px]">{salonCity}</div>
          ) : null}
        </div>
      </div>
    </aside>
  )
}
