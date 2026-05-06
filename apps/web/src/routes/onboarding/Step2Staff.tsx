import { Plus, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils/cn'

export type StaffDraft = {
  id: string
  full_name: string
  payout_percent: number
  /** Только для UI; в БД пока не пишем (стадия 2: TASK-12) */
  specialties: string[]
}

const PALETTE = ['#F4D7C5', '#D7E4C5', '#C5DAE4', '#E4C5DC', '#E8C4B8', '#FBE5C0']

function makeNew(): StaffDraft {
  return {
    id: `s-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    full_name: '',
    payout_percent: 40,
    specialties: [],
  }
}

type Props = {
  value: StaffDraft[]
  onChange: (v: StaffDraft[]) => void
}

export function Step2Staff({ value, onChange }: Props) {
  const { t } = useTranslation()

  function update(id: string, patch: Partial<StaffDraft>) {
    onChange(value.map((s) => (s.id === id ? { ...s, ...patch } : s)))
  }

  function remove(id: string) {
    onChange(value.filter((s) => s.id !== id))
  }

  function add() {
    onChange([...value, makeNew()])
  }

  return (
    <div>
      <h1 className="text-brand-navy text-3xl font-extrabold tracking-tight">
        {t('onboarding.step2.title')}
      </h1>
      <p className="text-muted-foreground mt-2 text-[15px] leading-relaxed">
        {t('onboarding.step2.subtitle')}
      </p>

      <div className="mt-7 grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
        {value.map((staff, i) => {
          const initial = (staff.full_name || '?').trim().charAt(0).toUpperCase() || '?'
          const color = PALETTE[i % PALETTE.length]
          return (
            <div
              key={staff.id}
              className="border-border bg-card shadow-finsm rounded-lg border p-4"
              data-testid="onb-staff-card"
            >
              <div className="flex items-start justify-between">
                <div
                  className="text-brand-navy grid size-12 place-items-center rounded-full text-base font-bold"
                  style={{ background: color }}
                >
                  {initial}
                </div>
                <button
                  type="button"
                  onClick={() => remove(staff.id)}
                  className="text-muted-foreground hover:text-destructive"
                  aria-label="remove"
                >
                  <Trash2 className="size-4" strokeWidth={1.7} />
                </button>
              </div>
              <div className="mt-3 flex flex-col gap-2">
                <Input
                  placeholder={t('onboarding.step2.name_placeholder')}
                  value={staff.full_name}
                  onChange={(e) => update(staff.id, { full_name: e.target.value })}
                />
                <div>
                  <Label htmlFor={`p-${staff.id}`} className="mb-1.5 block">
                    {t('onboarding.step2.percent_label')}
                  </Label>
                  <div className="border-brand-yellow-deep bg-brand-yellow flex items-center gap-2 rounded-md border-[1.5px] px-3 py-2">
                    <input
                      id={`p-${staff.id}`}
                      type="number"
                      min="0"
                      max="100"
                      value={staff.payout_percent}
                      onChange={(e) => update(staff.id, { payout_percent: Number(e.target.value) })}
                      className="num text-brand-navy w-full bg-transparent text-lg font-bold outline-none"
                    />
                    <span className="num text-brand-navy text-lg font-bold">%</span>
                  </div>
                </div>
              </div>
            </div>
          )
        })}

        {/* Add card */}
        <button
          type="button"
          onClick={add}
          className={cn(
            'border-brand-border-strong text-muted-foreground hover:border-secondary hover:text-secondary flex min-h-[180px] flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed bg-transparent p-4 transition-colors',
          )}
          data-testid="onb-staff-add"
        >
          <div className="border-brand-border-strong bg-card grid size-11 place-items-center rounded-full border-[1.5px]">
            <Plus className="size-[18px]" strokeWidth={1.7} />
          </div>
          <span className="text-sm font-semibold">{t('onboarding.step2.add')}</span>
        </button>
      </div>
    </div>
  )
}
