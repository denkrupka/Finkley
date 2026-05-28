import { Banknote, Calendar, Check, FileText, Plug } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ConnectIntegrationDialog } from './ConnectIntegrationDialog'
import type { OnboardingIntegration, PendingCredentials } from './OnboardingPage'

const INTEGRATIONS: ReadonlyArray<{
  id: OnboardingIntegration
  i18nKey: string
  icon: typeof Calendar
}> = [
  { id: 'banking', i18nKey: 'onboarding.step5.integrations.banking', icon: Banknote },
  { id: 'booksy', i18nKey: 'onboarding.step5.integrations.booksy', icon: Calendar },
  { id: 'wfirma', i18nKey: 'onboarding.step5.integrations.wfirma', icon: FileText },
]

export function StepIntegrationsChoice({
  selected,
  onChange,
  credentials,
  onCredentialsChange,
}: {
  selected: OnboardingIntegration[]
  onChange: (v: OnboardingIntegration[]) => void
  credentials?: Partial<Record<OnboardingIntegration, PendingCredentials>>
  onCredentialsChange?: (id: OnboardingIntegration, creds: PendingCredentials | null) => void
}) {
  const { t } = useTranslation()
  // T122 — открываем модалку подключения при клике на не-выбранную интеграцию.
  const [pending, setPending] = useState<OnboardingIntegration | null>(null)

  function toggle(id: OnboardingIntegration) {
    if (selected.includes(id)) onChange(selected.filter((x) => x !== id))
    else onChange([...selected, id])
  }

  function handleClick(id: OnboardingIntegration) {
    if (selected.includes(id)) toggle(id)
    else setPending(id)
  }

  return (
    <div className="space-y-3">
      <h2 className="text-brand-navy flex items-center gap-2 text-2xl font-bold tracking-tight">
        <Plug className="text-brand-teal-deep size-6" strokeWidth={2} />
        {t('onboarding.step_integrations.title')}
      </h2>

      <div className="grid gap-2">
        {INTEGRATIONS.map(({ id, i18nKey, icon: Icon }) => {
          const checked = selected.includes(id)
          return (
            <button
              key={id}
              type="button"
              onClick={() => handleClick(id)}
              className={`flex items-start gap-3 rounded-lg border-2 p-3 text-left transition-colors ${
                checked
                  ? 'border-brand-teal-deep bg-brand-teal-soft/30'
                  : 'border-border bg-card hover:border-brand-teal-deep/40'
              }`}
            >
              <div
                className={`grid size-9 shrink-0 place-items-center rounded-lg ${
                  checked
                    ? 'bg-brand-teal-deep text-white'
                    : 'bg-brand-teal-soft text-brand-teal-deep'
                }`}
              >
                {checked ? (
                  <Check className="size-5" strokeWidth={2.4} />
                ) : (
                  <Icon className="size-5" strokeWidth={1.8} />
                )}
              </div>
              <div className="flex-1">
                <p className="text-foreground text-sm font-bold">{t(`${i18nKey}.label`)}</p>
                <p className="text-muted-foreground mt-0.5 line-clamp-2 text-xs">
                  {t(`${i18nKey}.hint`)}
                </p>
              </div>
              {checked ? (
                <span className="bg-brand-teal-deep mt-0.5 inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase text-white">
                  ✓
                </span>
              ) : null}
            </button>
          )
        })}
      </div>

      <ConnectIntegrationDialog
        integration={pending}
        open={pending !== null}
        onClose={() => setPending(null)}
        existingCredentials={pending ? credentials?.[pending] : undefined}
        onConfirm={(creds) => {
          if (pending) {
            toggle(pending)
            onCredentialsChange?.(pending, creds)
          }
        }}
      />
    </div>
  )
}
