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
    services: t('onboarding.ai_services.subtitle', {
      defaultValue:
        'Что приносит реальную маржу, а на что ты тратишь время впустую. Покажу прямо в первый месяц работы.',
    }),
    staff: t('onboarding.ai_staff.subtitle', {
      defaultValue:
        'Кто из мастеров — твой кормилец, а кому нужна индивидуальная программа улучшения.',
    }),
    clients: t('onboarding.ai_clients.subtitle', {
      defaultValue:
        'Сегментация по 6 RFM-корзинам. Кого вернуть рассылкой, кого превратить в постоянного.',
    }),
    reviews: t('onboarding.ai_reviews.subtitle', {
      defaultValue:
        'За что хвалят, что бесит, какие фразы повторяются. Плюс портрет клиента по соц.сетям.',
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
        title: 'Топ-3 услуги по марже',
        body: 'Не по цене, не по выручке — а после вычета времени мастера и материалов. Чаще всего это не самые дорогие услуги, и это удивляет.',
        chip: 'Реальная маржа, а не «средний чек»',
      },
      {
        icon: TrendingDown,
        tone: 'amber',
        title: 'Услуги, которые тянут вниз',
        body: 'AI покажет где себестоимость съедает прибыль: цена не выросла за 2 года, материал подорожал, время мастера не оплачивается. С готовой рекомендацией.',
        chip: 'до +25% к марже',
      },
      {
        icon: Brain,
        tone: 'navy',
        title: 'Где поднять цены — а где сделать акцию',
        body: 'Сравнит с конкурентами в твоём городе (Google + Booksy) и подскажет конкретный диапазон. «Стрижка женская у конкурентов 80-120 PLN, ты — 70. Можно поднять до 95».',
      },
    ],
    staff: [
      {
        icon: Star,
        tone: 'gold',
        title: 'Твои звёзды — кому давать больше клиентов',
        body: 'Высокая загрузка + высокий retention + ★4.5+. Этих можно ставить на самые маржинальные услуги. AI рекомендует кому добавить часы в график.',
        chip: '+12-18% выручки в среднем',
      },
      {
        icon: AlertTriangle,
        tone: 'amber',
        title: 'Кому нужна программа улучшения',
        body: 'Низкая загрузка + клиенты не возвращаются + жалобы в отзывах. AI даст конкретные точки: «менее 50% клиентов возвращаются после маникюра» — это сигнал.',
      },
      {
        icon: Users,
        tone: 'sage',
        title: 'Кто из мастеров «свои клиенты»',
        body: 'Если мастер уходит, сколько клиентов уйдёт с ним? AI показывает «индекс лояльности к мастеру vs к салону» — критично для удержания персонала.',
      },
    ],
    clients: [
      {
        icon: TrendingUp,
        tone: 'sage',
        title: 'Чемпионы и Лояльные — твоё ядро',
        body: 'Кто приходит часто и недавно. AI покажет средний чек, любимую услугу, любимого мастера. Это люди для VIP-программы и закрытых акций.',
      },
      {
        icon: AlertTriangle,
        tone: 'amber',
        title: 'Под риском и Спящие — кого реактивировать',
        body: 'Раньше ходили регулярно — теперь молчат. AI готовит персонализированную рассылку для каждого: «Привет, Анна! Полгода назад ты делала окрашивание у Леси. Возвращайся — у нас бесплатный уход 1+1».',
        chip: 'Реактивация в 5× дешевле нового клиента',
      },
      {
        icon: Brain,
        tone: 'navy',
        title: 'Кого ты теряешь после первого визита',
        body: 'Главный денежный leak: 60% «новеньких» не возвращаются. AI разбирает по мастерам/услугам — где конкретно проблема (грубо: «после педикюра у Алины 78% не возвращаются — поговори с ней»).',
      },
    ],
    reviews: [
      {
        icon: MessageSquare,
        tone: 'gold',
        title: 'За что тебя хвалят — фразы-триггеры',
        body: 'AI выделит повторяющиеся фразы из 5★ отзывов («чисто», «уютно», «Леся золотые руки»). Эти слова потом используем в рекламе — звучит как от реальных клиентов.',
      },
      {
        icon: AlertTriangle,
        tone: 'amber',
        title: 'Что бесит клиентов — даже когда 5★',
        body: 'Анализ всех отзывов (включая Booksy/Google), не только 1-4★. AI находит скрытые жалобы: «всё хорошо НО долго ждать», «отлично, ХОТЯ дорого». С приоритетом — что решать первым.',
      },
      {
        icon: Sparkles,
        tone: 'sage',
        title: '5★ — на Google, 1-4★ — только тебе',
        body: 'Автозапрос отзыва клиенту после визита. 5★ ведут на форму Google review (твой салон поднимется в выдаче). 1-4★ — во внутренние, никто посторонний не увидит.',
        chip: 'Защита репутации + рост в Google',
      },
    ],
  }

  const HeroIcon = heroIcon[topic]
  const topicCards = cards[topic]

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-brand-navy inline-flex items-center gap-2 text-2xl font-bold tracking-tight sm:text-3xl">
          <HeroIcon className="text-brand-teal-deep size-7" strokeWidth={2} />
          {heroTitle[topic]}
        </h2>
        <p className="text-muted-foreground mt-3 text-sm leading-relaxed sm:text-[15px]">
          {heroSubtitle[topic]}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {topicCards.map((c, i) => (
          <BreakdownCard key={i} {...c} />
        ))}
      </div>

      <p className="border-border text-muted-foreground border-t pt-4 text-center text-xs leading-relaxed">
        {t('onboarding.ai_breakdown.footer', {
          defaultValue:
            'Этот разбор обновляется ежедневно автоматически на дашборде и в /reports → AI Insights. После первой недели работы будет уже на твоих реальных цифрах.',
        })}
      </p>
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
