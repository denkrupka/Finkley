import { Check, ChevronsUpDown, Search } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils/cn'

export type SearchableOption = {
  value: string
  label: string
  /** Опциональный sublabel — показывается мелким текстом рядом с label. */
  hint?: string
  /** Дополнительная строка для матчинга при поиске (например, code/SKU). */
  searchText?: string
}

/**
 * Универсальный selectt с inline-поиском. Используется когда опций много
 * (услуги, клиенты, инвентарь) и обычный Select становится неудобным.
 *
 * - Поиск substring-match по label + searchText (case-insensitive).
 * - Esc / blur — закрывает popover.
 * - Enter в input — выбирает первую опцию.
 */
export function SearchableSelect({
  value,
  onChange,
  options,
  placeholder,
  searchPlaceholder,
  emptyText,
  triggerClassName,
  contentClassName,
  disabled,
  ariaLabel,
}: {
  value: string | null | undefined
  onChange: (value: string) => void
  options: SearchableOption[]
  placeholder?: string
  searchPlaceholder?: string
  emptyText?: string
  triggerClassName?: string
  contentClassName?: string
  disabled?: boolean
  ariaLabel?: string
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      setQuery('')
      // фокус в input после открытия popover
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [open])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return options
    return options.filter((o) => {
      const hay = (o.label + ' ' + (o.searchText ?? '')).toLowerCase()
      return hay.includes(q)
    })
  }, [options, query])

  const current = options.find((o) => o.value === value)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          role="combobox"
          aria-expanded={open}
          aria-label={ariaLabel}
          disabled={disabled}
          className={cn(
            'border-input bg-card hover:bg-muted/40 flex h-10 w-full items-center justify-between gap-2 rounded-md border px-3 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50',
            triggerClassName,
          )}
        >
          <span className={cn('truncate', !current && 'text-muted-foreground')}>
            {current?.label ?? placeholder ?? ''}
          </span>
          <ChevronsUpDown className="text-muted-foreground size-4 shrink-0" strokeWidth={1.8} />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className={cn('w-[var(--radix-popover-trigger-width)] p-0', contentClassName)}
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <div className="border-border flex items-center gap-2 border-b px-3 py-2">
          <Search className="text-muted-foreground size-3.5 shrink-0" strokeWidth={1.8} />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault()
                setOpen(false)
              } else if (e.key === 'Enter' && filtered.length > 0) {
                e.preventDefault()
                onChange(filtered[0]!.value)
                setOpen(false)
              }
            }}
            placeholder={searchPlaceholder ?? 'Поиск…'}
            className="placeholder:text-muted-foreground flex-1 bg-transparent text-sm outline-none"
          />
        </div>
        <ul className="max-h-[280px] overflow-y-auto py-1" role="listbox">
          {filtered.length === 0 ? (
            <li className="text-muted-foreground px-3 py-4 text-center text-xs">
              {emptyText ?? '—'}
            </li>
          ) : (
            filtered.map((o) => {
              const selected = o.value === value
              return (
                <li key={o.value} role="option" aria-selected={selected}>
                  <button
                    type="button"
                    onClick={() => {
                      onChange(o.value)
                      setOpen(false)
                    }}
                    className={cn(
                      'hover:bg-muted/60 flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm transition-colors',
                      selected && 'bg-muted/40 font-semibold',
                    )}
                  >
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="text-foreground truncate">{o.label}</span>
                      {o.hint ? (
                        <span className="text-muted-foreground truncate text-[11px]">{o.hint}</span>
                      ) : null}
                    </span>
                    {selected ? (
                      <Check className="text-primary size-4 shrink-0" strokeWidth={2.4} />
                    ) : null}
                  </button>
                </li>
              )
            })
          )}
        </ul>
      </PopoverContent>
    </Popover>
  )
}
