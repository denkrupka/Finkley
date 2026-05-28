import { Banknote, Brain, Lock, MessageSquare, Star, Target, TrendingUp, Zap } from 'lucide-react'
import { useTranslation } from 'react-i18next'

/**
 * Шаг 0 онбординга — Welcome / sales pitch.
 *
 * T119: компактная версия — без длинных описаний, всё помещается в 4-5
 * строк без скроллинга. 8 коротких карточек 4×2 на десктопе, 2×4 на
 * мобильных. Подробности юзер увидит уже в портале.
 */
export function StepWelcome() {
  const { t } = useTranslation()

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-brand-navy text-2xl font-bold tracking-tight sm:text-3xl">
          {t('onboarding.welcome.title')}
        </h2>
        <p className="text-muted-foreground mt-2 text-sm">{t('onboarding.welcome.subtitle_v2')}</p>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Pill icon={Zap} tone="teal" text={t('onboarding.welcome.p1')} />
        <Pill icon={Lock} tone="navy" text={t('onboarding.welcome.p2')} />
        <Pill icon={Banknote} tone="sage" text={t('onboarding.welcome.p3')} />
        <Pill icon={TrendingUp} tone="gold" text={t('onboarding.welcome.p4')} />
        <Pill icon={MessageSquare} tone="teal" text={t('onboarding.welcome.p5')} />
        <Pill icon={Target} tone="navy" text={t('onboarding.welcome.p6')} />
        <Pill icon={Star} tone="gold" text={t('onboarding.welcome.p7')} />
        <Pill icon={Brain} tone="sage" text={t('onboarding.welcome.p8')} />
      </div>
    </div>
  )
}

function Pill({
  icon: Icon,
  text,
  tone,
}: {
  icon: typeof Brain
  text: string
  tone: 'teal' | 'navy' | 'sage' | 'gold'
}) {
  const iconBg =
    tone === 'teal'
      ? 'bg-brand-teal-soft text-brand-teal-deep'
      : tone === 'navy'
        ? 'bg-brand-navy text-white'
        : tone === 'sage'
          ? 'bg-brand-sage-soft text-brand-sage-deep'
          : 'bg-brand-gold-soft text-brand-gold-deep'

  return (
    <div className="border-border bg-card flex items-center gap-2 rounded-lg border p-2.5">
      <div className={`grid size-8 shrink-0 place-items-center rounded-md ${iconBg}`}>
        <Icon className="size-4" strokeWidth={2} />
      </div>
      <p className="text-foreground text-[12.5px] font-semibold leading-tight">{text}</p>
    </div>
  )
}
