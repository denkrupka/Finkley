import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'

import { RequireAuth, RequireGuest } from '@/components/auth/RequireAuth'
import { LoginPage } from '@/routes/auth/Login'
import { RootRedirect } from '@/routes/RootRedirect'
import { AIPage } from '@/routes/salon/pages'
import { SalonLayout } from '@/routes/salon/SalonLayout'

/**
 * Корневой компонент. Auth-роуты — публичные (с RequireGuest),
 * остальные — под RequireAuth.
 *
 * Eager: только Login (точка входа на возврате), SalonLayout,
 * RootRedirect — критический путь.
 *
 * Lazy (по своему chunk):
 * - Все salon-scoped страницы (юзер их по одной открывает)
 * - Signup/Forgot/Reset/Callback — посещаются 1 раз за время использования
 * - Onboarding — посещается ровно 1 раз в жизни юзера
 */
const SignupPage = lazy(() =>
  import('@/routes/auth/Signup').then((m) => ({ default: m.SignupPage })),
)
const ForgotPasswordPage = lazy(() =>
  import('@/routes/auth/ForgotPassword').then((m) => ({ default: m.ForgotPasswordPage })),
)
const ResetPasswordPage = lazy(() =>
  import('@/routes/auth/ResetPassword').then((m) => ({ default: m.ResetPasswordPage })),
)
const AuthCallbackPage = lazy(() =>
  import('@/routes/auth/AuthCallback').then((m) => ({ default: m.AuthCallbackPage })),
)
const OnboardingPage = lazy(() =>
  import('@/routes/onboarding/OnboardingPage').then((m) => ({ default: m.OnboardingPage })),
)

const DashboardPage = lazy(() =>
  import('@/routes/dashboard/DashboardPage').then((m) => ({ default: m.DashboardPage })),
)
const VisitsPage = lazy(() =>
  import('@/routes/visits/VisitsPage').then((m) => ({ default: m.VisitsPage })),
)
const ClientsPage = lazy(() =>
  import('@/routes/clients/ClientsPage').then((m) => ({ default: m.ClientsPage })),
)
const ExpensesPage = lazy(() =>
  import('@/routes/expenses/ExpensesPage').then((m) => ({ default: m.ExpensesPage })),
)
const StaffPage = lazy(() =>
  import('@/routes/staff/StaffPage').then((m) => ({ default: m.StaffPage })),
)
const PayoutsPage = lazy(() =>
  import('@/routes/payouts/PayoutsPage').then((m) => ({ default: m.PayoutsPage })),
)
const ReportsPage = lazy(() =>
  import('@/routes/reports/ReportsPage').then((m) => ({ default: m.ReportsPage })),
)
const ImportPage = lazy(() =>
  import('@/routes/settings/import/ImportPage').then((m) => ({ default: m.ImportPage })),
)
const SettingsPage = lazy(() =>
  import('@/routes/settings/SettingsPage').then((m) => ({ default: m.SettingsPage })),
)

/** Скелетон для Suspense-fallback. Простой, не привлекающий внимания. */
function PageFallback() {
  return (
    <div className="flex flex-1 flex-col px-5 py-7 sm:px-8" aria-busy="true">
      <div className="bg-muted/50 mb-5 h-8 w-1/3 animate-pulse rounded-md" />
      <div className="bg-muted/40 h-64 animate-pulse rounded-lg" />
    </div>
  )
}

function lazyRoute(node: React.ReactNode) {
  return <Suspense fallback={<PageFallback />}>{node}</Suspense>
}

function App() {
  return (
    <Routes>
      {/* Гостевые */}
      <Route
        path="/login"
        element={
          <RequireGuest>
            <LoginPage />
          </RequireGuest>
        }
      />
      <Route path="/signup" element={<RequireGuest>{lazyRoute(<SignupPage />)}</RequireGuest>} />
      <Route
        path="/forgot-password"
        element={<RequireGuest>{lazyRoute(<ForgotPasswordPage />)}</RequireGuest>}
      />
      {/* /reset-password требует временную сессию из ссылки — без RequireGuest */}
      <Route path="/reset-password" element={lazyRoute(<ResetPasswordPage />)} />
      <Route path="/auth/callback" element={lazyRoute(<AuthCallbackPage />)} />

      {/* Приватные */}
      <Route
        path="/"
        element={
          <RequireAuth>
            <RootRedirect />
          </RequireAuth>
        }
      />
      <Route
        path="/onboarding"
        element={<RequireAuth>{lazyRoute(<OnboardingPage />)}</RequireAuth>}
      />

      {/* Salon-scoped */}
      <Route
        path="/:salonId"
        element={
          <RequireAuth>
            <SalonLayout />
          </RequireAuth>
        }
      >
        <Route index element={<Navigate to="dashboard" replace />} />
        <Route path="dashboard" element={lazyRoute(<DashboardPage />)} />
        <Route path="visits" element={lazyRoute(<VisitsPage />)} />
        <Route path="clients" element={lazyRoute(<ClientsPage />)} />
        <Route path="expenses" element={lazyRoute(<ExpensesPage />)} />
        <Route path="staff" element={lazyRoute(<StaffPage />)} />
        <Route path="payouts" element={lazyRoute(<PayoutsPage />)} />
        <Route path="reports" element={lazyRoute(<ReportsPage />)} />
        <Route path="ai" element={<AIPage />} />
        <Route path="settings" element={lazyRoute(<SettingsPage />)} />
        <Route path="settings/import" element={lazyRoute(<ImportPage />)} />
        <Route path="*" element={<Navigate to="dashboard" replace />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default App
