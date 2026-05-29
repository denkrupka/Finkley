import { ArrowRight, Check, CreditCard, Sparkles, TrendingUp } from 'lucide-react'
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
  /** T105 — текущий путь онбординга. В quick показываем CTA «Доделать
   *  полный setup» — переключение на full и переход к первому шагу
   *  отсутствующему в quick (schedule). */
  path?: 'quick' | 'full' | null
  /** T105 — обработчик переключения на полную ветку. Меняет path на 'full'
   *  и навигирует на schedule (первый full-only шаг). */
  onSwitchToFull?: () => void
}

export function Step5Done({
  summary,
  benchmarksOptIn,
  onBenchmarksToggle,
  subscribeAfterSubmit,
  onSubscribeToggle,
  path,
  onSwitchToFull,
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

      {path === 'quick' && onSwitchToFull ? (
        <button
          type="button"
          onClick={onSwitchToFull}
          className="border-brand-teal-deep bg-brand-teal-soft/30 hover:bg-brand-teal-soft/60 text-brand-teal-deep mx-auto mt-6 inline-flex max-w-md items-center gap-2 rounded-xl border-2 border-dashed px-5 py-3 text-sm font-bold transition-colors"
        >
          <Sparkles className="size-4" strokeWidth={2} />
          {t('onboarding.step5.switch_to_full')}
          <ArrowRight className="size-4" strokeWidth={2.4} />
        </button>
      ) : null}

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
