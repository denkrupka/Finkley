import { CalendarPlus, Plus, Receipt, ShoppingBag } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

/**
 * Floating action button «Добавить» с выпадающим меню.
 *
 * Раньше внутри одного `<Popover>` было два `<PopoverTrigger asChild>` —
 * desktop pill и mobile circle (bug image #70: popover выползал в левый
 * верхний угол, потому что Radix позиционировался относительно «не того»
 * триггера). Теперь один триггер с responsive-классами: на ≥lg
 * рендерится pill (с текстом), на <lg — круглая кнопка с одной иконкой.
 *
 * - `onVisit` — открывает QuickEntryModal.
 * - `onExpense` — открывает ExpenseFormModal.
 * - `onSale` — открывает RetailSaleWizard в модалке «Новая продажа».
 */
export function FAB({
  onVisit,
  onExpense,
  onSale,
}: {
  onVisit: () => void
  onExpense: () => void
  onSale: () => void
}) {
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

  function handleSale() {
    setOpen(false)
    onSale()
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={t('fab.add')}
          data-testid="fab-add"
          className={[
            'bg-primary text-primary-foreground shadow-finlg fixed z-20',
            // Mobile: круглая 56px над bottom-nav
            'bottom-20 right-5 grid size-14 place-items-center rounded-full',
            // Desktop (≥lg): pill 56px с текстом, ниже и правее
            'lg:bottom-7 lg:right-7 lg:inline-flex lg:size-auto lg:h-14 lg:place-items-stretch',
            'lg:items-center lg:gap-2 lg:rounded-full lg:px-5 lg:pl-[18px] lg:text-[15px]',
            'font-display lg:font-semibold',
          ].join(' ')}
        >
          <Plus className="size-6 lg:size-5" strokeWidth={2.4} />
          <span className="hidden lg:inline">{t('fab.add')}</span>
        </button>
      </PopoverTrigger>

      <PopoverContent
        side="top"
        align="end"
        sideOffset={8}
        collisionPadding={16}
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
          onClick={handleSale}
          className="text-foreground hover:bg-muted/50 flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm font-semibold"
          data-testid="fab-action-sale"
        >
          <ShoppingBag className="text-secondary size-4" strokeWidth={2} />
          {t('fab.action_sale')}
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
