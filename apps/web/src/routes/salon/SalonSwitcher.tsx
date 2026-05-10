import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { Check, ChevronsUpDown, Plus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'

import { useMySalons } from '@/hooks/useSalons'
import { rememberLastSalon } from '@/routes/RootRedirect'

type Props = {
  salonId: string
  salonName: string
}

/**
 * Дропдаун для переключения между салонами юзера. Показывается в TopBar.
 *
 * - Если у юзера один салон — кнопка с chevron всё равно есть, чтобы можно
 *   было создать второй салон через пункт «+ Создать ещё салон» (TASK
 *   b829aa55: multi-salon UX).
 * - Если несколько — выбор переключает на /{newSalonId}/dashboard.
 * - Создание дополнительного салона ведёт на /onboarding — тот же 5-шаговый
 *   wizard, что и для первого.
 */
export function SalonSwitcher({ salonId, salonName }: Props) {
  const { t } = useTranslation()
  const { data: salons } = useMySalons()
  const navigate = useNavigate()

  const list = salons ?? []
  // Даже при одном салоне показываем dropdown — внутри пункт «+ Создать ещё».
  // Раньше тут был просто текст; теперь это всегда кнопка-меню.

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          className="text-brand-navy hover:text-brand-navy-soft inline-flex items-center gap-1.5 rounded-md text-[15px] font-bold tracking-tight"
          data-testid="salon-switcher"
        >
          {salonName}
          <ChevronsUpDown className="text-muted-foreground size-4" strokeWidth={1.7} />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="start"
          sideOffset={6}
          className="border-border bg-card shadow-finmd min-w-[240px] rounded-md border p-1"
        >
          <DropdownMenu.Label className="text-muted-foreground px-3 py-1.5 text-xs font-semibold uppercase tracking-wide">
            {t('salon_switcher.title')}
          </DropdownMenu.Label>
          {list.map((s) => {
            const isActive = s.id === salonId
            return (
              <DropdownMenu.Item
                key={s.id}
                className="data-[highlighted]:bg-accent flex cursor-pointer items-center justify-between gap-2 rounded-sm px-3 py-2 text-sm outline-none"
                onSelect={() => {
                  rememberLastSalon(s.id)
                  navigate(`/${s.id}/dashboard`)
                }}
              >
                <span className="truncate font-medium">{s.name}</span>
                {isActive ? (
                  <Check className="text-secondary size-4" strokeWidth={2} aria-hidden />
                ) : null}
              </DropdownMenu.Item>
            )
          })}
          <DropdownMenu.Separator className="bg-border my-1 h-px" />
          <DropdownMenu.Item
            className="text-secondary data-[highlighted]:bg-accent flex cursor-pointer items-center gap-2 rounded-sm px-3 py-2 text-sm font-semibold outline-none"
            onSelect={() => navigate('/onboarding')}
            data-testid="salon-switcher-add"
          >
            <Plus className="size-4" strokeWidth={2} />
            {t('salon_switcher.add_new')}
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}
