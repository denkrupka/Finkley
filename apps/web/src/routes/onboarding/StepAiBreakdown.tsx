import { useQuery } from '@tanstack/react-query'
import {
  AlertTriangle,
  ArrowUp,
  Brain,
  Loader2,
  type LucideIcon,
  MessageSquare,
  Sparkles,
  Star,
  TrendingDown,
  TrendingUp,
  Users,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { supabase } from '@/lib/supabase/client'
import { cn } from '@/lib/utils/cn'
import { renderMarkdownInline } from '@/lib/utils/render-markdown-inline'

export type AiBreakdownTopic = 'services' | 'staff' | 'clients' | 'reviews'

/**
 * T104 — отдельный шаг полной ветки онбординга для каждой из 4 тем
 * AI-разбора. После D1+ (real grounded data) принимает salonId и
 * запрашивает у Claude реальный анализ конкретной темы на основе
 * импортированных visits/staff/services/clients/отзывов.
 *
 * Если salonId не задан или AI упал — fallback на статичные карточки
 * из ru.json (legacy preview).
 */
export function StepAiBreakdown({
  topic,
  salonId,
}: {
  topic: AiBreakdownTopic
  salonId?: string | null
}) {
  const { t, i18n } = useTranslation()

  const ai = useQuery({
    queryKey: ['onboarding-ai-breakdown', topic, salonId ?? null],
    enabled: !!salonId,
    staleTime: Infinity,
    retry: 1,
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke('ai-onboarding-preview', {
        body: {
          salon_id: salonId,
          mode: 'breakdown',
          topic,
          locale: i18n.language.split('-')[0],
        },
      })
      if (error) throw error
      return data as { insights?: Array<{ title: string; body: string; chip?: string }> }
    },
  })

  const heroIcon: Record<AiBreakdownTopic, LucideIcon> = {
    services: TrendingUp,
    staff: Users,
    clients: TrendingDown,
    reviews: Star,
  }

  const heroTitle: Record<AiBreakdownTopic, string> = {
    services: t('onboarding.ai_services.title'),
    staff: t('onboarding.ai_staff.title'),
    clients: t('onboarding.ai_clients.title'),
    reviews: t('onboarding.ai_reviews.title'),
  }

  const heroSubtitle: Record<AiBreakdownTopic, string> = {
    services: t('onboarding.ai_services.subtitle_v2'),
    staff: t('onboarding.ai_staff.subtitle_v2'),
    clients: t('onboarding.ai_clients.subtitle_v2'),
    reviews: t('onboarding.ai_reviews.subtitle_v2'),
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
      {
        icon: Sparkles,
        tone: 'gold',
        title: 'Кого с кем апсейлить',
        body: 'Соберёт пары услуг которые ходят вместе → бандл-цена на ресепшене.',
        chip: '+15% AOV',
      },
    ],
    // Bug 21462c27 (Den 05.06): убрали срез по деньгам (они на этапе
    // онбординга часто сырые из импорта и AI выдаёт «космос»), оставили
    // срез по клиентам: новые vs постоянные, % возвратов, загрузка кресла,
    // лояльность.
    staff: [
      {
        icon: Users,
        tone: 'sage',
        title: 'Новые клиенты на мастере',
        body: 'Сколько новеньких пришло именно к нему за период. База роста клиентской базы.',
      },
      {
        icon: Star,
        tone: 'gold',
        title: '% возвратов',
        body: 'Из клиентов мастера — сколько возвращается. Низкий % → клиент не возвращается после первого визита.',
        chip: 'База лояльности',
      },
      {
        icon: TrendingUp,
        tone: 'navy',
        title: 'Загрузка кресла',
        body: 'Сколько часов из доступных мастер был занят. Кто пустует, у кого окна.',
        chip: '+10% часов',
      },
      {
        icon: AlertTriangle,
        tone: 'amber',
        title: 'Свои vs салона',
        body: 'Клиент привязан к мастеру или к салону. Критично для удержания мастеров.',
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
        chip: 'Вернуть клиента 5× дешевле, чем найти нового',
      },
      {
        icon: Brain,
        tone: 'navy',
        title: 'Кого теряешь после первого',
        body: 'Главная утечка — 60% новеньких не возвращаются. Где конкретно.',
      },
      {
        icon: Users,
        tone: 'gold',
        title: 'Кто приводит друзей',
        body: 'Топ-адвокаты бренда — им VIP-условия и реферальная программа.',
        chip: 'Органический рост',
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
      {
        icon: Star,
        tone: 'navy',
        title: 'Профиль каждого мастера',
        body: 'Кого хвалят персонально — выведет в карточку Booksy/Instagram.',
        chip: 'Бренд мастера',
      },
    ],
  }

  const HeroIcon = heroIcon[topic]
  const staticCards = cards[topic]

  // T228 — гарантируем РОВНО 4 карточки. Если AI вернул меньше — добиваем
  // статичными (из локального списка). Если больше — слайсим до 4.
  // Это чтобы UI всегда выглядел консистентно: 2×2 grid с инсайтами,
  // а не «иногда 3, иногда 4».
  const aiInsightsRaw = ai.data?.insights ?? null
  const merged: Array<{ title: string; body: string; chip?: string }> = []
  if (aiInsightsRaw && aiInsightsRaw.length > 0) {
    for (const c of aiInsightsRaw.slice(0, 4)) {
      merged.push({ title: c.title, body: c.body, chip: c.chip })
    }
    // Если AI вернул < 4 — добиваем из staticCards по позиции.
    for (let i = merged.length; i < 4; i += 1) {
      const s = staticCards[i]!
      merged.push({ title: s.title, body: s.body, chip: s.chip })
    }
  }

  return (
    <div className="space-y-3">
      <div>
        <h2 className="text-brand-navy inline-flex items-center gap-2 text-2xl font-bold tracking-tight">
          <HeroIcon className="text-brand-teal-deep size-6" strokeWidth={2} />
          {heroTitle[topic]}
        </h2>
        <p className="text-muted-foreground mt-1 text-sm">{heroSubtitle[topic]}</p>
        {salonId && ai.isLoading ? (
          <p className="text-brand-teal-deep mt-2 text-sm font-semibold">
            {t('onboarding.ai_summary.processing_hint')}
          </p>
        ) : null}
      </div>

      {salonId && ai.isLoading ? (
        <div className="border-brand-teal-deep/30 bg-brand-teal-soft/10 flex items-center gap-3 rounded-xl border border-dashed p-4">
          <Loader2 className="text-brand-teal-deep size-5 animate-spin" strokeWidth={2} />
          <p className="text-muted-foreground text-sm">{t('onboarding.wow.ai_loading')}</p>
        </div>
      ) : merged.length === 4 ? (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {merged.map((c, i) => (
            <BreakdownCard
              key={i}
              icon={staticCards[i]!.icon}
              tone={staticCards[i]!.tone}
              title={c.title}
              body={c.body}
              chip={c.chip}
            />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {staticCards.slice(0, 4).map((c, i) => (
            <BreakdownCard key={i} {...c} />
          ))}
        </div>
      )}
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
        <p className="text-foreground mt-1 text-sm font-bold leading-snug">
          {renderMarkdownInline(title)}
        </p>
      </div>
      <p className="text-muted-foreground text-[12.5px] leading-snug">
        {renderMarkdownInline(body)}
      </p>
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
