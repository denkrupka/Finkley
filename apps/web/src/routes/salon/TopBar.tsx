import { Menu } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { LocaleSwitcher } from '@/components/ui/locale-switcher'
import { useAuth } from '@/hooks/useAuth'
import { NotificationsBell } from './NotificationsBell'
import { SalonSwitcher } from './SalonSwitcher'

type Props = {
  /** Текущий салон, чтобы показать имя в TopBar */
  salonId: string
  salonName: string
  /** Сегодняшняя дата человеческой строкой («Понедельник, 6 мая») */
  todayLabel: string
  /** Инициалы пользователя — для аватара в правом верхнем углу. */
  ownerInitials: string
  /** Дёргается на mobile при клике на бургер — родитель открывает drawer-sidebar */
  onMenuClick?: () => void
}

export function TopBar({ salonId, salonName, todayLabel, ownerInitials, onMenuClick }: Props) {
  const { t } = useTranslation()
  const { signOut } = useAuth()
  return (
    <header className="border-border bg-card flex h-16 flex-shrink-0 items-center gap-4 border-b px-5 sm:gap-6 sm:px-7">
      {/* Mobile burger */}
      <button
        type="button"
        onClick={onMenuClick}
        className="border-border bg-card grid size-9 place-items-center rounded-md border lg:hidden"
        aria-label="menu"
      >
        <Menu className="size-[18px]" strokeWidth={1.7} />
      </button>

      {/* Salon name + date (desktop) или просто salon switcher (mobile) */}
      <div className="hidden flex-col leading-tight lg:flex">
        <SalonSwitcher salonId={salonId} salonName={salonName} />
        <span className="text-muted-foreground text-xs">{todayLabel}</span>
      </div>
      <div className="flex flex-1 lg:hidden">
        <SalonSwitcher salonId={salonId} salonName={salonName} />
      </div>

      {/* Period toggle убран из TopBar по решению owner (2026-05-12).
          Страницы которые используют ?period= URL-параметр имеют собственный
          period-selector внутри (Reports/Finance/Cashflow/Visits-list). */}
      <div className="flex flex-1" />

      {/* Bell + locale + plan + avatar + sign-out
          Тема и реферал перенесены в подвал сайдбара. */}
      <div className="flex items-center gap-2 sm:gap-3">
        <NotificationsBell salonId={salonId} />

        <div className="hidden lg:block">
          <LocaleSwitcher />
        </div>

        {/* Plan badge — clickable → /billing. Скрыто на самых узких экранах,
            чтобы не теснить топбар. Аватар видим всегда. */}
        <Link
          to={`/${salonId}/settings?tab=billing`}
          className="border-brand-yellow-deep/40 hidden h-9 items-center gap-1.5 rounded-full border bg-gradient-to-br from-[#FFFCEB] to-[#FFF4D1] px-2.5 transition-shadow hover:shadow-sm sm:inline-flex"
          aria-label={t('plan.badge_aria')}
          title={t('plan.pro_label')}
        >
          <span className="from-brand-gold grid size-5 place-items-center rounded-full bg-gradient-to-br to-[#E5C078] text-[10px] font-extrabold leading-none text-white">
            ★
          </span>
          <span className="text-brand-navy text-[11px] font-bold">{t('plan.pro_label')}</span>
        </Link>

        {/* Avatar — clickable → /settings (профиль). */}
        <Link
          to={`/${salonId}/settings`}
          className="text-brand-navy grid size-9 shrink-0 place-items-center rounded-full bg-gradient-to-br from-[#E8C4B8] to-[#D4A599] text-xs font-bold transition-shadow hover:shadow-sm"
          aria-label={t('common.profile_aria')}
          title={ownerInitials}
        >
          {ownerInitials}
        </Link>

        {/* Sign-out — позже переедет в dropdown профиля (TASK-18) */}
        <Button
          variant="ghost"
          size="sm"
          onClick={signOut}
          data-testid="logout"
          className="hidden lg:inline-flex"
        >
          {t('common.sign_out')}
        </Button>
      </div>
    </header>
  )
}
