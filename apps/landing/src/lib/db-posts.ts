/**
 * Build-time loader: статьи finsalon.app/media из Supabase media_posts.
 * Используется в /media/index.astro и /media/[slug].astro — мерджится
 * с markdown-постами из content-collection.
 *
 * Anon-ключ — публичный, RLS разрешает SELECT только для draft=false.
 * При отсутствии env-переменных возвращает [] (локальный dev без supabase).
 */

import { createClient } from '@supabase/supabase-js'

export type DbPost = {
  slug: string
  data: {
    title: string
    description: string
    date: Date
    cover?: string
    tags: string[]
    author: string
    draft: boolean
  }
  body: string
  source: 'db'
}

const SUPABASE_URL = import.meta.env.PUBLIC_SUPABASE_URL ?? import.meta.env.SUPABASE_URL ?? ''
const SUPABASE_ANON_KEY =
  import.meta.env.PUBLIC_SUPABASE_ANON_KEY ?? import.meta.env.SUPABASE_ANON_KEY ?? ''

export async function loadDbPosts(): Promise<DbPost[]> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return []
  }
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data, error } = await supabase
    .from('media_posts')
    .select('slug, title, description, body_md, cover_url, tags, author, draft, published_at')
    .eq('draft', false)
    .order('published_at', { ascending: false })

  if (error) {
    // Не валим билд лендинга — просто логируем.
    // eslint-disable-next-line no-console
    console.warn('[media-posts] supabase load failed:', error.message)
    return []
  }
  return (data ?? []).map((row) => ({
    slug: row.slug,
    data: {
      title: row.title,
      description: row.description,
      date: new Date(row.published_at),
      cover: row.cover_url ?? undefined,
      tags: row.tags ?? [],
      author: row.author ?? 'Finkley',
      draft: false,
    },
    body: row.body_md ?? '',
    source: 'db' as const,
  }))
}
