import { useQuery } from '@tanstack/react-query'
import { Brain, CheckCircle2, Loader2, Sparkles } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { supabase } from '@/lib/supabase/client'
import { renderMarkdownInline } from '@/lib/utils/render-markdown-inline'

import type { OnboardingIntegration } from './OnboardingPage'

/**
 * T144 — финальный AI-шаг онбординга: общий анализ всего что юзер ввёл
 * + конкретные советы как улучшить.
 *
 * Дёргает ai-onboarding-preview с full_summary=true и summary-сообщением
 * вместо отдельных карточек. Локализован, использует Claude Haiku 4.5.
 */
type AiAdvice = {
  title: string
  body: string
  priority: 'high' | 'medium' | 'low'
}

type AiSummary = {
  overview: string
  advice: AiAdvice[]
}

export function StepAiSummary({
  salonType,
  country,
  selectedIntegrations,
  staffCount,
  servicesCount,
  hasGooglePlace,
  hasNip,
  companyName,
  ocrVisitsCount,
  salonId,
}: {
  salonType?: string
  country?: string
  selectedIntegrations?: OnboardingIntegration[]
  staffCount?: number
  servicesCount?: number
  hasGooglePlace?: boolean
  hasNip?: boolean
  companyName?: string
  ocrVisitsCount?: number
  /** D1+ — early-created salon ID для real-data grounding AI. */
  salonId?: string | null
}) {
  const { t, i18n } = useTranslation()

  // Grace-период перед запуском AI: если salonId есть, ждём 15с чтобы
  // фоновые sync'и Booksy/Versum/Wfirma успели импортировать visits/clients/
  // services. Без этого AI получает 0 данных и отвечает по counters, а не
  // по реальным цифрам — запрос юзера 01.06.
  const [grace, setGrace] = useState<boolean>(() => Boolean(salonId))
  useEffect(() => {
    if (!salonId) return
    const id = setTimeout(() => setGrace(false), 15_000)
    return () => clearTimeout(id)
  }, [salonId])

  const summary = useQuery({
    queryKey: ['onboarding-ai-summary', salonId ?? null],
    enabled: !grace,
    queryFn: async (): Promise<AiSummary> => {
      const { data, error } = await supabase.functions.invoke('ai-onboarding-preview', {
        body: {
          salon_type: salonType,
          country,
          integrations: selectedIntegrations ?? [],
          masters_count: staffCount ?? 0,
          services_count: servicesCount ?? 0,
          has_google_place: !!hasGooglePlace,
          has_nip: !!hasNip,
          company_name: companyName || null,
          ocr_visits_count: ocrVisitsCount ?? 0,
          locale: i18n.language.split('-')[0],
          mode: 'full_summary',
          salon_id: salonId ?? undefined,
        },
      })
      if (error) throw error
      const result = data as { overview?: string; advice?: AiAdvice[] } | null
      return {
        overview: result?.overview ?? '',
        advice: result?.advice ?? [],
      }
    },
    retry: 1,
    staleTime: Infinity,
  })

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-brand-navy inline-flex items-center gap-2 text-2xl font-bold tracking-tight">
          <Brain className="text-brand-teal-deep size-6" strokeWidth={2} />
          {t('onboarding.ai_summary.title')}
        </h2>
        <p className="text-muted-foreground mt-1 text-sm">{t('onboarding.ai_summary.subtitle')}</p>
      </div>

      {summary.isLoading ? (
        <div className="border-brand-teal-deep/30 bg-brand-teal-soft/10 flex items-center gap-3 rounded-xl border border-dashed p-4">
          <Loader2 className="text-brand-teal-deep size-5 animate-spin" strokeWidth={2} />
          <p className="text-muted-foreground text-sm">{t('onboarding.ai_summary.loading')}</p>
        </div>
      ) : summary.isError ? (
        <div className="border-border bg-card flex items-start gap-3 rounded-xl border p-4">
          <Sparkles className="text-brand-teal-deep size-5" strokeWidth={2} />
          <p className="text-foreground text-sm">{t('onboarding.ai_summary.fallback')}</p>
        </div>
      ) : (
        <>
          {summary.data?.overview ? (
            <div className="border-brand-teal-deep/40 bg-brand-teal-soft/20 rounded-xl border-2 p-4">
              <p className="text-foreground text-sm leading-relaxed">
                {renderMarkdownInline(summary.data.overview)}
              </p>
            </div>
          ) : null}

          {summary.data?.advice && summary.data.advice.length > 0 ? (
            <div className="flex flex-col gap-2">
              <p className="text-muted-foreground text-[10.5px] font-bold uppercase tracking-wider">
                {t('onboarding.ai_summary.advice_header')}
              </p>
              {summary.data.advice.map((a, i) => (
                <AdviceCard key={i} advice={a} />
              ))}
            </div>
          ) : null}
        </>
      )}
    </div>
  )
}

function AdviceCard({ advice }: { advice: AiAdvice }) {
  const dot =
    advice.priority === 'high'
      ? 'bg-amber-500'
      : advice.priority === 'medium'
        ? 'bg-brand-teal-deep'
        : 'bg-brand-sage'
  return (
    <div className="border-border bg-card flex items-start gap-3 rounded-lg border p-3">
      <CheckCircle2 className="text-brand-teal-deep mt-0.5 size-5 shrink-0" strokeWidth={2} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className={`size-2 shrink-0 rounded-full ${dot}`} aria-hidden />
          <p className="text-foreground text-sm font-bold">{renderMarkdownInline(advice.title)}</p>
        </div>
        <p className="text-muted-foreground mt-0.5 text-xs leading-snug">
          {renderMarkdownInline(advice.body)}
        </p>
      </div>
    </div>
  )
}
