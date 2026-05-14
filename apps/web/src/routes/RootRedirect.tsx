/* eslint-disable react-refresh/only-export-components -- helper rememberLastSalon co-located with RootRedirect */
import { Navigate } from 'react-router-dom'

import { useIsAppAdmin } from '@/hooks/useMediaPosts'
import { useMySalons } from '@/hooks/useSalons'

const LAST_SALON_KEY = 'finkley:last-salon-id'

/**
 * Корневой редирект для авторизованного юзера:
 * - app_admin (без салона) или с явным prefer-admin → /admin/overview
 * - нет ни одного салона → /onboarding
 * - есть салоны → /{salonId}/dashboard
 *   (предпочитаем последний выбранный из localStorage, иначе первый)
 *
 * Если юзер — app_admin и одновременно владелец салона, по умолчанию
 * редиректим в админку: владелец салона + админ платформы = админ-таргет.
 * В админке есть кнопка «В кабинет салона» для переключения обратно.
 */
export function RootRedirect() {
  const { data: salons, isLoading, error } = useMySalons()
  const { data: isAdmin, isLoading: adminLoading } = useIsAppAdmin()

  if (isLoading || adminLoading) {
    return (
      <div className="bg-background flex min-h-screen items-center justify-center">
        <div className="bg-muted size-10 animate-pulse rounded-md" aria-hidden />
      </div>
    )
  }

  if (error) {
    return (
      <div className="bg-background flex min-h-screen items-center justify-center p-6 text-center">
        <p className="text-destructive">{error.message}</p>
      </div>
    )
  }

  if (isAdmin) {
    return <Navigate to="/admin/overview" replace />
  }

  if (!salons || salons.length === 0) {
    return <Navigate to="/onboarding" replace />
  }

  const lastId = typeof window !== 'undefined' ? window.localStorage.getItem(LAST_SALON_KEY) : null
  const target = salons.find((s) => s.id === lastId) ?? salons[0]
  return <Navigate to={`/${target!.id}/dashboard`} replace />
}

export function rememberLastSalon(salonId: string) {
  try {
    window.localStorage.setItem(LAST_SALON_KEY, salonId)
  } catch {
    // localStorage может быть недоступен (private mode); тихо игнорируем
  }
}
