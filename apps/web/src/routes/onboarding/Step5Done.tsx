import { Check, CreditCard, TrendingUp } from 'lucide-react'
import { useTranslation } from 'react-i18next'

type Props = {
  summary: {
    salonName: string
  }
  benchmarksOptIn: boolean
  onBenchmarksToggle: (value: boolean) => void
  /** Stripe trial 14 дней. Дефолт включён — кнопка Submit редиректит в
   *  Stripe Checkout. Если юзер снимает — попадает на /dashboard без
   *  активации подписки, может включить позже в Settings → Биллинг. */
  subscribeAfterSubmit: boolean
  onSubscribeToggle: (value: boolean) => void
}

export function Step5Done({
  summary,
  benchmarksOptIn,
  onBenchmarksToggle,
  subscribeAfterSubmit,
  onSubscribeToggle,
}: Props) {
  const { t } = useTranslation()

  return (
    <div className="text-center">
      <div className="bg-brand-sage-soft text-brand-sage mx-auto grid size-16 place-items-center rounded-full">
        <Check className="size-8" strokeWidth={2.5} />
      </div>
      <h1 className="text-brand-navy mt-6 text-3xl font-extrabold tracking-tight">
        {t('onboarding.step5.title', { name: summary.salonName.trim() || '...' })}
      </h1>

      <label
        className={`mx-auto mt-6 flex max-w-md cursor-pointer items-start gap-3 rounded-lg border p-4 text-left transition-colors ${
          subscribeAfterSubmit
            ? 'border-brand-teal-deep bg-brand-teal-soft/30'
            : 'border-border bg-card hover:bg-muted/30'
        }`}
      >
        <input
          type="checkbox"
          checked={subscribeAfterSubmit}
          onChange={(e) => onSubscribeToggle(e.target.checked)}
          className="mt-0.5 size-4 cursor-pointer"
        />
        <div className="flex-1">
          <div className="text-brand-navy flex items-center gap-1.5 text-sm font-bold">
            <CreditCard className="text-brand-teal-deep size-4" strokeWidth={2} />
            {t('onboarding.step5.subscribe_label')}
          </div>
          <p className="text-muted-foreground mt-1 text-xs leading-snug">
            {t('onboarding.step5.subscribe_hint')}
          </p>
        </div>
      </label>

      <label
        className={`mx-auto mt-4 flex max-w-md cursor-pointer items-start gap-3 rounded-lg border p-4 text-left transition-colors ${
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
    </div>
  )
}
