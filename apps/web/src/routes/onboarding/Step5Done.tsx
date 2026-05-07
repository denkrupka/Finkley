import { Check, TrendingUp } from 'lucide-react'
import { useTranslation } from 'react-i18next'

type Props = {
  summary: {
    salonName: string
    staffCount: number
    servicesCount: number
    expensesCount: number
  }
  benchmarksOptIn: boolean
  onBenchmarksToggle: (value: boolean) => void
}

export function Step5Done({ summary, benchmarksOptIn, onBenchmarksToggle }: Props) {
  const { t } = useTranslation()

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
