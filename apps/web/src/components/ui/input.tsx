import { forwardRef, type FocusEvent, type InputHTMLAttributes } from 'react'

import { cn } from '@/lib/utils/cn'

/**
 * Bug 65564a78 (Den 05.06): когда юзер заходит в финансовое поле с
 * предзаполненным «0» (цена услуги, % комиссии, фикс. расход и т.п.),
 * приходится вручную тереть ноль перед вводом. Делаем это автоматически:
 * на focus в type=number поле, где текущее значение === 0 / '0' / '0.00' —
 * выделяем содержимое, чтобы первое нажатие клавиши его заменило.
 *
 * Для непустых значений (например 150) ничего не делаем — даём юзеру
 * редактировать на месте курсора.
 */
function isZeroLike(value: string | undefined): boolean {
  if (value == null || value === '') return false
  // 0, 0.0, 0,0, 0.00 ... — любые «всё нули после опц. дробной точки/запятой»
  return /^0([.,]0+)?$/.test(value.trim())
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type = 'text', onFocus, ...props }, ref) => {
    function handleFocus(e: FocusEvent<HTMLInputElement>) {
      onFocus?.(e)
      if (e.defaultPrevented) return
      if (type === 'number' && isZeroLike(e.currentTarget.value)) {
        // setTimeout — браузер сам выставляет курсор после mousedown;
        // делаем select() в следующем тике, иначе он перетирается.
        const target = e.currentTarget
        setTimeout(() => {
          try {
            target.select()
          } catch {
            // input может уже быть unmounted
          }
        }, 0)
      }
    }

    return (
      <input
        ref={ref}
        type={type}
        onFocus={handleFocus}
        className={cn(
          'border-input bg-card font-display text-foreground shadow-finsm flex h-11 w-full rounded-md border px-3.5 py-2 text-sm transition-colors',
          'placeholder:text-muted-foreground',
          'focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1',
          'disabled:cursor-not-allowed disabled:opacity-50',
          'aria-[invalid=true]:border-destructive aria-[invalid=true]:focus-visible:ring-destructive',
          className,
        )}
        {...props}
      />
    )
  },
)
Input.displayName = 'Input'
