import {
  BarChart3,
  Bot,
  Calendar,
  Home,
  Receipt,
  Scissors,
  Settings,
  Users,
  type LucideIcon,
} from 'lucide-react'

/**
 * Источник правды для навигации salon-scoped роутов.
 * 8 пунктов sidebar в порядке `Design/project/chrome.jsx` → `Sidebar`.
 *
 * Каждый пункт знает:
 * - id      — соответствует пути после /{salonId}/
 * - i18nKey — путь в ru.json (`nav.<id>`)
 * - icon    — lucide-react аналог иконки из Design/project/icons.jsx
 * - stage   — на какой стадии MVP появляется реальная страница; до этого — ComingSoon
 *
 * mobile.includeInBottomNav — какие 4 пункта показывать в bottom-nav
 * (5-й слот — «Ещё», ведёт в /settings).
 */
export type NavItemId =
  | 'dashboard'
  | 'visits'
  | 'clients'
  | 'expenses'
  | 'staff'
  | 'reports'
  | 'ai'
  | 'settings'

export type NavItem = {
  id: NavItemId
  i18nKey: string
  icon: LucideIcon
  stage: number
  /** Если true — реальная страница, иначе ComingSoon */
  implemented: boolean
  /** Показывать в mobile bottom-nav */
  inBottomNav: boolean
}

export const NAV_ITEMS: NavItem[] = [
  {
    id: 'dashboard',
    i18nKey: 'nav.dashboard',
    icon: Home,
    stage: 1,
    implemented: false, // станет true в TASK-14
    inBottomNav: true,
  },
  {
    id: 'visits',
    i18nKey: 'nav.visits',
    icon: Calendar,
    stage: 1,
    implemented: false, // станет true в TASK-11
    inBottomNav: true,
  },
  {
    id: 'clients',
    i18nKey: 'nav.clients',
    icon: Users,
    stage: 2,
    implemented: false,
    inBottomNav: false,
  },
  {
    id: 'expenses',
    i18nKey: 'nav.expenses',
    icon: Receipt,
    stage: 1,
    implemented: false, // станет true в TASK-13
    inBottomNav: true,
  },
  {
    id: 'staff',
    i18nKey: 'nav.staff',
    icon: Scissors,
    stage: 1,
    implemented: false, // станет true в TASK-12
    inBottomNav: false,
  },
  {
    id: 'reports',
    i18nKey: 'nav.reports',
    icon: BarChart3,
    stage: 2,
    implemented: false,
    inBottomNav: false,
  },
  {
    id: 'ai',
    i18nKey: 'nav.ai',
    icon: Bot,
    stage: 4,
    implemented: false,
    inBottomNav: true,
  },
  {
    id: 'settings',
    i18nKey: 'nav.settings',
    icon: Settings,
    stage: 1,
    implemented: false, // частично будет в TASK-12/18
    inBottomNav: false,
  },
]

export const BOTTOM_NAV_ITEMS = NAV_ITEMS.filter((item) => item.inBottomNav)
