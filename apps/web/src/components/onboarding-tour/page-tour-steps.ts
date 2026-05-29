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
 *
 * T214 — у каждого шага есть `target` CSS-селектор. PageTour использует
 * общий `<TourStage>` рендерер (как и главный OnboardingTour), который
 * рисует затемнение со «вырезом» вокруг таргета и позиционирует tooltip
 * рядом с ним через `getBoundingClientRect`. Если target не найден на
 * странице — fallback на искусственный spotlight по центру с пунктирным
 * кольцом (юзер видит что элемент относится к функциональности этой же
 * страницы, но возможно ещё не имеет данных — например, pin комиссий
 * рендерится только если за период есть авто-комиссии).
 */

export const EXPENSES_TOUR_STEPS: TourStep[] = [
  {
    id: 'tabs',
    icon: Receipt,
    titleKey: 'tour.page.expenses.tabs.title',
    bodyKey: 'tour.page.expenses.tabs.body',
    target: '[data-tour="expenses-tabs"]',
  },
  {
    id: 'add',
    icon: Receipt,
    titleKey: 'tour.page.expenses.add.title',
    bodyKey: 'tour.page.expenses.add.body',
    target: '[data-tour="expense-add"]',
  },
  {
    id: 'banking',
    icon: Landmark,
    titleKey: 'tour.page.expenses.banking.title',
    bodyKey: 'tour.page.expenses.banking.body',
    target: '[data-tour="expenses-tab-banking"]',
  },
  {
    id: 'ocr',
    icon: ScanLine,
    titleKey: 'tour.page.expenses.ocr.title',
    bodyKey: 'tour.page.expenses.ocr.body',
    target: '[data-tour="expense-add"]',
  },
  {
    id: 'commissions',
    icon: AlertTriangle,
    titleKey: 'tour.page.expenses.commissions.title',
    bodyKey: 'tour.page.expenses.commissions.body',
    // Pinned-строка комиссий — может не существовать если у юзера нет
    // комиссий за период. Тогда покажется fallback (искусственный spotlight
    // с пунктирным кольцом) — это feature, не bug.
    target: '[data-tour="commissions-pin"]',
  },
]

export const FINANCE_TOUR_STEPS: TourStep[] = [
  {
    id: 'tabs',
    icon: PiggyBank,
    titleKey: 'tour.page.finance.tabs.title',
    bodyKey: 'tour.page.finance.tabs.body',
    target: '[data-tour="finance-tabs"]',
  },
  {
    id: 'pnl',
    icon: TrendingUp,
    titleKey: 'tour.page.finance.pnl.title',
    bodyKey: 'tour.page.finance.pnl.body',
    target: '[data-tour="finance-tabs"]',
  },
  {
    id: 'payments',
    icon: CalendarClock,
    titleKey: 'tour.page.finance.payments.title',
    bodyKey: 'tour.page.finance.payments.body',
    target: '[data-tour="finance-tabs"]',
  },
  {
    id: 'cash',
    icon: CreditCard,
    titleKey: 'tour.page.finance.cash.title',
    bodyKey: 'tour.page.finance.cash.body',
    target: '[data-tour="finance-tabs"]',
  },
  {
    id: 'transfers',
    icon: Banknote,
    titleKey: 'tour.page.finance.transfers.title',
    bodyKey: 'tour.page.finance.transfers.body',
    target: '[data-tour="finance-tabs"]',
  },
]

export const DASHBOARD_TOUR_STEPS: TourStep[] = [
  {
    id: 'kpi',
    icon: LineChart,
    titleKey: 'tour.page.dashboard.kpi.title',
    bodyKey: 'tour.page.dashboard.kpi.body',
    target: '[data-tour="dashboard-kpi"]',
  },
  {
    id: 'insights',
    icon: Sparkles,
    titleKey: 'tour.page.dashboard.insights.title',
    bodyKey: 'tour.page.dashboard.insights.body',
    target: '[data-tour="dashboard-insights"]',
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
    target: '[data-tour="inventory-list"]',
  },
  {
    id: 'threshold',
    icon: AlertTriangle,
    titleKey: 'tour.page.inventory.threshold.title',
    bodyKey: 'tour.page.inventory.threshold.body',
    // KPI «Мало на складе» — он же триггер механики порога уведомлений.
    target: '[data-tour="inventory-low-kpi"]',
  },
  {
    id: 'purchase',
    icon: Receipt,
    titleKey: 'tour.page.inventory.purchase.title',
    bodyKey: 'tour.page.inventory.purchase.body',
    target: '[data-tour="inventory-add"]',
  },
  {
    id: 'stocktake',
    icon: ScanLine,
    titleKey: 'tour.page.inventory.stocktake.title',
    bodyKey: 'tour.page.inventory.stocktake.body',
    target: '[data-tour="inventory-stocktake"]',
  },
]
