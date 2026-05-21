import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { supabase } from '@/lib/supabase/client'

export type BroadcastKind = 'marketing' | 'visit_reminder' | 'review_request'

export type ChannelPrefs = { email: boolean; sms: boolean }

export type BroadcastPrefs = Record<BroadcastKind, ChannelPrefs>

export const BROADCAST_KINDS: BroadcastKind[] = ['marketing', 'visit_reminder', 'review_request']

export const DEFAULT_BROADCAST_PREFS: BroadcastPrefs = {
  marketing: { email: true, sms: true },
  visit_reminder: { email: true, sms: true },
  review_request: { email: true, sms: true },
}

function normalize(raw: unknown): BroadcastPrefs {
  const out: BroadcastPrefs = { ...DEFAULT_BROADCAST_PREFS }
  if (!raw || typeof raw !== 'object') return out
  const obj = raw as Record<string, unknown>
  for (const k of BROADCAST_KINDS) {
    const v = obj[k]
    if (v && typeof v === 'object') {
      const vv = v as Record<string, unknown>
      out[k] = {
        email: vv.email !== false, // default true
        sms: vv.sms !== false,
      }
    }
  }
  return out
}

export function useBroadcastPrefs(salonId: string | undefined) {
  return useQuery<BroadcastPrefs>({
    queryKey: ['broadcast-prefs', salonId],
    enabled: !!salonId,
    queryFn: async () => {
      if (!salonId) return DEFAULT_BROADCAST_PREFS
      const { data, error } = await supabase
        .from('salons')
        .select('broadcast_prefs')
        .eq('id', salonId)
        .maybeSingle()
      if (error) throw error
      return normalize((data as { broadcast_prefs?: unknown } | null)?.broadcast_prefs)
    },
  })
}

export function useUpdateBroadcastPref(salonId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: {
      kind: BroadcastKind
      channel: 'email' | 'sms'
      enabled: boolean
    }) => {
      if (!salonId) throw new Error('no_salon')
      // Читаем текущие prefs (чтобы не затирать другие kinds), мутируем точечно,
      // пишем обратно. Гонка маловероятна — UI один владелец на табе.
      const { data: cur } = await supabase
        .from('salons')
        .select('broadcast_prefs')
        .eq('id', salonId)
        .maybeSingle()
      const prefs = normalize((cur as { broadcast_prefs?: unknown } | null)?.broadcast_prefs)
      prefs[input.kind] = { ...prefs[input.kind], [input.channel]: input.enabled }
      const { error } = await supabase
        .from('salons')
        .update({ broadcast_prefs: prefs })
        .eq('id', salonId)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['broadcast-prefs', salonId] }),
  })
}
