import { CheckCircle2, Rocket, Settings2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { cn } from '@/lib/utils/cn'

export type OnboardingPath = 'quick' | 'full'

export function Step0Path({
  value,
  onChange,
}: {
  value: OnboardingPath | null
  onChange: (v: OnboardingPath) => void
}) {
  const { t } = useTranslation()
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-brand-navy text-2xl font-bold tracking-tight">
          {t('onboarding.path.title')}
        </h2>
        <p className="text-muted-foreground mt-2 text-sm">{t('onboarding.path.subtitle')}</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <PathCard
          icon={Rocket}
          title={t('onboarding.path.quick_title')}
          subtitle={t('onboarding.path.quick_subtitle')}
          eta={t('onboarding.path.quick_eta')}
          bullets={[
            t('onboarding.path.quick_bullet_1'),
            t('onboarding.path.quick_bullet_2'),
            t('onboarding.path.quick_bullet_3'),
          ]}
          active={value === 'quick'}
          onClick={() => onChange('quick')}
          tone="quick"
        />
        <PathCard
          icon={Settings2}
          title={t('onboarding.path.full_title')}
          subtitle={t('onboarding.path.full_subtitle')}
          eta={t('onboarding.path.full_eta')}
          bullets={[
            t('onboarding.path.full_bullet_1'),
            t('onboarding.path.full_bullet_2'),
            t('onboarding.path.full_bullet_3'),
          ]}
          active={value === 'full'}
          onClick={() => onChange('full')}
          tone="full"
        />
      </div>

      <p className="text-muted-foreground text-[11px]">{t('onboarding.path.switch_hint')}</p>
    </div>
  )
}

function PathCard({
  icon: Icon,
  title,
  subtitle,
  eta,
  bullets,
  active,
  onClick,
  tone,
}: {
  icon: typeof Rocket
  title: string
  subtitle: string
  eta: string
  bullets: string[]
  active: boolean
  onClick: () => void
  tone: 'quick' | 'full'
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'group flex flex-col gap-3 rounded-xl border-2 p-5 text-left transition-all',
        active
          ? tone === 'quick'
            ? 'border-brand-sage bg-brand-sage-soft/30 shadow-finmd'
            : 'border-brand-teal-deep bg-brand-teal-soft/30 shadow-finmd'
          : 'border-border bg-card hover:border-brand-sage/50',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div
          className={cn(
            'grid size-10 shrink-0 place-items-center rounded-lg',
            tone === 'quick' ? 'bg-brand-sage text-white' : 'bg-brand-teal-deep text-white',
          )}
        >
          <Icon className="size-5" strokeWidth={2} />
        </div>
        <span
          className={cn(
            'rounded-full px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-wider',
            tone === 'quick'
              ? 'bg-brand-sage-soft text-brand-sage-deep'
              : 'bg-brand-teal-soft text-brand-teal-deep',
          )}
        >
          {eta}
        </span>
      </div>
      <div>
        <p className="text-foreground text-base font-bold">{title}</p>
        <p className="text-muted-foreground mt-0.5 text-xs">{subtitle}</p>
      </div>
      <ul className="mt-1 space-y-1.5">
        {bullets.map((b) => (
          <li key={b} className="text-foreground flex items-start gap-2 text-[12.5px]">
            <CheckCircle2
              className={cn(
                'mt-0.5 size-3.5 shrink-0',
                tone === 'quick' ? 'text-brand-sage' : 'text-brand-teal-deep',
              )}
              strokeWidth={2.2}
            />
            <span>{b}</span>
          </li>
        ))}
      </ul>
    </button>
  )
}
