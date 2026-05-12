import {
  BookOpen,
  CreditCard,
  HelpCircle,
  Palette,
  Plug,
  Shield,
  SlidersHorizontal,
  User,
  Users,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'

export const SETTINGS_TABS = [
  'profile',
  'catalogs',
  'parameters',
  'billing',
  'team',
  'integrations',
  'security',
  'appearance',
  'help',
] as const

export type SettingsTab = (typeof SETTINGS_TABS)[number]

const TAB_ICONS: Record<SettingsTab, typeof User> = {
  profile: User,
  catalogs: BookOpen,
  parameters: SlidersHorizontal,
  billing: CreditCard,
  team: Users,
  integrations: Plug,
  security: Shield,
  appearance: Palette,
  help: HelpCircle,
}

/**
 * Горизонтальный таб-навигатор для страницы Settings. Скроллится на мобиле.
 * Активный таб — переменная в URL (?tab=...), управляется родителем.
 */
export function SettingsTabsNav({
  active,
  onChange,
}: {
  active: SettingsTab
  onChange: (tab: SettingsTab) => void
}) {
  const { t } = useTranslation()

  return (
    <div className="border-border bg-card shadow-finsm mb-6 rounded-lg border p-1.5">
      <nav className="-mx-1.5 flex gap-1 overflow-x-auto px-1.5 sm:overflow-visible">
        {SETTINGS_TABS.map((tab) => {
          const Icon = TAB_ICONS[tab]
          const isActive = active === tab
          return (
            <button
              key={tab}
              type="button"
              onClick={() => onChange(tab)}
              className={`flex shrink-0 items-center gap-2 rounded-md px-3 py-2 text-sm font-semibold transition-colors ${
                isActive
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'text-muted-foreground hover:bg-muted/40 hover:text-foreground'
              }`}
            >
              <Icon className="size-4" strokeWidth={1.8} />
              {t(`settings.tabs.${tab}`)}
            </button>
          )
        })}
      </nav>
    </div>
  )
}
