import { Check } from 'lucide-react'
import { useTranslation } from 'react-i18next'

type Props = {
  summary: {
    salonName: string
    staffCount: number
    servicesCount: number
    expensesCount: number
  }
}

export function Step5Done({ summary }: Props) {
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
