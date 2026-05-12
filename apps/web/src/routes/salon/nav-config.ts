import {
  BarChart3,
  Bot,
  Home,
  Package,
  PiggyBank,
  Receipt,
  Settings,
  TrendingUp,
  type LucideIcon,
} from 'lucide-react'

/**
 * Источник правды для навигации salon-scoped роутов.
 *
 * После TASK-53 (12 мая 2026) sidebar показывает **группы**, а внутри каждой
 * страницы — горизонтальные табы с подкатегориями:
 *
 *   Главная   → /dashboard
 *   Доходы    → /income (табы: Визиты / Продажи / Прочие)
 *   Расходы   → /expenses
 *   Отчёты    → /reports (табы: Услуги / Клиенты / Мастера / Зарплата)
 *   Финансы   → /finance (табы: P&L / ДДС / Счета на оплату)
 *   Склад     → /inventory
 *   AI        → /ai
 *   Настройки → /settings (внутри есть «Справочники» с CRUD мастеров/услуг/клиентов)
 *
 * CRUD по справочникам (мастера/услуги/клиенты/категории) живёт в Settings →
 * Справочники, **не** в Отчётах. В Отчётах — только аналитика.
 *
 * mobile.includeInBottomNav — какие 4 пункта показывать в bottom-nav
 * (5-й слот — «Ещё», ведёт в /settings).
 */
export type NavItemId =
  | 'dashboard'
  | 'income'
  | 'expenses'
  | 'reports'
  | 'finance'
  | 'inventory'
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
    implemented: true,
    inBottomNav: true,
  },
  {
    id: 'income',
    i18nKey: 'nav.income',
    icon: TrendingUp,
    stage: 1,
    implemented: true,
    inBottomNav: true,
  },
  {
    id: 'expenses',
    i18nKey: 'nav.expenses',
    icon: Receipt,
    stage: 1,
    implemented: true,
    inBottomNav: true,
  },
  {
    id: 'reports',
    i18nKey: 'nav.reports',
    icon: BarChart3,
    stage: 2,
    implemented: true,
    inBottomNav: false,
  },
  {
    id: 'finance',
    i18nKey: 'nav.finance',
    icon: PiggyBank,
    stage: 2,
    implemented: true,
    inBottomNav: false,
  },
  {
    id: 'inventory',
    i18nKey: 'nav.inventory',
    icon: Package,
    stage: 5,
    implemented: true,
    inBottomNav: false,
  },
  {
    id: 'ai',
    i18nKey: 'nav.ai',
    icon: Bot,
    stage: 4,
    implemented: true,
    inBottomNav: true,
  },
  {
    id: 'settings',
    i18nKey: 'nav.settings',
    icon: Settings,
    stage: 1,
    implemented: true,
    inBottomNav: false,
  },
]

export const BOTTOM_NAV_ITEMS = NAV_ITEMS.filter((item) => item.inBottomNav)
