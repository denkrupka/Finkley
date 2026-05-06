import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'

import { useAuth } from '@/hooks/useAuth'

/**
 * Гард для приватных роутов.
 * - Пока загружается сессия — рендерим простую заглушку (skeleton-вид).
 * - Если юзер не залогинен — редирект на /login с сохранением `from` для постлогин-возврата.
 * - Если залогинен — рендерим children.
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth()
  const location = useLocation()

  if (loading) {
    return (
      <div className="bg-background flex min-h-screen items-center justify-center">
        <div className="bg-muted size-10 animate-pulse rounded-md" aria-hidden />
      </div>
    )
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location }} />
  }

  return <>{children}</>
}

/**
 * Обратный гард для гостевых страниц (логин/регистрация/сброс пароля).
 * Если юзер УЖЕ залогинен — редирект на главную (или на сохранённый `from`).
 */
export function RequireGuest({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth()
  const location = useLocation()

  if (loading) {
    return (
      <div className="bg-background flex min-h-screen items-center justify-center">
        <div className="bg-muted size-10 animate-pulse rounded-md" aria-hidden />
      </div>
    )
  }

  if (user) {
    const fromState = (location.state as { from?: { pathname?: string } } | null)?.from
    const target = fromState?.pathname ?? '/'
    return <Navigate to={target} replace />
  }

  return <>{children}</>
}
