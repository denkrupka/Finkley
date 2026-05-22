import { useMutation, useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'

import { supabase } from '@/lib/supabase/client'

export type Insight = {
  title: string
  body: string
  action_prompt: string
}

export type InsightKind =
  | 'services'
  | 'clients'
  | 'staff'
  | 'competitors_prices'
  | 'competitors_content'
  | 'competitors_rating'

/**
 * AI-инсайты для вкладок /reports. Дёргает edge function ai-report-insights
 * с серииализованным payload отчёта; возвращает массив выводов.
 *
 * Используем useQuery с durable-кэшем (staleTime 10 мин) — AI-вызов
 * стоит денег + пересчёт не нужен на каждый рендер.
 */
export function useReportInsights(
  salonId: string | undefined,
  kind: InsightKind,
  payload: unknown,
  enabled = true,
) {
  const { i18n } = useTranslation()
  const locale = i18n.language?.split('-')[0] ?? 'ru'
  return useQuery<Insight[]>({
    // Локаль в queryKey — переключение языка инвалидирует кэш и перезапросит
    // на новом языке (иначе юзер увидел бы старые RU-инсайты после смены).
    queryKey: ['report-insights', salonId, kind, locale, JSON.stringify(payload ?? null)],
    queryFn: async () => {
      if (!salonId) return []
      const { data, error } = await supabase.functions.invoke('ai-report-insights', {
        body: { salon_id: salonId, kind, payload, locale },
      })
      if (error) throw error
      const result = data as { insights?: Insight[] }
      return result.insights ?? []
    },
    enabled: !!salonId && enabled,
    staleTime: 10 * 60 * 1000, // 10 минут — не пересчитываем чаще
    gcTime: 30 * 60 * 1000,
    retry: 1,
  })
}

/**
 * Manual-refresh — если юзер нажал «Обновить рекомендации». Тот же endpoint
 * но через mutation, чтобы можно было pending-state кнопке показать.
 */
export function useRefreshReportInsights(salonId: string | undefined) {
  const { i18n } = useTranslation()
  const locale = i18n.language?.split('-')[0] ?? 'ru'
  return useMutation({
    mutationFn: async ({ kind, payload }: { kind: InsightKind; payload: unknown }) => {
      if (!salonId) throw new Error('no_salon')
      const { data, error } = await supabase.functions.invoke('ai-report-insights', {
        body: { salon_id: salonId, kind, payload, locale },
      })
      if (error) throw error
      return (data as { insights?: Insight[] }).insights ?? []
    },
  })
}

export type ServiceMatch = {
  our_service: string
  competitors: Array<{
    competitor_id: string
    competitor_service: string
    confidence: 'high' | 'medium' | 'low'
    reason: string
  }>
}

/**
 * AI-матчинг названий услуг между нашим салоном и конкурентами.
 * Возвращает { matches: ServiceMatch[] }. Schema другая — поэтому отдельный хук.
 */
export function useServiceMatchAi(salonId: string | undefined) {
  const { i18n } = useTranslation()
  const locale = i18n.language?.split('-')[0] ?? 'ru'
  return useMutation({
    mutationFn: async (payload: {
      our_services: string[]
      competitors: Array<{ competitor_id: string; services: string[] }>
    }) => {
      if (!salonId) throw new Error('no_salon')
      const { data, error } = await supabase.functions.invoke('ai-report-insights', {
        body: { salon_id: salonId, kind: 'service_match', payload, locale },
      })
      if (error) throw error
      return (data as { matches?: ServiceMatch[] }).matches ?? []
    },
  })
}
