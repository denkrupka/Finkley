import { supabase } from '@/lib/supabase/client'

/**
 * bug a75ebedf — fire-and-forget трекинг действий пользователя.
 * Записывает в public.user_actions. Никогда не блокирует UI, ошибки
 * не пробрасываются — это аналитика, не критический путь.
 *
 * Использование:
 *   trackUserAction({ kind: 'page_view', target: '/dashboard', salonId })
 *   trackUserAction({ kind: 'click', target: 'btn:add_expense', salonId })
 *   trackUserAction({ kind: 'feature_use', target: 'bank_link', salonId, metadata: { ... } })
 */
export type ActionKind = 'page_view' | 'click' | 'feature_use'

export type TrackInput = {
  kind: ActionKind
  target: string
  salonId?: string | null
  metadata?: Record<string, unknown>
}

// Debounce одинаковых page_view'ов в той же сессии — иначе rerender'ы
// React будут флудить таблицу. 5-секундное окно.
const RECENT_KEY_TTL_MS = 5_000
const recentKeys = new Map<string, number>()

export function trackUserAction(input: TrackInput): void {
  const key = `${input.kind}:${input.target}:${input.salonId ?? ''}`
  const now = Date.now()
  const last = recentKeys.get(key) ?? 0
  if (now - last < RECENT_KEY_TTL_MS) return
  recentKeys.set(key, now)

  // Fire-and-forget — не await
  void (async () => {
    try {
      const { data: sess } = await supabase.auth.getSession()
      const userId = sess.session?.user?.id ?? null
      await supabase.from('user_actions').insert({
        user_id: userId,
        salon_id: input.salonId ?? null,
        action_kind: input.kind,
        target: input.target.slice(0, 200),
        metadata: input.metadata ?? null,
      })
    } catch {
      // analytics не должна ломать UX
    }
  })()
}
