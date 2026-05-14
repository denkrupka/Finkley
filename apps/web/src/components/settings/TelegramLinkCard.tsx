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
  /**
   * Состояние загрузки виджета — нужно для fallback:
   *   - 'loading'  — скрипт всё ещё грузится
   *   - 'ready'    — виджет отрисовал iframe (DOM contains iframe)
   *   - 'blocked'  — через 4 сек iframe не появился (AdBlock, бот без
   *                  /setdomain в BotFather, недоступен telegram.org/js)
   */
  const [widgetState, setWidgetState] = useState<'loading' | 'ready' | 'blocked'>('loading')

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
    setWidgetState('loading')
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

    // Проверяем через 4 сек: появился ли iframe? Если нет — показываем
    // fallback с диагностикой (AdBlock / BotFather /setdomain не задан).
    const id = window.setTimeout(() => {
      const iframe = widgetRef.current?.querySelector('iframe')
      setWidgetState(iframe ? 'ready' : 'blocked')
    }, 4000)

    return () => {
      delete window.onTelegramLinkAuth
      window.clearTimeout(id)
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

          {/* Контейнер для скрипта Telegram Login Widget. Если за 4 сек он
              не вставит iframe — показываем fallback с прямой ссылкой на бота. */}
          <div ref={widgetRef} aria-label={t('settings.telegram.widget_label')} />

          {widgetState === 'loading' ? (
            <p className="text-muted-foreground text-xs">{t('common.loading')}</p>
          ) : null}

          {widgetState === 'blocked' ? (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs leading-relaxed">
              <p className="font-semibold text-amber-900">
                {t('settings.telegram.widget_blocked_title')}
              </p>
              <p className="mt-1 text-amber-800">{t('settings.telegram.widget_blocked_body')}</p>
              <a
                href={`https://t.me/${BOT_USERNAME}?start=link`}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 inline-flex h-9 items-center gap-1.5 rounded-md bg-[#229ED9] px-3 font-semibold text-white hover:bg-[#1f8fc4]"
              >
                <svg viewBox="0 0 24 24" fill="currentColor" className="size-4">
                  <path d="M9.78 18.65l.28-4.23 7.68-6.92c.34-.31-.07-.46-.52-.19L7.74 13.3 3.64 12c-.88-.25-.89-.86.2-1.3l15.97-6.16c.73-.33 1.43.18 1.15 1.3l-2.72 12.81c-.19.91-.74 1.13-1.5.71L12.6 16.3l-1.99 1.93c-.23.23-.42.42-.83.42z" />
                </svg>
                {t('settings.telegram.open_bot')}
              </a>
            </div>
          ) : null}

          {linking ? (
            <p className="text-muted-foreground text-xs">{t('settings.telegram.linking')}</p>
          ) : null}
        </div>
      )}
    </section>
  )
}
