import { useMutation } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'

import { supabase } from '@/lib/supabase/client'

export type ReviewAiScope = 'single' | 'negative_external' | 'internal_all' | 'internal_unread'

export type SingleExternalContent = {
  situation: string
  root_cause: string
  prevention: string[]
  public_impact: string
  psychological_profile: {
    tone: string
    emotion: string
    temperament: string
    communication_style: string
    service_context: string
  }
  response_strategy: {
    approach: string
    offer: string
    key_hook: string
  }
  suggested_public_reply: string
  suggested_private_message: string
}

export type SingleInternalContent = {
  situation: string
  root_cause: string
  prevention: string[]
  staff_action: string
  retention_strategy: {
    approach: string
    offer: string
    key_hook: string
  }
  psychological_profile: SingleExternalContent['psychological_profile']
  suggested_private_message: string
}

export type BulkContent = {
  overview: string
  patterns: { title: string; description: string }[]
  top_actions: string[]
  segments: { name: string; approach: string }[]
  risk_assessment?: string
}

export type ReviewAiContent = SingleExternalContent | SingleInternalContent | BulkContent

export type ReviewAiResponse =
  | { cached: true; content: ReviewAiContent; model: string; created_at: string }
  | { cached: false; content: ReviewAiContent; model: string }

/**
 * Дёргает edge function reviews-ai-analyze. Используем mutation (не query),
 * потому что:
 *   - юзер сам нажимает кнопку «AI анализ» — не нужен auto-fetch на mount,
 *   - edge function сам делает кеш-чек в БД, так что повторные клики дешёвые,
 *   - результат не reactive по другим данным.
 */
export function useReviewAiAnalyze(salonId: string | undefined) {
  const { i18n } = useTranslation()
  const locale = i18n.language?.split('-')[0] ?? 'ru'
  return useMutation<
    ReviewAiResponse,
    Error,
    { scope: ReviewAiScope; review_id?: string; force?: boolean }
  >({
    mutationFn: async ({ scope, review_id, force }) => {
      if (!salonId) throw new Error('no_salon')
      const { data, error } = await supabase.functions.invoke('reviews-ai-analyze', {
        body: { salon_id: salonId, scope, review_id, locale, force },
      })
      if (error) throw error
      return data as ReviewAiResponse
    },
  })
}
