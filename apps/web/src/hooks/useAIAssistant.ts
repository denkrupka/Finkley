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

export type AIToolCall = {
  id: string
  message_id: string
  tool_name: string
  tool_input: Record<string, unknown>
  status: 'success' | 'error' | 'undone'
  result_summary: string | null
  error_message: string | null
  entity_type: string | null
  entity_id: string | null
  undone_at: string | null
  created_at: string
}

export type AISuggestion = { prompt: string; reason?: string }

/** История сообщений последнего conversation для салона. */
export function useAIHistory(salonId: string | undefined, conversationId?: string | null) {
  return useQuery({
    queryKey: ['ai-history', salonId, conversationId ?? 'latest'],
    queryFn: async () => {
      if (!salonId)
        return {
          conversation_id: null,
          messages: [] as AIMessage[],
          tool_calls: [] as AIToolCall[],
        }
      const { data, error } = await supabase.functions.invoke('ai-assistant', {
        body: { action: 'history', salon_id: salonId, conversation_id: conversationId },
      })
      if (error) throw error
      const json = data as {
        ok: boolean
        conversation_id: string | null
        messages: AIMessage[]
        tool_calls?: AIToolCall[]
      }
      return {
        conversation_id: json.conversation_id,
        messages: json.messages ?? [],
        tool_calls: json.tool_calls ?? [],
      }
    },
    enabled: !!salonId,
    staleTime: 5_000,
  })
}

/** Динамические подсказки на основе реальных проблем салона. */
export function useAISuggestions(salonId: string | undefined) {
  const { i18n } = useTranslation()
  const locale = i18n.language?.split('-')[0] ?? 'ru'
  return useQuery({
    queryKey: ['ai-suggestions', salonId, locale],
    queryFn: async () => {
      if (!salonId) return [] as AISuggestion[]
      const { data, error } = await supabase.functions.invoke('ai-assistant', {
        body: { action: 'suggestions', salon_id: salonId, locale },
      })
      if (error) throw error
      const json = data as { ok: boolean; suggestions: AISuggestion[] }
      return json.suggestions ?? []
    },
    enabled: !!salonId,
    staleTime: 60_000,
  })
}

/** Отправить сообщение AI. Возвращает ответ + conversation_id + tool_calls. */
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
        tool_calls?: AIToolCall[]
        error?: string
      }
      if (!json.ok) throw new Error(json.error ?? 'send_failed')
      return json
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ai-history', salonId] })
      // Если AI что-то изменил в БД — инвалидируем смежные кеши.
      qc.invalidateQueries({ queryKey: ['visits'] })
      qc.invalidateQueries({ queryKey: ['expenses'] })
      qc.invalidateQueries({ queryKey: ['clients'] })
      qc.invalidateQueries({ queryKey: ['services'] })
      qc.invalidateQueries({ queryKey: ['cash-transfers'] })
      qc.invalidateQueries({ queryKey: ['register-balances'] })
      qc.invalidateQueries({ queryKey: ['ai-suggestions', salonId] })
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

/** Отменить операцию tool-call (soft-delete созданной сущности). */
export function useUndoToolCall(salonId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (toolCallId: string) => {
      const { data, error } = await supabase.functions.invoke('ai-assistant', {
        body: { action: 'undo_tool_call', tool_call_id: toolCallId },
      })
      if (error) throw error
      const json = data as { ok: boolean; error?: string }
      if (!json.ok) throw new Error(json.error ?? 'undo_failed')
      return json
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ai-history', salonId] })
      qc.invalidateQueries({ queryKey: ['visits'] })
      qc.invalidateQueries({ queryKey: ['expenses'] })
      qc.invalidateQueries({ queryKey: ['clients'] })
      qc.invalidateQueries({ queryKey: ['services'] })
      qc.invalidateQueries({ queryKey: ['cash-transfers'] })
      qc.invalidateQueries({ queryKey: ['register-balances'] })
    },
  })
}
