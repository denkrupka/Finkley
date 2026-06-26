import {
  BadgeCheck,
  BellRing,
  CheckCircle2,
  Loader2,
  Phone,
  ShieldCheck,
  Smartphone,
  Sparkles,
} from 'lucide-react'
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

  // --- SMS-подтверждение номера телефона ---
  // Подтверждённость: либо из профиля (если уже подтверждён ранее), либо
  // локально после успешной верификации в этой сессии.
  const profileVerified =
    !!profile?.phone_verified_at && (profile.phone ?? '') === value.phone.trim()
  const [verifiedLocal, setVerifiedLocal] = useState(false)
  const isPhoneVerified = profileVerified || verifiedLocal
  const [codeSent, setCodeSent] = useState(false)
  const [code, setCode] = useState('')
  const [sendingCode, setSendingCode] = useState(false)
  const [verifyingCode, setVerifyingCode] = useState(false)

  // Если юзер меняет номер после отправки кода/подтверждения — сбрасываем флоу.
  useEffect(() => {
    setCodeSent(false)
    setCode('')
    setVerifiedLocal(false)
  }, [value.phone])

  async function sendVerificationCode() {
    const phone = value.phone.trim()
    if (!phone) {
      toast.error(
        t('onboarding.tg_phone.verify_need_phone', { defaultValue: 'Сначала введи номер' }),
      )
      return
    }
    setSendingCode(true)
    try {
      const { data, error } = await supabase.functions.invoke('phone-verify', {
        body: { action: 'send', phone },
      })
      if (error) throw error
      const res = data as { ok?: boolean; sent?: boolean; error?: string; retry_after?: number }
      if (!res?.ok) {
        if (res?.error === 'rate_limited') {
          toast.error(
            t('onboarding.tg_phone.verify_rate_limited', {
              defaultValue: 'Подожди немного перед повторной отправкой',
            }),
          )
          return
        }
        throw new Error(res?.error ?? 'send_failed')
      }
      setCodeSent(true)
      toast.success(
        t('onboarding.tg_phone.verify_code_sent', { defaultValue: 'Код отправлен по SMS' }),
      )
    } catch (e) {
      toast.error(
        t('onboarding.tg_phone.verify_send_failed', {
          defaultValue: 'Не удалось отправить SMS. Попробуй позже.',
        }) + (e instanceof Error ? `: ${e.message}` : ''),
      )
    } finally {
      setSendingCode(false)
    }
  }

  async function submitVerificationCode() {
    const phone = value.phone.trim()
    if (!code.trim()) return
    setVerifyingCode(true)
    try {
      const { data, error } = await supabase.functions.invoke('phone-verify', {
        body: { action: 'verify', phone, code: code.trim() },
      })
      if (error) throw error
      const res = data as { ok?: boolean; verified?: boolean; error?: string }
      if (res?.ok && res.verified) {
        setVerifiedLocal(true)
        setCodeSent(false)
        setCode('')
        await refetch()
        toast.success(t('onboarding.tg_phone.verify_done', { defaultValue: 'Номер подтверждён' }))
        return
      }
      toast.error(
        t('onboarding.tg_phone.verify_wrong_code', {
          defaultValue: 'Неверный код. Попробуй ещё раз.',
        }),
      )
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setVerifyingCode(false)
    }
  }

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
      toast.info(t('onboarding.tg_phone.code_hint'))
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
        toast.success(t('onboarding.tg_phone.toast_linked'))
        onChange({ want_telegram: true })
        return
      }
      if (elapsed >= 120) {
        // T136 — 60s → 120s. Часто юзер тыкает Start не сразу.
        window.clearInterval(id)
        setPolling(false)
        toast.warning(t('onboarding.tg_phone.poll_timeout'))
      }
    }, 2000)
  }

  const benefits: Array<{ icon: typeof Sparkles; key: string; fallback: string }> = [
    {
      icon: Sparkles,
      key: 'onboarding.tg_phone.benefit_digest',
      fallback: 'Каждое утро в 9:00 — короткий разбор: сколько салон заработал вчера.',
    },
    {
      icon: BellRing,
      key: 'onboarding.tg_phone.benefit_alerts',
      fallback: 'Уведомления о важном: оплаты, напоминания о счетах, новые записи.',
    },
    {
      icon: Smartphone,
      key: 'onboarding.tg_phone.benefit_pocket',
      fallback: 'Цифры салона всегда под рукой в телефоне — без входа в приложение.',
    },
  ]

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-brand-navy text-2xl font-bold tracking-tight">
          {t('onboarding.tg_phone.title')}
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          {t('onboarding.tg_phone.intro', {
            defaultValue: 'Два способа быть на связи с салоном. Оба — по желанию.',
          })}
        </p>
      </div>

      {/* Блок 1 — номер телефона (для SMS) */}
      <div className="border-border bg-card rounded-xl border p-4">
        <div className="flex items-start gap-3">
          <div className="bg-muted text-muted-foreground grid size-9 shrink-0 place-items-center rounded-lg">
            <Phone className="size-5" strokeWidth={2} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-foreground text-sm font-bold">
              {t('onboarding.tg_phone.phone_section_title', { defaultValue: 'Номер телефона' })}
            </p>
            <p className="text-muted-foreground mt-0.5 text-xs">
              {t('onboarding.tg_phone.phone_hint', {
                defaultValue:
                  'По желанию. Пришлём SMS, только если случится что-то важное — спамить не будем.',
              })}
            </p>
          </div>
        </div>
        <Field id="onb-phone" label={t('onboarding.tg_phone.phone_label')} className="mt-3">
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

        {/* Подтверждение номера через SMS-код — по желанию */}
        {value.phone.trim() &&
          (isPhoneVerified ? (
            <div className="mt-3 flex items-center gap-2 rounded-lg border border-emerald-300 bg-emerald-50/60 px-3 py-2">
              <BadgeCheck className="size-4 shrink-0 text-emerald-600" strokeWidth={2.2} />
              <span className="text-xs font-semibold text-emerald-700">
                {t('onboarding.tg_phone.verify_badge', { defaultValue: 'Номер подтверждён' })}
              </span>
            </div>
          ) : (
            <div className="mt-3 space-y-2">
              {!codeSent ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={sendVerificationCode}
                  disabled={sendingCode}
                  className="w-full"
                >
                  {sendingCode ? (
                    <Loader2 className="size-4 animate-spin" strokeWidth={2} />
                  ) : (
                    <ShieldCheck className="size-4" strokeWidth={2} />
                  )}
                  {t('onboarding.tg_phone.verify_cta', { defaultValue: 'Подтвердить номер' })}
                </Button>
              ) : (
                <div className="space-y-2">
                  <p className="text-muted-foreground text-xs">
                    {t('onboarding.tg_phone.verify_code_hint', {
                      defaultValue: 'Введи 6-значный код из SMS.',
                    })}
                  </p>
                  <div className="flex gap-2">
                    <Input
                      type="text"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      maxLength={6}
                      value={code}
                      onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                      placeholder="000000"
                      className="num tracking-widest"
                    />
                    <Button
                      type="button"
                      size="sm"
                      onClick={submitVerificationCode}
                      disabled={verifyingCode || code.trim().length < 4}
                    >
                      {verifyingCode ? (
                        <Loader2 className="size-4 animate-spin" strokeWidth={2} />
                      ) : (
                        t('onboarding.tg_phone.verify_submit', { defaultValue: 'Подтвердить код' })
                      )}
                    </Button>
                  </div>
                  <button
                    type="button"
                    onClick={sendVerificationCode}
                    disabled={sendingCode}
                    className="text-muted-foreground hover:text-foreground text-xs underline disabled:opacity-50"
                  >
                    {t('onboarding.tg_phone.verify_resend', {
                      defaultValue: 'Отправить код заново',
                    })}
                  </button>
                </div>
              )}
            </div>
          ))}
      </div>

      {/* Блок 2 — Telegram-бот (мобильный доступ к салону) */}
      {isLinked ? (
        <div className="flex items-start gap-3 rounded-xl border-2 border-emerald-300 bg-emerald-50/60 p-4">
          <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-emerald-600 text-white">
            <CheckCircle2 className="size-5" strokeWidth={2.2} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-foreground text-sm font-bold">
              {t('onboarding.tg_phone.linked_title')}
            </p>
            <p className="text-muted-foreground mt-0.5 text-xs">
              {profile?.telegram_username
                ? `@${profile.telegram_username}`
                : t('onboarding.tg_phone.linked_no_username')}
            </p>
          </div>
        </div>
      ) : (
        <div className="border-brand-teal-deep/30 bg-brand-teal-soft/15 flex flex-col gap-3 rounded-xl border-2 p-4">
          <div className="flex items-start gap-3">
            <div className="bg-brand-teal-soft text-brand-teal-deep grid size-9 shrink-0 place-items-center rounded-lg">
              <svg viewBox="0 0 24 24" fill="currentColor" className="size-5">
                <path d="M9.78 18.65l.28-4.23 7.68-6.92c.34-.31-.07-.46-.52-.19L7.74 13.3 3.64 12c-.88-.25-.89-.86.2-1.3l15.97-6.16c.73-.33 1.43.18 1.15 1.3l-2.72 12.81c-.19.91-.74 1.13-1.5.71L12.6 16.3l-1.99 1.93c-.23.23-.42.42-.83.42z" />
              </svg>
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-foreground text-sm font-bold">
                {t('onboarding.tg_phone.tg_section_title', {
                  defaultValue: 'Telegram-бот — твой салон в телефоне',
                })}
              </p>
              <p className="text-muted-foreground mt-0.5 text-xs">
                {t('onboarding.tg_phone.tg_intro', {
                  defaultValue:
                    'Подключи бота — и следи за салоном прямо из телефона. Это главный мобильный канал Finkley.',
                })}
              </p>
            </div>
          </div>

          <ul className="space-y-1.5">
            {benefits.map((b) => {
              const Icon = b.icon
              return (
                <li key={b.key} className="flex items-start gap-2">
                  <Icon className="text-brand-teal-deep mt-0.5 size-4 shrink-0" strokeWidth={2} />
                  <span className="text-foreground text-xs leading-snug">
                    {t(b.key, { defaultValue: b.fallback })}
                  </span>
                </li>
              )
            })}
          </ul>

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
            {polling ? t('onboarding.tg_phone.polling') : t('onboarding.tg_phone.connect_now')}
          </Button>
        </div>
      )}
    </div>
  )
}
