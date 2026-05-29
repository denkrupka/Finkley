import { Check } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { cn } from '@/lib/utils/cn'

import { brandColor, isFullColorBrand } from './BrandIcon'
import { ConnectIntegrationDialog } from './ConnectIntegrationDialog'
import type { OnboardingIntegration, PendingCredentials } from './OnboardingPage'

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
  items,
  selected,
  onToggle,
  extra,
  credentials,
  onCredentialsChange,
}: {
  title: string
  items: IntegrationItem[]
  selected: OnboardingIntegration[]
  onToggle: (id: OnboardingIntegration) => void
  /** T102 — дополнительный контент после списка интеграций. */
  extra?: ReactNode
  /** T129 — сохранённые credentials per provider. */
  credentials?: Partial<Record<OnboardingIntegration, PendingCredentials>>
  /** T129 — обновляет credentials для конкретного провайдера. */
  onCredentialsChange?: (id: OnboardingIntegration, creds: PendingCredentials | null) => void
}) {
  const { t } = useTranslation()
  // T122 — модалка подключения. При клике на не-выбранную интеграцию
  // открываем dialog с описанием. На confirm → toggle.
  const [pending, setPending] = useState<OnboardingIntegration | null>(null)

  function handleCardClick(id: OnboardingIntegration) {
    if (selected.includes(id)) {
      onToggle(id) // снять выбор без модалки
    } else {
      setPending(id) // открыть модалку
    }
  }

  return (
    <div className="space-y-3">
      <h2 className="text-brand-navy text-2xl font-bold tracking-tight">{title}</h2>

      <div className="grid gap-2">
        {items.map((it) => {
          const checked = selected.includes(it.id)
          const Icon = it.icon
          return (
            <button
              key={it.id}
              type="button"
              onClick={() => handleCardClick(it.id)}
              className={cn(
                'flex items-start gap-3 rounded-xl border-2 p-3 text-left transition-colors',
                checked
                  ? 'border-brand-teal-deep bg-brand-teal-soft/30'
                  : 'border-border bg-card hover:border-brand-teal-deep/40',
              )}
            >
              <div
                className="grid size-9 shrink-0 place-items-center overflow-hidden rounded-lg text-white"
                style={{
                  background: checked
                    ? '#0d9488'
                    : isFullColorBrand(it.id)
                      ? 'transparent'
                      : brandColor(it.id),
                }}
              >
                {checked ? (
                  <Check className="size-5" strokeWidth={2.4} />
                ) : isFullColorBrand(it.id) ? (
                  <Icon className="size-9" strokeWidth={1.8} />
                ) : (
                  <Icon className="size-5" strokeWidth={1.8} />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-foreground text-sm font-bold">{it.title}</p>
                <p className="text-muted-foreground mt-0.5 line-clamp-2 text-xs">{it.benefit}</p>
              </div>
              {checked ? (
                <span className="bg-brand-teal-deep mt-0.5 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase text-white">
                  ✓ {t('onboarding.connect_dialog.badge_on')}
                </span>
              ) : null}
            </button>
          )
        })}
      </div>

      {extra}

      <ConnectIntegrationDialog
        integration={pending}
        open={pending !== null}
        onClose={() => setPending(null)}
        existingCredentials={pending ? credentials?.[pending] : undefined}
        onConfirm={(creds) => {
          if (pending) {
            onToggle(pending)
            onCredentialsChange?.(pending, creds)
          }
        }}
      />
    </div>
  )
}
