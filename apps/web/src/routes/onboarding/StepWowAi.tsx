import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Calendar,
  Sparkles,
  Star,
  TrendingDown,
  TrendingUp,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { cn } from '@/lib/utils/cn'

/**
 * Шаг WOW — последний перед созданием салона. Показывает «что AI уже видит»
 * на основе того что юзер дал в интеграциях. До реального submit'a — это
 * структурированное превью: 4 карточки с типовыми инсайтами, которые
 * появятся после первого месяца работы (или сразу — если Booksy/блокнот
 * импортировали историю).
 *
 * Цель — заставить юзера сказать «как я раньше работал без этого». После
 * submit'a реальный AI-анализ доступен в InsightsWidget на дашборде +
 * /reports → AI Insights.
 */
export function StepWowAi({
  hasBookings,
  hasBanking,
  hasSocial,
}: {
  hasBookings: boolean
  hasBanking: boolean
  hasSocial: boolean
}) {
  const { t } = useTranslation()

  // На основе того что подключено — генерим разные текста (имитация:
  // «AI уже знает что в твоём салоне ...»). Реальный AI анализ —
  // ai-report-insights Edge Function, она дёргается после submit'a.

  const cards: Array<{
    icon: typeof Sparkles
    tone: 'gold' | 'sage' | 'navy' | 'amber'
    eyebrow: string
    title: string
    body: string
    chip?: string
  }> = []

  if (hasBookings) {
    cards.push({
      icon: TrendingUp,
      tone: 'sage',
      eyebrow: t('onboarding.wow.master_eyebrow', { defaultValue: 'Топ мастера' }),
      title: t('onboarding.wow.master_title', {
        defaultValue: 'AI определит твоих звёзд и тех, кому нужно расти',
      }),
      body: t('onboarding.wow.master_body', {
        defaultValue:
          'Из визитов Booksy/блокнота AI посчитает выручку на мастера, средний чек, retention клиентов и долю молчунов. Видишь сразу: кто приносит 60% денег и кому стоит дать дополнительное обучение.',
      }),
      chip: t('onboarding.wow.chip_lift', { defaultValue: '+12-18% выручки в среднем' }),
    })
    cards.push({
      icon: TrendingDown,
      tone: 'amber',
      eyebrow: t('onboarding.wow.service_eyebrow', { defaultValue: 'Услуги' }),
      title: t('onboarding.wow.service_title', {
        defaultValue: 'AI найдёт услуги, на которые ты сливаешь время',
      }),
      body: t('onboarding.wow.service_body', {
        defaultValue:
          'Сравнит цену, материалы, время мастера — посчитает реальную маржу на каждую услугу. Подскажет какие поднять в цене, а какие убрать или сделать «акционной».',
      }),
      chip: t('onboarding.wow.chip_margin', { defaultValue: 'до +25% маржи' }),
    })
  }

  if (hasSocial) {
    cards.push({
      icon: Star,
      tone: 'gold',
      eyebrow: t('onboarding.wow.reviews_eyebrow', { defaultValue: 'Отзывы и клиенты' }),
      title: t('onboarding.wow.reviews_title', {
        defaultValue: 'AI разберёт отзывы по полочкам',
      }),
      body: t('onboarding.wow.reviews_body', {
        defaultValue:
          'За что хвалят, что бесит, какие фразы повторяются. Плюс — портрет клиента (возраст, услуги, средний чек) для каждой соцсети. Поймёшь куда лить рекламу.',
      }),
      chip: t('onboarding.wow.chip_review', { defaultValue: '5★ — на Google, 1-4★ — только тебе' }),
    })
  }

  if (hasBanking) {
    cards.push({
      icon: Calendar,
      tone: 'navy',
      eyebrow: t('onboarding.wow.cashflow_eyebrow', { defaultValue: 'Деньги' }),
      title: t('onboarding.wow.cashflow_title', {
        defaultValue: 'Cashflow в режиме live — без ручной вписи',
      }),
      body: t('onboarding.wow.cashflow_body', {
        defaultValue:
          'Списания падают в Расходы сами. AI отметит подозрительные траты (внезапно вырос рекламный бюджет), напомнит про факт-наоборот платежи и просрочки.',
      }),
      chip: t('onboarding.wow.chip_time', { defaultValue: '−5 часов рутины в неделю' }),
    })
  }

  // Если юзер пропустил все интеграции — всё равно дадим 1 generic карточку,
  // чтобы шаг не был пустым.
  if (cards.length === 0) {
    cards.push({
      icon: Sparkles,
      tone: 'navy',
      eyebrow: t('onboarding.wow.empty_eyebrow', { defaultValue: 'AI готов' }),
      title: t('onboarding.wow.empty_title', {
        defaultValue: 'Как только появятся данные — AI начнёт работать',
      }),
      body: t('onboarding.wow.empty_body', {
        defaultValue:
          'Подключи Booksy или импортируй блокнот, и AI сразу даст разбор: кто из мастеров приносит деньги, какие услуги тянут вниз, кого из клиентов вернуть рассылкой.',
      }),
    })
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-brand-navy inline-flex items-center gap-2 text-2xl font-bold tracking-tight sm:text-3xl">
          <Sparkles className="text-brand-teal-deep size-7" strokeWidth={2} />
          {t('onboarding.wow.title', {
            defaultValue: 'AI уже видит, что у тебя происходит',
          })}
        </h2>
        <p className="text-muted-foreground mt-3 text-sm leading-relaxed sm:text-[15px]">
          {t('onboarding.wow.subtitle', {
            defaultValue:
              'Через секунду ты увидишь свой портал — но AI уже посчитал, что именно стоит улучшить. Этот разбор обновляется каждый день автоматически.',
          })}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {cards.map((c, i) => (
          <WowCard key={i} {...c} />
        ))}
      </div>

      <p className="border-border text-muted-foreground border-t pt-4 text-center text-sm leading-relaxed">
        {t('onboarding.wow.footer', {
          defaultValue:
            'Полный разбор появится на дашборде в блоке «AI-помощник видит» — и будет обновляться сам.',
        })}
      </p>
    </div>
  )
}

function WowCard({
  icon: Icon,
  tone,
  eyebrow,
  title,
  body,
  chip,
}: {
  icon: typeof Sparkles
  tone: 'gold' | 'sage' | 'navy' | 'amber'
  eyebrow: string
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
        <div className="min-w-0 flex-1">
          <p className="text-muted-foreground text-[10px] font-semibold uppercase tracking-wider">
            {eyebrow}
          </p>
          <p className="text-foreground mt-0.5 text-sm font-bold leading-snug">{title}</p>
        </div>
      </div>
      <p className="text-muted-foreground text-[12.5px] leading-snug">{body}</p>
      {chip ? (
        <span
          className={cn(
            'inline-flex w-fit items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold',
            chipBg,
          )}
        >
          {chip.includes('+') || chip.includes('up') ? (
            <ArrowUp className="size-3" strokeWidth={2.4} />
          ) : chip.includes('−') ? (
            <ArrowDown className="size-3" strokeWidth={2.4} />
          ) : (
            <AlertTriangle className="size-3" strokeWidth={2.4} />
          )}
          {chip}
        </span>
      ) : null}
    </div>
  )
}
