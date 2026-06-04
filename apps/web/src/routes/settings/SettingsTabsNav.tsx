import {
  Bell,
  BookOpen,
  CalendarClock,
  Code,
  CreditCard,
  HelpCircle,
  Plug,
  Shield,
  User,
  Users,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'

// Порядок (2026-05-15 + image #71):
//   Профиль · Пользователи · График работы · Уведомления · Справочники ·
//   Интеграции · Биллинг · Безопасность · API · Помощь.
export const SETTINGS_TABS = [
  'profile',
  'team',
  'schedule',
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
  schedule: CalendarClock,
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
  visibleTabs,
}: {
  active: SettingsTab
  onChange: (tab: SettingsTab) => void
  /** T36 — список табов которые юзер может видеть. По умолчанию все. */
  visibleTabs?: readonly SettingsTab[]
}) {
  const { t } = useTranslation()
  const tabs = visibleTabs ?? SETTINGS_TABS

  return (
    <div className="border-border bg-card shadow-finsm mb-6 rounded-lg border p-1.5">
      {/* Image #123: 10 табов на одной строке вылазили за рамку контейнера
          (последняя «Помощь» обрезалась). Меняем поведение:
          - на узких viewport'ах — горизонтальный скролл (как было);
          - на средних/широких — flex-wrap, табы переносятся на 2 строки
            если не влезают в одну. Чуть уменьшил padding/gap чтобы при
            умеренной ширине всё-таки одной строкой обходилось. */}
      <nav className="-mx-1.5 flex gap-1 overflow-x-auto px-1.5 sm:flex-wrap sm:overflow-visible">
        {tabs.map((tab) => {
          const Icon = TAB_ICONS[tab]
          const isActive = active === tab
          return (
            <button
              key={tab}
              type="button"
              onClick={() => onChange(tab)}
              className={`flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-2 text-[13px] font-semibold transition-colors ${
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
