import { useMutation, useQueryClient } from '@tanstack/react-query'

import { supabase } from '@/lib/supabase/client'

export type UpdateSalonInput = {
  id: string
  name?: string
  country_code?: string
  currency?: string
  timezone?: string
  salon_type?: string
  locale?: string
  logo_url?: string | null
  retention_window_days?: number
  churn_window_days?: number
  opening_hours?: Record<string, { open?: string; close?: string; closed?: boolean }>
  /** Гео и публичные ссылки (миграции 20260521000014/20260521000019).
   *  Нужны для FlySMS-flow (google_place_url → 5★ редирект), импорта отзывов
   *  с Booksy/Google и автоподбора конкурентов рядом. */
  google_place_url?: string | null
  google_place_id?: string | null
  booksy_url?: string | null
  address?: string | null
  city?: string | null
  lat?: number | null
  lng?: number | null
  /** Миграция 20260522000002. Соцсети салона — для метрик
   *  контента в Reports → Конкуренты. */
  instagram_url?: string | null
  facebook_url?: string | null
  /** Миграция 20260523000002. Manual overrides Content-метрик
   *  (auto-scrape Meta заблокирован datacenter IP). */
  content_followers?: number | null
  content_posts?: number | null
  content_fb_likes?: number | null
  content_posts_per_month?: number | null
  content_updated_at?: string | null
}

export function useUpdateSalon() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: UpdateSalonInput) => {
      const { id, ...patch } = input
      const { error } = await supabase.from('salons').update(patch).eq('id', id)
      if (error) throw error
      return id
    },
    onSuccess: (id) => {
      qc.invalidateQueries({ queryKey: ['salons'] })
      qc.invalidateQueries({ queryKey: ['salons', 'one', id] })
    },
  })
}

/**
 * Загружает логотип салона в публичный bucket `salon-logos` и возвращает
 * public URL — он сохраняется в `salons.logo_url` обычным `useUpdateSalon`.
 *
 * Path: `<salon_id>/<uuid>.<ext>`. RLS на bucket пропускает запись только
 * для owner/admin салона (см. миграцию 20260508000015).
 */
export async function uploadSalonLogo(salonId: string, file: File): Promise<string> {
  const ext = file.name.split('.').pop()?.toLowerCase() || 'png'
  const path = `${salonId}/${crypto.randomUUID()}.${ext}`
  const { error: upErr } = await supabase.storage.from('salon-logos').upload(path, file, {
    upsert: false,
    contentType: file.type || undefined,
    cacheControl: '3600',
  })
  if (upErr) throw upErr
  const { data } = supabase.storage.from('salon-logos').getPublicUrl(path)
  return data.publicUrl
}

/**
 * Soft delete салона (`deleted_at = now()`). Через 30 дней grace period
 * scheduled function зачистит окончательно (TASK-26 в стадии 2).
 */
export function useDeleteSalon() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (salonId: string) => {
      const { error } = await supabase
        .from('salons')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', salonId)
      if (error) throw error
      return salonId
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['salons'] })
    },
  })
}
