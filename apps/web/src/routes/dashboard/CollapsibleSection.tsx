import { ChevronDown, ChevronRight } from 'lucide-react'
import { type ReactNode } from 'react'

import { usePersistedCollapse } from './useCollapsedState'

type Props = {
  /** Уникальный id для запоминания состояния в localStorage. */
  id: string
  /** Текст заголовка кнопки-сворачивания. */
  title: string
  /** Иконка слева от заголовка. */
  icon?: ReactNode
  /** По умолчанию открыт. */
  defaultOpen?: boolean
  /** Доп. контент справа в шапке (опционально — счётчик и т.п.). */
  rightSlot?: ReactNode
  /** Внешние классы для обёртки <section>. */
  className?: string
  children: ReactNode
}

/**
 * Обёртка для виджетов дашборда: показывает clickable-шапку с шевроном,
 * запоминает состояние сворачивания. Контент скрывается через display:none
 * (не unmount), чтобы внутренние fetch'и не перезапускались при разворачивании.
 */
export function CollapsibleSection({
  id,
  title,
  icon,
  defaultOpen = true,
  rightSlot,
  className,
  children,
}: Props) {
  const { open, toggle } = usePersistedCollapse(id, defaultOpen)
  return (
    <section className={className ?? 'mb-5'}>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="text-muted-foreground hover:text-foreground mb-2 flex w-full items-center gap-2 text-left text-[11px] font-semibold uppercase tracking-wider"
      >
        {open ? (
          <ChevronDown className="size-3.5 shrink-0" strokeWidth={2.2} />
        ) : (
          <ChevronRight className="size-3.5 shrink-0" strokeWidth={2.2} />
        )}
        {icon ? <span className="shrink-0">{icon}</span> : null}
        <span>{title}</span>
        {rightSlot ? <span className="ml-auto">{rightSlot}</span> : null}
      </button>
      <div className={open ? '' : 'hidden'}>{children}</div>
    </section>
  )
}
