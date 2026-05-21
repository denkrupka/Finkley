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
) {
  const key = competitorIds?.slice().sort().join(',') ?? ''
  return useQuery<CompetitorSnapshot[]>({
    queryKey: ['competitor-snapshots', key, kind ?? 'all'],
    queryFn: async () => {
      if (!competitorIds || competitorIds.length === 0) return []
      let q = supabase
        .from('competitor_snapshots')
        .select('*')
        .in('competitor_id', competitorIds)
        .order('snapshot_date', { ascending: false })
        .limit(200)
      if (kind) q = q.eq('kind', kind)
      const { data, error } = await q
      if (error) throw error
      return (data ?? []) as CompetitorSnapshot[]
    },
    enabled: !!competitorIds && competitorIds.length > 0,
    staleTime: 5 * 60 * 1000,
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
          'name' | 'booksy_url' | 'google_place_url' | 'instagram_url' | 'facebook_url'
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
