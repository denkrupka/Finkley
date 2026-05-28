import { Banknote, Brain, Lock, MessageSquare, Target, TrendingUp, Zap } from 'lucide-react'
import { useTranslation } from 'react-i18next'

/**
 * Шаг 0 онбординга — Welcome / sales pitch.
 *
 * Не запрашивает данных. Только продающее введение: благодарность, ключевые
 * выгоды, прямые ответы на боли владельца салона.
 *
 * Все выгоды поданы как «что получит клиент», а не «что мы умеем». CTA
 * под смысл шага — «Начать зарабатывать больше», не нейтральное «Далее».
 */
export function StepWelcome() {
  const { t } = useTranslation()

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-brand-navy text-2xl font-bold tracking-tight sm:text-3xl">
          {t('onboarding.welcome.title', {
            defaultValue: 'Привет, ты сделал важный выбор 👋',
          })}
        </h2>
        <p className="text-muted-foreground mt-3 text-sm leading-relaxed sm:text-[15px]">
          {t('onboarding.welcome.subtitle', {
            defaultValue:
              'Finkley помогает увидеть РЕАЛЬНЫЕ цифры твоего салона — сколько ты зарабатываешь после всех расходов, какие услуги приносят прибыль, а какие тянут вниз. И сразу подсказывает, что менять, чтобы увеличить доход.',
          })}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <BenefitCard
          icon={Zap}
          tone="teal"
          title={t('onboarding.welcome.b1_title', {
            defaultValue: 'Всё в одном месте — конец рутине',
          })}
          body={t('onboarding.welcome.b1_body', {
            defaultValue:
              'Booksy, Фейсбук, Инста, банк, бухгалтерия — больше не нужно лазить по 10 вкладкам. Интегрированно, синхронизировано, обновляется само.',
          })}
        />
        <BenefitCard
          icon={Lock}
          tone="navy"
          title={t('onboarding.welcome.b2_title', {
            defaultValue: 'Твои данные — только твои',
          })}
          body={t('onboarding.welcome.b2_body', {
            defaultValue:
              'Всё зашифровано. Мы физически не имеем доступа к твоей информации. Даже на запрос гос. органов мы не сможем её передать — потому что и сами её не видим.',
          })}
        />
        <BenefitCard
          icon={Banknote}
          tone="sage"
          title={t('onboarding.welcome.b3_title', {
            defaultValue: 'Банк подключается — расходы фиксируются сами',
          })}
          body={t('onboarding.welcome.b3_body', {
            defaultValue:
              'Не нужно вечером вписывать «купила лак за 80» — банк показывает, ты подтверждаешь. Никаких забытых расходов = настоящая картина по деньгам.',
          })}
        />
        <BenefitCard
          icon={TrendingUp}
          tone="gold"
          title={t('onboarding.welcome.b4_title', {
            defaultValue: 'Профильный финансовый отчёт',
          })}
          body={t('onboarding.welcome.b4_body', {
            defaultValue:
              'Сделан финансистами с опытом 200+ салонных проектов. Показывает не «сколько заплатил клиент», а реальную прибыль — в режиме живого времени.',
          })}
        />
        <BenefitCard
          icon={MessageSquare}
          tone="teal"
          title={t('onboarding.welcome.b5_title', {
            defaultValue: 'Все сообщения — в одной ленте',
          })}
          body={t('onboarding.welcome.b5_body', {
            defaultValue:
              'Instagram, Facebook, WhatsApp, Telegram — клиент написал куда угодно, ты увидишь сразу. Никаких пропущенных сообщений = больше записей.',
          })}
        />
        <BenefitCard
          icon={Target}
          tone="navy"
          title={t('onboarding.welcome.b6_title', {
            defaultValue: 'Анализ конкурентов с советами',
          })}
          body={t('onboarding.welcome.b6_body', {
            defaultValue:
              'Их цены, отзывы, сильные и слабые стороны. AI сравнит с тобой и подскажет, где недозарабатываешь и где ты явно лучше — это можно продавать.',
          })}
        />
        <BenefitCard
          icon={Brain}
          tone="sage"
          title={t('onboarding.welcome.b7_title', {
            defaultValue: 'AI-помощник, который знает твой салон',
          })}
          body={t('onboarding.welcome.b7_body', {
            defaultValue:
              'Сам отслеживает показатели, видит провалы и тренды, говорит конкретно что улучшить. Не общие советы — а на основе твоих живых данных.',
          })}
          className="sm:col-span-2"
        />
      </div>

      <p className="text-muted-foreground border-border border-t pt-4 text-center text-sm leading-relaxed">
        {t('onboarding.welcome.footer', {
          defaultValue:
            'Через несколько минут ты увидишь все свои деньги, своих мастеров и своих клиентов в одном месте. И поймёшь, что было скрыто всё это время.',
        })}
      </p>
    </div>
  )
}

function BenefitCard({
  icon: Icon,
  title,
  body,
  tone,
  className,
}: {
  icon: typeof Brain
  title: string
  body: string
  tone: 'teal' | 'navy' | 'sage' | 'gold'
  className?: string
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
    <div
      className={`border-border bg-card shadow-finsm flex items-start gap-3 rounded-xl border p-4 ${className ?? ''}`}
    >
      <div className={`grid size-10 shrink-0 place-items-center rounded-lg ${iconBg}`}>
        <Icon className="size-5" strokeWidth={2} />
      </div>
      <div className="min-w-0">
        <p className="text-foreground text-sm font-bold leading-snug">{title}</p>
        <p className="text-muted-foreground mt-1 text-[12.5px] leading-snug">{body}</p>
      </div>
    </div>
  )
}
