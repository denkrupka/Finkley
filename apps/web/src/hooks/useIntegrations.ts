import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { supabase } from '@/lib/supabase/client'

export type IntegrationProvider = 'booksy' | 'fresha' | 'treatwell' | 'yclients'

export type SalonIntegrationPublic = {
  id: string
  salon_id: string
  provider: IntegrationProvider
  status: 'connected' | 'error' | 'disconnected'
  last_sync_at: string | null
  last_sync_stats: {
    staff_synced?: number
    services_synced?: number
    visits_synced?: number
  } | null
  last_error: string | null
  connected_at: string
  updated_at: string
}

/** Список активных интеграций салона (без credentials). */
export function useSalonIntegrations(salonId: string | undefined) {
  return useQuery<SalonIntegrationPublic[]>({
    queryKey: ['salon-integrations', salonId],
    queryFn: async () => {
      if (!salonId) return []
      const { data, error } = await supabase
        .from('salon_integrations_public')
        .select('*')
        .eq('salon_id', salonId)
      if (error) throw error
      return (data ?? []) as SalonIntegrationPublic[]
    },
    enabled: !!salonId,
    staleTime: 30_000,
  })
}

/** Login на Booksy через capsolver+booksy-proxy. */
export function useBooksyLogin(salonId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: { email: string; password: string }) => {
      if (!salonId) throw new Error('no salon')
      const { data, error } = await supabase.functions.invoke('booksy-proxy', {
        body: { action: 'login', salon_id: salonId, ...input },
      })
      if (error) throw error
      const json = data as {
        ok?: boolean
        error?: string
        message?: string
        business?: { id: number; name: string }
      }
      if (!json.ok) throw new Error(json.message ?? json.error ?? 'login_failed')
      return json
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['salon-integrations', salonId] })
    },
  })
}

/** Триггер синка Booksy (полный — staff/services/visits). */
export function useBooksySync(salonId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      if (!salonId) throw new Error('no salon')
      const { data, error } = await supabase.functions.invoke('booksy-proxy', {
        body: { action: 'sync', salon_id: salonId },
      })
      if (error) throw error
      const json = data as {
        ok?: boolean
        error?: string
        message?: string
        stats?: {
          staff_synced: number
          services_synced: number
          visits_synced: number
        }
      }
      if (!json.ok) throw new Error(json.message ?? json.error ?? 'sync_failed')
      return json.stats!
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['salon-integrations', salonId] })
      qc.invalidateQueries({ queryKey: ['staff', salonId] })
      qc.invalidateQueries({ queryKey: ['services', salonId] })
      qc.invalidateQueries({ queryKey: ['visits', salonId] })
    },
  })
}

/** Отключить интеграцию (удалить credentials). */
export function useDisconnectIntegration(salonId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (provider: IntegrationProvider) => {
      const { error } = await supabase
        .from('salon_integrations')
        .delete()
        .eq('salon_id', salonId!)
        .eq('provider', provider)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['salon-integrations', salonId] })
    },
  })
}
