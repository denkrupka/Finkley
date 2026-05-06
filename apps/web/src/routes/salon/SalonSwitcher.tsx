import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { Check, ChevronsUpDown } from 'lucide-react'
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
 * - Если у юзера один салон — рендерим неинтерактивный текст (без кнопки).
 * - Если несколько — кнопка с chevron открывает меню; выбор → router.push
 *   на /{newSalonId}/dashboard и сохранение в localStorage.
 */
export function SalonSwitcher({ salonId, salonName }: Props) {
  const { t } = useTranslation()
  const { data: salons } = useMySalons()
  const navigate = useNavigate()

  const list = salons ?? []
  if (list.length <= 1) {
    return <span className="text-brand-navy text-[15px] font-bold tracking-tight">{salonName}</span>
  }

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
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}
