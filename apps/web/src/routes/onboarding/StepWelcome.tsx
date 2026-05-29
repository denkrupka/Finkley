import { Brain, FileBarChart, LayoutDashboard, MessageSquare, Wallet } from 'lucide-react'
import { useTranslation } from 'react-i18next'

/**
 * Шаг 0 онбординга — Welcome / sales pitch.
 *
 * 5 секций «что внутри», каждая с цветной плашкой-маркером + заголовок +
 * 1-2 строки описания. Текст по фидбеку владельца (image #32).
 */
export function StepWelcome() {
  const { t } = useTranslation()

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-brand-navy text-2xl font-bold tracking-tight sm:text-3xl">
          {t('onboarding.welcome.title')}
        </h2>
        <p className="text-muted-foreground mt-2 text-sm leading-snug">
          {t('onboarding.welcome.subtitle_v2')}
        </p>
      </div>

      <div className="flex flex-col gap-3">
        <Feature
          icon={LayoutDashboard}
          tone="sage"
          title={t('onboarding.welcome.dashboard_title')}
          body={t('onboarding.welcome.dashboard_body')}
        />
        <Feature
          icon={Wallet}
          tone="teal"
          title={t('onboarding.welcome.expenses_title')}
          body={t('onboarding.welcome.expenses_body')}
        />
        <Feature
          icon={FileBarChart}
          tone="navy"
          title={t('onboarding.welcome.reports_title')}
          body={t('onboarding.welcome.reports_body')}
        />
        <Feature
          icon={MessageSquare}
          tone="rose"
          title={t('onboarding.welcome.messenger_title')}
          body={t('onboarding.welcome.messenger_body')}
        />
        <Feature
          icon={Brain}
          tone="gold"
          title={t('onboarding.welcome.ai_title')}
          body={t('onboarding.welcome.ai_body')}
        />
      </div>
    </div>
  )
}

function Feature({
  icon: Icon,
  title,
  body,
  tone,
}: {
  icon: typeof Brain
  title: string
  body: string
  tone: 'sage' | 'teal' | 'navy' | 'rose' | 'gold'
}) {
  const colorBlock =
    tone === 'sage'
      ? 'bg-brand-sage-soft text-brand-sage-deep'
      : tone === 'teal'
        ? 'bg-brand-teal-soft text-brand-teal-deep'
        : tone === 'navy'
          ? 'bg-[#E8ECF7] text-brand-navy'
          : tone === 'rose'
            ? 'bg-[#FCE4EC] text-[#AD1457]'
            : 'bg-brand-gold-soft text-brand-gold-deep'

  return (
    <div className="flex items-start gap-3">
      <div
        className={`grid size-10 shrink-0 place-items-center rounded-md ${colorBlock}`}
        aria-hidden
      >
        <Icon className="size-4" strokeWidth={2} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-foreground text-sm font-bold">{title}</p>
        <p className="text-muted-foreground mt-0.5 text-xs leading-snug">{body}</p>
      </div>
    </div>
  )
}
