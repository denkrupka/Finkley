import { useEffect } from 'react'
import { useLocation, useParams } from 'react-router-dom'

import { useAuth } from '@/hooks/useAuth'
import { supabase } from '@/lib/supabase/client'

/**
 * Пишет page_view в tracking_events при каждой смене route внутри
 * SalonLayout. Path нормализуется (UUID salonId заменяется на ':salonId'),
 * чтобы агрегация в admin tracking считала /salon/.../visits как одну
 * страницу, а не миллион уникальных.
 *
 * RLS: пишет только если auth.uid() = user_id (юзер пишет о себе),
 * чтение — super_admin (policy в миграции 20260603000009).
 */
export function useTrackPageView() {
  const location = useLocation()
  const { salonId } = useParams<{ salonId: string }>()
  const { user } = useAuth()

  useEffect(() => {
    if (!user?.id) return
    // Нормализуем path — заменяем UUID-сегменты на плейсхолдеры.
    const normalized = location.pathname
      .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, '/:id')
      .replace(/\/\d+/g, '/:n')
    // Write fire-and-forget — не блокируем UI.
    void supabase
      .from('tracking_events')
      .insert({
        user_id: user.id,
        salon_id: salonId ?? null,
        event_type: 'page_view',
        path: normalized,
        metadata: { search: location.search || null },
      })
      .then((res) => {
        if (res.error) console.warn('tracking_events insert failed:', res.error.message)
      })
  }, [location.pathname, location.search, salonId, user?.id])
}
