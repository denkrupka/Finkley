import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { useAuth } from '@/hooks/useAuth'
import { supabase } from '@/lib/supabase/client'

export type MediaPost = {
  id: string
  slug: string
  title: string
  description: string
  body_md: string
  cover_url: string | null
  tags: string[]
  author: string
  draft: boolean
  published_at: string
  created_by: string | null
  created_at: string
  updated_at: string
}

export function useIsAppAdmin() {
  // userId в queryKey — иначе после logout/login useQuery возвращает
  // прошлый cached результат (false для прежней сессии).
  const { user } = useAuth()
  return useQuery<boolean>({
    queryKey: ['is-app-admin', user?.id ?? 'anon'],
    queryFn: async () => {
      if (!user) return false
      const { data, error } = await supabase
        .from('app_admins')
        .select('user_id')
        .eq('user_id', user.id)
        .maybeSingle()
      if (error) {
        console.warn('[useIsAppAdmin] query error:', error.message)
        return false
      }
      return !!data
    },
    enabled: !!user,
    staleTime: 5 * 60_000,
  })
}

export function useAllMediaPosts() {
  return useQuery<MediaPost[]>({
    queryKey: ['media-posts', 'all'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('media_posts')
        .select('*')
        .order('published_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as MediaPost[]
    },
    staleTime: 30_000,
  })
}

export function useUpsertMediaPost() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: Partial<MediaPost> & { slug: string; title: string }) => {
      const payload = {
        slug: input.slug.trim().toLowerCase(),
        title: input.title.trim(),
        description: input.description?.trim() ?? '',
        body_md: input.body_md ?? '',
        cover_url: input.cover_url ?? null,
        tags: input.tags ?? [],
        author: input.author?.trim() || 'Finkley',
        draft: input.draft ?? true,
        published_at: input.published_at ?? new Date().toISOString(),
      }
      if (input.id) {
        const { data, error } = await supabase
          .from('media_posts')
          .update(payload)
          .eq('id', input.id)
          .select('*')
          .single()
        if (error) throw error
        return data as MediaPost
      }
      const { data, error } = await supabase
        .from('media_posts')
        .insert(payload)
        .select('*')
        .single()
      if (error) throw error
      return data as MediaPost
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['media-posts'] }),
  })
}

export function useDeleteMediaPost() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('media_posts').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['media-posts'] }),
  })
}
