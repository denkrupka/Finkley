import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'

import { useAuth } from '@/hooks/useAuth'
import { AuthLayout } from './AuthLayout'

/**
 * Финальная точка для всех auth-флоу:
 * - email confirmation после signup
 * - OAuth callback (Google)
 * - magic link
 *
 * Supabase JS клиент с `detectSessionInUrl: true` (см. lib/supabase/client.ts)
 * сам забирает токены из URL fragment/query и устанавливает сессию.
 * Здесь мы просто ждём, пока сессия загрузится, и роутим юзера дальше.
 */
export function AuthCallbackPage() {
  const { t } = useTranslation()
  const { user, loading } = useAuth()
  const navigate = useNavigate()

  useEffect(() => {
    if (loading) return
    if (user) {
      // Куда дальше? В этой стадии — на «/» (router сам определит онбординг vs дашборд).
      // Логика выбора салона/онбординга — в RootRedirect (см. router.tsx).
      navigate('/', { replace: true })
    } else {
      navigate('/login', { replace: true })
    }
  }, [user, loading, navigate])

  return (
    <AuthLayout title={t('auth.callback.title')} subtitle={t('auth.callback.subtitle')}>
      <div className="flex justify-center py-4">
        <div className="bg-muted size-10 animate-pulse rounded-md" aria-hidden />
      </div>
    </AuthLayout>
  )
}
