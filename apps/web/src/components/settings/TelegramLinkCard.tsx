import { CheckCircle2, Link2, Loader2, Send } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { useMyProfile, useUnlinkTelegram } from '@/hooks/useMyProfile'
import { supabase } from '@/lib/supabase/client'

/**
 * @finkley_tg_bot — главный клиентский бот Finkley. Через него идёт:
 *   - Привязка Telegram-аккаунта (deep-link с одноразовым кодом, ниже)
 *   - Доставка дайджестов (ежедневных/еженедельных)
 *   - Маркетинговые рассылки
 * После привязки этого бота — клиент также сможет писать о багах в
 * @finklay_dev_bot (тот пускает только привязанных через profiles.telegram_id).
 */
const LINK_BOT_USERNAME = 'finkley_tg_bot'

/**
 * Карточка «Telegram» в Settings → Профиль.
 *
 * Привязка через deep-link с одноразовым кодом:
 *   1. Frontend дёргает RPC create_telegram_link_code() → получает 8-символьный
 *      код (TTL 10 мин).
 *   2. Открывает t.me/finkley_tg_bot?start=link_<код> в новой вкладке.
 *   3. Бот через webhook (см. supabase/functions/telegram-user-bot) видит код,
 *      привязывает profiles.telegram_id и отвечает «✅ Telegram привязан».
 *   4. SPA поллит профиль 30 сек — как только telegram_id появился, показывает
 *      success-toast.
 *
 * Старый Telegram Login Widget удалён — он блокировался AdBlock у большинства
 * пользователей.
 */
export function TelegramLinkCard() {
  const { t } = useTranslation()
  const { data: profile, refetch } = useMyProfile()
  const unlink = useUnlinkTelegram()
  const [generatingCode, setGeneratingCode] = useState(false)

  const isLinked = !!profile?.telegram_id

  async function openBotWithLinkCode() {
    setGeneratingCode(true)
    try {
      const { data, error } = await supabase.rpc('create_telegram_link_code')
      if (error) throw error
      const code = data as string
      if (!code) throw new Error('empty_code')
      window.open(
        `https://t.me/${LINK_BOT_USERNAME}?start=link_${code}`,
        '_blank',
        'noopener,noreferrer',
      )
      toast.info(t('settings.telegram.code_generated_hint'))
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
        </div>
      )}
    </section>
  )
}
