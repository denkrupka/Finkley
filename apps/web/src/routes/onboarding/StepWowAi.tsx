import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Banknote,
  Building2,
  Calendar,
  CheckCircle2,
  FileText,
  type LucideIcon,
  MessageSquare,
  Send,
  Sparkles,
  Star,
  TrendingDown,
  TrendingUp,
  Users,
  Wrench,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { cn } from '@/lib/utils/cn'

import type { OnboardingIntegration } from './OnboardingPage'

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
/**
 * T125 — реальные данные: суммируем что юзер реально дал в онбординге
 * (интеграции, мастера, услуги, NIP, Google place) и показываем конкретные
 * факты + конкретные следующие шаги AI на этих данных.
 */
export function StepWowAi({
  hasBookings,
  hasBanking,
  hasSocial,
  full = false,
  selectedIntegrations = [],
  staffCount = 0,
  servicesCount = 0,
  hasGooglePlace = false,
  hasNip = false,
  companyName = '',
  ocrVisitsCount = 0,
}: {
  hasBookings: boolean
  hasBanking: boolean
  hasSocial: boolean
  /** T83 — расширенный режим для полной ветки онбординга: показываем все
   *  4 темы (услуги/мастера/клиенты/отзывы) с подробным разбором,
   *  независимо от того что подключено. В быстрой ветке (full=false)
   *  карточки появляются только под выбранные интеграции. */
  full?: boolean
  // T125 — реальные данные из state онбординга
  selectedIntegrations?: OnboardingIntegration[]
  staffCount?: number
  servicesCount?: number
  hasGooglePlace?: boolean
  hasNip?: boolean
  companyName?: string
  ocrVisitsCount?: number
}) {
  const { t } = useTranslation()

  // T125 — карточки «AI уже знает» строятся из реальных данных из state.
  // Каждая карточка отражает что-то конкретное что юзер сделал.
  const cards: Array<{
    icon: LucideIcon
    tone: 'gold' | 'sage' | 'navy' | 'amber'
    eyebrow: string
    title: string
    body: string
    chip?: string
  }> = []

  // ─── Реальные карточки на основе данных юзера ─────────────────────────

  if (staffCount > 0) {
    cards.push({
      icon: Users,
      tone: 'sage',
      eyebrow: t('onboarding.wow.real_staff_eyebrow', { defaultValue: 'Команда' }),
      title: t('onboarding.wow.real_staff_title', {
        defaultValue: '{{count}} мастер(ов) в команде',
        count: staffCount,
      }),
      body: t('onboarding.wow.real_staff_body', {
        defaultValue:
          'AI рассчитает выручку, retention и средний чек на каждого. Первые цифры — через 2 недели.',
      }),
      chip: t('onboarding.wow.real_staff_chip', {
        defaultValue: 'Через 14 дней — топ-лист',
      }),
    })
  }

  if (servicesCount > 0) {
    cards.push({
      icon: Wrench,
      tone: 'amber',
      eyebrow: t('onboarding.wow.real_services_eyebrow', { defaultValue: 'Каталог' }),
      title: t('onboarding.wow.real_services_title', {
        defaultValue: '{{count}} услуг(и) в каталоге',
        count: servicesCount,
      }),
      body: t('onboarding.wow.real_services_body', {
        defaultValue:
          'AI найдёт услуги, где себестоимость съедает прибыль, и предложит новую цену.',
      }),
      chip: t('onboarding.wow.chip_margin', { defaultValue: 'до +25% маржи' }),
    })
  }

  if (hasBookings) {
    const note = selectedIntegrations.includes('booksy')
      ? t('onboarding.wow.real_booksy_body', {
          defaultValue:
            'Booksy → клиенты, мастера и история визитов приедут автоматом за 2-5 минут. AI начнёт работать сразу.',
        })
      : ocrVisitsCount > 0
        ? t('onboarding.wow.real_ocr_body', {
            defaultValue:
              '{{count}} визитов из блокнота попадут в портал после создания. AI разнесёт по мастерам.',
            count: ocrVisitsCount,
          })
        : t('onboarding.wow.real_ical_body', {
            defaultValue:
              'iCal-фид для каждого мастера — синхронизация с Google/Apple Calendar мгновенная.',
          })
    cards.push({
      icon: Calendar,
      tone: 'navy',
      eyebrow: t('onboarding.wow.real_bookings_eyebrow', { defaultValue: 'Записи' }),
      title: t('onboarding.wow.real_bookings_title', {
        defaultValue: 'Календарь подключён',
      }),
      body: note,
      chip: t('onboarding.wow.chip_time', { defaultValue: '−5 часов рутины в неделю' }),
    })
  }

  if (hasBanking) {
    cards.push({
      icon: Banknote,
      tone: 'navy',
      eyebrow: t('onboarding.wow.real_banking_eyebrow', { defaultValue: 'Банк' }),
      title: t('onboarding.wow.real_banking_title', {
        defaultValue: 'PSD2-консент — следующий шаг',
      }),
      body: t('onboarding.wow.real_banking_body', {
        defaultValue:
          'После SCA-консента каждое списание автоматом упадёт в «Расходы». AI алертит подозрительные.',
      }),
      chip: t('onboarding.wow.real_banking_chip', { defaultValue: '90 дней без переподключения' }),
    })
  }

  if (hasSocial) {
    const socials: string[] = []
    if (selectedIntegrations.includes('instagram')) socials.push('Instagram')
    if (selectedIntegrations.includes('facebook')) socials.push('Facebook')
    if (selectedIntegrations.includes('telegram')) socials.push('Telegram')
    cards.push({
      icon: MessageSquare,
      tone: 'gold',
      eyebrow: t('onboarding.wow.real_inbox_eyebrow', { defaultValue: 'Inbox' }),
      title: t('onboarding.wow.real_inbox_title', {
        defaultValue: '{{channels}} — в одной ленте',
        channels: socials.join(' + ') || 'Соцсети',
      }),
      body: t('onboarding.wow.real_inbox_body', {
        defaultValue:
          'Все сообщения в одном месте. AI отвечает на типовые вопросы автоматом (цены, расписание).',
      }),
    })
  }

  if (hasGooglePlace) {
    cards.push({
      icon: Star,
      tone: 'gold',
      eyebrow: t('onboarding.wow.real_google_eyebrow', { defaultValue: 'Google профиль' }),
      title: t('onboarding.wow.real_google_title', {
        defaultValue: 'Google Place привязан',
      }),
      body: t('onboarding.wow.real_google_body', {
        defaultValue:
          'AI анализирует отзывы 24/7: за что хвалят, что бесит, портрет клиента. 5★ — автоматом в Google.',
      }),
      chip: t('onboarding.wow.real_google_chip', { defaultValue: 'Защита репутации' }),
    })
  }

  if (hasNip && companyName) {
    cards.push({
      icon: Building2,
      tone: 'navy',
      eyebrow: t('onboarding.wow.real_company_eyebrow', { defaultValue: 'Компания' }),
      title: companyName,
      body: t('onboarding.wow.real_company_body', {
        defaultValue:
          'Реквизиты для фактур готовы. Подключённая бухгалтерия избавит от двойного ввода.',
      }),
    })
  }

  if (selectedIntegrations.includes('telegram')) {
    cards.push({
      icon: Send,
      tone: 'sage',
      eyebrow: t('onboarding.wow.real_tg_eyebrow', { defaultValue: 'Telegram' }),
      title: t('onboarding.wow.real_tg_title', { defaultValue: 'Утренний разбор в 9:00' }),
      body: t('onboarding.wow.real_tg_body', {
        defaultValue: 'Каждое утро — короткий дайджест + критичные алерты прямо в чате.',
      }),
    })
  }

  if (
    selectedIntegrations.includes('wfirma') ||
    selectedIntegrations.includes('ksef') ||
    selectedIntegrations.includes('fakturownia') ||
    selectedIntegrations.includes('ifirma') ||
    selectedIntegrations.includes('infakt')
  ) {
    const accounting = selectedIntegrations.find((x) =>
      ['wfirma', 'ksef', 'fakturownia', 'ifirma', 'infakt'].includes(x),
    )
    cards.push({
      icon: FileText,
      tone: 'amber',
      eyebrow: t('onboarding.wow.real_accounting_eyebrow', { defaultValue: 'Бухгалтерия' }),
      title: t('onboarding.wow.real_accounting_title', {
        defaultValue: '{{provider}} — связка готова',
        provider:
          accounting === 'ksef' ? 'KSeF' : (accounting ?? '').replace(/^./, (c) => c.toUpperCase()),
      }),
      body: t('onboarding.wow.real_accounting_body', {
        defaultValue:
          'AI забирает все фактуры из inbox и автоматически разносит по доходам/расходам.',
      }),
    })
  }

  // ─── Fallback карточки (если ничего не выбрано) ───────────────────────
  if (cards.length === 0) {
    if (full) {
      cards.push({
        icon: TrendingUp,
        tone: 'sage',
        eyebrow: t('onboarding.wow.master_eyebrow', { defaultValue: 'Топ мастера' }),
        title: t('onboarding.wow.master_title', {
          defaultValue: 'AI определит твоих звёзд и тех, кому нужно расти',
        }),
        body: t('onboarding.wow.master_body_v2', {
          defaultValue: 'Выручка, retention, ★ на мастера. Кто звезда, кому учиться.',
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
        body: t('onboarding.wow.service_body_v2', {
          defaultValue: 'Реальная маржа на каждую услугу. Что поднять в цене, что убрать.',
        }),
        chip: t('onboarding.wow.chip_margin', { defaultValue: 'до +25% маржи' }),
      })
    } else {
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
  }

  const integrationCount = selectedIntegrations.length

  return (
    <div className="space-y-3">
      <div>
        <h2 className="text-brand-navy inline-flex items-center gap-2 text-2xl font-bold tracking-tight">
          <Sparkles className="text-brand-teal-deep size-6" strokeWidth={2} />
          {t('onboarding.wow.title', {
            defaultValue: 'AI уже видит, что у тебя происходит',
          })}
        </h2>
        {integrationCount + staffCount + servicesCount > 0 ? (
          <p className="text-muted-foreground mt-1 inline-flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
            <CheckCircle2 className="text-brand-sage-deep size-3.5" strokeWidth={2.2} />
            <span>
              {t('onboarding.wow.real_summary', {
                defaultValue:
                  '{{integrations}} интеграций · {{staff}} мастеров · {{services}} услуг',
                integrations: integrationCount,
                staff: staffCount,
                services: servicesCount,
              })}
            </span>
          </p>
        ) : null}
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {cards.map((c, i) => (
          <WowCard key={i} {...c} />
        ))}
      </div>
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
  icon: LucideIcon
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
