import { Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'

import { RequireAuth, RequireGuest } from '@/components/auth/RequireAuth'
import { RequirePermission } from '@/components/auth/RequirePermission'
import { RouteErrorBoundary } from '@/components/error-boundary/ErrorBoundary'
import { useI18nSync } from '@/i18n/useI18nSync'
import { lazyWithRetry } from '@/lib/lazy-with-retry'
import { LoginPage } from '@/routes/auth/Login'
import { RootRedirect } from '@/routes/RootRedirect'
import { SalonLayout } from '@/routes/salon/SalonLayout'

const AIPage = lazyWithRetry(() =>
  import('@/routes/ai/AIAssistantPage').then((m) => ({ default: m.AIAssistantPage })),
)
const HelpPage = lazyWithRetry(() =>
  import('@/routes/help/HelpPage').then((m) => ({ default: m.HelpPage })),
)
const TeamPage = lazyWithRetry(() =>
  import('@/routes/team/TeamPage').then((m) => ({ default: m.TeamPage })),
)
const AuditLogPage = lazyWithRetry(() =>
  import('@/routes/audit/AuditLogPage').then((m) => ({ default: m.AuditLogPage })),
)
const AcceptInvitePage = lazyWithRetry(() =>
  import('@/routes/team/AcceptInvitePage').then((m) => ({ default: m.AcceptInvitePage })),
)

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
const SignupPage = lazyWithRetry(() =>
  import('@/routes/auth/Signup').then((m) => ({ default: m.SignupPage })),
)
const ForgotPasswordPage = lazyWithRetry(() =>
  import('@/routes/auth/ForgotPassword').then((m) => ({ default: m.ForgotPasswordPage })),
)
const ResetPasswordPage = lazyWithRetry(() =>
  import('@/routes/auth/ResetPassword').then((m) => ({ default: m.ResetPasswordPage })),
)
const AuthCallbackPage = lazyWithRetry(() =>
  import('@/routes/auth/AuthCallback').then((m) => ({ default: m.AuthCallbackPage })),
)
const OnboardingPage = lazyWithRetry(() =>
  import('@/routes/onboarding/OnboardingPage').then((m) => ({ default: m.OnboardingPage })),
)

const DashboardPage = lazyWithRetry(() =>
  import('@/routes/dashboard/DashboardPage').then((m) => ({ default: m.DashboardPage })),
)
const NotificationsPage = lazyWithRetry(() =>
  import('@/routes/notifications/NotificationsPage').then((m) => ({
    default: m.NotificationsPage,
  })),
)
const VisitsPage = lazyWithRetry(() =>
  import('@/routes/visits/VisitsPage').then((m) => ({ default: m.VisitsPage })),
)
const ExpensesPage = lazyWithRetry(() =>
  import('@/routes/expenses/ExpensesPage').then((m) => ({ default: m.ExpensesPage })),
)
const StaffPage = lazyWithRetry(() =>
  import('@/routes/staff/StaffPage').then((m) => ({ default: m.StaffPage })),
)
const PayoutsPage = lazyWithRetry(() =>
  import('@/routes/payouts/PayoutsPage').then((m) => ({ default: m.PayoutsPage })),
)
const IncomePage = lazyWithRetry(() =>
  import('@/routes/income/IncomePage').then((m) => ({ default: m.IncomePage })),
)
const ReportsHubPage = lazyWithRetry(() =>
  import('@/routes/reports-hub/ReportsHubPage').then((m) => ({ default: m.ReportsHubPage })),
)
const FinancePage = lazyWithRetry(() =>
  import('@/routes/finance/FinancePage').then((m) => ({ default: m.FinancePage })),
)
const ImportPage = lazyWithRetry(() =>
  import('@/routes/settings/import/ImportPage').then((m) => ({ default: m.ImportPage })),
)
const IntegrationsPage = lazyWithRetry(() =>
  import('@/routes/integrations/IntegrationsPage').then((m) => ({ default: m.IntegrationsPage })),
)
const ServicesPage = lazyWithRetry(() =>
  import('@/routes/services/ServicesPage').then((m) => ({ default: m.ServicesPage })),
)
const InventoryPage = lazyWithRetry(() =>
  import('@/routes/inventory/InventoryPage').then((m) => ({ default: m.InventoryPage })),
)
const MarketingPage = lazyWithRetry(() =>
  import('@/routes/marketing/MarketingPage').then((m) => ({ default: m.MarketingPage })),
)
const MessengerPage = lazyWithRetry(() =>
  import('@/routes/messenger/MessengerPage').then((m) => ({ default: m.MessengerPage })),
)
const KnowledgePage = lazyWithRetry(() =>
  import('@/routes/knowledge/KnowledgePage').then((m) => ({ default: m.KnowledgePage })),
)
const SettingsPage = lazyWithRetry(() =>
  import('@/routes/settings/SettingsPage').then((m) => ({ default: m.SettingsPage })),
)
const FinanceCatalogPage = lazyWithRetry(() =>
  import('@/routes/settings/FinanceCatalogPage').then((m) => ({
    default: m.FinanceCatalogPage,
  })),
)
const CounterpartiesCatalogPage = lazyWithRetry(() =>
  import('@/routes/settings/counterparties/CounterpartiesCatalogPage').then((m) => ({
    default: m.CounterpartiesCatalogPage,
  })),
)
const AdminMediaPage = lazyWithRetry(() =>
  import('@/routes/admin/AdminMediaPage').then((m) => ({ default: m.AdminMediaPage })),
)
const AdminLayout = lazyWithRetry(() =>
  import('@/routes/admin/AdminLayout').then((m) => ({ default: m.AdminLayout })),
)
const AdminOverviewPage = lazyWithRetry(() =>
  import('@/routes/admin/AdminOverviewPage').then((m) => ({ default: m.AdminOverviewPage })),
)
const AdminSalonsPage = lazyWithRetry(() =>
  import('@/routes/admin/AdminSalonsPage').then((m) => ({ default: m.AdminSalonsPage })),
)
const AdminUsersPage = lazyWithRetry(() =>
  import('@/routes/admin/AdminUsersPage').then((m) => ({ default: m.AdminUsersPage })),
)
const AdminFeedbackPage = lazyWithRetry(() =>
  import('@/routes/admin/AdminFeedbackPage').then((m) => ({ default: m.AdminFeedbackPage })),
)
const AdminTrackingPage = lazyWithRetry(() =>
  import('@/routes/admin/AdminTrackingPage').then((m) => ({ default: m.AdminTrackingPage })),
)
const BankingCallbackPage = lazyWithRetry(() =>
  import('@/routes/banking/BankingCallbackPage').then((m) => ({ default: m.BankingCallbackPage })),
)
const BlockedAccountPage = lazyWithRetry(() =>
  import('@/routes/blocked/BlockedAccountPage').then((m) => ({ default: m.BlockedAccountPage })),
)
const BlockedSalonPage = lazyWithRetry(() =>
  import('@/routes/blocked/BlockedSalonPage').then((m) => ({ default: m.BlockedSalonPage })),
)
const MediaListPage = lazyWithRetry(() =>
  import('@/routes/media/MediaListPage').then((m) => ({ default: m.MediaListPage })),
)
const MediaArticlePage = lazyWithRetry(() =>
  import('@/routes/media/MediaArticlePage').then((m) => ({ default: m.MediaArticlePage })),
)
const ReviewPage = lazyWithRetry(() =>
  import('@/routes/public/ReviewPage').then((m) => ({ default: m.ReviewPage })),
)
const ApiDocsPage = lazyWithRetry(() =>
  import('@/routes/public/ApiDocsPage').then((m) => ({ default: m.ApiDocsPage })),
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

function lazyRoute(node: React.ReactNode, label?: string) {
  return (
    <RouteErrorBoundary label={label}>
      <Suspense fallback={<PageFallback />}>{node}</Suspense>
    </RouteErrorBoundary>
  )
}

function App() {
  // Подтягиваем язык интерфейса из profiles.locale (если задан и поддерживается).
  // Без этого выбор в онбординге игнорировался — i18next читал только localStorage.
  useI18nSync()
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
      <Route path="/help" element={lazyRoute(<HelpPage />)} />
      <Route path="/accept-invite" element={lazyRoute(<AcceptInvitePage />)} />
      {/* Enable Banking redirect target — нужен access к userSession + salon list,
          поэтому за RequireAuth ниже не оборачиваем (юзер уходил/возвращался в той
          же сессии); сам компонент проверяет данные сессии. */}
      <Route path="/banking/callback" element={lazyRoute(<BankingCallbackPage />)} />

      {/* Блог Finkley — публичные, без авторизации */}
      <Route path="/media" element={lazyRoute(<MediaListPage />)} />
      <Route path="/media/:slug" element={lazyRoute(<MediaArticlePage />)} />

      {/* Документация публичного API — доступна без авторизации */}
      <Route path="/docs/api" element={lazyRoute(<ApiDocsPage />)} />

      {/* Публичная страница сбора отзыва после визита (FlySMS-flow).
          Не требует auth — только token из URL. */}
      <Route path="/review/:token" element={lazyRoute(<ReviewPage />)} />

      {/* Блокировки — публичные (юзер должен видеть страницу даже без активной сессии) */}
      <Route path="/blocked/account" element={lazyRoute(<BlockedAccountPage />)} />
      <Route
        path="/blocked/salon/:salonId"
        element={<RequireAuth>{lazyRoute(<BlockedSalonPage />)}</RequireAuth>}
      />

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
        element={<RequireAuth>{lazyRoute(<OnboardingPage />, 'Онбординг')}</RequireAuth>}
      />

      {/* Super-admin (корневой, не привязан к salon) */}
      <Route
        path="/admin"
        element={
          <RequireAuth>
            <AdminLayout />
          </RequireAuth>
        }
      >
        <Route index element={<Navigate to="overview" replace />} />
        <Route path="overview" element={lazyRoute(<AdminOverviewPage />)} />
        <Route path="salons" element={lazyRoute(<AdminSalonsPage />)} />
        <Route path="users" element={lazyRoute(<AdminUsersPage />)} />
        <Route path="media" element={lazyRoute(<AdminMediaPage />)} />
        <Route path="feedback" element={lazyRoute(<AdminFeedbackPage />)} />
        <Route path="tracking" element={lazyRoute(<AdminTrackingPage />)} />
      </Route>

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
        <Route path="notifications" element={lazyRoute(<NotificationsPage />)} />
        <Route path="visits" element={lazyRoute(<VisitsPage />)} />
        {/* /clients жил отдельной страницей в Settings → Справочники.
            После TASK-42 справочник клиентов merged в Reports → Клиенты →
            Список (полный CRUD + сегменты + RBAC). Старая страница
            оставлена как редирект, чтобы внешние ссылки и закладки
            продолжали работать. */}
        <Route
          path="clients"
          element={<Navigate to="../reports?tab=clients&client=list" replace />}
        />
        {/* Legacy: /reports?tab=clients&client=top ушёл в /list — поддерживаем
            старые закладки. Это просто заглушка на уровне ClientsAnalyticsTab:
            если в URL пришло client=top, компонент сам отрисует list (fallback
            в isClientsSubTab). Дополнительная редирект-маршрут не нужна. */}
        {/* T36 — защита роутов через permissions матрицу. RequirePermission
            проверяет can(category, 'view'); owner/admin всегда проходят. При
            запрете — redirect на /dashboard + toast. */}
        <Route
          path="expenses"
          element={
            <RequirePermission category="expenses">{lazyRoute(<ExpensesPage />)}</RequirePermission>
          }
        />
        {/* Bug (баг-трекер): мастер (staff) мог открыть справочники Мастера/
            Услуги и видеть кнопку «Добавить» / править справочные данные.
            Гейтим через settings.catalogs — owner/admin проходят всегда. */}
        <Route
          path="staff"
          element={
            <RequirePermission category="settings" sub="catalogs">
              {lazyRoute(<StaffPage />)}
            </RequirePermission>
          }
        />
        <Route
          path="services"
          element={
            <RequirePermission category="settings" sub="catalogs">
              {lazyRoute(<ServicesPage />)}
            </RequirePermission>
          }
        />
        <Route
          path="inventory"
          element={
            <RequirePermission category="inventory">
              {lazyRoute(<InventoryPage />)}
            </RequirePermission>
          }
        />
        <Route
          path="marketing"
          element={
            <RequirePermission category="marketing">
              {lazyRoute(<MarketingPage />)}
            </RequirePermission>
          }
        />
        <Route
          path="messenger"
          element={
            <RequirePermission category="messenger">
              {lazyRoute(<MessengerPage />)}
            </RequirePermission>
          }
        />
        <Route path="knowledge" element={lazyRoute(<KnowledgePage />)} />
        <Route path="payouts" element={lazyRoute(<PayoutsPage />)} />
        <Route
          path="reports"
          element={
            <RequirePermission category="reports">
              {lazyRoute(<ReportsHubPage />)}
            </RequirePermission>
          }
        />
        <Route
          path="income"
          element={
            <RequirePermission category="income">{lazyRoute(<IncomePage />)}</RequirePermission>
          }
        />
        <Route
          path="finance"
          element={
            <RequirePermission category="finance">{lazyRoute(<FinancePage />)}</RequirePermission>
          }
        />
        <Route
          path="ai"
          element={<RequirePermission category="ai">{lazyRoute(<AIPage />)}</RequirePermission>}
        />
        <Route path="settings" element={lazyRoute(<SettingsPage />)} />
        <Route path="settings/import" element={lazyRoute(<ImportPage />)} />
        {/* /settings/integrations рендерит SettingsPage (sub-tab integrations).
            IntegrationsPage остаётся доступной для тестов / legacy ссылок. */}
        <Route path="settings/integrations" element={lazyRoute(<SettingsPage />)} />
        <Route path="settings/integrations-full" element={lazyRoute(<IntegrationsPage />)} />
        <Route path="settings/team" element={lazyRoute(<TeamPage />)} />
        <Route path="settings/audit" element={lazyRoute(<AuditLogPage />)} />
        <Route path="settings/finance-catalog" element={lazyRoute(<FinanceCatalogPage />)} />
        {/* Backward-compat: старые 4 URL'а ведут на объединённую страницу с активным табом. */}
        <Route
          path="settings/expenses-catalog"
          element={<Navigate to="../settings/finance-catalog?tab=expenses" replace />}
        />
        <Route
          path="settings/income-categories"
          element={<Navigate to="../settings/finance-catalog?tab=incomes" replace />}
        />
        <Route
          path="settings/investments-catalog"
          element={<Navigate to="../settings/finance-catalog?tab=investments" replace />}
        />
        <Route
          path="settings/cash-registers"
          element={<Navigate to="../settings/finance-catalog?tab=cash" replace />}
        />
        <Route path="settings/counterparties" element={lazyRoute(<CounterpartiesCatalogPage />)} />
        <Route path="help" element={lazyRoute(<HelpPage />)} />
        <Route path="*" element={<Navigate to="dashboard" replace />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default App
