import { Bell, MessageCircle, Phone } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'

type Props = {
  value: {
    phone: string
    /** Подключить Telegram-бота? Если true — после submit покажем deep-link
     *  на t.me/finkley_tg_bot?start=<token>. */
    want_telegram: boolean
  }
  onChange: (v: Partial<Props['value']>) => void
}

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

      <label className="border-border bg-card hover:border-brand-teal-deep/40 flex cursor-pointer items-start gap-3 rounded-xl border-2 p-4 transition-colors">
        <input
          type="checkbox"
          checked={value.want_telegram}
          onChange={(e) => onChange({ want_telegram: e.target.checked })}
          className="accent-brand-teal-deep mt-1 size-5 shrink-0 cursor-pointer"
        />
        <div className="bg-brand-teal-soft text-brand-teal-deep grid size-10 shrink-0 place-items-center rounded-lg">
          <MessageCircle className="size-5" strokeWidth={2} />
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
      </label>
    </div>
  )
}
