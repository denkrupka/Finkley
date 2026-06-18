import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { Check, ChevronsUpDown, Lock, Plus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'

import { useEntitlements } from '@/hooks/useEntitlements'
import { usePermissions } from '@/hooks/usePermissions'
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
  const { role } = usePermissions(salonId)
  const { canCreateMultipleSalons } = useEntitlements(salonId)
  const navigate = useNavigate()

  const list = salons ?? []
  // Bug (баг-трекер): мастер (staff) видел «Создать ещё салон». Это owner-
  // действие — скрываем для staff/external.
  const canCreateSalon = role !== 'staff' && role !== 'external'
  // T7 — несколько салонов только на тарифе €99. Если уже есть салон и тариф
  // ниже — ведём на апгрейд вместо создания.
  const multiSalonLocked = list.length >= 1 && !canCreateMultipleSalons

  function handleAddSalon() {
    if (multiSalonLocked) {
      toast.message(
        t('billing.multi_salon_locked', {
          defaultValue:
            'Несколько салонов доступно на тарифе €99. Откройте его, чтобы добавить салон.',
        }),
      )
      navigate(`/${salonId}/settings?tab=billing&plan=t99`)
      return
    }
    navigate('/onboarding?new=1')
  }
  // Даже при одном салоне показываем dropdown — внутри пункт «+ Создать ещё».
  // Раньше тут был просто текст; теперь это всегда кнопка-меню.

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          className="text-brand-navy hover:text-brand-navy-soft flex w-full min-w-0 items-center gap-1.5 rounded-md text-left text-[15px] font-bold tracking-tight"
          data-testid="salon-switcher"
        >
          {/* Bug 1b88180e: truncate чтобы длинное имя салона на mobile
              не переносилось на несколько строк и не наезжало на контент. */}
          <span className="min-w-0 flex-1 truncate">{salonName}</span>
          <ChevronsUpDown className="text-muted-foreground size-4 shrink-0" strokeWidth={1.7} />
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
          {canCreateSalon ? (
            <>
              <DropdownMenu.Separator className="bg-border my-1 h-px" />
              <DropdownMenu.Item
                className="text-secondary data-[highlighted]:bg-accent flex cursor-pointer items-center gap-2 rounded-sm px-3 py-2 text-sm font-semibold outline-none"
                onSelect={handleAddSalon}
                data-testid="salon-switcher-add"
              >
                {multiSalonLocked ? (
                  <Lock className="size-4" strokeWidth={2} />
                ) : (
                  <Plus className="size-4" strokeWidth={2} />
                )}
                {t('salon_switcher.add_new')}
              </DropdownMenu.Item>
            </>
          ) : null}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}
