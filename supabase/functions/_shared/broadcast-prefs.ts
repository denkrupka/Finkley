/**
 * Серверный helper для чтения salons.broadcast_prefs.
 *
 * Используется в cron edge functions (send-review-request,
 * client-overdue-push) чтобы пропускать каналы, выключенные владельцем
 * салона в UI /marketing → Рассылки.
 */

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'

export type BroadcastKind = 'marketing' | 'visit_reminder' | 'review_request'

export type ChannelPrefs = { email: boolean; sms: boolean }

const DEFAULT: ChannelPrefs = { email: true, sms: true }

/**
 * Возвращает {email, sms} для конкретного типа рассылки. Если поле в БД
 * пустое/невалидное — default true (не ломаем существующее поведение).
 */
export async function getBroadcastChannels(
  admin: SupabaseClient,
  salonId: string,
  kind: BroadcastKind,
): Promise<ChannelPrefs> {
  const { data } = await admin
    .from('salons')
    .select('broadcast_prefs')
    .eq('id', salonId)
    .maybeSingle()
  const prefs = (data as { broadcast_prefs?: Record<string, unknown> } | null)?.broadcast_prefs
  if (!prefs || typeof prefs !== 'object') return DEFAULT
  const v = prefs[kind]
  if (!v || typeof v !== 'object') return DEFAULT
  const obj = v as Record<string, unknown>
  return {
    email: obj.email !== false,
    sms: obj.sms !== false,
  }
}
