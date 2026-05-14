import { CheckCircle2, Link2, Send } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { useMyProfile, useUnlinkTelegram } from '@/hooks/useMyProfile'
import { supabase } from '@/lib/supabase/client'

const BOT_USERNAME = import.meta.env.VITE_TELEGRAM_BOT_USERNAME as string | undefined
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string

declare global {
  interface Window {
    onTelegramLinkAuth?: (user: TelegramUser) => void
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
 * Карточка «Telegram» в Settings → Profile.
 *
 * - Если у юзера telegram_id уже сохранён в profiles → показываем «привязано:
 *   @username» + кнопку «Отвязать»
 * - Если нет → рендерим официальный виджет Telegram Login Widget, callback
 *   шлёт payload в edge function telegram-link (HMAC-валидация + UPDATE
 *   profiles.telegram_id для текущего юзера)
 *
 * Привязка нужна чтобы клиент мог писать баги в @finklay_dev_bot из личного
 * чата — gate проверяет profiles.telegram_id (см. telegram-bug-collector).
 */
export function TelegramLinkCard() {
  const { t } = useTranslation()
  const { data: profile, refetch } = useMyProfile()
  const unlink = useUnlinkTelegram()
  const widgetRef = useRef<HTMLDivElement>(null)
  const [linking, setLinking] = useState(false)

  const isLinked = !!profile?.telegram_id

  useEffect(() => {
    if (isLinked || !BOT_USERNAME || !widgetRef.current) return

    window.onTelegramLinkAuth = async (tgUser) => {
      setLinking(true)
      try {
        const { data: session } = await supabase.auth.getSession()
        const token = session.session?.access_token
        if (!token) throw new Error('not_authenticated')
        const res = await fetch(`${SUPABASE_URL}/functions/v1/telegram-link`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(tgUser),
        })
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        if (!res.ok) {
          throw new Error(
            body.error === 'telegram_already_linked_to_other_account'
              ? t('settings.telegram.error_already_linked')
              : body.error || `HTTP ${res.status}`,
          )
        }
        toast.success(t('settings.telegram.toast_linked'))
        await refetch()
      } catch (e) {
        toast.error(e instanceof Error ? e.message : String(e))
      } finally {
        setLinking(false)
      }
    }

    // Рендерим официальный виджет от Telegram. Скрипт сам вставляет <iframe>.
    widgetRef.current.innerHTML = ''
    const script = document.createElement('script')
    script.src = 'https://telegram.org/js/telegram-widget.js?22'
    script.async = true
    script.setAttribute('data-telegram-login', BOT_USERNAME)
    script.setAttribute('data-size', 'large')
    script.setAttribute('data-radius', '8')
    script.setAttribute('data-userpic', 'false')
    script.setAttribute('data-onauth', 'onTelegramLinkAuth(user)')
    script.setAttribute('data-request-access', 'write')
    widgetRef.current.appendChild(script)

    return () => {
      delete window.onTelegramLinkAuth
    }
  }, [isLinked, refetch, t])

  return (
    <section className="border-border bg-card shadow-finsm mb-6 rounded-lg border p-5 sm:p-6">
      <div className="mb-4 flex items-center gap-2">
        <Send className="text-brand-navy size-4" strokeWidth={2} />
        <h2 className="text-brand-navy text-base font-bold tracking-tight">
          {t('settings.telegram.title')}
        </h2>
      </div>
      <p className="text-muted-foreground mb-4 text-sm">{t('settings.telegram.subtitle')}</p>

      {isLinked ? (
        <div className="border-border flex flex-col gap-3 rounded-md border bg-emerald-50/50 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="size-5 text-emerald-600" strokeWidth={2} />
            <div>
              <p className="text-foreground text-sm font-semibold">
                {t('settings.telegram.linked_title')}
              </p>
              <p className="text-muted-foreground text-xs">
                {profile?.telegram_username
                  ? `@${profile.telegram_username}`
                  : t('settings.telegram.linked_no_username', { id: profile?.telegram_id })}
              </p>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            disabled={unlink.isPending}
            onClick={() => {
              if (!confirm(t('settings.telegram.confirm_unlink'))) return
              unlink.mutate(undefined, {
                onSuccess: () => toast.success(t('settings.telegram.toast_unlinked')),
                onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
              })
            }}
          >
            {t('settings.telegram.unlink')}
          </Button>
        </div>
      ) : !BOT_USERNAME ? (
        <p className="text-muted-foreground text-xs">{t('settings.telegram.bot_not_configured')}</p>
      ) : (
        <div className="border-border flex flex-col gap-3 rounded-md border p-4">
          <div className="flex items-start gap-2">
            <Link2 className="text-muted-foreground mt-0.5 size-4" strokeWidth={2} />
            <p className="text-muted-foreground text-xs leading-relaxed">
              {t('settings.telegram.why_link')}
            </p>
          </div>
          <div ref={widgetRef} aria-label={t('settings.telegram.widget_label')} />
          {linking ? <p className="text-muted-foreground text-xs">{t('common.loading')}</p> : null}
        </div>
      )}
    </section>
  )
}
