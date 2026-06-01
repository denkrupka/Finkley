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
  /** Контекст из связанных таблиц (только internal-отзывы, у внешних null). */
  client?: { id: string; name: string | null } | null
  staff?: { id: string; full_name: string | null } | null
  visit?: {
    id: string
    visit_at: string
    service_name_snapshot: string | null
  } | null
}

export function useReviews(salonId: string | undefined) {
  return useQuery<ReviewRow[]>({
    queryKey: ['reviews', salonId],
    queryFn: async () => {
      if (!salonId) return []
      // JOIN clients/staff/visits — для internal отзывов нужны имя клиента,
      // мастера, услуга, дата/время. PostgREST embed: select=...,fk(cols)
      const { data, error } = await supabase
        .from('reviews')
        .select(
          '*, client:clients(id, name), staff:staff(id, full_name), visit:visits(id, visit_at, service_name_snapshot)',
        )
        .eq('salon_id', salonId)
        .order('posted_at', { ascending: false })
        .limit(500)
      if (error) throw error
      // PostgREST embed может вернуть массив для single-FK — нормализуем в объект.
      const rows = (data ?? []) as Array<
        ReviewRow & {
          client: ReviewRow['client'] | ReviewRow['client'][]
          staff: ReviewRow['staff'] | ReviewRow['staff'][]
          visit: ReviewRow['visit'] | ReviewRow['visit'][]
        }
      >
      return rows.map((r) => ({
        ...r,
        client: Array.isArray(r.client) ? (r.client[0] ?? null) : r.client,
        staff: Array.isArray(r.staff) ? (r.staff[0] ?? null) : r.staff,
        visit: Array.isArray(r.visit) ? (r.visit[0] ?? null) : r.visit,
      })) as ReviewRow[]
    },
    enabled: !!salonId,
    staleTime: 60_000,
  })
}

/**
 * Кол-во непрочитанных НЕГАТИВНЫХ внешних отзывов (Booksy/Google rating < 5,
 * read_at IS NULL). Legacy hook — оставлен для backwards-compat.
 */
export function useUnreadNegativeReviewsCount(salonId: string | undefined) {
  return useQuery<number>({
    queryKey: ['reviews-unread-negative-count', salonId],
    queryFn: async () => {
      if (!salonId) return 0
      const { count, error } = await supabase
        .from('reviews')
        .select('id', { count: 'exact', head: true })
        .eq('salon_id', salonId)
        .neq('source', 'internal')
        .lt('rating', 5)
        .is('read_at', null)
      if (error) throw error
      return count ?? 0
    },
    enabled: !!salonId,
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  })
}

/**
 * Counts непрочитанных отзывов разделённые по source (internal vs external).
 * Используется для badges на:
 *   - Sidebar «Отчёты» (total = internal + external)
 *   - Tab «Отзывы» внутри Reports (total)
 *   - Sub-tab «Внутренние» (internal) / «С Booksy и Google» (external)
 *
 * Запрос один — SELECT с group by source через PostgREST не работает, поэтому
 * тянем все непрочитанные id + source, считаем на клиенте.
 */
export function useUnreadReviewsBySource(salonId: string | undefined) {
  return useQuery<{ internal: number; external: number; total: number }>({
    queryKey: ['reviews-unread-by-source', salonId],
    queryFn: async () => {
      if (!salonId) return { internal: 0, external: 0, total: 0 }
      const { data, error } = await supabase
        .from('reviews')
        .select('id, source')
        .eq('salon_id', salonId)
        .is('read_at', null)
      if (error) throw error
      let internal = 0
      let external = 0
      for (const r of (data ?? []) as Array<{ source: string }>) {
        if (r.source === 'internal') internal++
        else external++
      }
      return { internal, external, total: internal + external }
    },
    enabled: !!salonId,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
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
