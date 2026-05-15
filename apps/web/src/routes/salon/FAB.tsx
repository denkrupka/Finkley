import { CalendarPlus, Plus, Receipt } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

/**
 * Floating action button «Добавить» с выпадающим меню.
 *
 * Раньше FAB был однокнопочным «+ Визит» и сразу открывал QuickEntryModal.
 * По багу c6a1c5df владелец хочет, чтобы FAB предлагал выбор: «Визит»
 * или «Расход» — это два самых частых действия. Меню открывается на
 * desktop pill и на mobile fab.
 *
 * - `onVisit` — открывает QuickEntryModal.
 * - `onExpense` — открывает ExpenseFormModal.
 */
export function FAB({ onVisit, onExpense }: { onVisit: () => void; onExpense: () => void }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  function handleVisit() {
    setOpen(false)
    onVisit()
  }

  function handleExpense() {
    setOpen(false)
    onExpense()
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      {/* Desktop pill */}
      <PopoverTrigger asChild>
        <button
          type="button"
          className="bg-primary font-display text-primary-foreground shadow-finlg fixed bottom-7 right-7 z-20 hidden h-14 items-center gap-2 rounded-full px-5 pl-[18px] text-[15px] font-semibold lg:inline-flex"
          data-testid="fab-add-desktop"
        >
          <Plus className="size-5" strokeWidth={2.4} />
          <span>{t('fab.add')}</span>
        </button>
      </PopoverTrigger>

      {/* Mobile round, чуть выше bottom-nav */}
      <PopoverTrigger asChild>
        <button
          type="button"
          className="bg-primary text-primary-foreground shadow-finlg fixed bottom-20 right-5 z-20 grid size-14 place-items-center rounded-full lg:hidden"
          aria-label={t('fab.add')}
          data-testid="fab-add-mobile"
        >
          <Plus className="size-6" strokeWidth={2.4} />
        </button>
      </PopoverTrigger>

      <PopoverContent
        side="top"
        align="end"
        className="border-border bg-card shadow-finxl w-56 rounded-lg border p-1.5"
      >
        <button
          type="button"
          onClick={handleVisit}
          className="text-foreground hover:bg-muted/50 flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm font-semibold"
          data-testid="fab-action-visit"
        >
          <CalendarPlus className="text-secondary size-4" strokeWidth={2} />
          {t('fab.action_visit')}
        </button>
        <button
          type="button"
          onClick={handleExpense}
          className="text-foreground hover:bg-muted/50 flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm font-semibold"
          data-testid="fab-action-expense"
        >
          <Receipt className="text-secondary size-4" strokeWidth={2} />
          {t('fab.action_expense')}
        </button>
      </PopoverContent>
    </Popover>
  )
}
