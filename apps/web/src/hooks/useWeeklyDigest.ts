import { useMutation, useQueryClient } from '@tanstack/react-query'

import { supabase } from '@/lib/supabase/client'
import type { DigestChannel } from '@/hooks/useSalons'

/**
 * Обновляет колонку `weekly_digest_channels` (массив каналов). Параллельно
 * синхронизирует мастер-флажок `weekly_digest_enabled` — true если есть
 * хотя бы один канал. Cron/edge function будут читать channels.
 */
export function useUpdateDigestChannels(salonId: string | undefined, kind: 'weekly' | 'daily') {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (channels: DigestChannel[]) => {
      if (!salonId) throw new Error('no salon')
      const channelsCol = kind === 'weekly' ? 'weekly_digest_channels' : 'daily_digest_channels'
      const enabledCol = kind === 'weekly' ? 'weekly_digest_enabled' : 'daily_digest_enabled'
      const enabled = channels.length > 0
      const { error } = await supabase
        .from('salons')
        .update({ [channelsCol]: channels, [enabledCol]: enabled })
        .eq('id', salonId)
      if (error) {
        const msg = error.message ?? String(error)
        if (/does not exist/i.test(msg)) {
          throw new Error('Миграция БД ещё не применена. Подожди пару минут — деплой в процессе.')
        }
        throw new Error(msg)
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['salons'] })
    },
  })
}

export type SendDigestResponse = {
  ok: boolean
  sent_to: string
  via?: DigestChannel[]
  period?: { start: string; end: string }
}

/**
 * Дёргает edge function send-weekly-digest для текущего салона.
 * Function проверит membership через JWT и пришлёт KPI-письмо на email
 * и/или telegram в зависимости от выбранных каналов. Возвращает массив
 * `via` — реально отправленные каналы (telegram скипается если нет
 * привязки в profiles.telegram_id).
 */
export function useSendWeeklyDigest(salonId: string | undefined) {
  return useMutation({
    mutationFn: async () => {
      if (!salonId) throw new Error('no salon')
      const { data, error } = await supabase.functions.invoke('send-weekly-digest', {
        body: { salon_id: salonId },
      })
      if (error) throw error
      return data as SendDigestResponse
    },
  })
}

/**
 * Опт-аут переключатель `salons.weekly_digest_enabled`.
 * Используется в Settings для отключения дайджеста.
 */
export function useToggleWeeklyDigest(salonId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (enabled: boolean) => {
      if (!salonId) throw new Error('no salon')
      const { error } = await supabase
        .from('salons')
        .update({ weekly_digest_enabled: enabled })
        .eq('id', salonId)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['salons'] })
    },
  })
}

/** Ежедневная сводка — manual send. Возвращает via-список каналов. */
export function useSendDailyDigest(salonId: string | undefined) {
  return useMutation({
    mutationFn: async () => {
      if (!salonId) throw new Error('no salon')
      const { data, error } = await supabase.functions.invoke('send-daily-digest', {
        body: { salon_id: salonId },
      })
      if (error) {
        const ctx = (error as { context?: Response }).context
        if (ctx && typeof ctx.json === 'function') {
          try {
            const body = (await ctx.json()) as { error?: string }
            if (body?.error) throw new Error(body.error)
          } catch (parseErr) {
            if (parseErr instanceof Error && parseErr.message !== error.message) throw parseErr
          }
        }
        throw error
      }
      return data as SendDigestResponse
    },
  })
}

/** Toggle `salons.daily_digest_enabled`. Колонка появилась миграцией
 *  20260513000004 — если она ещё не применилась, показываем понятную ошибку. */
export function useToggleDailyDigest(salonId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (enabled: boolean) => {
      if (!salonId) throw new Error('no salon')
      const { error } = await supabase
        .from('salons')
        .update({ daily_digest_enabled: enabled })
        .eq('id', salonId)
      if (error) {
        // PostgrestError — это plain object, не Error. Конвертируем
        // в настоящий Error чтобы toast не показал "[object Object]".
        const msg = error.message ?? String(error)
        if (/does not exist/i.test(msg)) {
          throw new Error('Миграция БД ещё не применена. Подожди пару минут — деплой в процессе.')
        }
        throw new Error(msg)
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['salons'] })
    },
  })
}
