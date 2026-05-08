import { Monitor, Moon, Sun } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { useTheme, type Theme } from '@/components/theme/theme-provider'

/**
 * AppearanceCard — Settings → переключатель темы (system / light / dark).
 * State хранится в localStorage; ThemeProvider слушает и кладёт класс на html.
 */
export function AppearanceCard() {
  const { t } = useTranslation()
  const { theme, resolvedTheme, setTheme } = useTheme()

  const options: Array<{ value: Theme; icon: typeof Sun; labelKey: string }> = [
    { value: 'system', icon: Monitor, labelKey: 'settings.appearance.theme_system' },
    { value: 'light', icon: Sun, labelKey: 'settings.appearance.theme_light' },
    { value: 'dark', icon: Moon, labelKey: 'settings.appearance.theme_dark' },
  ]

  return (
    <section className="border-border bg-card shadow-finsm rounded-lg border p-5 sm:p-6">
      <h2 className="text-brand-navy text-base font-bold tracking-tight">
        {t('settings.appearance.title')}
      </h2>
      <p className="text-muted-foreground mt-1 text-sm">
        {t('settings.appearance.subtitle', { resolved: resolvedTheme })}
      </p>

      <div className="mt-3 grid grid-cols-3 gap-2">
        {options.map((opt) => {
          const Icon = opt.icon
          const active = theme === opt.value
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => setTheme(opt.value)}
              className={`flex flex-col items-center gap-1.5 rounded-md border p-3 transition-colors ${
                active
                  ? 'border-secondary bg-secondary/5 text-foreground'
                  : 'border-border text-muted-foreground hover:border-secondary/50 hover:text-foreground'
              }`}
            >
              <Icon className="size-5" strokeWidth={1.7} />
              <span className="text-xs font-semibold">{t(opt.labelKey)}</span>
            </button>
          )
        })}
      </div>
    </section>
  )
}
