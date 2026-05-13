import { Monitor, Moon, Sun } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { useTheme, type Theme } from '@/components/theme/theme-provider'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils/cn'

/**
 * Мини-кнопка переключения темы. Клик → popover с 3 опциями: System / Light / Dark.
 * Когда выбран `system`, иконка показывает текущую разрешённую тему (sun/moon),
 * а маленький индикатор Monitor поверх отмечает «следую за ОС».
 */
export function ThemeToggleButton({ variant = 'topbar' }: { variant?: 'topbar' | 'sidebar' } = {}) {
  const { t } = useTranslation()
  const { theme, resolvedTheme, setTheme } = useTheme()

  const Icon = resolvedTheme === 'dark' ? Moon : Sun
  const isSystem = theme === 'system'
  const title = isSystem
    ? `${t('settings.appearance.title')} · ${t('settings.appearance.theme_system')}`
    : t('settings.appearance.title')

  const options: Array<{ value: Theme; icon: typeof Sun; labelKey: string }> = [
    { value: 'system', icon: Monitor, labelKey: 'settings.appearance.theme_system' },
    { value: 'light', icon: Sun, labelKey: 'settings.appearance.theme_light' },
    { value: 'dark', icon: Moon, labelKey: 'settings.appearance.theme_dark' },
  ]

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={title}
          title={title}
          className={cn(
            'border-border bg-card hover:bg-muted/40 relative grid place-items-center rounded-md border transition-colors',
            variant === 'sidebar' ? 'size-9' : 'size-9',
          )}
        >
          <Icon className="size-4" strokeWidth={1.7} />
          {isSystem ? (
            <span
              aria-hidden
              className="border-card bg-brand-teal absolute -bottom-1 -right-1 grid size-3.5 place-items-center rounded-full border"
              title={t('settings.appearance.theme_system')}
            >
              <Monitor className="size-2 text-white" strokeWidth={2.5} />
            </span>
          ) : null}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-44 p-1">
        <ul className="flex flex-col gap-0.5">
          {options.map((opt) => {
            const OptionIcon = opt.icon
            const active = theme === opt.value
            return (
              <li key={opt.value}>
                <button
                  type="button"
                  onClick={() => setTheme(opt.value)}
                  className={cn(
                    'hover:bg-muted/40 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors',
                    active && 'bg-muted/30 font-semibold',
                  )}
                >
                  <OptionIcon className="size-4" strokeWidth={1.8} />
                  {t(opt.labelKey)}
                </button>
              </li>
            )
          })}
        </ul>
      </PopoverContent>
    </Popover>
  )
}
