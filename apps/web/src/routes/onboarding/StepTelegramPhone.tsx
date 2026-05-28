import { Bell, CheckCircle2, Loader2, Phone } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { useMyProfile } from '@/hooks/useMyProfile'
import { supabase } from '@/lib/supabase/client'

type Props = {
  value: {
    phone: string
    /** Подключить Telegram-бота? Если true — после submit покажем deep-link
     *  на t.me/finkley_tg_bot?start=<token>. */
    want_telegram: boolean
  }
  onChange: (v: Partial<Props['value']>) => void
}

const TG_BOT_USERNAME = 'finkley_tg_bot'

/**
 * T97 — последний интеграционный шаг: Telegram бот + телефон.
 *
 * Phone — для SMS-уведомлений (не критично, opt-in). Cохраняется в
 * profiles.phone.
 *
 * Telegram — чекбокс «хочу получать инсайты в TG». После submit'a
 * покажем кнопку «Открыть бота» — юзер кликнет /start, бот запишет
 * telegram_id в profiles.
 */
export function StepTelegramPhone({ value, onChange }: Props) {
  const { t } = useTranslation()
  const { data: profile, refetch } = useMyProfile()
  const [busy, setBusy] = useState(false)
  const [polling, setPolling] = useState(false)

  const isLinked = !!profile?.telegram_id

  // T124 — мгновенное подключение Telegram прямо на шаге онбординга.
  // Если профиль уже привязан — синхронизируем want_telegram = true.
  useEffect(() => {
    if (isLinked && !value.want_telegram) onChange({ want_telegram: true })
  }, [isLinked, value.want_telegram, onChange])

  async function linkTelegram() {
    setBusy(true)
    try {
      const { data, error } = await supabase.rpc('create_telegram_link_code')
      if (error) throw error
      const code = data as string
      if (!code) throw new Error('empty_code')
      window.open(
        `https://t.me/${TG_BOT_USERNAME}?start=link_${code}`,
        '_blank',
        'noopener,noreferrer',
      )
      toast.info(
        t('onboarding.tg_phone.code_hint', {
          defaultValue: 'Жми «Start» в Telegram — статус обновится здесь автоматически',
        }),
      )
      pollLinkStatus()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  function pollLinkStatus() {
    setPolling(true)
    let elapsed = 0
    const id = window.setInterval(async () => {
      elapsed += 2
      const { data } = await refetch()
      if (data?.telegram_id) {
        window.clearInterval(id)
        setPolling(false)
        toast.success(
          t('onboarding.tg_phone.toast_linked', {
            defaultValue: 'Telegram привязан! Утренний разбор уже в пути.',
          }),
        )
        onChange({ want_telegram: true })
        return
      }
      if (elapsed >= 120) {
        // T136 — 60s → 120s. Часто юзер тыкает Start не сразу.
        window.clearInterval(id)
        setPolling(false)
        toast.warning(
          t('onboarding.tg_phone.poll_timeout', {
            defaultValue:
              'Не получилось подтвердить. Жми «Подключить» ещё раз и дойди до Start в Telegram.',
          }),
        )
      }
    }, 2000)
  }

  return (
    <div className="space-y-4">
      <h1 className="text-brand-navy text-2xl font-bold tracking-tight">
        <Bell className="text-brand-teal-deep mr-2 inline-block size-6" strokeWidth={2} />
        {t('onboarding.tg_phone.title', { defaultValue: 'Как с тобой связываться?' })}
      </h1>

      <Field
        id="onb-phone"
        label={t('onboarding.tg_phone.phone_label', {
          defaultValue: 'Номер телефона (для SMS — по желанию)',
        })}
      >
        <div className="relative">
          <Phone
            className="text-muted-foreground pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2"
            strokeWidth={1.8}
          />
          <Input
            id="onb-phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            value={value.phone}
            onChange={(e) => onChange({ phone: e.target.value })}
            placeholder="+48 600 123 456"
            className="num pl-10"
          />
        </div>
      </Field>

      {isLinked ? (
        <div className="flex items-start gap-3 rounded-xl border-2 border-emerald-300 bg-emerald-50/60 p-3">
          <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-emerald-600 text-white">
            <CheckCircle2 className="size-5" strokeWidth={2.2} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-foreground text-sm font-bold">
              {t('onboarding.tg_phone.linked_title', {
                defaultValue: 'Telegram подключён',
              })}
            </p>
            <p className="text-muted-foreground mt-0.5 text-xs">
              {profile?.telegram_username
                ? `@${profile.telegram_username}`
                : t('onboarding.tg_phone.linked_no_username', {
                    defaultValue: 'Получишь разбор каждое утро в 9:00',
                  })}
            </p>
          </div>
        </div>
      ) : (
        <div className="border-border bg-card flex flex-col gap-2 rounded-xl border-2 p-3">
          <div className="flex items-start gap-3">
            <div className="bg-brand-teal-soft text-brand-teal-deep grid size-9 shrink-0 place-items-center rounded-lg">
              <svg viewBox="0 0 24 24" fill="currentColor" className="size-5">
                <path d="M9.78 18.65l.28-4.23 7.68-6.92c.34-.31-.07-.46-.52-.19L7.74 13.3 3.64 12c-.88-.25-.89-.86.2-1.3l15.97-6.16c.73-.33 1.43.18 1.15 1.3l-2.72 12.81c-.19.91-.74 1.13-1.5.71L12.6 16.3l-1.99 1.93c-.23.23-.42.42-.83.42z" />
              </svg>
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-foreground text-sm font-bold">
                {t('onboarding.tg_phone.tg_title', {
                  defaultValue: 'Получать инсайты в Telegram',
                })}
              </p>
              <p className="text-muted-foreground mt-0.5 text-xs">
                {t('onboarding.tg_phone.tg_body_v2', {
                  defaultValue: 'Каждое утро в 9:00 — краткий разбор от @finkley_tg_bot.',
                })}
              </p>
            </div>
          </div>
          <Button
            type="button"
            onClick={linkTelegram}
            disabled={busy || polling}
            className="!bg-[#229ED9] hover:!bg-[#1f8fc4]"
          >
            {busy || polling ? (
              <Loader2 className="size-4 animate-spin" strokeWidth={2} />
            ) : (
              <svg viewBox="0 0 24 24" fill="currentColor" className="size-4">
                <path d="M9.78 18.65l.28-4.23 7.68-6.92c.34-.31-.07-.46-.52-.19L7.74 13.3 3.64 12c-.88-.25-.89-.86.2-1.3l15.97-6.16c.73-.33 1.43.18 1.15 1.3l-2.72 12.81c-.19.91-.74 1.13-1.5.71L12.6 16.3l-1.99 1.93c-.23.23-.42.42-.83.42z" />
              </svg>
            )}
            {polling
              ? t('onboarding.tg_phone.polling', {
                  defaultValue: 'Жду подтверждения от бота…',
                })
              : t('onboarding.tg_phone.connect_now', {
                  defaultValue: 'Подключить через @finkley_tg_bot',
                })}
          </Button>
        </div>
      )}
    </div>
  )
}
