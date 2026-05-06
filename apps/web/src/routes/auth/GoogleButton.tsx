import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { useAuth } from '@/hooks/useAuth'

/**
 * Кнопка «Войти через Google».
 * Использует `supabase.auth.signInWithOAuth({ provider: 'google' })`.
 * Redirect URI настраивается в:
 * 1. Google Cloud Console (`https://<staging|prod>.supabase.co/auth/v1/callback`)
 * 2. Supabase Dashboard → Auth → URL configuration → Site URL = твой кастомный домен.
 *
 * При первом подключении к проекту Google provider должен быть включён в
 * Supabase Dashboard → Authentication → Providers → Google.
 */
export function GoogleButton() {
  const { t } = useTranslation()
  const { signInWithOAuth } = useAuth()
  const [loading, setLoading] = useState(false)

  async function onClick() {
    setLoading(true)
    const { error } = await signInWithOAuth('google')
    if (error) {
      // signInWithOAuth обычно делает redirect, в случае ошибки показываем в console.
      console.error('Google OAuth error', error)
      setLoading(false)
    }
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="lg"
      onClick={onClick}
      disabled={loading}
      data-testid="google-signin"
    >
      <GoogleIcon />
      <span>{t('auth.login.google_button')}</span>
    </Button>
  )
}

function GoogleIcon() {
  return (
    <svg viewBox="0 0 18 18" className="size-4" aria-hidden>
      <path
        d="M16.51 8.18c0-.6-.05-1.18-.14-1.74H9v3.3h4.21a3.6 3.6 0 0 1-1.56 2.36v1.96h2.52a7.6 7.6 0 0 0 2.34-5.88z"
        fill="#4285F4"
      />
      <path
        d="M9 17a7.4 7.4 0 0 0 5.17-1.9l-2.52-1.96a4.7 4.7 0 0 1-2.65.74A4.66 4.66 0 0 1 4.6 10.7H1.99v2.02A7.7 7.7 0 0 0 9 17z"
        fill="#34A853"
      />
      <path
        d="M4.6 10.7a4.7 4.7 0 0 1 0-3.4V5.28H1.99a7.7 7.7 0 0 0 0 7.44l2.61-2.02z"
        fill="#FBBC05"
      />
      <path
        d="M9 4.78a4.2 4.2 0 0 1 2.97 1.16l2.22-2.22A7.4 7.4 0 0 0 9 1a7.7 7.7 0 0 0-7.01 4.28l2.61 2.02A4.66 4.66 0 0 1 9 4.78z"
        fill="#EA4335"
      />
    </svg>
  )
}
