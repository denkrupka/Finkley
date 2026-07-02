import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Brain, CheckCircle2, Loader2, Sparkles } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
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
  currency,
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
  /** Валюта салона (ISO 4217) — чтобы AI писал суммы в правильной валюте. */
  currency?: string
  /** D1+ — early-created salon ID для real-data grounding AI. */
  salonId?: string | null
}) {
  const { t, i18n } = useTranslation()

  // Grace-период перед запуском AI: ждём, пока ПЕРВЫЙ visits-синк системы
  // записи реально завершится (salon_integrations.last_sync_at != null; его
  // пишут runTieredSync после полного visits-tier и recordSyncResult при
  // любом успешном booksy-proxy вызове), но не дольше 90с. Раньше был слепой
  // таймер 15с — Booksy-импорт визитов занимает 1-3 минуты, AI получал нули
  // и писал «ни одного визита за три месяца, клиенты не бронируют» (жалоба
  // юзера 02.07). Если систем записи нет — не ждём вообще.
  // Список = BOOKING_SYNC_PROVIDERS в supabase/functions/ai-onboarding-preview
  // (держать в синхроне; общий импорт между Deno и Vite невозможен).
  // treatwell/bookon/fresha исключены осознанно: у них connected+NULL либо
  // не случается, либо вечен (заглушки) и повесил бы ожидание.
  const BOOKING_SYNC_PROVIDERS = ['booksy']
  const [waitTimedOut, setWaitTimedOut] = useState(false)
  useEffect(() => {
    if (!salonId) return
    const id = setTimeout(() => setWaitTimedOut(true), 90_000)
    return () => clearTimeout(id)
  }, [salonId])
  const hasPendingBookingSync = (
    rows: Array<{ provider: string; status: string; last_sync_at: string | null }>,
  ) =>
    rows.some(
      (r) =>
        BOOKING_SYNC_PROVIDERS.includes(r.provider) &&
        r.status === 'connected' &&
        r.last_sync_at == null,
    )
  const syncWait = useQuery({
    queryKey: ['onboarding-ai-sync-wait', salonId ?? null],
    enabled: Boolean(salonId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('salon_integrations_public')
        .select('provider,status,last_sync_at')
        .eq('salon_id', salonId as string)
      if (error) throw error
      return (data ?? []) as Array<{
        provider: string
        status: string
        last_sync_at: string | null
      }>
    },
    // Поллим каждые 4с, пока есть незавершённый синк. После 90с-таймаута
    // grace снимается и AI стартует по частичным данным, но поллинг
    // продолжается реже (10с): когда синк доедет, мы перегенерируем итог
    // (см. эффект ниже) — иначе staleTime:Infinity заморозил бы анализ
    // по огрызку данных навсегда.
    refetchInterval: (query) => {
      const rows = query.state.data
      if (!rows) return 4_000
      if (!hasPendingBookingSync(rows)) return false
      return waitTimedOut ? 10_000 : 4_000
    },
  })
  const syncPending =
    !syncWait.isError && (syncWait.data == null || hasPendingBookingSync(syncWait.data))
  const grace = Boolean(salonId) && !waitTimedOut && syncPending

  // Если AI-запрос ушёл, пока импорт ещё шёл (сработал 90с-таймаут), итог
  // построен по частичным данным. Помечаем это и, когда синк реально доедет,
  // перегенерируем итог один раз — иначе staleTime:Infinity заморозил бы
  // «огрызочный» анализ навсегда.
  const qc = useQueryClient()
  const ranWhilePendingRef = useRef(false)
  const syncPendingRef = useRef(syncPending)
  syncPendingRef.current = syncPending
  useEffect(() => {
    if (syncPending || !ranWhilePendingRef.current) return
    ranWhilePendingRef.current = false
    void qc.invalidateQueries({ queryKey: ['onboarding-ai-summary', salonId ?? null] })
  }, [syncPending, qc, salonId])

  const summary = useQuery({
    queryKey: ['onboarding-ai-summary', salonId ?? null],
    enabled: !grace,
    queryFn: async (): Promise<AiSummary> => {
      if (syncPendingRef.current) ranWhilePendingRef.current = true
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
          currency,
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

  // Bug 4ba1a19f (Елена 05.06): пока идёт grace + первая загрузка AI
  // (могут быть 10–15 секунд), юзер видел пустой экран и думал что
  // окно сломалось. Показываем явный «processing» хинт под заголовком
  // и расширенную плашку с лоадером. При фоновой перегенерации (синк
  // доехал после частичного итога) старый контент остаётся видимым.
  const isBusy = grace || summary.isLoading || (summary.isFetching && !summary.data)

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-brand-navy inline-flex items-center gap-2 text-2xl font-bold tracking-tight">
          <Brain className="text-brand-teal-deep size-6" strokeWidth={2} />
          {t('onboarding.ai_summary.title')}
        </h2>
        <p className="text-muted-foreground mt-1 text-sm">{t('onboarding.ai_summary.subtitle')}</p>
        {isBusy ? (
          <p className="text-brand-teal-deep mt-2 text-sm font-semibold">
            {t('onboarding.ai_summary.processing_hint')}
          </p>
        ) : null}
      </div>

      {isBusy ? (
        <div className="border-brand-teal-deep/30 bg-brand-teal-soft/10 flex items-center gap-3 rounded-xl border border-dashed p-4">
          <Loader2 className="text-brand-teal-deep size-5 animate-spin" strokeWidth={2} />
          <p className="text-muted-foreground text-sm">
            {grace ? t('onboarding.ai_summary.sync_wait_hint') : t('onboarding.ai_summary.loading')}
          </p>
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
