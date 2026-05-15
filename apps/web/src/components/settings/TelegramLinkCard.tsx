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
    // Image #58/59: убран авто-детект "blocked"-состояния. Telegram-widget.js
    // вставляет iframe асинхронно, часто после 6-секундного таймаута, что давало
    // ложное срабатывание "виджет заблокирован" хотя кнопка показывалась.
    // Теперь fallback-ссылка "Открыть бота" видна всегда — пользователь выбирает.
    const host = widgetRef.current
    host.innerHTML = ''
    const script = document.createElement('script')
    script.src = 'https://telegram.org/js/telegram-widget.js?22'
    script.async = true
    script.setAttribute('data-telegram-login', BOT_USERNAME)
    script.setAttribute('data-size', 'large')
    script.setAttribute('data-radius', '8')
    script.setAttribute('data-userpic', 'false')
    script.setAttribute('data-onauth', 'onTelegramLinkAuth(user)')
    script.setAttribute('data-request-access', 'write')
    host.appendChild(script)

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
          {/* Статус: не привязано — раньше не показывали, юзер не понимал
              текущее состояние и думал что что-то сломано. */}
          <div className="flex items-center gap-2">
            <span className="inline-flex h-6 items-center gap-1.5 rounded-full bg-amber-100 px-2.5 text-[11px] font-semibold text-amber-900">
              <span className="size-1.5 rounded-full bg-amber-500" />
              {t('settings.telegram.status_not_linked')}
            </span>
          </div>
          <div className="flex items-start gap-2">
            <Link2 className="text-muted-foreground mt-0.5 size-4" strokeWidth={2} />
            <p className="text-muted-foreground text-xs leading-relaxed">
              {t('settings.telegram.why_link')}
            </p>
          </div>

          {/* Контейнер для скрипта Telegram Login Widget. */}
          <div ref={widgetRef} aria-label={t('settings.telegram.widget_label')} />

          {/* Альтернативная ссылка «Открыть бота» — показываем всегда (даже
              когда виджет работает) как удобный fallback. Раньше тут был
              предупредительный AdBlock-warning, но он смущал юзеров когда
              виджет на самом деле работал. */}
          <div className="border-border/40 flex flex-wrap items-center gap-2 border-t pt-3 text-xs">
            <span className="text-muted-foreground">{t('settings.telegram.or')}</span>
            <a
              href={`https://t.me/${BOT_USERNAME}?start=link`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[#229ED9] px-3 font-semibold text-[#229ED9] hover:bg-[#229ED9]/10"
            >
              <svg viewBox="0 0 24 24" fill="currentColor" className="size-3.5">
                <path d="M9.78 18.65l.28-4.23 7.68-6.92c.34-.31-.07-.46-.52-.19L7.74 13.3 3.64 12c-.88-.25-.89-.86.2-1.3l15.97-6.16c.73-.33 1.43.18 1.15 1.3l-2.72 12.81c-.19.91-.74 1.13-1.5.71L12.6 16.3l-1.99 1.93c-.23.23-.42.42-.83.42z" />
              </svg>
              {t('settings.telegram.open_bot')}
            </a>
          </div>

          {linking ? (
            <p className="text-muted-foreground text-xs">{t('settings.telegram.linking')}</p>
          ) : null}
        </div>
      )}
    </section>
  )
}
