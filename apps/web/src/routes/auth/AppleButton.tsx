import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useAuth } from '@/hooks/useAuth'
import { cn } from '@/lib/utils/cn'

/**
 * Кнопка «Sign in with Apple» по Apple Human Interface Guidelines:
 * чёрный фон, белый текст, фирменное Apple-яблоко слева, скруглённые углы.
 * Текст не локализуется по HIG — Apple жёстко требует «Sign in with Apple»
 * (на любом языке, в т.ч. RU). На этом и стоит, для соответствия гайду.
 *
 * Setup (owner):
 * 1. Apple Developer Program — $99/год (developer.apple.com/programs)
 * 2. Certificates, Identifiers & Profiles → Identifiers:
 *    - App ID для finkley.app (включить «Sign in with Apple» capability)
 *    - Service ID (например, `app.finkley.signin`) — используется как client_id
 *      в Supabase. В Service ID:
 *        - Domain: finkley.app
 *        - Return URL: https://<supabase-ref>.supabase.co/auth/v1/callback
 * 3. Keys → создать новый Key с Sign in with Apple → скачать .p8 файл (один раз!)
 * 4. Прислать мне:
 *    - Service ID (client_id)
 *    - Team ID (10-символьный из верхнего правого угла Apple Dev)
 *    - Key ID (10-символьный, видно при создании ключа)
 *    - Содержимое .p8 файла (несколько строк PEM)
 *    Я соберу всё в Supabase Auth (Apple-провайдер требует подписанный JWT
 *    как client_secret — Supabase делает это server-side из этих 4 полей).
 *
 * NOTE: Apple возвращает email/имя ТОЛЬКО при первой авторизации.
 * Supabase сохраняет это в auth.users автоматически. Если юзер удалит
 * аккаунт и заново — повторно придёт «hidden email» (random@privaterelay.appleid.com).
 */
export function AppleButton() {
  const { t } = useTranslation()
  const { signInWithOAuth } = useAuth()
  const [loading, setLoading] = useState(false)

  async function onClick() {
    setLoading(true)
    const { error } = await signInWithOAuth('apple')
    if (error) {
      console.error('Apple OAuth error', error)
      setLoading(false)
    }
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={loading}
      className={cn(
        'h-13 inline-flex w-full items-center justify-center gap-2 rounded-md',
        'bg-black text-white',
        'font-display text-sm font-semibold',
        'transition-opacity hover:opacity-90',
        'disabled:pointer-events-none disabled:opacity-50',
        'focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2',
      )}
      aria-label={t('auth.login.apple_button')}
      data-testid="apple-signin"
    >
      <AppleIcon />
      <span>{t('auth.login.apple_button')}</span>
    </button>
  )
}

function AppleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-[18px]" aria-hidden>
      <path
        fill="currentColor"
        d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z"
      />
    </svg>
  )
}
