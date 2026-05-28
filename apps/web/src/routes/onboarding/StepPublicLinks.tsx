import { Calendar, Facebook, Instagram, Link2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'

type Props = {
  value: {
    booksy_url: string
    instagram_url: string
    facebook_url: string
  }
  onChange: (v: Partial<Props['value']>) => void
}

/**
 * T103 — публичные ссылки салона. Запрашиваются в полной ветке после
 * шага схемы интеграций, потому что:
 *   - Booksy URL — для public link в письмах клиентам / SMS-напоминаниях.
 *     Если уже подключали Booksy интеграцию — кладём тот же URL.
 *   - Instagram URL / Facebook URL — для public profile salon (отображается
 *     в /reviews, в письмах, в QR-карточке).
 *
 * Сохраняются в salons.booksy_url / instagram_url / facebook_url.
 */
export function StepPublicLinks({ value, onChange }: Props) {
  const { t } = useTranslation()

  return (
    <div>
      <h1 className="text-brand-navy text-2xl font-bold tracking-tight">
        <Link2 className="text-brand-teal-deep mr-2 inline-block size-6" strokeWidth={2} />
        {t('onboarding.public_links.title')}
      </h1>

      <div className="mt-3 flex flex-col gap-3">
        <Field
          id="onb-booksy"
          label={
            <span className="inline-flex items-center gap-1.5">
              <Calendar className="text-brand-teal-deep size-4" strokeWidth={2} />
              {t('onboarding.public_links.booksy')}
            </span>
          }
        >
          <Input
            id="onb-booksy"
            type="url"
            inputMode="url"
            value={value.booksy_url}
            onChange={(e) => onChange({ booksy_url: e.target.value })}
            placeholder="https://booksy.com/…"
          />
        </Field>

        <Field
          id="onb-ig"
          label={
            <span className="inline-flex items-center gap-1.5">
              <Instagram className="size-4" strokeWidth={2} style={{ color: '#E1306C' }} />
              {t('onboarding.public_links.instagram')}
            </span>
          }
        >
          <Input
            id="onb-ig"
            type="url"
            inputMode="url"
            value={value.instagram_url}
            onChange={(e) => onChange({ instagram_url: e.target.value })}
            placeholder="https://instagram.com/your_salon"
          />
        </Field>

        <Field
          id="onb-fb"
          label={
            <span className="inline-flex items-center gap-1.5">
              <Facebook className="size-4" strokeWidth={2} style={{ color: '#1877F2' }} />
              {t('onboarding.public_links.facebook')}
            </span>
          }
        >
          <Input
            id="onb-fb"
            type="url"
            inputMode="url"
            value={value.facebook_url}
            onChange={(e) => onChange({ facebook_url: e.target.value })}
            placeholder="https://facebook.com/your_salon"
          />
        </Field>
      </div>
    </div>
  )
}
