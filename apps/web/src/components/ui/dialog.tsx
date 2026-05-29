import * as DialogPrimitive from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { forwardRef, type ComponentPropsWithoutRef, type ElementRef, type ReactNode } from 'react'

import { cn } from '@/lib/utils/cn'

export const Dialog = DialogPrimitive.Root
export const DialogTrigger = DialogPrimitive.Trigger
export const DialogPortal = DialogPrimitive.Portal
export const DialogClose = DialogPrimitive.Close

export const DialogOverlay = forwardRef<
  ElementRef<typeof DialogPrimitive.Overlay>,
  ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-50 bg-[rgba(20,20,40,0.45)] backdrop-blur-sm',
      className,
    )}
    {...props}
  />
))
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName

type DialogContentProps = ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
  showClose?: boolean
}

export const DialogContent = forwardRef<
  ElementRef<typeof DialogPrimitive.Content>,
  DialogContentProps
>(({ className, children, showClose = true, ...props }, ref) => (
  <DialogPortal>
    <DialogOverlay />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        // Mobile: full viewport minus 1rem padding. От sm и больше — 420px.
        // max-h-100dvh + overflow-y-auto чтобы контент диалога был полностью
        // прокручиваемым (header+form+footer вместе). Раньше был grid с
        // overflow-y-hidden — приходилось вручную добавлять scroll внутри
        // каждого диалога, и часть контента срезалась.
        'bg-card shadow-finxl fixed left-1/2 top-1/2 z-50 flex max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] max-w-[calc(100vw-1rem)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-y-auto overflow-x-hidden rounded-xl sm:max-h-[calc(100dvh-2rem)] sm:w-[420px] sm:max-w-[420px]',
        'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
        className,
      )}
      {...props}
    >
      {children}
      {showClose ? (
        <DialogPrimitive.Close
          className="border-border bg-card text-foreground hover:bg-muted/40 focus-visible:ring-ring absolute right-4 top-4 grid size-9 place-items-center rounded-md border focus-visible:outline-none focus-visible:ring-2"
          aria-label="close"
        >
          <X className="size-4" strokeWidth={1.7} />
        </DialogPrimitive.Close>
      ) : null}
    </DialogPrimitive.Content>
  </DialogPortal>
))
DialogContent.displayName = DialogPrimitive.Content.displayName

export function DialogHeader({ children }: { children: ReactNode }) {
  return (
    <div className="border-border flex flex-col gap-1 border-b px-5 py-4 pr-14">{children}</div>
  )
}

export const DialogTitle = forwardRef<
  ElementRef<typeof DialogPrimitive.Title>,
  ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn('text-brand-navy text-lg font-bold tracking-tight', className)}
    {...props}
  />
))
DialogTitle.displayName = DialogPrimitive.Title.displayName

export const DialogDescription = forwardRef<
  ElementRef<typeof DialogPrimitive.Description>,
  ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn('text-muted-foreground text-xs', className)}
    {...props}
  />
))
DialogDescription.displayName = DialogPrimitive.Description.displayName

/**
 * DialogFooter. По умолчанию — обычный footer в конце формы.
 *
 * Mobile audit (2026-05-30): пропс `sticky` делает футер прилипшим к низу
 * scroll-area (DialogContent сам scroll-area через `overflow-y-auto`).
 * Использовать в длинных формах (ExpenseFormModal, QuickEntryModal) чтобы
 * на iPhone (375-414px) кнопка Submit была видна без скролла к самому низу.
 *
 * Без `sticky` — поведение как раньше. Opt-in, чтобы не ломать диалоги
 * которые сами стилизуют свой footer.
 */
export function DialogFooter({
  children,
  className,
  sticky = false,
}: {
  children: ReactNode
  className?: string
  sticky?: boolean
}) {
  return (
    <div
      className={cn(
        'flex flex-col gap-2 px-5 pb-5 pt-2',
        sticky && 'bg-card/95 border-border sticky bottom-0 z-10 border-t pt-3 backdrop-blur-sm',
        className,
      )}
    >
      {children}
    </div>
  )
}
