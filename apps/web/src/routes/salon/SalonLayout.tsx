import * as Dialog from '@radix-ui/react-dialog'
import { format } from 'date-fns'
import { Suspense, useEffect, useState } from 'react'

import { lazyWithRetry } from '@/lib/lazy-with-retry'
import { getDateLocale } from '@/lib/utils/format-date'
import { useTranslation } from 'react-i18next'
import { Navigate, Outlet, useLocation, useParams } from 'react-router-dom'

import { trackUserAction } from '@/lib/analytics/track-user-action'

import { CashGateRequiredDialog } from '@/components/CashGateRequiredDialog'
import {
  DialogContent as DialogContentUi,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Dialog as DialogUi,
} from '@/components/ui/dialog'
import { useAuth } from '@/hooks/useAuth'
import { useRequireCashShift } from '@/hooks/useCashShifts'
import { useMessengerNotifications } from '@/hooks/useMessenger'
import { useMySalons, useSalon } from '@/hooks/useSalons'
import { useStaff } from '@/hooks/useStaff'
import { rememberLastSalon } from '@/routes/RootRedirect'
import { SubscriptionBanner } from '@/routes/billing/SubscriptionBanner'
import { BottomNav } from './BottomNav'
import { FAB } from './FAB'
import { Sidebar } from './Sidebar'
import { TopBar } from './TopBar'

// QuickEntryModal лениво — он тащит ClientPicker → libphonenumber-js (~80KB).
// Юзеру нужен только когда он жмёт FAB; до этого момента грузить ни к чему.
const QuickEntryModal = lazyWithRetry(() =>
  import('@/routes/visits/QuickEntryModal').then((m) => ({ default: m.QuickEntryModal })),
)
// ExpenseFormModal лениво по той же причине — большая форма с categories
// и subcategories, нужна только когда FAB → «Расход».
const ExpenseFormModal = lazyWithRetry(() =>
  import('@/routes/expenses/ExpenseFormModal').then((m) => ({ default: m.ExpenseFormModal })),
)
// RetailSaleWizard — wizard на 4 шага с inventory/categories, лениво по
// аналогичной причине; нужен только когда FAB → «Продажа».
const RetailSaleWizard = lazyWithRetry(() =>
  import('@/routes/visits/RetailSaleWizard').then((m) => ({ default: m.RetailSaleWizard })),
)

/**
 * Layout для всех salon-scoped роутов `/{salonId}/*`.
 * Делает три вещи:
 *
 * 1. **SalonGuard.** Проверяет, что `:salonId` в URL — салон, в котором юзер
 *    состоит. Иначе 404 (а не редирект — иначе race с авторизацией).
 * 2. **Запоминает выбранный салон** в localStorage для RootRedirect.
 * 3. **Рендерит Chrome:** Sidebar (desktop) / Sheet-drawer (mobile),
 *    TopBar, mobile-only PeriodToggle между TopBar и контентом, FAB,
 *    BottomNav (mobile).
 */
export function SalonLayout() {
  const { t } = useTranslation()
  const { salonId } = useParams<{ salonId: string }>()
  const location = useLocation()
  // Скрываем FAB «+Визит» на страницах-«рабочих столах» где он мешает
  // основному CTA (мессенджер имеет свою кнопку «Создать визит» в шапке чата).
  // Image #53: на /finance кнопка +Визит не релевантна — это страница для
  // P&L/ДДС/налогов, а не для записи. Также скрываем на /reports (аналитика —
  // отдельный flow) и /settings (конфигурация — там FAB только мешает).
  const path = location.pathname
  // bug a75ebedf — page-view tracking (fire-and-forget, debounce 5s).
  useEffect(() => {
    if (!salonId) return
    trackUserAction({ kind: 'page_view', target: path, salonId })
  }, [path, salonId])
  const hideFab =
    path.endsWith('/messenger') ||
    path.endsWith('/finance') ||
    path.endsWith('/reports') ||
    path.includes('/settings')
  const { user } = useAuth()
  const { data: salons, isLoading } = useMySalons()
  const [drawerOpen, setDrawerOpen] = useState(false)
  // bug 94dd5f53 — collapse sidebar (только иконки). Состояние в
  // localStorage чтобы переживало рефреш.
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false
    return window.localStorage.getItem('finkley:sidebar:collapsed') === '1'
  })
  function toggleSidebarCollapsed() {
    setSidebarCollapsed((prev) => {
      const next = !prev
      try {
        window.localStorage.setItem('finkley:sidebar:collapsed', next ? '1' : '0')
      } catch {
        /* localStorage may be disabled — ignore */
      }
      return next
    })
  }
  const [quickEntryOpen, setQuickEntryOpen] = useState(false)
  const [quickEntryPrefill, setQuickEntryPrefill] = useState<{
    staffId: string
    when: string
    clientId?: string
    endAt?: string
  } | null>(null)
  const [expenseModalOpen, setExpenseModalOpen] = useState(false)
  const [saleModalOpen, setSaleModalOpen] = useState(false)
  const [gateOpen, setGateOpen] = useState(false)
  const [gateAction, setGateAction] = useState<'expense' | 'sale'>('expense')

  const salon = salons?.find((s) => s.id === salonId) ?? null
  const { data: salonFull } = useSalon(salonId)
  const { data: staff = [] } = useStaff(salonId)
  const { hasOpenShift } = useRequireCashShift(salonId)

  // Глобальная подписка на новые входящие сообщения — toast + native
  // Notification (если разрешено). Учитываем notification_prefs:
  // отсутствие ключа = включено, false = отключено.
  const messengerNotifEnabled =
    (salonFull?.notification_prefs ?? salon?.notification_prefs)?.messenger_new_message !== false
  useMessengerNotifications(salonId, {
    enabled: messengerNotifEnabled,
    salonName: salon?.name,
  })

  useEffect(() => {
    if (salonId && salon) rememberLastSalon(salonId)
  }, [salonId, salon])

  useEffect(() => {
    function onOpenQuickEntry(e: Event) {
      const detail = (
        e as CustomEvent<{
          staffId?: string
          when?: string
          clientId?: string
          endAt?: string
        }>
      ).detail
      if (detail?.staffId && detail.when) {
        setQuickEntryPrefill({
          staffId: detail.staffId,
          when: detail.when,
          clientId: detail.clientId,
          endAt: detail.endAt,
        })
      } else if (detail?.clientId) {
        // Из мессенджера: staff не указан, но клиент известен.
        setQuickEntryPrefill({
          staffId: '',
          when: detail.when ?? new Date().toISOString(),
          clientId: detail.clientId,
        })
      } else {
        setQuickEntryPrefill(null)
      }
      setQuickEntryOpen(true)
    }
    window.addEventListener('finsalon:open-quick-entry', onOpenQuickEntry)
    return () => window.removeEventListener('finsalon:open-quick-entry', onOpenQuickEntry)
  }, [])

  if (isLoading) {
    return (
      <div className="bg-background flex min-h-screen items-center justify-center">
        <div className="bg-muted size-10 animate-pulse rounded-md" aria-hidden />
      </div>
    )
  }

  if (!salon) {
    // SalonGuard: либо такого салона нет, либо юзер не состоит в нём.
    return <Navigate to="/" replace />
  }
  if (salon.blocked_at) {
    return <Navigate to={`/blocked/salon/${salon.id}`} replace />
  }

  const ownerInitials =
    (user?.user_metadata?.full_name ?? user?.email ?? '?')
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((s: string) => s.charAt(0).toUpperCase())
      .join('') || '?'

  const todayLabel = format(new Date(), 'EEEE, d MMMM', { locale: getDateLocale() })

  return (
    <div className="bg-background min-h-screen">
      {/* Sidebar desktop — fixed, всегда видна при прокрутке (любой высоты страницы). */}
      <div className="fixed inset-y-0 left-0 z-30 hidden lg:block">
        <Sidebar
          salonId={salon.id}
          collapsed={sidebarCollapsed}
          onToggleCollapsed={toggleSidebarCollapsed}
        />
      </div>

      {/* Sidebar mobile в Drawer */}
      <Dialog.Root open={drawerOpen} onOpenChange={setDrawerOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm lg:hidden" />
          <Dialog.Content
            className="fixed inset-y-0 left-0 z-50 lg:hidden"
            aria-describedby={undefined}
          >
            <Dialog.Title className="sr-only">{t('nav.drawer_title')}</Dialog.Title>
            <Sidebar salonId={salon.id} onNavigate={() => setDrawerOpen(false)} />
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {/* Right side: TopBar + content + FAB + BottomNav.
          На десктопе сдвинут вправо на ширину фиксированного sidebar (232px).
          h-screen на десктопе делает колонку строго равной viewport — TopBar
          всегда виден, скролл живёт внутри <main>. Это нужно для страниц
          вроде /messenger где нельзя позволить body-скроллу выпихнуть UI. */}
      <div
        className={`flex min-h-screen min-w-0 flex-col lg:h-screen ${
          sidebarCollapsed ? 'lg:pl-[64px]' : 'lg:pl-[232px]'
        }`}
      >
        <TopBar
          salonId={salon.id}
          salonName={salon.name}
          todayLabel={todayLabel.charAt(0).toUpperCase() + todayLabel.slice(1)}
          ownerInitials={ownerInitials}
          onMenuClick={() => setDrawerOpen(true)}
        />

        <SubscriptionBanner />

        <main className="relative flex min-h-0 flex-1 flex-col pb-24 lg:overflow-y-auto lg:pb-0">
          <Outlet />
        </main>
      </div>

      {hideFab ? null : (
        <FAB
          onVisit={() => {
            setQuickEntryPrefill(null)
            setQuickEntryOpen(true)
          }}
          onExpense={() => {
            // Per-user касса: «+Расход» из FAB — тот же гейт что в
            // ExpensesPage. Блокируем открытие модалки заранее.
            if (!hasOpenShift) {
              setGateAction('expense')
              setGateOpen(true)
              return
            }
            setExpenseModalOpen(true)
          }}
          onSale={() => {
            if (!hasOpenShift) {
              setGateAction('sale')
              setGateOpen(true)
              return
            }
            setSaleModalOpen(true)
          }}
        />
      )}
      <BottomNav salonId={salon.id} />

      {quickEntryOpen ? (
        <Suspense fallback={null}>
          <QuickEntryModal
            open={quickEntryOpen}
            onOpenChange={(v) => {
              setQuickEntryOpen(v)
              if (!v) setQuickEntryPrefill(null)
            }}
            salonId={salon.id}
            currency={salon.currency}
            prefill={quickEntryPrefill}
          />
        </Suspense>
      ) : null}

      {expenseModalOpen ? (
        <Suspense fallback={null}>
          <ExpenseFormModal
            open={expenseModalOpen}
            onOpenChange={setExpenseModalOpen}
            salonId={salon.id}
            currency={salon.currency}
          />
        </Suspense>
      ) : null}

      <DialogUi open={saleModalOpen} onOpenChange={setSaleModalOpen}>
        <DialogContentUi className="w-[96vw] gap-0 p-0 sm:!w-[760px] sm:!max-w-[760px]">
          <div className="px-4 pt-4 sm:px-5 sm:pt-5">
            <DialogHeader>
              <DialogTitle>{t('income.sales.create_title')}</DialogTitle>
              <DialogDescription>{t('income.sales.create_subtitle')}</DialogDescription>
            </DialogHeader>
          </div>
          {saleModalOpen ? (
            <Suspense fallback={null}>
              <RetailSaleWizard
                salonId={salon.id}
                currency={salonFull?.currency ?? salon.currency}
                staff={staff}
                onDone={() => setSaleModalOpen(false)}
              />
            </Suspense>
          ) : null}
        </DialogContentUi>
      </DialogUi>

      <CashGateRequiredDialog
        open={gateOpen}
        onClose={() => setGateOpen(false)}
        salonId={salon.id}
        action={gateAction}
        onShiftOpened={() =>
          gateAction === 'sale' ? setSaleModalOpen(true) : setExpenseModalOpen(true)
        }
      />
    </div>
  )
}
