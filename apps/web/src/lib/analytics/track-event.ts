import { supabase } from '@/lib/supabase/client'

/**
 * Fire-and-forget трекинг действий в public.tracking_events.
 *
 * Это тот же поток что useTrackPageView (page_view), но для именованных
 * действий (event_type='action', path=<action key>). В отличие от
 * lib/analytics/track-user-action.ts (таблица user_actions), сюда пишем
 * события, которые читает RPC setup_progress для детекции выполнения задач
 * чек-листа «Настройка Finkley» (например finance_report_generated).
 *
 * RLS (миграция 20260603000009): юзер может вставлять только свои события
 * (with check user_id = auth.uid()). Поэтому всегда подставляем текущего
 * пользователя из сессии. Ошибки не пробрасываем — аналитика не критический
 * путь и не должна ломать UX.
 *
 * Использование:
 *   trackEvent('finance_report_generated', salonId, { format: 'xlsx' })
 */
export async function trackEvent(
  path: string,
  salonId: string | null | undefined,
  metadata?: Record<string, unknown>,
): Promise<void> {
  try {
    const { data: sess } = await supabase.auth.getSession()
    const userId = sess.session?.user?.id ?? null
    if (!userId) return
    const { error } = await supabase.from('tracking_events').insert({
      user_id: userId,
      salon_id: salonId ?? null,
      event_type: 'action',
      path: path.slice(0, 200),
      metadata: metadata ?? {},
    })
    if (error) console.warn('tracking_events insert failed:', error.message)
  } catch {
    // analytics не должна ломать UX
  }
}
