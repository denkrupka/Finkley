import * as Dialog from '@radix-ui/react-dialog'
import { format } from 'date-fns'
import { ru } from 'date-fns/locale'
import { Suspense, useEffect, useState } from 'react'

import { lazyWithRetry } from '@/lib/lazy-with-retry'
import { useTranslation } from 'react-i18next'
import { Navigate, Outlet, useParams } from 'react-router-dom'

import { useAuth } from '@/hooks/useAuth'
import { useMySalons } from '@/hooks/useSalons'
import { rememberLastSalon } from '@/routes/RootRedirect'
import { SubscriptionBanner } from '@/routes/billing/SubscriptionBanner'
import { BottomNav } from './BottomNav'
import { FAB } from './FAB'
import { PeriodToggle } from './PeriodToggle'
import { Sidebar } from './Sidebar'
import { TopBar } from './TopBar'

// QuickEntryModal лениво — он тащит ClientPicker → libphonenumber-js (~80KB).
// Юзеру нужен только когда он жмёт FAB; до этого момента грузить ни к чему.
const QuickEntryModal = lazyWithRetry(() =>
  import('@/routes/visits/QuickEntryModal').then((m) => ({ default: m.QuickEntryModal })),
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
  const { user } = useAuth()
  const { data: salons, isLoading } = useMySalons()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [quickEntryOpen, setQuickEntryOpen] = useState(false)

  const salon = salons?.find((s) => s.id === salonId) ?? null

  useEffect(() => {
    if (salonId && salon) rememberLastSalon(salonId)
  }, [salonId, salon])

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

  const ownerInitials =
    (user?.user_metadata?.full_name ?? user?.email ?? '?')
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((s: string) => s.charAt(0).toUpperCase())
      .join('') || '?'

  const todayLabel = format(new Date(), 'EEEE, d MMMM', { locale: ru })

  return (
    <div className="bg-background flex min-h-screen">
      {/* Sidebar desktop */}
      <div className="hidden lg:block">
        <Sidebar salonId={salon.id} />
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

      {/* Right side: TopBar + content + FAB + BottomNav */}
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar
          salonId={salon.id}
          salonName={salon.name}
          todayLabel={todayLabel.charAt(0).toUpperCase() + todayLabel.slice(1)}
          ownerInitials={ownerInitials}
          onMenuClick={() => setDrawerOpen(true)}
        />

        {/* Mobile-only period toggle (на desktop он в TopBar) */}
        <div className="border-border bg-card border-b px-4 py-2 lg:hidden">
          <div className="flex justify-center">
            <PeriodToggle />
          </div>
        </div>

        <SubscriptionBanner />

        <main className="relative flex flex-1 flex-col overflow-y-auto pb-24 lg:pb-0">
          <Outlet />
        </main>
      </div>

      <FAB onClick={() => setQuickEntryOpen(true)} />
      <BottomNav salonId={salon.id} />

      {quickEntryOpen ? (
        <Suspense fallback={null}>
          <QuickEntryModal
            open={quickEntryOpen}
            onOpenChange={setQuickEntryOpen}
            salonId={salon.id}
            currency={salon.currency}
          />
        </Suspense>
      ) : null}
    </div>
  )
}
