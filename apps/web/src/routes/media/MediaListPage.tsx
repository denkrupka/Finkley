import { useQuery } from '@tanstack/react-query'
import { ArrowRight, Calendar, Tag } from 'lucide-react'
import { Link } from 'react-router-dom'

import { supabase } from '@/lib/supabase/client'
import { type MediaPost } from '@/hooks/useMediaPosts'

/**
 * /media — публичный список статей блога Finkley. Доступен без авторизации
 * (RLS policy «Public read published media_posts»). Мгновенно отображает
 * новые статьи после save в /admin/media (без перестройки лендинга).
 */
export function MediaListPage() {
  const { data: posts = [], isLoading } = useQuery<MediaPost[]>({
    queryKey: ['media-posts', 'published'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('media_posts')
        .select('*')
        .eq('draft', false)
        .order('published_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as MediaPost[]
    },
    staleTime: 30_000,
  })

  return (
    <div className="bg-background min-h-screen">
      <header className="border-border bg-card border-b">
        <div className="mx-auto max-w-5xl px-5 py-12 sm:px-8">
          <Link to="/" className="text-muted-foreground hover:text-foreground text-xs">
            ← Finkley
          </Link>
          <h1 className="text-brand-navy mt-4 text-4xl font-bold tracking-tight sm:text-5xl">
            Блог Finkley
          </h1>
          <p className="text-muted-foreground mt-3 max-w-2xl text-base">
            Управленческий учёт, маржа, маркетинг и операционка салона красоты — без воды, с
            цифрами.
          </p>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-5 py-12 sm:px-8">
        {isLoading ? (
          <p className="text-muted-foreground text-sm">Загрузка…</p>
        ) : posts.length === 0 ? (
          <p className="text-muted-foreground text-sm">Статей пока нет.</p>
        ) : (
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {posts.map((p) => (
              <Link
                key={p.id}
                to={`/media/${p.slug}`}
                className="border-border bg-card shadow-finsm hover:shadow-finmd group flex flex-col overflow-hidden rounded-lg border transition-shadow"
              >
                {p.cover_url ? (
                  <img
                    src={p.cover_url}
                    alt={p.title}
                    className="aspect-[16/9] w-full object-cover"
                  />
                ) : (
                  <div className="bg-muted/50 aspect-[16/9] w-full" />
                )}
                <div className="flex flex-1 flex-col p-5">
                  <h2 className="text-brand-navy line-clamp-2 text-lg font-bold leading-tight">
                    {p.title}
                  </h2>
                  <p className="text-muted-foreground mt-2 line-clamp-3 text-sm">{p.description}</p>
                  <div className="text-muted-foreground mt-3 flex items-center gap-2 text-xs">
                    <Calendar className="size-3" strokeWidth={2} />
                    {new Date(p.published_at).toLocaleDateString('ru-RU', {
                      day: 'numeric',
                      month: 'long',
                      year: 'numeric',
                    })}
                  </div>
                  {p.tags && p.tags.length > 0 ? (
                    <div className="mt-3 flex flex-wrap gap-1">
                      {p.tags.slice(0, 3).map((tag) => (
                        <span
                          key={tag}
                          className="bg-muted/60 text-muted-foreground inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[10px] font-semibold"
                        >
                          <Tag className="size-2.5" strokeWidth={2} />
                          {tag}
                        </span>
                      ))}
                    </div>
                  ) : null}
                  <div className="text-secondary mt-4 inline-flex items-center gap-1 text-xs font-semibold transition-transform group-hover:translate-x-1">
                    Читать
                    <ArrowRight className="size-3.5" strokeWidth={2} />
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </main>
    </div>
  )
}
