import { useQuery } from '@tanstack/react-query'
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Banknote,
  Building2,
  Calendar,
  CheckCircle2,
  FileText,
  Loader2,
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

import { supabase } from '@/lib/supabase/client'
import { cn } from '@/lib/utils/cn'

import type { OnboardingIntegration } from './OnboardingPage'

const ICON_MAP: Record<string, LucideIcon> = {
  staff: Users,
  services: Wrench,
  bookings: Calendar,
  banking: Banknote,
  social: MessageSquare,
  google: Star,
  company: Building2,
  general: Sparkles,
}

type AiInsight = {
  icon: string
  title: string
  body: string
}

const AI_TONES = ['sage', 'navy', 'gold', 'amber'] as const

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
  salonType,
  country,
  salonId,
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
  // T125 #2 — для AI prompt
  salonType?: string
  country?: string
  /** D1+ — early-created salon ID. Если есть, edge function подгружает
   *  реальные visits/staff/services из БД для grounding AI. */
  salonId?: string | null
}) {
  const { t, i18n } = useTranslation()

  const aiPreview = useQuery({
    // D1+ — queryKey включает salonId; если салон создан между mount'ами
    // (например, юзер вернулся назад и заполнил step1) — перезапрашиваем
    // с реальными данными.
    queryKey: ['onboarding-ai-preview', salonId ?? null],
    queryFn: async (): Promise<{ insights: AiInsight[] }> => {
      const { data, error } = await supabase.functions.invoke('ai-onboarding-preview', {
        body: {
          salon_type: salonType,
          country,
          integrations: selectedIntegrations,
          masters_count: staffCount,
          services_count: servicesCount,
          has_google_place: hasGooglePlace,
          has_nip: hasNip,
          company_name: companyName || null,
          ocr_visits_count: ocrVisitsCount,
          locale: i18n.language.split('-')[0],
          salon_id: salonId ?? undefined,
        },
      })
      if (error) throw error
      const result = data as { insights?: AiInsight[] } | null
      return { insights: result?.insights ?? [] }
    },
    retry: 1,
    staleTime: Infinity,
  })

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
      eyebrow: t('onboarding.wow.real_staff_eyebrow'),
      title: t('onboarding.wow.real_staff_title', { count: staffCount }),
      body: t('onboarding.wow.real_staff_body'),
      chip: t('onboarding.wow.real_staff_chip'),
    })
  }

  if (servicesCount > 0) {
    cards.push({
      icon: Wrench,
      tone: 'amber',
      eyebrow: t('onboarding.wow.real_services_eyebrow'),
      title: t('onboarding.wow.real_services_title', { count: servicesCount }),
      body: t('onboarding.wow.real_services_body'),
      chip: t('onboarding.wow.chip_margin'),
    })
  }

  if (hasBookings) {
    const note = selectedIntegrations.includes('booksy')
      ? t('onboarding.wow.real_booksy_body')
      : ocrVisitsCount > 0
        ? t('onboarding.wow.real_ocr_body', { count: ocrVisitsCount })
        : t('onboarding.wow.real_ical_body')
    cards.push({
      icon: Calendar,
      tone: 'navy',
      eyebrow: t('onboarding.wow.real_bookings_eyebrow'),
      title: t('onboarding.wow.real_bookings_title'),
      body: note,
      chip: t('onboarding.wow.chip_time'),
    })
  }

  if (hasBanking) {
    cards.push({
      icon: Banknote,
      tone: 'navy',
      eyebrow: t('onboarding.wow.real_banking_eyebrow'),
      title: t('onboarding.wow.real_banking_title'),
      body: t('onboarding.wow.real_banking_body'),
      chip: t('onboarding.wow.real_banking_chip'),
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
      eyebrow: t('onboarding.wow.real_inbox_eyebrow'),
      title: t('onboarding.wow.real_inbox_title', { channels: socials.join(' + ') || 'Соцсети' }),
      body: t('onboarding.wow.real_inbox_body'),
    })
  }

  if (hasGooglePlace) {
    cards.push({
      icon: Star,
      tone: 'gold',
      eyebrow: t('onboarding.wow.real_google_eyebrow'),
      title: t('onboarding.wow.real_google_title'),
      body: t('onboarding.wow.real_google_body'),
      chip: t('onboarding.wow.real_google_chip'),
    })
  }

  if (hasNip && companyName) {
    cards.push({
      icon: Building2,
      tone: 'navy',
      eyebrow: t('onboarding.wow.real_company_eyebrow'),
      title: companyName,
      body: t('onboarding.wow.real_company_body'),
    })
  }

  if (selectedIntegrations.includes('telegram')) {
    cards.push({
      icon: Send,
      tone: 'sage',
      eyebrow: t('onboarding.wow.real_tg_eyebrow'),
      title: t('onboarding.wow.real_tg_title'),
      body: t('onboarding.wow.real_tg_body'),
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
      eyebrow: t('onboarding.wow.real_accounting_eyebrow'),
      title: t('onboarding.wow.real_accounting_title', {
        provider:
          accounting === 'ksef' ? 'KSeF' : (accounting ?? '').replace(/^./, (c) => c.toUpperCase()),
      }),
      body: t('onboarding.wow.real_accounting_body'),
    })
  }

  // ─── Fallback карточки (если ничего не выбрано) ───────────────────────
  if (cards.length === 0) {
    if (full) {
      cards.push({
        icon: TrendingUp,
        tone: 'sage',
        eyebrow: t('onboarding.wow.master_eyebrow'),
        title: t('onboarding.wow.master_title'),
        body: t('onboarding.wow.master_body_v2'),
        chip: t('onboarding.wow.chip_lift'),
      })
      cards.push({
        icon: TrendingDown,
        tone: 'amber',
        eyebrow: t('onboarding.wow.service_eyebrow'),
        title: t('onboarding.wow.service_title'),
        body: t('onboarding.wow.service_body_v2'),
        chip: t('onboarding.wow.chip_margin'),
      })
    } else {
      cards.push({
        icon: Sparkles,
        tone: 'navy',
        eyebrow: t('onboarding.wow.empty_eyebrow'),
        title: t('onboarding.wow.empty_title'),
        body: t('onboarding.wow.empty_body'),
      })
    }
  }

  const integrationCount = selectedIntegrations.length

  return (
    <div className="space-y-3">
      <div>
        <h2 className="text-brand-navy inline-flex items-center gap-2 text-2xl font-bold tracking-tight">
          <Sparkles className="text-brand-teal-deep size-6" strokeWidth={2} />
          {t('onboarding.wow.title')}
        </h2>
        {integrationCount + staffCount + servicesCount > 0 ? (
          <p className="text-muted-foreground mt-1 inline-flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
            <CheckCircle2 className="text-brand-sage-deep size-3.5" strokeWidth={2.2} />
            <span>
              {t('onboarding.wow.real_summary', {
                integrations: integrationCount,
                staff: staffCount,
                services: servicesCount,
              })}
            </span>
          </p>
        ) : null}
      </div>
      {/* T125 #2 — AI-инсайты (loading skeleton, потом реальный результат
          от Claude Haiku 4.5). На ошибке — graceful: показываем только
          rules-based карточки ниже.
          T228 — добиваем до РОВНО 4 AI-карточек из rules-based если AI
          вернул меньше. Это критично для consistent UI: всегда 2×2 grid. */}
      {aiPreview.isLoading ? (
        <div className="border-brand-teal-deep/30 bg-brand-teal-soft/10 flex items-center gap-2 rounded-xl border border-dashed p-3">
          <Loader2 className="text-brand-teal-deep size-4 animate-spin" strokeWidth={2} />
          <p className="text-muted-foreground text-xs">{t('onboarding.wow.ai_loading')}</p>
        </div>
      ) : aiPreview.data?.insights && aiPreview.data.insights.length > 0 ? (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {(() => {
            const aiCards = aiPreview.data.insights.slice(0, 4)
            const padded: Array<{
              key: string
              icon: LucideIcon
              tone: (typeof AI_TONES)[number]
              eyebrow: string
              title: string
              body: string
              chip?: string
            }> = aiCards.map((insight, i) => ({
              key: `ai-${i}`,
              icon: ICON_MAP[insight.icon] ?? Sparkles,
              tone: AI_TONES[i % AI_TONES.length] ?? 'navy',
              eyebrow: t('onboarding.wow.ai_eyebrow'),
              title: insight.title,
              body: insight.body,
            }))
            // Добиваем из rules-based cards если AI вернул < 4
            for (let i = padded.length; i < 4 && i - aiCards.length < cards.length; i += 1) {
              const c = cards[i - aiCards.length]!
              padded.push({ key: `pad-${i}`, ...c })
            }
            return padded.map((c) => (
              <WowCard
                key={c.key}
                icon={c.icon}
                tone={c.tone}
                eyebrow={c.eyebrow}
                title={c.title}
                body={c.body}
                chip={c.chip}
              />
            ))
          })()}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {cards.slice(0, 4).map((c, i) => (
            <WowCard key={i} {...c} />
          ))}
        </div>
      )}
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
