import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { supabase } from '@/lib/supabase/client'

/** Запись о покупке пакета SMS — pending/paid. */
export type SmsPurchase = {
  id: string
  salon_id: string
  package_size: number
  price_per_sms_grosz: number
  total_grosz: number
  status: 'pending' | 'paid' | 'failed' | 'refunded'
  created_at: string
  paid_at: string | null
}

/** Запись о приватном sender name — pending_payment / pending_smsapi / active / rejected. */
export type SmsSender = {
  id: string
  salon_id: string
  sender_name: string
  status: 'pending_payment' | 'pending_smsapi' | 'active' | 'rejected'
  price_grosz: number
  rejection_reason: string | null
  created_at: string
  paid_at: string | null
  activated_at: string | null
}

/** Поля баланса/паузы/sender на salons (выборка нужна только эти). */
export type SmsSalonStatus = {
  sms_balance: number
  sms_paused: boolean
  sms_active_sender_id: string | null
}

/** Размер пакета → цена за SMS в грошах. Дублирует sms-checkout PACKAGE_PRICES. */
export const SMS_PACKAGES = [
  { size: 10, pricePerSmsGrosz: 60 },
  { size: 30, pricePerSmsGrosz: 58 },
  { size: 50, pricePerSmsGrosz: 56 },
  { size: 100, pricePerSmsGrosz: 54 },
  { size: 300, pricePerSmsGrosz: 52 },
  { size: 500, pricePerSmsGrosz: 50 },
] as const

export const SMS_SENDER_PRICE_GROSZ = 10000

export function useSmsSalonStatus(salonId: string | undefined) {
  return useQuery<SmsSalonStatus | null>({
    queryKey: ['sms-salon-status', salonId],
    enabled: !!salonId,
    queryFn: async () => {
      if (!salonId) return null
      const { data, error } = await supabase
        .from('salons')
        .select('sms_balance, sms_paused, sms_active_sender_id')
        .eq('id', salonId)
        .maybeSingle()
      if (error) throw error
      return (data as SmsSalonStatus | null) ?? null
    },
  })
}

export function useSmsPurchases(salonId: string | undefined) {
  return useQuery<SmsPurchase[]>({
    queryKey: ['sms-purchases', salonId],
    enabled: !!salonId,
    queryFn: async () => {
      if (!salonId) return []
      const { data, error } = await supabase
        .from('salon_sms_purchases')
        .select('*')
        .eq('salon_id', salonId)
        .order('created_at', { ascending: false })
        .limit(20)
      if (error) throw error
      return (data ?? []) as SmsPurchase[]
    },
  })
}

export function useSmsSenders(salonId: string | undefined) {
  return useQuery<SmsSender[]>({
    queryKey: ['sms-senders', salonId],
    enabled: !!salonId,
    queryFn: async () => {
      if (!salonId) return []
      const { data, error } = await supabase
        .from('salon_sms_senders')
        .select('*')
        .eq('salon_id', salonId)
        .neq('status', 'rejected')
        .order('created_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as SmsSender[]
    },
  })
}

/** Owner toggle «Приостановить SMS». */
export function useToggleSmsPaused(salonId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (paused: boolean) => {
      if (!salonId) throw new Error('no_salon')
      const { error } = await supabase
        .from('salons')
        .update({ sms_paused: paused })
        .eq('id', salonId)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sms-salon-status', salonId] }),
  })
}

/** Активный sender — NULL = FINKLEY, иначе FK на salon_sms_senders.id (только status=active). */
export function useSetActiveSender(salonId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (senderId: string | null) => {
      if (!salonId) throw new Error('no_salon')
      const { error } = await supabase
        .from('salons')
        .update({ sms_active_sender_id: senderId })
        .eq('id', salonId)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sms-salon-status', salonId] }),
  })
}

/** Запуск Stripe Checkout для покупки пакета. Открывает window.location.href = url. */
export function useBuySmsPackage(salonId: string | undefined) {
  return useMutation({
    mutationFn: async (packageSize: number): Promise<{ url: string }> => {
      if (!salonId) throw new Error('no_salon')
      const { data, error } = await supabase.functions.invoke('sms-checkout', {
        body: { salon_id: salonId, package_size: packageSize },
      })
      if (error) {
        const ctx = (error as { context?: Response }).context
        let msg = error.message
        if (ctx && typeof ctx.clone === 'function') {
          try {
            const b = (await ctx.clone().json()) as { error?: string }
            msg = b?.error ?? msg
          } catch {
            /* ignore */
          }
        }
        throw new Error(msg)
      }
      return data as { url: string }
    },
  })
}

/** Покупка sender name (Stripe Checkout 100 zł). */
export function useBuySmsSender(salonId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (senderName: string): Promise<{ url: string }> => {
      if (!salonId) throw new Error('no_salon')
      const { data, error } = await supabase.functions.invoke('sms-sender-purchase', {
        body: { salon_id: salonId, sender_name: senderName },
      })
      if (error) {
        const ctx = (error as { context?: Response }).context
        let msg = error.message
        if (ctx && typeof ctx.clone === 'function') {
          try {
            const b = (await ctx.clone().json()) as { error?: string; reason?: string }
            msg = b?.error ? `${b.error}${b.reason ? `:${b.reason}` : ''}` : msg
          } catch {
            /* ignore */
          }
        }
        throw new Error(msg)
      }
      return data as { url: string }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sms-senders', salonId] }),
  })
}
