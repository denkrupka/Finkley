import { CheckCircle2, Link2, Loader2, Send } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { useMyProfile, useUnlinkTelegram } from '@/hooks/useMyProfile'
import { supabase } from '@/lib/supabase/client'

const BOT_USERNAME = import.meta.env.VITE_TELEGRAM_BOT_USERNAME as string | undefined
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string
/**
 * Бот-багрепортер. Именно он имеет webhook telegram-bug-collector, поэтому
 * deep-link привязка идёт через него (а не через @finkley_tg_bot, который —
 * чисто Login Widget без webhook). См. VITE_BUG_BOT_USERNAME если будет
 * нужна параметризация, пока хардкодим.
 */
const BUG_BOT_USERNAME = 'finklay_dev_bot'

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
 * Два пути привязки:
 *   1. **Deep-link через бота** (основной, надёжный). Frontend дёргает RPC
 *      create_telegram_link_code() → получает 8-символьный код → открывает
 *      t.me/<bug_bot>?start=link_<код>. Бот через webhook видит код, привязывает
 *      profiles.telegram_id и отвечает «✅ Telegram привязан». Этот путь
 *      обходит блокировку Telegram Login Widget (AdBlock / /setdomain).
 *   2. **Telegram Login Widget** (fallback). Скрипт telegram.org/js рендерит
 *      кнопку, callback шлёт payload в telegram-link с HMAC-валидацией.
 *      Часто блокируется AdBlock — поэтому это уже не primary.
 *
 * Привязка нужна чтобы юзер мог писать о багах в @finklay_dev_bot из личного
 * чата — gate проверяет profiles.telegram_id (см. telegram-bug-collector).
 */
export function TelegramLinkCard() {
  const { t } = useTranslation()
  const { data: profile, refetch } = useMyProfile()
  const unlink = useUnlinkTelegram()
  const widgetRef = useRef<HTMLDivElement>(null)
  const [linking, setLinking] = useState(false)
  const [generatingCode, setGeneratingCode] = useState(false)

  const isLinked = !!profile?.telegram_id

  /**
   * Генерирует одноразовый код привязки и открывает Telegram-бот с этим кодом.
   * После клика юзер попадает в чат с ботом и видит preset кнопку «Start» —
   * по нажатию бот получает /start link_<код> и привязывает аккаунт автоматом.
   * Возвращаемся в SPA — спустя несколько секунд жмём «Проверить статус» или
   * сам refetch покажет привязку.
   */
  async function openBotWithLinkCode() {
    setGeneratingCode(true)
    try {
      const { data, error } = await supabase.rpc('create_telegram_link_code')
      if (error) throw error
      const code = data as string
      if (!code) throw new Error('empty_code')
      // Открываем в новой вкладке. На мобильном откроется приложение Telegram.
      window.open(
        `https://t.me/${BUG_BOT_USERNAME}?start=link_${code}`,
        '_blank',
        'noopener,noreferrer',
      )
      toast.info(t('settings.telegram.code_generated_hint'))
      // Поллим статус привязки 30 сек — типичное время на подтверждение в боте.
      pollLinkStatus()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setGeneratingCode(false)
    }
  }

  /** Поллим refetch профиля 30 сек, выходим как только telegram_id появился. */
  function pollLinkStatus() {
    let elapsed = 0
    const id = window.setInterval(async () => {
      elapsed += 2
      const { data } = await refetch()
      if (data?.telegram_id) {
        window.clearInterval(id)
        toast.success(t('settings.telegram.toast_linked'))
        return
      }
      if (elapsed >= 30) window.clearInterval(id)
    }, 2000)
  }

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

    // Рендерим официальный виджет от Telegram. Это fallback-путь для тех,
    // кто использует @finkley_tg_bot и у кого /setdomain настроен.
    const host = widgetRef.current
    host.innerHTML = ''
    const script = document.createElement('script')
    script.src = 'https://telegram.org/js/telegram-widget.js?22'
    script.async = true
    script.setAttribute('data-telegram-login', BOT_USERNAME)
    script.setAttribute('data-size', 'medium')
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
      ) : (
        <div className="border-border flex flex-col gap-3 rounded-md border p-4">
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

          {/* PRIMARY способ: deep-link через бот с одноразовым кодом.
              Работает даже если AdBlock блокирует telegram.org/js. */}
          <Button
            type="button"
            variant="primary"
            size="md"
            onClick={openBotWithLinkCode}
            disabled={generatingCode}
            className="!bg-[#229ED9] hover:!bg-[#1f8fc4]"
          >
            {generatingCode ? (
              <Loader2 className="size-4 animate-spin" strokeWidth={2} />
            ) : (
              <svg viewBox="0 0 24 24" fill="currentColor" className="size-4">
                <path d="M9.78 18.65l.28-4.23 7.68-6.92c.34-.31-.07-.46-.52-.19L7.74 13.3 3.64 12c-.88-.25-.89-.86.2-1.3l15.97-6.16c.73-.33 1.43.18 1.15 1.3l-2.72 12.81c-.19.91-.74 1.13-1.5.71L12.6 16.3l-1.99 1.93c-.23.23-.42.42-.83.42z" />
              </svg>
            )}
            {t('settings.telegram.link_via_bot')}
          </Button>
          <p className="text-muted-foreground text-[11px] leading-relaxed">
            {t('settings.telegram.link_via_bot_hint')}
          </p>

          {/* FALLBACK: Telegram Login Widget. Если бот @finkley_tg_bot
              корректно настроен (/setdomain) и AdBlock не блокирует — здесь
              появится официальная кнопка «Войти через Telegram». */}
          {BOT_USERNAME ? (
            <div className="border-border/40 flex flex-col gap-2 border-t pt-3">
              <p className="text-muted-foreground text-[11px]">
                {t('settings.telegram.or_widget')}
              </p>
              <div ref={widgetRef} aria-label={t('settings.telegram.widget_label')} />
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
