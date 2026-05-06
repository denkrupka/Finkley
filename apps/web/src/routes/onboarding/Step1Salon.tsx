import { useTranslation } from 'react-i18next'

import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils/cn'
import {
  COUNTRY_OPTIONS,
  SALON_TYPES,
  type CountryCode,
  type SalonTypeId,
} from './onboarding-defaults'

type Props = {
  value: {
    name: string
    country_code: CountryCode
    salon_type: SalonTypeId
  }
  onChange: (v: Partial<Props['value']>) => void
}

export function Step1Salon({ value, onChange }: Props) {
  const { t } = useTranslation()
  return (
    <div>
      <h1 className="text-brand-navy text-3xl font-extrabold tracking-tight">
        {t('onboarding.step1.title')}
      </h1>
      <p className="text-muted-foreground mt-2 text-[15px] leading-relaxed">
        {t('onboarding.step1.subtitle')}
      </p>

      <div className="mt-7 flex flex-col gap-6">
        <Field id="onb-name" label={t('onboarding.step1.name_label')}>
          <Input
            id="onb-name"
            value={value.name}
            onChange={(e) => onChange({ name: e.target.value })}
            placeholder={t('onboarding.step1.name_placeholder')}
            autoFocus
            data-testid="onb-name"
          />
        </Field>

        <Field id="onb-country" label={t('onboarding.step1.country_label')}>
          <div className="flex flex-wrap gap-2" data-testid="onb-country">
            {COUNTRY_OPTIONS.map((c) => {
              const active = value.country_code === c.code
              return (
                <button
                  key={c.code}
                  type="button"
                  onClick={() => onChange({ country_code: c.code })}
                  className={cn(
                    'rounded-full border px-4 py-2 text-sm font-semibold transition-colors',
                    active
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-border bg-card text-foreground hover:bg-accent/50',
                  )}
                >
                  {c.name}
                  <span
                    className={cn(
                      'ml-1.5 text-[11px] font-medium',
                      active ? 'text-primary-foreground/70' : 'text-muted-foreground',
                    )}
                  >
                    {c.currency}
                  </span>
                </button>
              )
            })}
          </div>
        </Field>

        <Field id="onb-type" label={t('onboarding.step1.type_label')}>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3" data-testid="onb-type">
            {SALON_TYPES.map((typ) => {
              const active = value.salon_type === typ.id
              return (
                <button
                  key={typ.id}
                  type="button"
                  onClick={() => onChange({ salon_type: typ.id })}
                  className={cn(
                    'rounded-lg border p-4 text-left text-sm font-semibold transition-colors',
                    active
                      ? 'border-primary bg-primary text-primary-foreground shadow-finsm'
                      : 'border-border bg-card text-foreground hover:border-brand-border-strong',
                  )}
                >
                  {typ.name}
                </button>
              )
            })}
          </div>
        </Field>
      </div>
    </div>
  )
}
