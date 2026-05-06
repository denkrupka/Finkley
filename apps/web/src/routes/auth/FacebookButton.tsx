import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { useAuth } from '@/hooks/useAuth'

/**
 * Кнопка «Войти через Facebook».
 * Включается через `supabase.auth.signInWithOAuth({ provider: 'facebook' })`.
 *
 * Setup (owner):
 * 1. developers.facebook.com → My Apps → Create App → type: Consumer
 * 2. Add Product → Facebook Login → Web
 * 3. Settings → Basic → скопировать App ID + App Secret
 * 4. Facebook Login → Settings → Valid OAuth Redirect URIs:
 *    https://<supabase-ref>.supabase.co/auth/v1/callback
 * 5. Прислать App ID и App Secret — я положу в Supabase Auth.
 *
 * До App Review логин работает только для Test users (Settings → Roles → Test Users).
 * После App Review (basic permissions email + public_profile) — открыто всем.
 */
export function FacebookButton() {
  const { t } = useTranslation()
  const { signInWithOAuth } = useAuth()
  const [loading, setLoading] = useState(false)

  async function onClick() {
    setLoading(true)
    const { error } = await signInWithOAuth('facebook')
    if (error) {
      console.error('Facebook OAuth error', error)
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
      data-testid="facebook-signin"
    >
      <FacebookIcon />
      <span>{t('auth.login.facebook_button')}</span>
    </Button>
  )
}

function FacebookIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden>
      <path
        fill="#1877F2"
        d="M24 12.073C24 5.405 18.627 0 12 0S0 5.405 0 12.073c0 6.026 4.388 11.022 10.125 11.927v-8.435H7.078v-3.492h3.047V9.413c0-3.018 1.792-4.683 4.533-4.683 1.313 0 2.686.235 2.686.235v2.97H15.83c-1.49 0-1.954.93-1.954 1.886v2.252h3.328l-.532 3.492h-2.796V24C19.612 23.095 24 18.099 24 12.073z"
      />
    </svg>
  )
}
