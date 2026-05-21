import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { Check, Globe } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { useAuth } from '@/hooks/useAuth'
import { supabase } from '@/lib/supabase/client'

/**
 * Переключатель языка интерфейса. RU/PL/EN — полные переводы (1635 ключей).
 *
 * Двойная персистенция:
 * 1. localStorage (через i18next-browser-languagedetector) — мгновенный отклик
 *    и работает без сети.
 * 2. profiles.locale (если юзер залогинен) — авторитативный источник; при
 *    первом заходе на новом устройстве язык подтянется из БД (см. useI18nSync).
 */
const LOCALES = [
  { code: 'ru', label: 'Русский', flag: '🇷🇺' },
  { code: 'pl', label: 'Polski', flag: '🇵🇱' },
  { code: 'en', label: 'English', flag: '🇬🇧' },
] as const

export function LocaleSwitcher() {
  const { i18n } = useTranslation()
  const { user } = useAuth()
  const current = LOCALES.find((l) => l.code === i18n.language) ?? LOCALES[0]

  async function setLocale(code: string) {
    if (code === i18n.language) return
    await i18n.changeLanguage(code)
    // Best-effort persist в profiles.locale — silent fail если нет сети / RLS.
    // Без авторизации просто пропускаем (гостевые страницы тоже используют свитчер).
    if (user) {
      void supabase
        .from('profiles')
        .update({ locale: code })
        .eq('id', user.id)
        .then(({ error }) => {
          if (error) console.warn('locale persist failed', error.message)
        })
    }
  }

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
                onSelect={() => void setLocale(l.code)}
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
