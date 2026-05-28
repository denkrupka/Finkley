import { CheckCircle2, Rocket, Sparkles } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { cn } from '@/lib/utils/cn'

export type OnboardingPath = 'quick' | 'full'

/**
 * Шаг 1 — выбор пути онбординга. Продающий тон: «3 минуты — увидишь
 * деньги» vs «20 минут — увидишь всё». ETA и список выгод явно показывают
 * во что превратится время инвестированное юзером.
 */
export function Step0Path({
  value,
  onChange,
}: {
  value: OnboardingPath | null
  onChange: (v: OnboardingPath) => void
}) {
  const { t } = useTranslation()
  return (
    <div className="space-y-3">
      <h2 className="text-brand-navy text-2xl font-bold tracking-tight">
        {t('onboarding.path.title', { defaultValue: 'Как настроить — быстро или максимально?' })}
      </h2>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <PathCard
          icon={Rocket}
          title={t('onboarding.path.quick_title', { defaultValue: 'Быстрая настройка' })}
          subtitle={t('onboarding.path.quick_subtitle', {
            defaultValue: '5 минут — и ты внутри портала со своими данными',
          })}
          eta={t('onboarding.path.quick_eta', { defaultValue: '≈ 5 минут' })}
          bullets={[
            t('onboarding.path.quick_bullet_1', {
              defaultValue: 'Базовый профиль салона + тип',
            }),
            t('onboarding.path.quick_bullet_2', {
              defaultValue: 'Подключение Booksy / банка / соцсетей — за 2 клика',
            }),
            t('onboarding.path.quick_bullet_3', {
              defaultValue: 'WOW-разбор данных AI сразу после интеграций',
            }),
            t('onboarding.path.quick_bullet_4', {
              defaultValue: 'Полную настройку можно добавить потом',
            }),
          ]}
          active={value === 'quick'}
          onClick={() => onChange('quick')}
          tone="quick"
        />
        <PathCard
          icon={Sparkles}
          title={t('onboarding.path.full_title', { defaultValue: 'Максимальный старт' })}
          subtitle={t('onboarding.path.full_subtitle', {
            defaultValue: 'Все настройки + импорт мастеров и услуг + расходы + полный AI-разбор',
          })}
          eta={t('onboarding.path.full_eta', { defaultValue: '≈ 20 минут' })}
          bullets={[
            t('onboarding.path.full_bullet_1', {
              defaultValue: 'Всё из быстрой настройки +',
            }),
            t('onboarding.path.full_bullet_2', {
              defaultValue: 'Логотип, адрес, рабочий график, бухгалтерия',
            }),
            t('onboarding.path.full_bullet_3', {
              defaultValue: 'Импорт мастеров с приглашениями + полный каталог услуг',
            }),
            t('onboarding.path.full_bullet_4', {
              defaultValue: 'Расходы по категориям + Полный AI-разбор по 4 темам',
            }),
          ]}
          active={value === 'full'}
          onClick={() => onChange('full')}
          tone="full"
        />
      </div>
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
