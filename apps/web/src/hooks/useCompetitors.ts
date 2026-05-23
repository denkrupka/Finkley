import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { supabase } from '@/lib/supabase/client'

export type Competitor = {
  id: string
  salon_id: string
  name: string
  booksy_url: string | null
  google_place_url: string | null
  google_place_id: string | null
  instagram_url: string | null
  facebook_url: string | null
  /** Manual overrides — заменяют auto-scrape когда задано. */
  content_followers: number | null
  content_posts: number | null
  content_fb_likes: number | null
  content_posts_per_month: number | null
  content_updated_at: string | null
  is_auto_picked: boolean
  is_archived: boolean
  created_at: string
  updated_at: string
}

export type CompetitorSnapshot = {
  id: string
  competitor_id: string
  kind: 'price' | 'occupancy' | 'rating' | 'content'
  data: Record<string, unknown>
  source: 'booksy' | 'google' | 'instagram' | 'facebook' | 'manual'
  snapshot_date: string
  created_at: string
}

export type CompetitorMonitoringSettings = {
  salon_id: string
  watched_services: string[]
  auto_pick_enabled: boolean
  auto_pick_radius_m: number
}

export function useCompetitors(salonId: string | undefined) {
  return useQuery<Competitor[]>({
    queryKey: ['competitors', salonId],
    queryFn: async () => {
      if (!salonId) return []
      const { data, error } = await supabase
        .from('competitors')
        .select('*')
        .eq('salon_id', salonId)
        .eq('is_archived', false)
        .order('name', { ascending: true })
      if (error) throw error
      return (data ?? []) as Competitor[]
    },
    enabled: !!salonId,
    staleTime: 60_000,
  })
}

export function useCompetitorSnapshots(
  competitorIds: string[] | undefined,
  kind?: 'price' | 'occupancy' | 'rating' | 'content',
  dateFilter?: { startIso: string; endIso: string } | null,
) {
  const key = competitorIds?.slice().sort().join(',') ?? ''
  return useQuery<CompetitorSnapshot[]>({
    queryKey: [
      'competitor-snapshots',
      key,
      kind ?? 'all',
      dateFilter?.startIso ?? null,
      dateFilter?.endIso ?? null,
    ],
    queryFn: async () => {
      if (!competitorIds || competitorIds.length === 0) return []
      let q = supabase
        .from('competitor_snapshots')
        .select('*')
        .in('competitor_id', competitorIds)
        .order('snapshot_date', { ascending: false })
        .limit(500)
      if (kind) q = q.eq('kind', kind)
      if (dateFilter) {
        q = q.gte('snapshot_date', dateFilter.startIso).lte('snapshot_date', dateFilter.endIso)
      }
      const { data, error } = await q
      if (error) throw error
      return (data ?? []) as CompetitorSnapshot[]
    },
    enabled: !!competitorIds && competitorIds.length > 0,
    staleTime: 5 * 60 * 1000,
  })
}

/**
 * Триггер edge function reviews-sync для импорта отзывов с Booksy/Google.
 * Возвращает кол-во импортированных отзывов.
 */
export function useTriggerReviewsSync(salonId: string | undefined) {
  return useMutation({
    mutationFn: async (): Promise<number> => {
      if (!salonId) throw new Error('no_salon')
      const { data, error } = await supabase.functions.invoke('reviews-sync', {
        body: { salon_id: salonId },
      })
      if (error) throw error
      return (data as { imported?: number } | null)?.imported ?? 0
    },
  })
}

/**
 * Триггер автоподбора конкурентов через Google Places Nearby Search.
 * Возвращает кол-во добавленных конкурентов.
 */
async function extractFunctionErrorCode(error: unknown): Promise<string | undefined> {
  const ctx = (error as { context?: Response } | null)?.context
  if (!ctx || typeof ctx.clone !== 'function') return undefined
  try {
    const body = (await ctx.clone().json()) as { error?: string } | null
    return body?.error ?? undefined
  } catch {
    return undefined
  }
}

export function useDiscoverCompetitors(salonId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (): Promise<number> => {
      if (!salonId) throw new Error('no_salon')
      const { data, error } = await supabase.functions.invoke('competitor-discover', {
        body: { salon_id: salonId },
      })
      if (error) {
        const code = await extractFunctionErrorCode(error)
        const err = new Error(code ?? error.message) as Error & { code?: string }
        err.code = code
        throw err
      }
      return (data as { added?: number } | null)?.added ?? 0
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['competitors', salonId] }),
  })
}

/**
 * Ручной триггер competitor-sync (UI-вызов «Синхронизировать сейчас»).
 * Возвращает (competitors, snapshots) — сколько визитов и сколько собрано.
 * Cron по расписанию делает то же самое раз в день, но юзеру полезно дёргать
 * сразу после добавления конкурентов, чтобы не ждать сутки.
 */
export function useSyncCompetitors(salonId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (): Promise<{ competitors: number; snapshots: number }> => {
      if (!salonId) throw new Error('no_salon')
      const { data, error } = await supabase.functions.invoke('competitor-sync', {
        body: { salon_id: salonId },
      })
      if (error) throw error
      const d = (data ?? {}) as { competitors?: number; snapshots?: number }
      return { competitors: d.competitors ?? 0, snapshots: d.snapshots ?? 0 }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['competitor-snapshots'] })
    },
  })
}

/** Метрики «своего салона» для сравнения с конкурентами (rating + content). */
export type OwnSalonMetrics = {
  rating_avg: number | null
  rating_count: number
  internal_review_count: number
}

export function useOwnSalonMetrics(salonId: string | undefined) {
  return useQuery<OwnSalonMetrics>({
    queryKey: ['own-salon-metrics', salonId],
    queryFn: async () => {
      if (!salonId)
        return { rating_avg: null, rating_count: 0, internal_review_count: 0 } as OwnSalonMetrics
      // Берём все отзывы салона; rating_avg считаем по non-null рейтингам.
      const { data, error } = await supabase
        .from('reviews')
        .select('rating,source')
        .eq('salon_id', salonId)
        .limit(2000)
      if (error) throw error
      const rows = (data ?? []) as Array<{ rating: number | null; source: string }>
      const rated = rows.filter((r) => r.rating != null)
      const avg =
        rated.length > 0 ? rated.reduce((s, r) => s + (r.rating as number), 0) / rated.length : null
      return {
        rating_avg: avg != null ? Math.round(avg * 100) / 100 : null,
        rating_count: rated.length,
        internal_review_count: rows.filter((r) => r.source === 'internal').length,
      }
    },
    enabled: !!salonId,
    staleTime: 60_000,
  })
}

/** Content-метрики своего салона (followers/posts/likes/posts_per_month)
 *  собираются competitor-sync cron'ом в own_salon_metrics. Возвращаем
 *  последний snapshot kind='content' (любой source — берём свежий). */
export type OwnSalonContent = {
  followers: number | null
  posts: number | null
  following: number | null
  posts_per_month: number | null
  fb_likes: number | null
  snapshot_date: string | null
  has_data: boolean
}

/** Booksy aggregate rating своего салона из own_salon_metrics. */
export function useOwnSalonBooksyRating(salonId: string | undefined) {
  return useQuery<{ rating: number; count: number } | null>({
    queryKey: ['own-salon-booksy-rating', salonId],
    enabled: !!salonId,
    queryFn: async () => {
      if (!salonId) return null
      const { data } = await supabase
        .from('own_salon_metrics')
        .select('data')
        .eq('salon_id', salonId)
        .eq('kind', 'rating')
        .eq('source', 'booksy')
        .order('snapshot_date', { ascending: false })
        .limit(1)
        .maybeSingle()
      const d = (data as { data?: { rating?: number; count?: number } } | null)?.data
      if (!d || d.rating == null || d.count == null) return null
      return { rating: d.rating, count: d.count }
    },
    staleTime: 60_000,
  })
}

/** Occupancy метрики своего салона из own_salon_metrics (kind='occupancy').
 *  Структура: { services: OccupancyService[], total_staff } — та же что у конкурентов. */
export type OwnSalonOccupancyService = {
  name: string
  variant_id?: number
  duration_min: number
  staff_count: number
  free_slots_7d: number
  days_covered: number
}
export function useOwnSalonOccupancy(salonId: string | undefined) {
  return useQuery<{
    services: OwnSalonOccupancyService[]
    total_staff: number
    snapshot_date: string
  } | null>({
    queryKey: ['own-salon-occupancy', salonId],
    enabled: !!salonId,
    queryFn: async () => {
      if (!salonId) return null
      const { data } = await supabase
        .from('own_salon_metrics')
        .select('data, snapshot_date')
        .eq('salon_id', salonId)
        .eq('kind', 'occupancy')
        .eq('source', 'booksy')
        .order('snapshot_date', { ascending: false })
        .limit(1)
        .maybeSingle()
      const row = data as {
        data?: { services?: OwnSalonOccupancyService[]; total_staff?: number }
        snapshot_date?: string
      } | null
      if (!row?.data?.services || row.data.services.length === 0) return null
      return {
        services: row.data.services,
        total_staff: row.data.total_staff ?? 0,
        snapshot_date: row.snapshot_date ?? '',
      }
    },
    staleTime: 60_000,
  })
}

/** Google aggregate rating своего салона из own_salon_metrics.
 *  count = userRatingCount из Google Places API (реальное число отзывов
 *  на Google, а не локально импортированных). */
export function useOwnSalonGoogleRating(salonId: string | undefined) {
  return useQuery<{ rating: number; count: number } | null>({
    queryKey: ['own-salon-google-rating', salonId],
    enabled: !!salonId,
    queryFn: async () => {
      if (!salonId) return null
      const { data } = await supabase
        .from('own_salon_metrics')
        .select('data')
        .eq('salon_id', salonId)
        .eq('kind', 'rating')
        .eq('source', 'google')
        .order('snapshot_date', { ascending: false })
        .limit(1)
        .maybeSingle()
      const d = (data as { data?: { rating?: number; count?: number } } | null)?.data
      if (!d || d.rating == null || d.count == null) return null
      return { rating: d.rating, count: d.count }
    },
    staleTime: 60_000,
  })
}

export function useOwnSalonContent(salonId: string | undefined) {
  return useQuery<OwnSalonContent>({
    queryKey: ['own-salon-content', salonId],
    queryFn: async () => {
      const empty: OwnSalonContent = {
        followers: null,
        posts: null,
        following: null,
        posts_per_month: null,
        fb_likes: null,
        snapshot_date: null,
        has_data: false,
      }
      if (!salonId) return empty
      const { data, error } = await supabase
        .from('own_salon_metrics')
        .select('data, source, snapshot_date')
        .eq('salon_id', salonId)
        .eq('kind', 'content')
        .order('snapshot_date', { ascending: false })
        .limit(2) // оба источника (insta + fb), берём свежие
      if (error) throw error
      const rows = (data ?? []) as Array<{
        data: Record<string, unknown>
        source: string
        snapshot_date: string
      }>
      if (rows.length === 0) return empty
      // Мерджим: одно поле может быть на одном источнике, другое — на другом.
      const merged: OwnSalonContent = { ...empty }
      for (const r of rows) {
        const d = r.data
        if (merged.followers == null && typeof d.followers === 'number')
          merged.followers = d.followers
        if (merged.posts == null && typeof d.posts === 'number') merged.posts = d.posts
        if (merged.following == null && typeof d.following === 'number')
          merged.following = d.following
        if (merged.posts_per_month == null && typeof d.posts_per_month === 'number')
          merged.posts_per_month = d.posts_per_month
        if (merged.fb_likes == null && typeof d.fb_likes === 'number') merged.fb_likes = d.fb_likes
        if (!merged.snapshot_date) merged.snapshot_date = r.snapshot_date
      }
      merged.has_data =
        merged.followers != null ||
        merged.posts != null ||
        merged.fb_likes != null ||
        merged.posts_per_month != null
      return merged
    },
    enabled: !!salonId,
    staleTime: 60_000,
  })
}

export function useCompetitorSettings(salonId: string | undefined) {
  return useQuery<CompetitorMonitoringSettings | null>({
    queryKey: ['competitor-settings', salonId],
    queryFn: async () => {
      if (!salonId) return null
      const { data } = await supabase
        .from('competitor_monitoring_settings')
        .select('*')
        .eq('salon_id', salonId)
        .maybeSingle()
      return (data as CompetitorMonitoringSettings | null) ?? null
    },
    enabled: !!salonId,
  })
}

export function useCreateCompetitor(salonId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (
      input: Partial<
        Pick<
          Competitor,
          | 'name'
          | 'booksy_url'
          | 'google_place_url'
          | 'google_place_id'
          | 'instagram_url'
          | 'facebook_url'
        >
      >,
    ) => {
      if (!salonId) throw new Error('no_salon')
      if (!input.name?.trim()) throw new Error('name_required')
      const { error } = await supabase.from('competitors').insert({ salon_id: salonId, ...input })
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['competitors', salonId] }),
  })
}

export function useUpdateCompetitor(salonId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: { id: string } & Partial<Competitor>) => {
      const { id, ...patch } = input
      const { error } = await supabase.from('competitors').update(patch).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['competitors', salonId] }),
  })
}

export function useUpsertCompetitorSettings(salonId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (patch: Partial<CompetitorMonitoringSettings>) => {
      if (!salonId) throw new Error('no_salon')
      const { error } = await supabase
        .from('competitor_monitoring_settings')
        .upsert({ salon_id: salonId, ...patch }, { onConflict: 'salon_id' })
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['competitor-settings', salonId] }),
  })
}
