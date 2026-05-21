import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'

import { supabase } from '@/lib/supabase/client'

export type AIRole = 'user' | 'assistant'

export type AIMessage = {
  id: string
  role: AIRole
  content: string
  created_at: string
}

/** История сообщений последнего conversation для салона. */
export function useAIHistory(salonId: string | undefined, conversationId?: string | null) {
  return useQuery({
    queryKey: ['ai-history', salonId, conversationId ?? 'latest'],
    queryFn: async () => {
      if (!salonId) return { conversation_id: null, messages: [] as AIMessage[] }
      const { data, error } = await supabase.functions.invoke('ai-assistant', {
        body: { action: 'history', salon_id: salonId, conversation_id: conversationId },
      })
      if (error) throw error
      const json = data as {
        ok: boolean
        conversation_id: string | null
        messages: AIMessage[]
      }
      return { conversation_id: json.conversation_id, messages: json.messages ?? [] }
    },
    enabled: !!salonId,
    staleTime: 5_000,
  })
}

/** Отправить сообщение AI. Возвращает ответ + conversation_id. */
export function useSendAIMessage(salonId: string | undefined) {
  const qc = useQueryClient()
  const { i18n } = useTranslation()
  const locale = i18n.language?.split('-')[0] ?? 'ru'
  return useMutation({
    mutationFn: async (input: { message: string; conversationId?: string | null }) => {
      if (!salonId) throw new Error('no salon')
      const { data, error } = await supabase.functions.invoke('ai-assistant', {
        body: {
          action: 'send',
          salon_id: salonId,
          conversation_id: input.conversationId,
          message: input.message,
          locale,
        },
      })
      if (error) throw error
      const json = data as {
        ok: boolean
        conversation_id: string
        message: AIMessage
        error?: string
      }
      if (!json.ok) throw new Error(json.error ?? 'send_failed')
      return json
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ai-history', salonId] })
    },
  })
}

/** Создать новый conversation (старая история останется в БД). */
export function useResetAIChat(salonId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      if (!salonId) throw new Error('no salon')
      const { data, error } = await supabase.functions.invoke('ai-assistant', {
        body: { action: 'reset', salon_id: salonId },
      })
      if (error) throw error
      const json = data as { ok: boolean; conversation_id: string }
      return json.conversation_id
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ai-history', salonId] })
    },
  })
}
