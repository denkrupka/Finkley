import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { supabase } from '@/lib/supabase/client'

export type KbSection = 'staff' | 'clients' | 'finance' | 'schedule' | 'operations'

export type KbArticleRow = {
  id: string
  salon_id: string
  section: KbSection
  title: string
  body: string
  sort_order: number
  created_at: string
  updated_at: string
}

export function useKbArticles(salonId: string | undefined) {
  return useQuery<KbArticleRow[]>({
    queryKey: ['kb-articles', salonId],
    queryFn: async () => {
      if (!salonId) return []
      const { data, error } = await supabase
        .from('salon_kb_articles')
        .select('*')
        .eq('salon_id', salonId)
        .order('sort_order', { ascending: true })
      if (error) throw error
      return (data ?? []) as KbArticleRow[]
    },
    enabled: !!salonId,
    staleTime: 60_000,
  })
}

export function useCreateKbArticle(salonId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: { section: KbSection; title: string; body: string }) => {
      if (!salonId) throw new Error('no_salon')
      const { data, error } = await supabase
        .from('salon_kb_articles')
        .insert({
          salon_id: salonId,
          section: input.section,
          title: input.title.trim(),
          body: input.body,
          sort_order: 100,
        })
        .select('*')
        .single()
      if (error) throw error
      return data as KbArticleRow
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['kb-articles', salonId] })
    },
  })
}

export function useUpdateKbArticle(salonId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: {
      id: string
      title?: string
      body?: string
      sort_order?: number
    }) => {
      const { id, ...patch } = input
      const { error } = await supabase.from('salon_kb_articles').update(patch).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['kb-articles', salonId] })
    },
  })
}

export function useDeleteKbArticle(salonId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('salon_kb_articles').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['kb-articles', salonId] })
    },
  })
}

/**
 * Bulk-seed: при первом открытии KB у юзера в БД ноль статей —
 * заливаем стартовый набор. Возвращает количество созданных.
 */
export function useSeedKbArticles(salonId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (
      seed: Array<{ section: KbSection; title: string; body: string; sort_order?: number }>,
    ) => {
      if (!salonId) throw new Error('no_salon')
      const rows = seed.map((s, i) => ({
        salon_id: salonId,
        section: s.section,
        title: s.title.trim(),
        body: s.body,
        sort_order: s.sort_order ?? i * 10,
      }))
      const { data, error } = await supabase.from('salon_kb_articles').insert(rows).select('id')
      if (error) throw error
      return data?.length ?? 0
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['kb-articles', salonId] })
    },
  })
}
