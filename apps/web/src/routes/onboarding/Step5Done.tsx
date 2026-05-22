import { Banknote, Calendar, Check, FileText, Plug, Sparkles, TrendingUp } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import type { OnboardingIntegration } from './OnboardingPage'

type Props = {
  summary: {
    salonName: string
    staffCount: number
    servicesCount: number
    expensesCount: number
  }
  benchmarksOptIn: boolean
  onBenchmarksToggle: (value: boolean) => void
  selectedIntegrations: OnboardingIntegration[]
  onIntegrationsToggle: (value: OnboardingIntegration[]) => void
  /** Подписаться в Stripe после submit: true = редирект в Stripe Checkout
   *  (trial 14 дней включён), false = просто dashboard. */
  subscribeAfterSubmit: boolean
  onSubscribeToggle: (value: boolean) => void
}

const INTEGRATIONS: ReadonlyArray<{
  id: OnboardingIntegration
  i18nKey: string
  icon: typeof Calendar
}> = [
  { id: 'banking', i18nKey: 'onboarding.step5.integrations.banking', icon: Banknote },
  { id: 'booksy', i18nKey: 'onboarding.step5.integrations.booksy', icon: Calendar },
  { id: 'wfirma', i18nKey: 'onboarding.step5.integrations.wfirma', icon: FileText },
]

export function Step5Done({
  summary,
  benchmarksOptIn,
  onBenchmarksToggle,
  selectedIntegrations,
  onIntegrationsToggle,
  subscribeAfterSubmit,
  onSubscribeToggle,
}: Props) {
  const { t } = useTranslation()

  function toggleIntegration(id: OnboardingIntegration) {
    if (selectedIntegrations.includes(id)) {
      onIntegrationsToggle(selectedIntegrations.filter((x) => x !== id))
    } else {
      onIntegrationsToggle([...selectedIntegrations, id])
    }
  }

  return (
    <div className="text-center">
      <div className="bg-brand-sage-soft text-brand-sage mx-auto grid size-16 place-items-center rounded-full">
        <Check className="size-8" strokeWidth={2.5} />
      </div>
      <h1 className="text-brand-navy mt-6 text-3xl font-extrabold tracking-tight">
        {t('onboarding.step5.title', { name: summary.salonName.trim() || '...' })}
      </h1>
      <p className="text-muted-foreground mt-2 text-[15px] leading-relaxed">
        {t('onboarding.step5.subtitle')}
      </p>

      <ul className="mx-auto mt-8 grid max-w-md grid-cols-2 gap-4 sm:grid-cols-3">
        <Card label={t('onboarding.step5.staff')} value={summary.staffCount} />
        <Card label={t('onboarding.step5.services')} value={summary.servicesCount} />
        <Card label={t('onboarding.step5.expenses')} value={summary.expensesCount} />
      </ul>

      {/* Paywall: 14 дней trial, дальше платно. По умолчанию включено —
          юзер увидит Stripe Checkout сразу после submit. Можно снять. */}
      <div className="border-brand-gold-deep bg-brand-gold-soft/40 mx-auto mt-6 max-w-md rounded-xl border-2 p-5 text-left">
        <div className="text-brand-navy flex items-start gap-3">
          <div className="bg-brand-gold-deep grid size-10 shrink-0 place-items-center rounded-lg text-white">
            <Sparkles className="size-5" strokeWidth={2} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-base font-bold">{t('onboarding.step5.paywall_title')}</p>
            <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
              {t('onboarding.step5.paywall_subtitle')}
            </p>
          </div>
        </div>
        <label className="border-border bg-card mt-3 flex cursor-pointer items-start gap-3 rounded-md border p-3">
          <input
            type="checkbox"
            checked={subscribeAfterSubmit}
            onChange={(e) => onSubscribeToggle(e.target.checked)}
            className="mt-0.5 size-4 cursor-pointer"
          />
          <div className="text-foreground flex-1 text-[12.5px] leading-snug">
            {t('onboarding.step5.paywall_optin')}
          </div>
        </label>
      </div>

      {/* Бенчмарки opt-in — дружелюбный копирайт, по умолчанию включено */}
      <label
        className={`mx-auto mt-8 flex max-w-md cursor-pointer items-start gap-3 rounded-lg border p-4 text-left transition-colors ${
          benchmarksOptIn
            ? 'border-brand-sage bg-brand-sage-soft/40'
            : 'border-border bg-card hover:bg-muted/30'
        }`}
      >
        <input
          type="checkbox"
          checked={benchmarksOptIn}
          onChange={(e) => onBenchmarksToggle(e.target.checked)}
          className="mt-0.5 size-4 cursor-pointer"
        />
        <div className="flex-1">
          <div className="text-brand-navy flex items-center gap-1.5 text-sm font-bold">
            <TrendingUp className="text-brand-sage size-4" strokeWidth={2} />
            {t('onboarding.step5.benchmarks_title')}
          </div>
          <p className="text-muted-foreground mt-1 text-xs leading-snug">
            {t('onboarding.step5.benchmarks_subtitle')}
          </p>
        </div>
      </label>

      {/* Выбор интеграций — opt-in. После submit'а юзер сразу попадёт в settings
          с открытой вкладкой Integrations и подсветкой выбранных провайдеров. */}
      <div className="mx-auto mt-6 max-w-md text-left">
        <div className="text-brand-navy mb-2 flex items-center gap-1.5 text-sm font-bold">
          <Plug className="text-brand-teal size-4" strokeWidth={2} />
          {t('onboarding.step5.integrations.title')}
        </div>
        <p className="text-muted-foreground mb-3 text-xs leading-snug">
          {t('onboarding.step5.integrations.subtitle')}
        </p>
        <div className="grid gap-2">
          {INTEGRATIONS.map(({ id, i18nKey, icon: Icon }) => {
            const checked = selectedIntegrations.includes(id)
            return (
              <label
                key={id}
                className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-left transition-colors ${
                  checked
                    ? 'border-brand-teal bg-brand-teal-soft/40'
                    : 'border-border bg-card hover:bg-muted/30'
                }`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggleIntegration(id)}
                  className="mt-0.5 size-4 cursor-pointer"
                />
                <div className="flex-1">
                  <div className="text-foreground flex items-center gap-1.5 text-sm font-semibold">
                    <Icon className="text-brand-teal size-4" strokeWidth={1.8} />
                    {t(`${i18nKey}.label`)}
                  </div>
                  <p className="text-muted-foreground mt-0.5 text-xs leading-snug">
                    {t(`${i18nKey}.hint`)}
                  </p>
                </div>
              </label>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function Card({ label, value }: { label: string; value: number }) {
  return (
    <li className="border-border bg-card shadow-finsm rounded-lg border p-4 text-center">
      <div className="num text-brand-navy text-2xl font-bold">{value}</div>
      <div className="text-muted-foreground mt-1 text-xs">{label}</div>
    </li>
  )
}
