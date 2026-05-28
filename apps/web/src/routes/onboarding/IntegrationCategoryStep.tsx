import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { cn } from '@/lib/utils/cn'

import type { OnboardingIntegration } from './OnboardingPage'

export type IntegrationItem = {
  id: OnboardingIntegration
  icon: LucideIcon
  title: string
  benefit: string
}

/**
 * Универсальная карточка-шаг «Подключить интеграции категории». Используется
 * в Bookings / Social / Banking шагах онбординга.
 *
 * Здесь только чекбокс «хочу подключить» — фактическое OAuth-связывание
 * происходит после создания салона на /settings/integrations (там полно-
 * ценные диалоги с PSD2/SCA, Booksy bring-your-own-token, Meta Login).
 * URL передаёт ?prompt=booksy,banking в OnboardingPage submit.
 */
export function IntegrationCategoryStep({
  title,
  subtitle,
  items,
  selected,
  onToggle,
  emoji,
  extra,
}: {
  title: string
  subtitle: string
  items: IntegrationItem[]
  selected: OnboardingIntegration[]
  onToggle: (id: OnboardingIntegration) => void
  emoji: string
  /** T102 — дополнительный контент после списка интеграций (например, кнопка
   *  OCR блокнота для bookings). Рендерится перед нижней подсказкой. */
  extra?: ReactNode
}) {
  const { t } = useTranslation()

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-brand-navy text-2xl font-bold tracking-tight">
          <span aria-hidden className="mr-1.5">
            {emoji}
          </span>
          {title}
        </h2>
        <p className="text-muted-foreground mt-2 text-sm leading-relaxed">{subtitle}</p>
      </div>

      <div className="grid gap-3">
        {items.map((it) => {
          const checked = selected.includes(it.id)
          const Icon = it.icon
          return (
            <label
              key={it.id}
              className={cn(
                'flex cursor-pointer items-start gap-3 rounded-xl border-2 p-4 transition-colors',
                checked
                  ? 'border-brand-teal-deep bg-brand-teal-soft/30'
                  : 'border-border bg-card hover:border-brand-teal-deep/40',
              )}
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => onToggle(it.id)}
                className="accent-brand-teal-deep mt-1 size-5 shrink-0 cursor-pointer"
              />
              <div
                className={cn(
                  'grid size-10 shrink-0 place-items-center rounded-lg',
                  checked
                    ? 'bg-brand-teal-deep text-white'
                    : 'bg-brand-teal-soft text-brand-teal-deep',
                )}
              >
                <Icon className="size-5" strokeWidth={1.8} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-foreground text-sm font-bold">{it.title}</p>
                <p className="text-muted-foreground mt-1 text-xs leading-snug">{it.benefit}</p>
              </div>
            </label>
          )
        })}
      </div>

      {extra}

      <p className="text-muted-foreground text-xs">
        {t('onboarding.step_integrations.connect_after_hint', {
          defaultValue:
            'Подключим после создания салона — откроем тебе нужные диалоги один за другим. Можешь пропустить — позже зайдёшь в Настройки → Интеграции.',
        })}
      </p>
    </div>
  )
}
