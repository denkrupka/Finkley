import { Plus, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { SEED_SERVICES_BY_TYPE, type SalonTypeId } from './onboarding-defaults'

export type ServiceDraft = {
  id: string
  category_name: string
  name: string
  default_price_cents: number
}

function makeNew(category_name = ''): ServiceDraft {
  return {
    id: `srv-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    category_name,
    name: '',
    default_price_cents: 0,
  }
}

type Props = {
  value: ServiceDraft[]
  onChange: (v: ServiceDraft[]) => void
  salonType: SalonTypeId
}

export function Step3Services({ value, onChange, salonType }: Props) {
  const { t } = useTranslation()

  function update(id: string, patch: Partial<ServiceDraft>) {
    onChange(value.map((s) => (s.id === id ? { ...s, ...patch } : s)))
  }

  function remove(id: string) {
    onChange(value.filter((s) => s.id !== id))
  }

  function add() {
    const lastCategory = value.length > 0 ? value[value.length - 1]!.category_name : ''
    onChange([...value, makeNew(lastCategory)])
  }

  function resetSeed() {
    onChange(SEED_SERVICES_BY_TYPE[salonType].map((s, i) => ({ ...s, id: `seed-${i}` })))
  }

  return (
    <div>
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-brand-navy text-3xl font-extrabold tracking-tight">
            {t('onboarding.step3.title')}
          </h1>
          <p className="text-muted-foreground mt-2 text-[15px] leading-relaxed">
            {t('onboarding.step3.subtitle')}
          </p>
        </div>
        {SEED_SERVICES_BY_TYPE[salonType].length > 0 ? (
          <button
            type="button"
            onClick={resetSeed}
            className="text-secondary text-sm font-semibold hover:underline"
          >
            {t('onboarding.step3.reset_seed')}
          </button>
        ) : null}
      </div>

      <div className="mt-7 flex flex-col gap-2">
        <div className="text-muted-foreground hidden grid-cols-[1.5fr_2fr_120px_44px] gap-2.5 px-1 text-[11px] font-semibold uppercase tracking-wide sm:grid">
          <span>{t('onboarding.step3.category')}</span>
          <span>{t('onboarding.step3.service')}</span>
          <span className="text-right">{t('onboarding.step3.price')}</span>
          <span />
        </div>

        {value.map((s) => (
          <div
            key={s.id}
            className="border-border bg-card grid grid-cols-1 gap-2 rounded-md border p-3 sm:grid-cols-[1.5fr_2fr_120px_44px] sm:gap-2.5 sm:border-0 sm:bg-transparent sm:p-0"
            data-testid="onb-service-row"
          >
            <Input
              value={s.category_name}
              onChange={(e) => update(s.id, { category_name: e.target.value })}
              placeholder={t('onboarding.step3.category_placeholder')}
            />
            <Input
              value={s.name}
              onChange={(e) => update(s.id, { name: e.target.value })}
              placeholder={t('onboarding.step3.service_placeholder')}
            />
            <div className="border-input bg-card flex items-center gap-1.5 rounded-md border px-3">
              <Label htmlFor={`pr-${s.id}`} className="hidden">
                {t('onboarding.step3.price')}
              </Label>
              <input
                id={`pr-${s.id}`}
                type="number"
                min="0"
                value={Math.round(s.default_price_cents / 100)}
                onChange={(e) =>
                  update(s.id, {
                    default_price_cents: Math.max(0, Number(e.target.value)) * 100,
                  })
                }
                className="num text-foreground h-10 w-full bg-transparent text-right text-sm font-semibold outline-none"
              />
              <span className="text-muted-foreground text-xs">€</span>
            </div>
            <button
              type="button"
              onClick={() => remove(s.id)}
              className="border-border text-muted-foreground hover:text-destructive grid size-11 place-items-center rounded-md border sm:size-11"
              aria-label="remove"
            >
              <Trash2 className="size-4" strokeWidth={1.7} />
            </button>
          </div>
        ))}

        <button
          type="button"
          onClick={add}
          className="border-brand-border-strong text-muted-foreground hover:border-secondary hover:text-secondary mt-2 inline-flex items-center justify-center gap-2 self-start rounded-md border border-dashed px-4 py-2 text-sm font-semibold"
          data-testid="onb-service-add"
        >
          <Plus className="size-4" strokeWidth={1.7} />
          {t('onboarding.step3.add')}
        </button>
      </div>
    </div>
  )
}
