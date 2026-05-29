import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, Calendar, Tag } from 'lucide-react'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useParams } from 'react-router-dom'

import { supabase } from '@/lib/supabase/client'
import { type MediaPost } from '@/hooks/useMediaPosts'

/**
 * /media/:slug — публичная страница одной статьи блога. Рендерит body_html
 * (или markdown fallback) напрямую из БД — публикации появляются мгновенно
 * без перестройки лендинга.
 *
 * Также проставляет title + meta description + og теги для индексации Google
 * (для clients-side SPA это работает для bots с JS-render; для Google это
 * норм с 2019 года).
 */
export function MediaArticlePage() {
  const { t } = useTranslation()
  const { slug } = useParams<{ slug: string }>()
  const { data: post, isLoading } = useQuery<MediaPost | null>({
    queryKey: ['media-post', slug],
    queryFn: async () => {
      if (!slug) return null
      const { data, error } = await supabase
        .from('media_posts')
        .select('*')
        .eq('slug', slug)
        .eq('draft', false)
        .maybeSingle()
      if (error) throw error
      return (data as MediaPost | null) ?? null
    },
    enabled: !!slug,
    staleTime: 30_000,
  })

  // SEO meta — на лету
  useEffect(() => {
    if (!post) return
    const prevTitle = document.title
    document.title = post.seo_title ?? post.title

    function setMeta(name: string, content: string, attrName = 'name') {
      let el = document.querySelector(`meta[${attrName}="${name}"]`)
      if (!el) {
        el = document.createElement('meta')
        el.setAttribute(attrName, name)
        document.head.appendChild(el)
      }
      el.setAttribute('content', content)
    }
    setMeta('description', post.seo_description ?? post.description)
    setMeta('keywords', (post.keywords ?? post.tags ?? []).join(', '))
    setMeta('og:title', post.seo_title ?? post.title, 'property')
    setMeta('og:description', post.seo_description ?? post.description, 'property')
    if (post.og_image_url ?? post.cover_url) {
      setMeta('og:image', post.og_image_url ?? post.cover_url ?? '', 'property')
    }
    if (post.canonical_url) {
      let link = document.querySelector('link[rel="canonical"]') as HTMLLinkElement | null
      if (!link) {
        link = document.createElement('link')
        link.setAttribute('rel', 'canonical')
        document.head.appendChild(link)
      }
      link.setAttribute('href', post.canonical_url)
    }

    return () => {
      document.title = prevTitle
    }
  }, [post])

  if (isLoading) {
    return (
      <div className="bg-background flex min-h-screen items-center justify-center">
        <p className="text-muted-foreground text-sm">{t('media.article.loading')}</p>
      </div>
    )
  }
  if (!post) {
    return (
      <div className="bg-background flex min-h-screen flex-col items-center justify-center gap-3 p-8 text-center">
        <h1 className="text-brand-navy text-2xl font-bold">{t('media.article.not_found')}</h1>
        <Link to="/media" className="text-secondary text-sm underline">
          {t('media.article.all_articles_link')}
        </Link>
      </div>
    )
  }

  const html = post.body_html || markdownToHtml(post.body_md ?? '')

  return (
    <div className="bg-background min-h-screen">
      <header className="border-border bg-card border-b">
        <div className="mx-auto max-w-3xl px-5 py-8 sm:px-8">
          <Link
            to="/media"
            className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-xs"
          >
            <ArrowLeft className="size-3" strokeWidth={2} />
            {t('media.article.all_articles_link_short')}
          </Link>
        </div>
      </header>

      <article className="mx-auto max-w-3xl px-5 py-10 sm:px-8">
        {post.cover_url ? (
          <img
            src={post.cover_url}
            alt={post.title}
            className="border-border mb-8 aspect-[16/9] w-full rounded-lg border object-cover"
          />
        ) : null}
        <h1 className="text-brand-navy text-3xl font-bold leading-tight tracking-tight sm:text-4xl">
          {post.title}
        </h1>
        <p className="text-muted-foreground mt-4 text-lg">{post.description}</p>
        <div className="text-muted-foreground mt-4 flex flex-wrap items-center gap-3 text-xs">
          <span className="inline-flex items-center gap-1">
            <Calendar className="size-3" strokeWidth={2} />
            {new Date(post.published_at).toLocaleDateString('ru-RU', {
              day: 'numeric',
              month: 'long',
              year: 'numeric',
            })}
          </span>
          <span>· {post.author}</span>
          {post.tags && post.tags.length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {post.tags.map((tag) => (
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
        </div>

        <div
          className="prose prose-slate prose-headings:text-brand-navy prose-a:text-secondary mt-8 max-w-none"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </article>
    </div>
  )
}

/** Fallback для старых статей без body_html (только body_md). */
function markdownToHtml(md: string): string {
  if (!md) return ''
  const esc = md.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  let html = esc
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>')
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>')
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>')
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>')
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>')
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, text, url) => {
    const safe = /^(https?:|mailto:|\/)/.test(url) ? url : '#'
    return `<a href="${safe}" target="_blank" rel="noopener noreferrer">${text}</a>`
  })
  html = html
    .split(/\n{2,}/)
    .map((block) => {
      const t = block.trim()
      if (!t) return ''
      if (/^<h[1-3]>/.test(t) || /^<(ul|ol|p)/.test(t)) return t
      return `<p>${t.replace(/\n/g, '<br />')}</p>`
    })
    .join('\n')
  return html
}
