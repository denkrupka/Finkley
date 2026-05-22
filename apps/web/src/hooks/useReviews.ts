import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { supabase } from '@/lib/supabase/client'

export type ReviewSource = 'internal' | 'booksy' | 'google'
export type ReviewVisibility = 'private' | 'public'

export type ReviewRow = {
  id: string
  salon_id: string
  source: ReviewSource
  visibility: ReviewVisibility
  rating: number | null
  body: string | null
  author_name: string | null
  client_id: string | null
  staff_id: string | null
  visit_id: string | null
  external_id: string | null
  external_url: string | null
  read_at: string | null
  posted_at: string
  created_at: string
  reply_text: string | null
  reply_author: string | null
  reply_posted_at: string | null
}

export function useReviews(salonId: string | undefined) {
  return useQuery<ReviewRow[]>({
    queryKey: ['reviews', salonId],
    queryFn: async () => {
      if (!salonId) return []
      const { data, error } = await supabase
        .from('reviews')
        .select('*')
        .eq('salon_id', salonId)
        .order('posted_at', { ascending: false })
        .limit(500)
      if (error) throw error
      return (data ?? []) as ReviewRow[]
    },
    enabled: !!salonId,
    staleTime: 60_000,
  })
}

/** Массово помечает все непрочитанные отзывы салона как прочитанные. */
export function useMarkAllReviewsRead(salonId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (filter?: { source?: 'internal' | 'external' }) => {
      if (!salonId) throw new Error('no_salon')
      let q = supabase
        .from('reviews')
        .update({ read_at: new Date().toISOString() })
        .eq('salon_id', salonId)
        .is('read_at', null)
      if (filter?.source === 'internal') q = q.eq('source', 'internal')
      else if (filter?.source === 'external') q = q.neq('source', 'internal')
      const { error } = await q
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['reviews', salonId] })
    },
  })
}

/** Сохраняет ответ салона на отзыв в БД (reply_text / reply_author / reply_posted_at). */
export function useSaveReviewReply(salonId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: { reviewId: string; text: string; author?: string }) => {
      const { error } = await supabase
        .from('reviews')
        .update({
          reply_text: input.text,
          reply_author: input.author ?? 'Salon',
          reply_posted_at: new Date().toISOString(),
        })
        .eq('id', input.reviewId)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['reviews', salonId] })
    },
  })
}

/** Помечает review как прочитанный (read_at=now()). */
export function useMarkReviewRead(salonId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (reviewId: string) => {
      const { error } = await supabase
        .from('reviews')
        .update({ read_at: new Date().toISOString() })
        .eq('id', reviewId)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['reviews', salonId] })
    },
  })
}

/**
 * Импорт отзывов с Booksy + Google Places.
 * Дёргает edge function reviews-sync с salon_id. Возвращает кол-во импортированных.
 *
 * Требования по env на Supabase: GOOGLE_PLACES_API_KEY (опционально — Google skip
 * если не задано). Salon должен иметь google_place_id и/или booksy_url.
 */
export function useReviewsImport(salonId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (): Promise<number> => {
      if (!salonId) throw new Error('no_salon')
      const { data, error } = await supabase.functions.invoke('reviews-sync', {
        body: { salon_id: salonId },
      })
      if (error) throw error
      return (data as { imported?: number } | null)?.imported ?? 0
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['reviews', salonId] }),
  })
}
