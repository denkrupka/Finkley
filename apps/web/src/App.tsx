import { Navigate, Route, Routes } from 'react-router-dom'

import { RequireAuth, RequireGuest } from '@/components/auth/RequireAuth'
import { AuthCallbackPage } from '@/routes/auth/AuthCallback'
import { ForgotPasswordPage } from '@/routes/auth/ForgotPassword'
import { LoginPage } from '@/routes/auth/Login'
import { ResetPasswordPage } from '@/routes/auth/ResetPassword'
import { SignupPage } from '@/routes/auth/Signup'
import { OnboardingPage } from '@/routes/onboarding/OnboardingPage'
import { RootRedirect } from '@/routes/RootRedirect'
import { SalonLayout } from '@/routes/salon/SalonLayout'
import { DashboardPage } from '@/routes/dashboard/DashboardPage'
import { ExpensesPage } from '@/routes/expenses/ExpensesPage'
import { AIPage, ClientsPage, ReportsPage } from '@/routes/salon/pages'
import { SettingsPage } from '@/routes/settings/SettingsPage'
import { StaffPage } from '@/routes/staff/StaffPage'
import { VisitsPage } from '@/routes/visits/VisitsPage'

/**
 * Корневой компонент. Auth-роуты — публичные (с RequireGuest),
 * остальные — под RequireAuth.
 */
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
      <Route
        path="/signup"
        element={
          <RequireGuest>
            <SignupPage />
          </RequireGuest>
        }
      />
      <Route
        path="/forgot-password"
        element={
          <RequireGuest>
            <ForgotPasswordPage />
          </RequireGuest>
        }
      />
      {/* /reset-password требует временную сессию из ссылки — без RequireGuest */}
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/auth/callback" element={<AuthCallbackPage />} />

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
        element={
          <RequireAuth>
            <OnboardingPage />
          </RequireAuth>
        }
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
        <Route path="dashboard" element={<DashboardPage />} />
        <Route path="visits" element={<VisitsPage />} />
        <Route path="clients" element={<ClientsPage />} />
        <Route path="expenses" element={<ExpensesPage />} />
        <Route path="staff" element={<StaffPage />} />
        <Route path="reports" element={<ReportsPage />} />
        <Route path="ai" element={<AIPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="dashboard" replace />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default App
