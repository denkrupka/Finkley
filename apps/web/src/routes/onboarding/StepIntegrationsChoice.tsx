import { Banknote, Calendar, FileText, Plug } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import type { OnboardingIntegration } from './OnboardingPage'

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
}: {
  selected: OnboardingIntegration[]
  onChange: (v: OnboardingIntegration[]) => void
}) {
  const { t } = useTranslation()

  function toggle(id: OnboardingIntegration) {
    if (selected.includes(id)) onChange(selected.filter((x) => x !== id))
    else onChange([...selected, id])
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-brand-navy flex items-center gap-2 text-2xl font-bold tracking-tight">
          <Plug className="text-brand-teal-deep size-6" strokeWidth={2} />
          {t('onboarding.step_integrations.title')}
        </h2>
        <p className="text-muted-foreground mt-2 text-sm">
          {t('onboarding.step_integrations.subtitle')}
        </p>
      </div>

      <div className="grid gap-3">
        {INTEGRATIONS.map(({ id, i18nKey, icon: Icon }) => {
          const checked = selected.includes(id)
          return (
            <label
              key={id}
              className={`flex cursor-pointer items-start gap-3 rounded-lg border-2 p-4 transition-colors ${
                checked
                  ? 'border-brand-teal-deep bg-brand-teal-soft/30'
                  : 'border-border bg-card hover:border-brand-teal-deep/40'
              }`}
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => toggle(id)}
                className="mt-0.5 size-5 cursor-pointer"
              />
              <Icon className="text-brand-teal-deep mt-0.5 size-5 shrink-0" strokeWidth={1.8} />
              <div className="flex-1">
                <p className="text-foreground text-sm font-bold">{t(`${i18nKey}.label`)}</p>
                <p className="text-muted-foreground mt-1 text-xs leading-snug">
                  {t(`${i18nKey}.hint`)}
                </p>
              </div>
            </label>
          )
        })}
      </div>

      <p className="text-muted-foreground text-xs">{t('onboarding.step_integrations.hint_skip')}</p>
    </div>
  )
}
