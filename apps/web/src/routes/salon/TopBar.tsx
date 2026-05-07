import { Menu } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { LocaleSwitcher } from '@/components/ui/locale-switcher'
import { useAuth } from '@/hooks/useAuth'
import { NotificationsBell } from './NotificationsBell'
import { PeriodToggle } from './PeriodToggle'
import { SalonSwitcher } from './SalonSwitcher'

type Props = {
  /** Текущий салон, чтобы показать имя в TopBar */
  salonId: string
  salonName: string
  /** Сегодняшняя дата человеческой строкой («Понедельник, 6 мая») */
  todayLabel: string
  /** Дёргается на mobile при клике на бургер — родитель открывает drawer-sidebar */
  onMenuClick?: () => void
}

export function TopBar({ salonId, salonName, todayLabel, onMenuClick }: Props) {
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

      {/* Period toggle (desktop по центру; на mobile живёт под TopBar в самой странице) */}
      <div className="hidden flex-1 justify-center lg:flex">
        <PeriodToggle />
      </div>

      {/* Bell + locale switcher + sign-out (desktop) / только bell (mobile) */}
      <div className="flex items-center gap-2 sm:gap-3">
        <NotificationsBell salonId={salonId} />

        <div className="hidden lg:block">
          <LocaleSwitcher />
        </div>

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
