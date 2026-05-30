import { HelpCircle, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { cn } from '@/lib/utils/cn'

/**
 * T113 — кнопка «?» с popover'ом в углу карточки/секции дашборда.
 *
 * Раньше использовался title= attribute (нативный браузерный tooltip):
 * срабатывал по hover, появлялся медленно (1s+), на тач-устройствах
 * не работал, не форматировался. Заменён на явную кнопку:
 *   - всегда видна в правом верхнем углу
 *   - click — popover с многострочным описанием
 *   - закрывается по клику снаружи или Escape
 *   - works on touch.
 *
 * Текст принимается как plain string с переводами строк (\n). Рендерится
 * с whitespace-pre-line чтобы переносы сохранялись.
 */
export function InfoHelpButton({
  text,
  className,
}: {
  text: string
  /** Дополнительные классы для позиционирования (по умолчанию absolute
   *  right-3 top-3 в parent с position:relative). */
  className?: string
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onDocDown(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDocDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={wrapRef} className={cn('absolute right-3 top-3 z-10', className)}>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          setOpen((v) => !v)
        }}
        aria-label={t('common.info_help.aria', { defaultValue: 'Подсказка' })}
        className={cn(
          'text-muted-foreground hover:text-foreground hover:bg-muted/40 inline-flex size-5 items-center justify-center rounded-full transition-colors',
          open && 'bg-muted/60 text-foreground',
        )}
      >
        <HelpCircle className="size-4" strokeWidth={2} />
      </button>

      {open ? (
        <div
          role="dialog"
          aria-modal="false"
          className="border-border bg-card shadow-finmd absolute right-0 top-7 z-50 w-[280px] rounded-md border p-3 sm:w-[320px]"
        >
          <div className="flex items-start justify-between gap-2">
            <p className="text-foreground text-[12px] font-bold uppercase tracking-wider">
              {t('common.info_help.title', { defaultValue: 'Что это' })}
            </p>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label={t('common.close', { defaultValue: 'Закрыть' })}
              className="text-muted-foreground hover:text-foreground -mr-1 -mt-1"
            >
              <X className="size-3.5" strokeWidth={2} />
            </button>
          </div>
          <p className="text-foreground/85 mt-1.5 whitespace-pre-line text-[12px] leading-snug">
            {text}
          </p>
        </div>
      ) : null}
    </div>
  )
}
