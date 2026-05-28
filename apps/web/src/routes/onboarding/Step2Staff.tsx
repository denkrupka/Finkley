import { Mail, Phone, Plus, Send, Trash2, UserPlus } from 'lucide-react'
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
  /** T99 — email для приглашения мастера. Если invite=true — после создания
   *  салона пушим invite через salon_invitations. */
  email?: string
  /** T99 — телефон мастера, для SMS / Booksy auto-match. */
  phone?: string
  /** T99 — флаг «отправить приглашение в портал». */
  invite?: boolean
}

const PALETTE = ['#F4D7C5', '#D7E4C5', '#C5DAE4', '#E4C5DC', '#E8C4B8', '#FBE5C0']

function makeNew(): StaffDraft {
  return {
    id: `s-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    full_name: '',
    payout_percent: 40,
    specialties: [],
    email: '',
    phone: '',
    invite: false,
  }
}

type Props = {
  value: StaffDraft[]
  onChange: (v: StaffDraft[]) => void
}

/**
 * T99 — апгрейд Step2Staff:
 *   - email + phone у каждого мастера (для приглашения и Booksy match)
 *   - чекбокс «Пригласить в портал» — после submit'a отправит invite на email
 *   - подсказка что если подключён Booksy/блокнот — мастера и их аватары
 *     импортируются автоматом ПОСЛЕ создания салона.
 */
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
        {t('onboarding.step2.title', { defaultValue: 'Твоя команда' })}
      </h1>
      <p className="text-muted-foreground mt-2 text-[15px] leading-relaxed">
        {t('onboarding.step2.subtitle_v2', {
          defaultValue:
            'Заведи мастеров и сразу отметь «Пригласить» — после создания салона им уйдёт письмо с ссылкой на регистрацию. Booksy/блокнот подтянут остальных автоматом.',
        })}
      </p>

      <div className="mt-7 grid grid-cols-1 gap-3.5 sm:grid-cols-2">
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
                  placeholder={t('onboarding.step2.name_placeholder', {
                    defaultValue: 'Имя и фамилия',
                  })}
                  value={staff.full_name}
                  onChange={(e) => update(staff.id, { full_name: e.target.value })}
                />
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <div className="relative">
                    <Mail
                      className="text-muted-foreground pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2"
                      strokeWidth={1.8}
                    />
                    <Input
                      type="email"
                      placeholder="email@…"
                      value={staff.email ?? ''}
                      onChange={(e) => update(staff.id, { email: e.target.value })}
                      className="pl-9 text-sm"
                    />
                  </div>
                  <div className="relative">
                    <Phone
                      className="text-muted-foreground pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2"
                      strokeWidth={1.8}
                    />
                    <Input
                      type="tel"
                      placeholder="+48 …"
                      value={staff.phone ?? ''}
                      onChange={(e) => update(staff.id, { phone: e.target.value })}
                      className="num pl-9 text-sm"
                    />
                  </div>
                </div>
                <div>
                  <Label htmlFor={`p-${staff.id}`} className="mb-1 block text-xs">
                    {t('onboarding.step2.percent_label', { defaultValue: 'Процент от выручки' })}
                  </Label>
                  <div className="border-brand-yellow-deep bg-brand-yellow flex items-center gap-2 rounded-md border-[1.5px] px-3 py-1.5">
                    <input
                      id={`p-${staff.id}`}
                      type="number"
                      min="0"
                      max="100"
                      value={staff.payout_percent}
                      onChange={(e) => update(staff.id, { payout_percent: Number(e.target.value) })}
                      className="num text-brand-navy w-full bg-transparent text-base font-bold outline-none"
                    />
                    <span className="num text-brand-navy text-base font-bold">%</span>
                  </div>
                </div>
                <label
                  className={cn(
                    'border-border bg-muted/20 hover:bg-muted/40 flex cursor-pointer items-center gap-2 rounded-md border p-2 text-xs font-semibold transition-colors',
                    staff.invite && 'border-brand-teal-deep bg-brand-teal-soft/40',
                    !staff.email && 'cursor-not-allowed opacity-50',
                  )}
                  title={
                    !staff.email
                      ? t('onboarding.step2.invite_need_email', {
                          defaultValue: 'Укажи email чтобы пригласить',
                        })
                      : undefined
                  }
                >
                  <input
                    type="checkbox"
                    checked={!!staff.invite}
                    disabled={!staff.email}
                    onChange={(e) => update(staff.id, { invite: e.target.checked })}
                    className="accent-brand-teal-deep size-4 cursor-pointer disabled:cursor-not-allowed"
                  />
                  <Send className="text-brand-teal-deep size-3.5" strokeWidth={2} />
                  <span>
                    {t('onboarding.step2.invite_label', {
                      defaultValue: 'Пригласить в портал после создания',
                    })}
                  </span>
                </label>
              </div>
            </div>
          )
        })}

        {/* Add card */}
        <button
          type="button"
          onClick={add}
          className="border-brand-border-strong text-muted-foreground hover:border-secondary hover:text-secondary flex min-h-[180px] flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed bg-transparent p-4 transition-colors"
          data-testid="onb-staff-add"
        >
          <div className="border-brand-border-strong bg-card grid size-11 place-items-center rounded-full border-[1.5px]">
            <UserPlus className="size-[18px]" strokeWidth={1.7} />
          </div>
          <span className="text-sm font-semibold">
            {t('onboarding.step2.add', { defaultValue: 'Добавить мастера' })}
          </span>
        </button>
      </div>

      <p className="text-muted-foreground mt-4 inline-flex items-center gap-1.5 text-xs">
        <Plus className="size-3" strokeWidth={2.2} />
        {t('onboarding.step2.hint_booksy', {
          defaultValue:
            'Если подключишь Booksy — мастера, аватарки и история визитов импортируются автоматом после создания салона. Здесь можно завести только тех, кого нет в Booksy.',
        })}
      </p>
    </div>
  )
}
