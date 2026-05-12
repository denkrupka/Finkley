import * as PopoverPrimitive from '@radix-ui/react-popover'
import { Check, ChevronDown, Plus, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Input } from '@/components/ui/input'
import { useClients, type ClientRow } from '@/hooks/useClients'
import { cn } from '@/lib/utils/cn'
import { formatPhoneDisplay } from '@/lib/utils/format-phone'

import { ClientFormModal } from './ClientFormModal'

type Props = {
  salonId: string
  value: string | null
  onChange: (clientId: string | null) => void
  placeholder?: string
  /** testid для Playwright */
  testId?: string
}

/**
 * Combobox для выбора клиента в форме визита.
 * Поведение:
 *   - Поиск по имени или телефону на лету (debounce ~150ms через staleTime cache).
 *   - Если ничего не найдено — кнопка «+ Создать "<query>"», создаёт по имени
 *     (если query похож на телефон — сохраняет в phone). Сразу выбирает.
 *   - «Без клиента» (null) — первая опция, всегда доступна.
 */
export function ClientPicker({ salonId, value, onChange, placeholder, testId }: Props) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const { data: clients = [] } = useClients(salonId, { search: query, sort: 'last_visit' })
  // Полная модалка создания клиента (имя/телефон/email/комментарий) —
  // вместо инлайн-создания. Открывается из «Создать <query>».
  const [createModalOpen, setCreateModalOpen] = useState(false)
  const [createPrefill, setCreatePrefill] = useState('')

  const selected: ClientRow | null = useMemo(() => {
    if (!value) return null
    return clients.find((c) => c.id === value) ?? null
  }, [clients, value])

  // При открытии — фокус в поле поиска
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 30)
    else setQuery('')
  }, [open])

  function selectClient(id: string | null) {
    onChange(id)
    setOpen(false)
  }

  function openCreateModal() {
    setCreatePrefill(query.trim())
    setCreateModalOpen(true)
    setOpen(false)
  }

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <PopoverPrimitive.Trigger asChild>
        <button
          type="button"
          data-testid={testId ?? 'client-picker'}
          className={cn(
            'border-border bg-card text-foreground hover:bg-muted/40 flex h-12 w-full items-center justify-between rounded-md border-[1.5px] px-3.5 text-sm',
            'focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-2',
          )}
        >
          <span className="flex min-w-0 items-center gap-2">
            {selected ? (
              <>
                <span className="truncate font-medium">{selected.name}</span>
                {selected.phone ? (
                  <span className="num text-muted-foreground hidden truncate text-xs sm:inline">
                    {formatPhoneDisplay(selected.phone)}
                  </span>
                ) : null}
              </>
            ) : (
              <span className="text-muted-foreground">
                {placeholder ?? t('clients.picker.no_client')}
              </span>
            )}
          </span>
          {selected ? (
            <span
              role="button"
              tabIndex={0}
              aria-label={t('clients.picker.clear')}
              onClick={(e) => {
                e.stopPropagation()
                onChange(null)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.stopPropagation()
                  onChange(null)
                }
              }}
              className="hover:text-destructive grid size-6 cursor-pointer place-items-center rounded-md"
            >
              <X className="size-3.5" strokeWidth={1.7} />
            </span>
          ) : (
            <ChevronDown className="text-muted-foreground size-4" strokeWidth={1.7} />
          )}
        </button>
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align="start"
          sideOffset={4}
          className="border-border bg-card shadow-finmd z-50 w-[--radix-popover-trigger-width] rounded-md border"
        >
          <div className="p-2">
            <Input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('clients.picker.search_placeholder')}
              className="h-9"
            />
          </div>

          <div className="max-h-72 overflow-y-auto px-1 pb-1">
            {/* No-client option — всегда доступно */}
            <button
              type="button"
              onClick={() => selectClient(null)}
              className={cn(
                'hover:bg-muted/40 flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm',
                value === null && 'bg-muted/60',
              )}
            >
              <span className="text-muted-foreground italic">{t('clients.picker.no_client')}</span>
              {value === null ? <Check className="size-4" strokeWidth={1.7} /> : null}
            </button>

            {clients.slice(0, 50).map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => selectClient(c.id)}
                className={cn(
                  'hover:bg-muted/40 flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm',
                  value === c.id && 'bg-muted/60',
                )}
              >
                <span className="min-w-0 flex-1">
                  <span className="text-foreground block truncate font-medium">{c.name}</span>
                  {c.phone ? (
                    <span className="num text-muted-foreground block truncate text-xs">
                      {formatPhoneDisplay(c.phone)}
                    </span>
                  ) : null}
                </span>
                {value === c.id ? <Check className="size-4" strokeWidth={1.7} /> : null}
              </button>
            ))}

            {query.trim() && clients.length === 0 ? (
              <button
                type="button"
                onClick={openCreateModal}
                className="text-secondary hover:bg-muted/40 flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm font-semibold"
                data-testid="cl-picker-create"
              >
                <Plus className="size-4" strokeWidth={2} />
                {t('clients.picker.create_with', { name: query.trim() })}
              </button>
            ) : null}
          </div>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>

      <ClientFormModal
        open={createModalOpen}
        onOpenChange={setCreateModalOpen}
        salonId={salonId}
        prefillName={createPrefill}
        onCreated={(created) => onChange(created.id)}
      />
    </PopoverPrimitive.Root>
  )
}
