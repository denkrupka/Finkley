import { Calendar1, CalendarOff, EyeOff, Pencil } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useToggleStaffCalendarVisibility } from '@/hooks/useStaffMutations'
import type { StaffRow } from '@/hooks/useStaff'

type Props = {
  salonId: string
  staff: StaffRow
  children: React.ReactNode
  onShowDailyView: (staffId: string) => void
  onEditSchedule: (staffId: string) => void
}

/**
 * Popover-меню по клику на staff-cell в шапке календаря.
 * Действия:
 *   1) Дневной вид — фильтрует календарь на одного мастера.
 *   2) Добавить отсутствие — пока «coming soon» (требует отдельной таблицы).
 *   3) Редактировать график — открывает StaffEditSheet.
 *   4) Скрыть из календаря — staff.visible_on_calendar = false.
 */
export function StaffHeaderMenu({
  salonId,
  staff,
  children,
  onShowDailyView,
  onEditSchedule,
}: Props) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const toggleVisibility = useToggleStaffCalendarVisibility(salonId)

  function handleHide() {
    toggleVisibility.mutate(
      { id: staff.id, visible: false },
      {
        onSuccess: () => {
          toast.success(t('visits.calendar.staff_menu.hidden_toast', { name: staff.full_name }))
        },
      },
    )
    setOpen(false)
  }

  function handleDailyView() {
    onShowDailyView(staff.id)
    setOpen(false)
  }

  function handleEditSchedule() {
    onEditSchedule(staff.id)
    setOpen(false)
  }

  function handleAddAbsence() {
    toast.info(t('visits.calendar.staff_menu.absence_coming_soon'))
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent align="center" className="w-60 p-0">
        <button
          type="button"
          onClick={handleDailyView}
          className="hover:bg-muted/40 flex w-full items-center gap-2.5 px-4 py-3 text-left text-sm font-semibold"
        >
          <Calendar1 className="text-muted-foreground size-4 shrink-0" strokeWidth={1.7} />
          {t('visits.calendar.staff_menu.daily_view')}
        </button>
        <div className="border-border border-t" />
        <button
          type="button"
          onClick={handleAddAbsence}
          className="hover:bg-muted/40 flex w-full items-center gap-2.5 px-4 py-3 text-left text-sm font-semibold"
        >
          <CalendarOff className="text-muted-foreground size-4 shrink-0" strokeWidth={1.7} />
          {t('visits.calendar.staff_menu.add_absence')}
        </button>
        <div className="border-border border-t" />
        <button
          type="button"
          onClick={handleEditSchedule}
          className="hover:bg-muted/40 flex w-full items-center gap-2.5 px-4 py-3 text-left text-sm font-semibold"
        >
          <Pencil className="text-muted-foreground size-4 shrink-0" strokeWidth={1.7} />
          {t('visits.calendar.staff_menu.edit_schedule')}
        </button>
        <div className="border-border border-t" />
        <button
          type="button"
          onClick={handleHide}
          className="hover:bg-muted/40 text-destructive flex w-full items-center gap-2.5 px-4 py-3 text-left text-sm font-semibold"
        >
          <EyeOff className="size-4 shrink-0" strokeWidth={1.7} />
          {t('visits.calendar.staff_menu.hide_from_calendar')}
        </button>
      </PopoverContent>
    </Popover>
  )
}
