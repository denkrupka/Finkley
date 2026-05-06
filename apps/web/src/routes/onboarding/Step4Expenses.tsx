import { Plus, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Input } from '@/components/ui/input'

type Props = {
  value: string[]
  onChange: (v: string[]) => void
}

export function Step4Expenses({ value, onChange }: Props) {
  const { t } = useTranslation()

  function update(i: number, name: string) {
    const next = [...value]
    next[i] = name
    onChange(next)
  }

  function remove(i: number) {
    onChange(value.filter((_, idx) => idx !== i))
  }

  function add() {
    onChange([...value, ''])
  }

  return (
    <div>
      <h1 className="text-brand-navy text-3xl font-extrabold tracking-tight">
        {t('onboarding.step4.title')}
      </h1>
      <p className="text-muted-foreground mt-2 text-[15px] leading-relaxed">
        {t('onboarding.step4.subtitle')}
      </p>

      <div className="mt-7 flex flex-col gap-2" data-testid="onb-expenses">
        {value.map((cat, i) => (
          <div key={i} className="flex items-center gap-2">
            <Input
              value={cat}
              onChange={(e) => update(i, e.target.value)}
              placeholder={t('onboarding.step4.placeholder')}
            />
            <button
              type="button"
              onClick={() => remove(i)}
              className="border-border text-muted-foreground hover:text-destructive grid size-11 shrink-0 place-items-center rounded-md border"
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
        >
          <Plus className="size-4" strokeWidth={1.7} />
          {t('onboarding.step4.add')}
        </button>
      </div>
    </div>
  )
}
