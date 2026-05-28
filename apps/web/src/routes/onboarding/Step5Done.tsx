import {
  ArrowRight,
  Banknote,
  Calendar,
  Check,
  CreditCard,
  FileText,
  Plug,
  Sparkles,
  TrendingUp,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'

import type { OnboardingIntegration } from './OnboardingPage'

type Props = {
  summary: {
    salonName: string
  }
  benchmarksOptIn: boolean
  onBenchmarksToggle: (value: boolean) => void
  selectedIntegrations: OnboardingIntegration[]
  onIntegrationsToggle: (value: OnboardingIntegration[]) => void
  /** T105 — текущий путь онбординга. В quick показываем CTA «Доделать
   *  полный setup» — переключение на full и переход к первому шагу
   *  отсутствующему в quick (schedule). */
  path?: 'quick' | 'full' | null
  /** T105 — обработчик переключения на полную ветку. Меняет path на 'full'
   *  и навигирует на schedule (первый full-only шаг). */
  onSwitchToFull?: () => void
  /** T178 — Stripe Checkout opt-out (вернул после регрессии T164).
   *  Дефолт true (юзер автоматом получает 14-дневный trial). Чек-бокс
   *  даёт явный «без подписки» — для demo/test юзеров без Stripe ENV. */
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
  path,
  onSwitchToFull,
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

      {/* T145 — убраны: subtitle про "Дашборд на месте/пустой/добавь визит",
          плитки счётчиков (мастеров/услуг/категорий), блок paywall с trial.
          Подписка теперь активируется автоматически в Settings → Биллинг. */}
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

      {/* T178 — Stripe opt-out. Дефолт включён, юзер может снять для
          demo/test. Без всплывающего "Paywall" блока T159 — просто
          компактный чек-бокс. */}
      <label
        className={`mx-auto mt-6 flex max-w-md cursor-pointer items-start gap-3 rounded-lg border p-3 text-left transition-colors ${
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
          <div className="text-foreground flex items-center gap-1.5 text-sm font-semibold">
            <CreditCard className="text-brand-teal-deep size-4" strokeWidth={2} />
            {t('onboarding.step5.subscribe_label')}
          </div>
          <p className="text-muted-foreground mt-0.5 text-xs">
            {t('onboarding.step5.subscribe_hint')}
          </p>
        </div>
      </label>

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
