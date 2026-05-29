import {
  AlertTriangle,
  Banknote,
  Bell,
  CalendarClock,
  CreditCard,
  Landmark,
  LineChart,
  Package,
  PiggyBank,
  Receipt,
  ScanLine,
  Sparkles,
  TrendingUp,
} from 'lucide-react'

import type { TourStep } from './tour-internals'

/**
 * T46 — наборы шагов для per-page mini-туров. Каждый набор соответствует
 * одной странице и фокусируется только на специфичных для неё фичах
 * (общий onboarding покрывает остальное).
 */

export const EXPENSES_TOUR_STEPS: TourStep[] = [
  {
    id: 'tabs',
    icon: Receipt,
    titleKey: 'tour.page.expenses.tabs.title',
    bodyKey: 'tour.page.expenses.tabs.body',
  },
  {
    id: 'add',
    icon: Receipt,
    titleKey: 'tour.page.expenses.add.title',
    bodyKey: 'tour.page.expenses.add.body',
    target: '[data-testid="settings-save-public"], [data-tour="expense-add"]',
  },
  {
    id: 'banking',
    icon: Landmark,
    titleKey: 'tour.page.expenses.banking.title',
    bodyKey: 'tour.page.expenses.banking.body',
  },
  {
    id: 'ocr',
    icon: ScanLine,
    titleKey: 'tour.page.expenses.ocr.title',
    bodyKey: 'tour.page.expenses.ocr.body',
  },
  {
    id: 'commissions',
    icon: AlertTriangle,
    titleKey: 'tour.page.expenses.commissions.title',
    bodyKey: 'tour.page.expenses.commissions.body',
  },
]

export const FINANCE_TOUR_STEPS: TourStep[] = [
  {
    id: 'tabs',
    icon: PiggyBank,
    titleKey: 'tour.page.finance.tabs.title',
    bodyKey: 'tour.page.finance.tabs.body',
  },
  {
    id: 'pnl',
    icon: TrendingUp,
    titleKey: 'tour.page.finance.pnl.title',
    bodyKey: 'tour.page.finance.pnl.body',
  },
  {
    id: 'payments',
    icon: CalendarClock,
    titleKey: 'tour.page.finance.payments.title',
    bodyKey: 'tour.page.finance.payments.body',
  },
  {
    id: 'cash',
    icon: CreditCard,
    titleKey: 'tour.page.finance.cash.title',
    bodyKey: 'tour.page.finance.cash.body',
  },
  {
    id: 'transfers',
    icon: Banknote,
    titleKey: 'tour.page.finance.transfers.title',
    bodyKey: 'tour.page.finance.transfers.body',
  },
]

export const DASHBOARD_TOUR_STEPS: TourStep[] = [
  {
    id: 'kpi',
    icon: LineChart,
    titleKey: 'tour.page.dashboard.kpi.title',
    bodyKey: 'tour.page.dashboard.kpi.body',
  },
  {
    id: 'insights',
    icon: Sparkles,
    titleKey: 'tour.page.dashboard.insights.title',
    bodyKey: 'tour.page.dashboard.insights.body',
  },
  {
    id: 'fab',
    icon: Receipt,
    titleKey: 'tour.page.dashboard.fab.title',
    bodyKey: 'tour.page.dashboard.fab.body',
    target: '[data-tour="fab-add"]',
  },
  {
    id: 'notifications',
    icon: Bell,
    titleKey: 'tour.page.dashboard.notifications.title',
    bodyKey: 'tour.page.dashboard.notifications.body',
    target: '[data-tour="bell"]',
  },
]

export const INVENTORY_TOUR_STEPS: TourStep[] = [
  {
    id: 'list',
    icon: Package,
    titleKey: 'tour.page.inventory.list.title',
    bodyKey: 'tour.page.inventory.list.body',
  },
  {
    id: 'threshold',
    icon: AlertTriangle,
    titleKey: 'tour.page.inventory.threshold.title',
    bodyKey: 'tour.page.inventory.threshold.body',
  },
  {
    id: 'purchase',
    icon: Receipt,
    titleKey: 'tour.page.inventory.purchase.title',
    bodyKey: 'tour.page.inventory.purchase.body',
  },
  {
    id: 'stocktake',
    icon: ScanLine,
    titleKey: 'tour.page.inventory.stocktake.title',
    bodyKey: 'tour.page.inventory.stocktake.body',
  },
]
