import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'

import { supabase } from '@/lib/supabase/client'

const BOT_USERNAME = import.meta.env.VITE_TELEGRAM_BOT_USERNAME as string | undefined
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string

declare global {
  interface Window {
    onTelegramAuth?: (user: TelegramUser) => void
  }
}

type TelegramUser = {
  id: number
  first_name: string
  last_name?: string
  username?: string
  photo_url?: string
  auth_date: number
  hash: string
}

/**
 * Telegram Login Widget — однокликовый login через Telegram-клиент юзера.
 * См. ADR-009 и docs/09_INTEGRATIONS.md.
 *
 * Поток:
 * 1. Виджет подгружает скрипт `telegram.org/js/telegram-widget.js`
 * 2. Юзер кликает на кнопку, авторизуется в Telegram
 * 3. Telegram вызывает `window.onTelegramAuth(user)` с подписанными данными
 * 4. Мы шлём эти данные в edge function `telegram-auth`, она валидирует HMAC
 *    и возвращает пару access/refresh tokens
 * 5. `supabase.auth.setSession(...)` устанавливает сессию на клиенте
 *
 * Если `VITE_TELEGRAM_BOT_USERNAME` не задана — виджет вообще не рендерим
 * (фича выключена). Это нормальный путь до того, как создан бот в @BotFather.
 */
export function TelegramLoginWidget() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const containerRef = useRef<HTMLDivElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  useEffect(() => {
    if (!BOT_USERNAME || !containerRef.current) return

    window.onTelegramAuth = async (tgUser) => {
      setError(null)
      setPending(true)
      try {
        const res = await fetch(`${SUPABASE_URL}/functions/v1/telegram-auth`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(tgUser),
        })
        if (!res.ok) {
          const body = await res.text()
          throw new Error(body || `HTTP ${res.status}`)
        }
        const { access_token, refresh_token } = (await res.json()) as {
          access_token: string
          refresh_token: string
        }
        const { error: setErr } = await supabase.auth.setSession({
          access_token,
          refresh_token,
        })
        if (setErr) throw setErr
        navigate('/', { replace: true })
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        console.error('Telegram auth failed', msg)
        setError(msg)
      } finally {
        setPending(false)
      }
    }

    const script = document.createElement('script')
    script.src = 'https://telegram.org/js/telegram-widget.js?22'
    script.async = true
    script.setAttribute('data-telegram-login', BOT_USERNAME)
    script.setAttribute('data-size', 'medium')
    script.setAttribute('data-radius', '6')
    script.setAttribute('data-userpic', 'false')
    script.setAttribute('data-onauth', 'onTelegramAuth(user)')
    script.setAttribute('data-request-access', 'write')
    containerRef.current.appendChild(script)

    return () => {
      delete window.onTelegramAuth
    }
  }, [navigate])

  if (!BOT_USERNAME) return null

  return (
    <div className="flex flex-col items-center gap-2">
      <div ref={containerRef} aria-label={t('auth.login.telegram_button')} />
      {pending ? <p className="text-muted-foreground text-xs">{t('common.loading')}</p> : null}
      {error ? (
        <p className="text-destructive text-xs font-medium" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}
