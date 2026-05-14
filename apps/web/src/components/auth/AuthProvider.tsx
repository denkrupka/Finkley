import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'

import { supabase } from '@/lib/supabase/client'
import { AuthContext, type AuthContextValue } from './AuthContext'

/**
 * Строит абсолютный URL внутри SPA с учётом base-path (`/app/` в проде, `/` в dev).
 * Используется для всех redirectTo / emailRedirectTo — они обязаны попадать
 * в SPA-роуты, не в landing-роуты.
 */
function absoluteAppUrl(path: string): string {
  const base = import.meta.env.BASE_URL || '/' // '/app/' в проде, '/' локально
  const cleanPath = path.startsWith('/') ? path.slice(1) : path
  return `${window.location.origin}${base}${cleanPath}`
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let mounted = true

    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return
      setSession(data.session)
      setLoading(false)
    })

    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession)
    })

    return () => {
      mounted = false
      sub.subscription.unsubscribe()
    }
  }, [])

  /**
   * Периодически проверяем что текущая сессия валидна на стороне сервера.
   * Если супер-админ забанил юзера в админке — `auth.getUser()` начнёт
   * возвращать ошибку «User is banned». Мы поймаем её и редирект на
   * /blocked/account. Проверка каждые 60 секунд — компромисс между
   * скоростью реакции и нагрузкой на Supabase Auth.
   */
  useEffect(() => {
    if (!session?.access_token) return
    let cancelled = false

    async function check() {
      const { data, error } = await supabase.auth.getUser()
      if (cancelled) return
      if (error) {
        if (/banned|disabled/i.test(error.message)) {
          await supabase.auth.signOut()
          if (window.location.pathname !== '/blocked/account') {
            window.location.href = '/blocked/account'
          }
        }
        return
      }
      // Дополнительная страховка: если admin-API вернул banned_until — тоже
      // редиректим. На клиентском getUser это поле обычно null, но проверяем.
      const banned = (data.user as unknown as { banned_until?: string })?.banned_until
      if (banned && new Date(banned).getTime() > Date.now()) {
        await supabase.auth.signOut()
        if (window.location.pathname !== '/blocked/account') {
          window.location.href = '/blocked/account'
        }
      }
    }

    check()
    const id = window.setInterval(check, 60_000)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [session?.access_token])

  const value = useMemo<AuthContextValue>(
    () => ({
      user: session?.user ?? null,
      session,
      loading,

      async signInWithPassword(email, password) {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        return { error }
      },

      async signUpWithPassword(email, password, options) {
        const redirectTo = absoluteAppUrl('auth/callback')
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: redirectTo,
            data: options?.fullName ? { full_name: options.fullName } : undefined,
          },
        })
        // Если у юзера НЕ создалась session — нужно подтверждение email.
        // Supabase делает это автоматически если в Auth Settings включена email confirmation.
        const needsEmailConfirmation = !data.session
        return { error, needsEmailConfirmation }
      },

      async signInWithOAuth(provider) {
        const redirectTo = absoluteAppUrl('auth/callback')
        const { error } = await supabase.auth.signInWithOAuth({
          provider,
          options: { redirectTo },
        })
        return { error }
      },

      async resetPasswordForEmail(email) {
        const redirectTo = absoluteAppUrl('reset-password')
        const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo })
        return { error }
      },

      async updatePassword(newPassword) {
        const { error } = await supabase.auth.updateUser({ password: newPassword })
        return { error }
      },

      async signOut() {
        await supabase.auth.signOut()
        // Глобальный редирект на /login делает RequireAuth/AuthGate,
        // здесь не делаем — оставляем компонентам решать UX.
      },
    }),
    [session, loading],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
