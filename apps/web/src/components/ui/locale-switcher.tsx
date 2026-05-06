import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { Check, Globe } from 'lucide-react'
import { useTranslation } from 'react-i18next'

/**
 * Переключатель языка интерфейса. В стадии 1 — только русский,
 * но компонент уже готов к добавлению PL/EN/DE в стадии 5 (TASK-43):
 * нужно только дополнить i18n/config supportedLngs + добавить файлы переводов.
 *
 * Хранит выбор в localStorage через i18next-browser-languagedetector
 * (см. i18n/index.ts).
 */
const LOCALES = [{ code: 'ru', label: 'Русский', flag: '🇷🇺' }] as const

export function LocaleSwitcher() {
  const { i18n } = useTranslation()
  const current = LOCALES.find((l) => l.code === i18n.language) ?? LOCALES[0]

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          className="border-border bg-card text-foreground hover:bg-muted/40 grid size-9 place-items-center rounded-md border"
          aria-label={current.label}
        >
          <Globe className="size-[17px]" strokeWidth={1.7} />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={6}
          className="border-border bg-card shadow-finmd min-w-[180px] rounded-md border p-1"
        >
          {LOCALES.map((l) => {
            const isActive = i18n.language === l.code
            return (
              <DropdownMenu.Item
                key={l.code}
                onSelect={() => void i18n.changeLanguage(l.code)}
                className="data-[highlighted]:bg-accent flex cursor-pointer items-center justify-between gap-2 rounded-sm px-3 py-2 text-sm outline-none"
              >
                <span className="flex items-center gap-2">
                  <span aria-hidden>{l.flag}</span>
                  <span>{l.label}</span>
                </span>
                {isActive ? (
                  <Check className="text-secondary size-4" strokeWidth={2} aria-hidden />
                ) : null}
              </DropdownMenu.Item>
            )
          })}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}
