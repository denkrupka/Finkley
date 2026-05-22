import { useMutation, useQuery } from '@tanstack/react-query'

import { supabase } from '@/lib/supabase/client'

import type { BroadcastKind } from './useBroadcastPrefs'

export type BroadcastSegment =
  | 'all'
  | 'new'
  | 'regular'
  | 'dormant'
  | { tag: string }
  | { client_ids: string[] }

export type BroadcastSendRequest = {
  segment: BroadcastSegment
  channels: { sms?: boolean; email?: boolean }
  sms_text?: string
  email_subject?: string
  email_body?: string
}

export type BroadcastSendResult = {
  ok: true
  total_in_segment: number
  eligible: number
  sent_sms: number
  sent_email: number
  failed_sms: number
  failed_email: number
  skipped_no_balance: number
  skipped_paused: number
}

export type BroadcastPreviewResult = {
  ok: true
  dry_run: true
  total_in_segment: number
  eligible: number
  can_sms: number
  can_email: number
}

async function invokeBroadcast<T>(salonId: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('marketing-send-broadcast', {
    body: { salon_id: salonId, ...body },
  })
  if (error) {
    const ctx = (error as { context?: Response }).context
    let msg = error.message
    if (ctx && typeof ctx.clone === 'function') {
      try {
        const b = (await ctx.clone().json()) as { error?: string; message?: string }
        const parts = [b?.error, b?.message].filter(Boolean)
        if (parts.length > 0) msg = parts.join(': ')
      } catch {
        /* ignore */
      }
    }
    throw new Error(msg)
  }
  return data as T
}

/**
 * Превью: сколько клиентов попадает в сегмент и сколько из них имеют
 * нужный канал (phone/email). Не шлёт сообщения. Кэш не нужен — мгновенно.
 */
export function useBroadcastPreview(
  salonId: string | undefined,
  segment: BroadcastSegment,
  channels: { sms?: boolean; email?: boolean },
) {
  const channelsKey = `${channels.sms ? '1' : '0'}${channels.email ? '1' : '0'}`
  const segmentKey =
    typeof segment === 'object'
      ? 'tag' in segment
        ? `tag:${segment.tag}`
        : `manual:${segment.client_ids.slice().sort().join(',')}`
      : segment
  return useQuery<BroadcastPreviewResult>({
    queryKey: ['broadcast-preview', salonId, segmentKey, channelsKey],
    enabled: !!salonId && (channels.sms === true || channels.email === true),
    queryFn: () =>
      invokeBroadcast<BroadcastPreviewResult>(salonId!, {
        segment,
        channels,
        sms_text: 'preview',
        email_subject: 'preview',
        email_body: 'preview',
        dry_run: true,
      }),
  })
}

/**
 * Реальная отправка маркетинговой рассылки. Возвращает агрегаты —
 * сколько ушло, сколько skipped по каждой причине.
 */
export function useSendBroadcast(salonId: string | undefined) {
  return useMutation({
    mutationFn: async (input: BroadcastSendRequest): Promise<BroadcastSendResult> => {
      if (!salonId) throw new Error('no_salon')
      return invokeBroadcast<BroadcastSendResult>(
        salonId,
        input as unknown as Record<string, unknown>,
      )
    },
  })
}

/**
 * Тестовая отправка одного сообщения owner-у салона для проверки канала.
 * Использует edge function marketing-test-send.
 */
export function useSendBroadcastTest(salonId: string | undefined) {
  return useMutation({
    mutationFn: async (input: {
      kind: BroadcastKind
      channel: 'sms' | 'email'
      to: string
    }): Promise<{ ok: true; channel: 'sms' | 'email' }> => {
      if (!salonId) throw new Error('no_salon')
      const { data, error } = await supabase.functions.invoke('marketing-test-send', {
        body: {
          salon_id: salonId,
          kind: input.kind,
          channel: input.channel,
          to: input.to,
        },
      })
      if (error) {
        const ctx = (error as { context?: Response }).context
        let msg = error.message
        if (ctx && typeof ctx.clone === 'function') {
          try {
            const b = (await ctx.clone().json()) as {
              error?: string
              reason?: string
              status?: string
              message?: string
            }
            const parts = [b?.error, b?.reason, b?.status, b?.message].filter(Boolean)
            if (parts.length > 0) msg = parts.join(': ')
          } catch {
            /* ignore */
          }
        }
        throw new Error(msg)
      }
      return data as { ok: true; channel: 'sms' | 'email' }
    },
  })
}
