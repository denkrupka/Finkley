import { useEffect, useRef } from 'react'
import { useLocation, useParams } from 'react-router-dom'

import { useAuth } from '@/hooks/useAuth'
import { supabase } from '@/lib/supabase/client'

/**
 * Пишет page_view в tracking_events при смене route внутри SalonLayout.
 *
 * Disk IO mitigation (02.06 alert): дедуплицируем — не пишем тот же
 * normalized path дважды подряд в течение 60 секунд. Это убивает
 * "noise" от re-renders / search-param изменений на той же странице,
 * но сохраняет валидную аналитику переходов.
 *
 * Path нормализуется (UUID/числа → плейсхолдеры), чтобы агрегация в
 * admin tracking считала /salon/.../visits как одну страницу.
 *
 * RLS: пишет только если auth.uid() = user_id (юзер пишет о себе),
 * чтение — super_admin (policy в миграции 20260603000009).
 */
const DEDUPE_WINDOW_MS = 60_000

export function useTrackPageView() {
  const location = useLocation()
  const { salonId } = useParams<{ salonId: string }>()
  const { user } = useAuth()
  const lastInsertRef = useRef<{ path: string; at: number } | null>(null)

  useEffect(() => {
    if (!user?.id) return
    const normalized = location.pathname
      .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, '/:id')
      .replace(/\/\d+/g, '/:n')

    const now = Date.now()
    const last = lastInsertRef.current
    if (last && last.path === normalized && now - last.at < DEDUPE_WINDOW_MS) {
      return
    }
    lastInsertRef.current = { path: normalized, at: now }

    void supabase
      .from('tracking_events')
      .insert({
        user_id: user.id,
        salon_id: salonId ?? null,
        event_type: 'page_view',
        path: normalized,
      })
      .then((res) => {
        if (res.error) console.warn('tracking_events insert failed:', res.error.message)
      })
  }, [location.pathname, salonId, user?.id])
}
