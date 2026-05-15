import { useMutation, useQuery } from '@tanstack/react-query'

import { supabase } from '@/lib/supabase/client'

export type Insight = {
  title: string
  body: string
  action_prompt: string
}

export type InsightKind = 'services' | 'clients' | 'staff'

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
  return useQuery<Insight[]>({
    queryKey: ['report-insights', salonId, kind, JSON.stringify(payload ?? null)],
    queryFn: async () => {
      if (!salonId) return []
      const { data, error } = await supabase.functions.invoke('ai-report-insights', {
        body: { salon_id: salonId, kind, payload },
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
  return useMutation({
    mutationFn: async ({ kind, payload }: { kind: InsightKind; payload: unknown }) => {
      if (!salonId) throw new Error('no_salon')
      const { data, error } = await supabase.functions.invoke('ai-report-insights', {
        body: { salon_id: salonId, kind, payload },
      })
      if (error) throw error
      return (data as { insights?: Insight[] }).insights ?? []
    },
  })
}
