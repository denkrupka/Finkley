import {
  AlertTriangle,
  ArrowUp,
  Brain,
  type LucideIcon,
  MessageSquare,
  Sparkles,
  Star,
  TrendingDown,
  TrendingUp,
  Users,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { cn } from '@/lib/utils/cn'

export type AiBreakdownTopic = 'services' | 'staff' | 'clients' | 'reviews'

/**
 * T104 — отдельный шаг полной ветки онбординга для каждой из 4 тем
 * AI-разбора (по запросу владельца — «по шагам», а не одной страницей).
 *
 * Каждая страница — превью: что AI уже посчитает после первой недели
 * работы. Реальный анализ доступен на дашборде + в /reports → AI Insights.
 */
export function StepAiBreakdown({ topic }: { topic: AiBreakdownTopic }) {
  const { t } = useTranslation()

  const heroIcon: Record<AiBreakdownTopic, LucideIcon> = {
    services: TrendingUp,
    staff: Users,
    clients: TrendingDown,
    reviews: Star,
  }

  const heroTitle: Record<AiBreakdownTopic, string> = {
    services: t('onboarding.ai_services.title', {
      defaultValue: 'AI-разбор твоих услуг',
    }),
    staff: t('onboarding.ai_staff.title', {
      defaultValue: 'AI-разбор твоих мастеров',
    }),
    clients: t('onboarding.ai_clients.title', {
      defaultValue: 'AI-разбор твоей базы клиентов',
    }),
    reviews: t('onboarding.ai_reviews.title', {
      defaultValue: 'AI-разбор отзывов',
    }),
  }

  const heroSubtitle: Record<AiBreakdownTopic, string> = {
    services: t('onboarding.ai_services.subtitle_v2', {
      defaultValue: 'Что приносит маржу, а на что льёшь время впустую.',
    }),
    staff: t('onboarding.ai_staff.subtitle_v2', {
      defaultValue: 'Кто звезда, кому нужна программа улучшения.',
    }),
    clients: t('onboarding.ai_clients.subtitle_v2', {
      defaultValue: 'RFM-сегменты — кого вернуть, кого превратить в постоянного.',
    }),
    reviews: t('onboarding.ai_reviews.subtitle_v2', {
      defaultValue: 'За что хвалят, что бесит, портрет клиента из соцсетей.',
    }),
  }

  const cards: Record<
    AiBreakdownTopic,
    Array<{
      icon: LucideIcon
      tone: 'gold' | 'sage' | 'navy' | 'amber'
      title: string
      body: string
      chip?: string
    }>
  > = {
    services: [
      {
        icon: TrendingUp,
        tone: 'sage',
        title: 'Топ-3 по марже',
        body: 'После вычета времени мастера и материалов — чаще всего сюрприз.',
        chip: 'Реальная маржа',
      },
      {
        icon: TrendingDown,
        tone: 'amber',
        title: 'Что тянет вниз',
        body: 'Где себестоимость съедает прибыль — с готовой рекомендацией.',
        chip: 'до +25% маржи',
      },
      {
        icon: Brain,
        tone: 'navy',
        title: 'Где поднять цены',
        body: 'Сравнит с конкурентами Google + Booksy и подскажет диапазон.',
      },
    ],
    staff: [
      {
        icon: Star,
        tone: 'gold',
        title: 'Твои звёзды',
        body: 'Высокий retention + ★4.5+ → им маржинальные услуги и больше часов.',
        chip: '+12-18% выручки',
      },
      {
        icon: AlertTriangle,
        tone: 'amber',
        title: 'Кому нужна программа',
        body: 'Низкая загрузка + клиенты не возвращаются — с точкой роста.',
      },
      {
        icon: Users,
        tone: 'sage',
        title: 'Свои vs салона',
        body: 'Индекс лояльности — критично для удержания персонала.',
      },
    ],
    clients: [
      {
        icon: TrendingUp,
        tone: 'sage',
        title: 'Чемпионы и Лояльные',
        body: 'Твоё ядро. Средний чек, любимая услуга, любимый мастер.',
      },
      {
        icon: AlertTriangle,
        tone: 'amber',
        title: 'Под риском и Спящие',
        body: 'AI готовит персонализированную рассылку для возврата.',
        chip: 'Реактивация 5× дешевле',
      },
      {
        icon: Brain,
        tone: 'navy',
        title: 'Кого теряешь после первого',
        body: 'Главный leak — 60% новеньких не возвращаются. Где конкретно.',
      },
    ],
    reviews: [
      {
        icon: MessageSquare,
        tone: 'gold',
        title: 'За что хвалят',
        body: 'Повторяющиеся фразы из 5★ — потом в рекламу.',
      },
      {
        icon: AlertTriangle,
        tone: 'amber',
        title: 'Что бесит',
        body: 'Скрытые жалобы даже в 5★ — с приоритетом что решать.',
      },
      {
        icon: Sparkles,
        tone: 'sage',
        title: '5★ → Google, 1-4★ → тебе',
        body: 'Автозапрос отзыва после визита. Защита репутации.',
        chip: 'Рост в Google',
      },
    ],
  }

  const HeroIcon = heroIcon[topic]
  const topicCards = cards[topic]

  return (
    <div className="space-y-3">
      <div>
        <h2 className="text-brand-navy inline-flex items-center gap-2 text-2xl font-bold tracking-tight">
          <HeroIcon className="text-brand-teal-deep size-6" strokeWidth={2} />
          {heroTitle[topic]}
        </h2>
        <p className="text-muted-foreground mt-1 text-sm">{heroSubtitle[topic]}</p>
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {topicCards.map((c, i) => (
          <BreakdownCard key={i} {...c} />
        ))}
      </div>
    </div>
  )
}

function BreakdownCard({
  icon: Icon,
  tone,
  title,
  body,
  chip,
}: {
  icon: LucideIcon
  tone: 'gold' | 'sage' | 'navy' | 'amber'
  title: string
  body: string
  chip?: string
}) {
  const iconBg =
    tone === 'gold'
      ? 'bg-brand-gold-soft text-brand-gold-deep'
      : tone === 'sage'
        ? 'bg-brand-sage-soft text-brand-sage-deep'
        : tone === 'navy'
          ? 'bg-brand-navy text-white'
          : 'bg-amber-50 text-amber-800'

  const chipBg =
    tone === 'gold'
      ? 'bg-brand-gold-soft text-brand-gold-deep'
      : tone === 'sage'
        ? 'bg-brand-sage-soft text-brand-sage-deep'
        : tone === 'navy'
          ? 'bg-brand-navy/10 text-brand-navy'
          : 'bg-amber-100 text-amber-800'

  return (
    <div className="border-border bg-card shadow-finsm flex flex-col gap-2.5 rounded-xl border p-4">
      <div className="flex items-start gap-3">
        <div className={cn('grid size-10 shrink-0 place-items-center rounded-lg', iconBg)}>
          <Icon className="size-5" strokeWidth={2} />
        </div>
        <p className="text-foreground mt-1 text-sm font-bold leading-snug">{title}</p>
      </div>
      <p className="text-muted-foreground text-[12.5px] leading-snug">{body}</p>
      {chip ? (
        <span
          className={cn(
            'inline-flex w-fit items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold',
            chipBg,
          )}
        >
          <ArrowUp className="size-3" strokeWidth={2.4} />
          {chip}
        </span>
      ) : null}
    </div>
  )
}
