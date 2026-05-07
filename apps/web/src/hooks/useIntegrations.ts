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
  sync_interval_minutes: number
}

/** Доступные интервалы авто-синхронизации Booksy (минуты). */
export const BOOKSY_SYNC_INTERVAL_OPTIONS: { value: number; label_key: string }[] = [
  { value: 2, label_key: 'integrations.interval.2min' },
  { value: 5, label_key: 'integrations.interval.5min' },
  { value: 10, label_key: 'integrations.interval.10min' },
  { value: 20, label_key: 'integrations.interval.20min' },
  { value: 30, label_key: 'integrations.interval.30min' },
  { value: 60, label_key: 'integrations.interval.1h' },
  { value: 240, label_key: 'integrations.interval.4h' },
  { value: 720, label_key: 'integrations.interval.12h' },
  { value: 1440, label_key: 'integrations.interval.24h' },
]

type BooksyResponse<T> = {
  ok?: boolean
  error?: string
  reason?: string
  message?: string
} & T

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

function unpack<T>(data: BooksyResponse<T>): T {
  if (!data.ok) {
    // Возвращаем error code (request_blocked / invalid_credentials / rate_limited)
    // — UI сама форматирует через i18n.
    throw new Error(data.error ?? data.message ?? 'unknown_error')
  }
  return data
}

/** Login на Booksy: фронт решил hCaptcha, шлём токен в proxy. */
export function useBooksyLogin(salonId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: { email: string; password: string; captchaToken: string }) => {
      if (!salonId) throw new Error('no salon')
      const { data, error } = await supabase.functions.invoke('booksy-proxy', {
        body: {
          action: 'login',
          salon_id: salonId,
          email: input.email,
          password: input.password,
          captcha_token: input.captchaToken,
        },
      })
      if (error) {
        // FunctionsHttpError — пробуем достать тело ответа
        type WithCtx = { context?: { json?: () => Promise<unknown> } }
        const ctx = (error as unknown as WithCtx).context
        if (ctx?.json) {
          try {
            const body = (await ctx.json()) as BooksyResponse<unknown>
            throw new Error(body.error ?? body.message ?? error.message)
          } catch (parseErr) {
            if (parseErr instanceof Error && parseErr.message !== error.message) throw parseErr
          }
        }
        throw error
      }
      return unpack(
        data as BooksyResponse<{ business: { id: number; name: string }; account: unknown }>,
      )
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['salon-integrations', salonId] })
    },
  })
}

/** Fallback: юзер ввёл access_token руками (Booksy заблокировал прямой логин). */
export function useBooksyLoginWithToken(salonId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: { accessToken: string }) => {
      if (!salonId) throw new Error('no salon')
      const { data, error } = await supabase.functions.invoke('booksy-proxy', {
        body: {
          action: 'login_with_token',
          salon_id: salonId,
          access_token: input.accessToken,
        },
      })
      if (error) {
        type WithCtx = { context?: { json?: () => Promise<unknown> } }
        const ctx = (error as unknown as WithCtx).context
        if (ctx?.json) {
          try {
            const body = (await ctx.json()) as BooksyResponse<unknown>
            throw new Error(body.error ?? body.message ?? error.message)
          } catch (parseErr) {
            if (parseErr instanceof Error && parseErr.message !== error.message) throw parseErr
          }
        }
        throw error
      }
      return unpack(
        data as BooksyResponse<{ business: { id: number; name: string }; account: unknown }>,
      )
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
        stats?: { staff_synced: number; services_synced: number; visits_synced: number }
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

/** Изменить частоту автосинхронизации Booksy (в минутах). */
export function useUpdateBooksyInterval(salonId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (intervalMinutes: number) => {
      if (!salonId) throw new Error('no salon')
      const { data, error } = await supabase.functions.invoke('booksy-proxy', {
        body: {
          action: 'update_interval',
          salon_id: salonId,
          interval_minutes: intervalMinutes,
        },
      })
      if (error) throw error
      const json = data as { ok?: boolean; error?: string; message?: string }
      if (!json.ok) throw new Error(json.message ?? json.error ?? 'update_failed')
      return intervalMinutes
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['salon-integrations', salonId] })
    },
  })
}

/** Очистить все импортированные визиты (для re-sync с новым форматом). */
export function useClearBooksyVisits(salonId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      if (!salonId) throw new Error('no salon')
      const { data, error } = await supabase.functions.invoke('booksy-proxy', {
        body: { action: 'clear_visits', salon_id: salonId },
      })
      if (error) throw error
      const json = data as { ok?: boolean; deleted?: number; message?: string; error?: string }
      if (!json.ok) throw new Error(json.message ?? json.error ?? 'clear_failed')
      return json.deleted ?? 0
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['salon-integrations', salonId] })
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
