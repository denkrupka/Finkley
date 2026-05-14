import {
  Bell,
  BookOpen,
  Code,
  CreditCard,
  HelpCircle,
  Plug,
  Shield,
  User,
  Users,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'

// Порядок (по требованию владельца, 2026-05-15):
//   Профиль · Пользователи · Уведомления · Справочники · Интеграции ·
//   Биллинг · Безопасность · API · Помощь.
// «Уведомления» оставлены (salon-настройки дайджестов).
export const SETTINGS_TABS = [
  'profile',
  'team',
  'notifications',
  'catalogs',
  'integrations',
  'billing',
  'security',
  'api',
  'help',
] as const

export type SettingsTab = (typeof SETTINGS_TABS)[number]

const TAB_ICONS: Record<SettingsTab, typeof User> = {
  profile: User,
  catalogs: BookOpen,
  notifications: Bell,
  api: Code,
  billing: CreditCard,
  team: Users,
  integrations: Plug,
  security: Shield,
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
