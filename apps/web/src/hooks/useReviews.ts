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

/** Импорт отзывов с Booksy/Google (через будущую edge function reviews-sync).
 *  Пока stub — возвращает 0; UI кнопка показывает «не реализовано». */
export function useReviewsImport(salonId: string | undefined) {
  return useMutation({
    mutationFn: async () => {
      if (!salonId) throw new Error('no_salon')
      // TODO: edge function reviews-sync для скрапинга Booksy + Google Places API
      throw new Error(
        'Импорт отзывов с Booksy/Google пока в разработке. Внутренние отзывы (FlySMS-flow) уже работают.',
      )
    },
  })
}
