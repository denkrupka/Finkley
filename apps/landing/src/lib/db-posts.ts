/**
 * Build-time loader: статьи finsalon.app/media из Supabase media_posts.
 * Используется в /media/index.astro и /media/[slug].astro — мерджится
 * с markdown-постами из content-collection.
 *
 * Anon-ключ — публичный, RLS разрешает SELECT только для draft=false.
 * При отсутствии env-переменных возвращает [] (локальный dev без supabase).
 *
 * Используем прямой REST-запрос вместо @supabase/supabase-js клиента, потому
 * что Astro билдится на Node 20 без нативного WebSocket — RealtimeClient
 * падает при инициализации.
 */

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
  try {
    const url = `${SUPABASE_URL}/rest/v1/media_posts?select=slug,title,description,body_md,cover_url,tags,author,draft,published_at&draft=eq.false&order=published_at.desc`
    const resp = await fetch(url, {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        accept: 'application/json',
      },
    })
    if (!resp.ok) {
      // eslint-disable-next-line no-console
      console.warn(`[media-posts] supabase load failed: ${resp.status} ${resp.statusText}`)
      return []
    }
    const rows = (await resp.json()) as Array<{
      slug: string
      title: string
      description: string
      body_md: string | null
      cover_url: string | null
      tags: string[] | null
      author: string | null
      draft: boolean
      published_at: string
    }>
    return rows.map((row) => ({
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
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[media-posts] supabase load failed:', (e as Error).message)
    return []
  }
}
