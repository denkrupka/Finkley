import {
  ChevronDown,
  Eye,
  EyeOff,
  Lightbulb,
  Loader2,
  Plus,
  RefreshCw,
  Save,
  Sparkles,
  Trash2,
  Upload,
  Wand2,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'

import { RichTextEditor } from '@/components/editor/RichTextEditor'
import { GoogleSnippetPreview } from '@/components/seo/GoogleSnippetPreview'
import { SeoScorePanel } from '@/components/seo/SeoScorePanel'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  ARTICLE_LANGS,
  useAiGenerateDescription,
  useAiGenerateFullArticle,
  useAiGenerateKeywords,
  useAiGenerateOutline,
  useAiGenerateTitle,
  useAiImproveText,
  useAiSuggestTopics,
  type ArticleLang,
} from '@/hooks/useAiSeo'
import {
  useAllMediaPosts,
  useDeleteMediaPost,
  useIsAppAdmin,
  useRebuildLanding,
  useUpsertMediaPost,
  type MediaPost,
} from '@/hooks/useMediaPosts'
import { renderBrandedCover } from '@/lib/seo/generate-cover'
import { ensureSeoElements, evaluateSeo, normalizeSlug, slugify } from '@/lib/seo/seo-utils'
import { supabase } from '@/lib/supabase/client'

/**
 * Админка постов /media. Доступ только для app_admins.
 *
 * 3-колоночный layout:
 *   - Sidebar (узкий): список статей (draft/published)
 *   - Editor (центр): поля + WYSIWYG (TipTap) + SEO-поля + действия
 *   - SEO Lab (правый): score 0-100, чек-лист, Google snippet preview,
 *     OG preview, ИИ-помощник
 *
 * Публичный блог finkley.app/media — Astro SSG (тянет media_posts на билде),
 * поэтому опубликованная статья появляется там ТОЛЬКО после пересборки сайта.
 * Пересборка дёргается автоматически при публикации (draft=false) и кнопкой
 * «Пересобрать сайт» (useRebuildLanding → rebuild-landing-trigger). Билд+деплой
 * ~1-2 минуты. (Внутри SPA /app/media список обновляется сразу.)
 */
export function AdminMediaPage() {
  const { t } = useTranslation()
  const { data: isAdmin, isLoading: adminLoading } = useIsAppAdmin()
  const { data: posts = [], isLoading } = useAllMediaPosts()
  const upsert = useUpsertMediaPost()
  const remove = useDeleteMediaPost()
  const rebuild = useRebuildLanding()
  const [selected, setSelected] = useState<MediaPost | null>(null)
  const [draft, setDraft] = useState<Partial<MediaPost>>({})
  const [targetKeyword, setTargetKeyword] = useState('')
  const [autoSlug, setAutoSlug] = useState(true)
  const [showSeoFields, setShowSeoFields] = useState(true)
  const [fullBusy, setFullBusy] = useState(false)
  const [articleLang, setArticleLang] = useState<ArticleLang>('ru')

  // AI hooks
  const aiTitle = useAiGenerateTitle()
  const aiDesc = useAiGenerateDescription()
  const aiKeywords = useAiGenerateKeywords()
  const aiOutline = useAiGenerateOutline()
  const aiImprove = useAiImproveText()
  const aiTopics = useAiSuggestTopics()
  const aiFull = useAiGenerateFullArticle()

  useEffect(() => {
    if (selected) {
      setDraft({
        ...selected,
        body_html: selected.body_html || markdownToHtml(selected.body_md ?? ''),
      })
      setTargetKeyword((selected.keywords?.[0] as string | undefined) ?? '')
      setAutoSlug(false) // редактируем существующую — slug фиксированный
    } else {
      setDraft({
        slug: '',
        title: '',
        description: '',
        body_md: '',
        body_html: '',
        tags: [],
        draft: true,
        seo_title: null,
        seo_description: null,
        og_image_url: null,
        canonical_url: null,
        keywords: null,
      })
      setTargetKeyword('')
      setAutoSlug(true) // новая — авто-slug из title
    }
  }, [selected])

  // Auto-slug
  useEffect(() => {
    if (autoSlug && draft.title) {
      setDraft((d) => ({ ...d, slug: slugify(d.title ?? '') }))
    }
  }, [autoSlug, draft.title])

  const seoResult = useMemo(
    () =>
      evaluateSeo({
        title: draft.title ?? '',
        description: draft.description ?? '',
        body_html: draft.body_html ?? '',
        seo_title: draft.seo_title,
        seo_description: draft.seo_description,
        og_image_url: draft.og_image_url,
        cover_url: draft.cover_url,
        keywords: draft.keywords,
        tags: draft.tags,
        target_keyword: targetKeyword,
        slug: draft.slug ?? '',
      }),
    [draft, targetKeyword],
  )

  if (adminLoading) {
    return (
      <div className="p-8">
        <p className="text-muted-foreground text-sm">{t('common.loading')}</p>
      </div>
    )
  }
  if (!isAdmin) {
    return (
      <div className="p-8">
        <h1 className="text-foreground text-lg font-bold">{t('admin.media.no_access_title')}</h1>
        <p className="text-muted-foreground mt-1 text-sm">{t('admin.media.no_access_body')}</p>
        <p className="text-muted-foreground mt-3 text-xs">{t('admin.media.no_access_hint')}</p>
      </div>
    )
  }

  async function uploadCover() {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*'
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) return
      const path = `covers/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.-]/g, '_')}`
      const { error } = await supabase.storage
        .from('blog-images')
        .upload(path, file, { cacheControl: '3600', upsert: false })
      if (error) {
        toast.error(error.message)
        return
      }
      const { data } = supabase.storage.from('blog-images').getPublicUrl(path)
      setDraft((d) => ({ ...d, cover_url: data.publicUrl }))
      toast.success(t('admin.media.toast_cover_uploaded'))
    }
    input.click()
  }

  async function uploadImageBlob(blob: Blob, name: string): Promise<string> {
    const path = `covers/${Date.now()}-${name}`
    const { error } = await supabase.storage
      .from('blog-images')
      .upload(path, blob, { cacheControl: '3600', upsert: false, contentType: 'image/png' })
    if (error) throw error
    return supabase.storage.from('blog-images').getPublicUrl(path).data.publicUrl
  }

  /**
   * «Сгенерировать статью целиком» — один клик: ИИ пишет заголовок, slug,
   * мета, ключи, теги и тело статьи под максимальный SEO score, клиент
   * добивает брендовую обложку (canvas → PNG) + иллюстрацию + гарантирует
   * внутренние/внешние ссылки. Результат — черновик: владелец проверяет и
   * публикует.
   */
  async function generateFullArticle(kwOverride?: string) {
    const kw = (kwOverride ?? '').trim() || targetKeyword.trim() || (draft.title ?? '').trim()
    if (!kw) {
      toast.error(
        t('admin.media.ai.error_keyword_required', {
          defaultValue: 'Сначала впиши целевое ключевое слово или тему',
        }),
      )
      return
    }
    setFullBusy(true)
    try {
      const art = await aiFull.mutateAsync({
        target_keyword: kw,
        title: (draft.title ?? '').trim() || undefined,
        language: articleLang,
      })

      // Брендовые картинки: обложка (заголовок) + иллюстрация (ключ).
      // Не критично для текста — при сбое продолжаем без картинки.
      let coverUrl: string | null = null
      let inlineUrl: string | null = null
      try {
        // Надпись на обложке по языку статьи: кириллица для ru/uk, латиница иначе.
        const blogWord = articleLang === 'ru' || articleLang === 'uk' ? 'БЛОГ' : 'BLOG'
        const coverBlob = await renderBrandedCover({
          title: art.title,
          eyebrow: `FINKLEY · ${blogWord}`,
          variant: 'cover',
        })
        coverUrl = await uploadImageBlob(coverBlob, 'cover.png')
        const inlineBlob = await renderBrandedCover({
          title: targetKeyword.trim() || kw,
          eyebrow: 'FINKLEY',
          variant: 'inline',
        })
        inlineUrl = await uploadImageBlob(inlineBlob, 'inline.png')
      } catch (imgErr) {
        console.warn('cover generation failed', imgErr)
      }

      const body = ensureSeoElements(art.body_html, {
        title: art.title,
        inlineImageUrl: inlineUrl,
        altText: targetKeyword.trim() || art.title,
      })
      const slug = normalizeSlug(art.slug, art.title)
      // Подстраховка под SEO-чек длины описания: snippet Google ≤160.
      const clampDesc = (s: string) =>
        s.length > 160 ? `${s.slice(0, 157).replace(/\s+\S*$/, '')}…` : s
      const desc = clampDesc(art.description)
      const seoDesc = clampDesc(art.seo_description || art.description)

      setAutoSlug(false)
      setDraft((d) => ({
        ...d,
        title: art.title,
        seo_title: art.seo_title || art.title,
        slug,
        description: desc,
        seo_description: seoDesc,
        keywords: art.keywords,
        tags: art.tags.length ? art.tags : (d.tags ?? []),
        body_html: body,
        cover_url: coverUrl ?? d.cover_url ?? null,
        og_image_url: coverUrl ?? d.og_image_url ?? null,
        draft: true,
      }))
      // Плотность меряется по КОРОТКОМУ target_keyword (2–4 слова), который
      // выбрал ИИ и вписал в title + повторил в теле 7–10 раз. Если бы держали
      // длинный заголовок как ключ — плотность всегда была бы ~0.1%. Фоллбэк на
      // kw, если модель не вернула target_keyword (старый формат).
      setTargetKeyword(art.target_keyword || kw)
      toast.success(
        t('admin.media.ai.toast_full_done', {
          defaultValue: 'Статья сгенерирована. Проверь и нажми «Опубликовать».',
        }),
      )
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setFullBusy(false)
    }
  }

  function save() {
    if (!draft.slug?.trim() || !draft.title?.trim()) {
      toast.error(t('admin.media.errors.slug_or_title_required'))
      return
    }
    upsert.mutate(
      {
        id: selected?.id,
        slug: draft.slug,
        title: draft.title,
        description: draft.description ?? '',
        body_md: draft.body_md ?? '',
        body_html: draft.body_html ?? '',
        cover_url: draft.cover_url ?? null,
        tags: draft.tags ?? [],
        author: draft.author ?? 'Finkley',
        draft: draft.draft ?? true,
        published_at: draft.published_at ?? new Date().toISOString(),
        seo_title: draft.seo_title ?? null,
        seo_description: draft.seo_description ?? null,
        og_image_url: draft.og_image_url ?? null,
        canonical_url: draft.canonical_url ?? null,
        keywords: draft.keywords ?? null,
      },
      {
        onSuccess: (saved) => {
          toast.success(t('admin.media.toast_saved'))
          setSelected(saved)
        },
        onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
      },
    )
  }

  function togglePublish() {
    setDraft((d) => ({ ...d, draft: !(d.draft ?? true) }))
  }

  function deletePost() {
    if (!selected) return
    if (!confirm(t('admin.media.confirm_delete'))) return
    remove.mutate(selected.id, {
      onSuccess: () => {
        toast.success(t('admin.media.toast_deleted'))
        setSelected(null)
      },
      onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
    })
  }

  // ---- AI helpers ----
  function genTitle() {
    aiTitle.mutate(
      { body_html: draft.body_html ?? '', target_keyword: targetKeyword },
      {
        onSuccess: (r) => {
          if (r.titles?.[0]) {
            setDraft((d) => ({ ...d, title: r.titles[0], seo_title: r.titles[0] }))
            toast.success(t('admin.media.ai.toast_title_done'))
          }
        },
        onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
      },
    )
  }
  function genDescription() {
    if (!draft.title?.trim()) {
      toast.error(t('admin.media.ai.error_title_required'))
      return
    }
    aiDesc.mutate(
      { title: draft.title, body_html: draft.body_html ?? '' },
      {
        onSuccess: (r) => {
          setDraft((d) => ({
            ...d,
            description: r.description,
            seo_description: r.description,
          }))
          toast.success(t('admin.media.ai.toast_desc_done'))
        },
        onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
      },
    )
  }
  function genKeywords() {
    if (!draft.title?.trim()) {
      toast.error(t('admin.media.ai.error_title_required'))
      return
    }
    aiKeywords.mutate(
      { title: draft.title, body_html: draft.body_html ?? '' },
      {
        onSuccess: (r) => {
          setDraft((d) => ({ ...d, keywords: r.keywords }))
          if (!targetKeyword && r.keywords[0]) setTargetKeyword(r.keywords[0])
          toast.success(t('admin.media.ai.toast_keywords_done'))
        },
        onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
      },
    )
  }
  function genOutline() {
    if (!draft.title?.trim()) {
      toast.error(t('admin.media.ai.error_title_required'))
      return
    }
    aiOutline.mutate(
      { title: draft.title, target_keyword: targetKeyword },
      {
        onSuccess: (r) => {
          // Конвертируем markdown outline в HTML и вставляем в body_html.
          const html = r.outline
            .split('\n')
            .map((line) => {
              const m = line.match(/^##\s+(.+)$/)
              if (m) return `<h2>${m[1]}</h2><p></p>`
              return line.trim() ? `<p>${line}</p>` : ''
            })
            .filter(Boolean)
            .join('\n')
          setDraft((d) => ({
            ...d,
            body_html: d.body_html?.trim() ? `${d.body_html}\n${html}` : html,
          }))
          toast.success(t('admin.media.ai.toast_outline_done'))
        },
        onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
      },
    )
  }

  return (
    <div className="flex flex-1 flex-col px-5 py-7 sm:px-8 lg:pb-12">
      <header className="mb-5 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-brand-navy text-2xl font-bold tracking-tight">
            {t('admin.media.title')}
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">{t('admin.media.subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="md"
            onClick={() =>
              rebuild.mutate(undefined, {
                onSuccess: (r) =>
                  r?.dispatched
                    ? toast.success(
                        t('admin.media.rebuild_started', {
                          defaultValue:
                            'Сайт пересобирается — статьи появятся на finkley.app/media через пару минут.',
                        }),
                      )
                    : toast.warning(
                        t('admin.media.rebuild_no_token', {
                          defaultValue:
                            'Пересборка не настроена: добавь секрет GH_DISPATCH_TOKEN в Supabase.',
                        }),
                      ),
                onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
              })
            }
            disabled={rebuild.isPending}
            title={t('admin.media.rebuild_hint', {
              defaultValue:
                'Лендинг finkley.app/media — статический. Пересборка показывает новые статьи.',
            })}
          >
            <RefreshCw
              className={`size-4 ${rebuild.isPending ? 'animate-spin' : ''}`}
              strokeWidth={2}
            />
            {t('admin.media.rebuild', { defaultValue: 'Пересобрать сайт' })}
          </Button>
          <Button
            variant="primary"
            size="md"
            onClick={() => setSelected(null)}
            data-testid="new-post"
          >
            <Plus className="size-4" strokeWidth={2} />
            {t('admin.media.new_post')}
          </Button>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-[260px_minmax(0,1fr)_340px]">
        {/* ---- Список статей ---- */}
        <aside className="border-border bg-card shadow-finsm rounded-lg border">
          {isLoading ? (
            <p className="text-muted-foreground p-4 text-xs">{t('common.loading')}</p>
          ) : posts.length === 0 ? (
            <p className="text-muted-foreground p-4 text-xs">{t('admin.media.empty')}</p>
          ) : (
            <ul className="max-h-[80vh] overflow-y-auto">
              {posts.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => setSelected(p)}
                    className={[
                      'flex w-full flex-col items-start gap-1 border-b px-3 py-2 text-left transition-colors',
                      selected?.id === p.id ? 'bg-primary/10' : 'hover:bg-muted/40',
                      'border-border/40',
                    ].join(' ')}
                  >
                    <span className="text-foreground line-clamp-1 text-sm font-semibold">
                      {p.title}
                    </span>
                    <span className="text-muted-foreground text-[10px]">/{p.slug}</span>
                    <span
                      className={
                        p.draft
                          ? 'inline-flex items-center gap-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-800'
                          : 'inline-flex items-center gap-1 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700'
                      }
                    >
                      {p.draft ? (
                        <EyeOff className="size-3" strokeWidth={2} />
                      ) : (
                        <Eye className="size-3" strokeWidth={2} />
                      )}
                      {p.draft ? t('admin.media.status.draft') : t('admin.media.status.published')}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>

        {/* ---- Редактор ---- */}
        <div className="border-border bg-card shadow-finsm flex min-w-0 flex-col overflow-hidden rounded-lg border">
          <div className="flex-1 overflow-y-auto p-5">
            {/* Topic suggester для пустых статей */}
            {!selected && !draft.title ? (
              <TopicSuggester
                targetKeyword={targetKeyword}
                setTargetKeyword={setTargetKeyword}
                aiTopics={aiTopics}
                onPick={(topic) => setDraft((d) => ({ ...d, title: topic }))}
                onGenerateFull={generateFullArticle}
                fullBusy={fullBusy}
              />
            ) : null}

            {/* Title + Slug */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs">{t('admin.media.fields.title')}</Label>
                  <AiButton
                    onClick={genTitle}
                    pending={aiTitle.isPending}
                    label={t('admin.media.ai.generate_title')}
                  />
                </div>
                <Input
                  value={draft.title ?? ''}
                  onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
                  className="mt-1 h-10"
                  data-testid="post-title"
                  placeholder={t('admin.media.placeholders.title')}
                />
              </div>
              <div className="sm:col-span-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs">{t('admin.media.fields.slug')}</Label>
                  <label className="text-muted-foreground inline-flex cursor-pointer items-center gap-1.5 text-[10px]">
                    <input
                      type="checkbox"
                      checked={autoSlug}
                      onChange={(e) => setAutoSlug(e.target.checked)}
                      className="size-3 accent-sky-500"
                    />
                    {t('admin.media.fields.auto_slug')}
                  </label>
                </div>
                <Input
                  value={draft.slug ?? ''}
                  onChange={(e) => {
                    setAutoSlug(false)
                    setDraft((d) => ({ ...d, slug: e.target.value }))
                  }}
                  placeholder="zachem-salonu-finansy"
                  className="mt-1 h-10 font-mono text-xs"
                />
              </div>
              <div className="sm:col-span-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs">{t('admin.media.fields.description')}</Label>
                  <AiButton
                    onClick={genDescription}
                    pending={aiDesc.isPending}
                    label={t('admin.media.ai.generate_description')}
                  />
                </div>
                <Input
                  value={draft.description ?? ''}
                  onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
                  className="mt-1 h-10"
                  placeholder={t('admin.media.placeholders.description')}
                />
              </div>
              <div>
                <Label className="text-xs">{t('admin.media.fields.cover_url')}</Label>
                <div className="mt-1 flex gap-2">
                  <Input
                    value={draft.cover_url ?? ''}
                    onChange={(e) => setDraft((d) => ({ ...d, cover_url: e.target.value }))}
                    placeholder="https://…"
                    className="h-10 flex-1"
                  />
                  <Button
                    variant="outline"
                    size="md"
                    onClick={uploadCover}
                    title={t('admin.media.upload_cover')}
                  >
                    <Upload className="size-4" strokeWidth={1.8} />
                  </Button>
                </div>
                {draft.cover_url ? (
                  <img
                    src={draft.cover_url}
                    alt="cover"
                    className="border-border mt-2 h-24 w-auto rounded-md border object-cover"
                  />
                ) : null}
              </div>
              <div>
                <Label className="text-xs">{t('admin.media.fields.tags')}</Label>
                <Input
                  value={(draft.tags ?? []).join(', ')}
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      tags: e.target.value
                        .split(',')
                        .map((s) => s.trim())
                        .filter(Boolean),
                    }))
                  }
                  placeholder={t('admin.media.fields.tags_placeholder', {
                    defaultValue: 'финансы, KPI, маржа',
                  })}
                  className="mt-1 h-10"
                />
              </div>
            </div>

            {/* Target keyword */}
            <div className="border-border mt-4 rounded-md border bg-amber-50/40 p-3">
              <div className="mb-1.5 flex items-center justify-between">
                <Label className="inline-flex items-center gap-1.5 text-xs font-bold">
                  🎯 {t('admin.media.fields.target_keyword')}
                </Label>
                <span className="text-muted-foreground text-[10px]">
                  {t('admin.media.fields.target_keyword_hint')}
                </span>
              </div>
              <Input
                value={targetKeyword}
                onChange={(e) => setTargetKeyword(e.target.value)}
                placeholder={t('admin.media.fields.target_keyword_placeholder', {
                  defaultValue: 'например: учёт салона красоты',
                })}
                className="h-9"
              />
              {/* Язык статьи — независим от языка UI. */}
              <div className="mt-2 flex items-center gap-2">
                <Label className="text-muted-foreground shrink-0 text-[11px] font-semibold">
                  {t('admin.media.ai.article_language', { defaultValue: 'Язык статьи' })}
                </Label>
                <select
                  value={articleLang}
                  onChange={(e) => setArticleLang(e.target.value as ArticleLang)}
                  data-testid="article-language"
                  className="border-input bg-background h-9 flex-1 rounded-md border px-2 text-sm"
                >
                  {ARTICLE_LANGS.map((l) => (
                    <option key={l.code} value={l.code}>
                      {l.flag} {l.label}
                    </option>
                  ))}
                </select>
              </div>
              <button
                type="button"
                onClick={() => generateFullArticle()}
                disabled={fullBusy}
                data-testid="generate-full-article"
                className="mt-2.5 inline-flex h-10 w-full items-center justify-center gap-2 rounded-md bg-gradient-to-br from-violet-600 to-fuchsia-600 text-sm font-bold text-white shadow-sm transition-colors hover:from-violet-700 hover:to-fuchsia-700 disabled:opacity-60"
              >
                {fullBusy ? (
                  <Loader2 className="size-4 animate-spin" strokeWidth={2.5} />
                ) : (
                  <Wand2 className="size-4" strokeWidth={2.2} />
                )}
                {fullBusy
                  ? t('admin.media.ai.full_generating', { defaultValue: 'Генерирую статью…' })
                  : t('admin.media.ai.generate_full', {
                      defaultValue: 'Сгенерировать статью целиком',
                    })}
              </button>
              <p className="mt-1.5 text-[10px] leading-tight text-amber-800/70">
                {t('admin.media.ai.full_hint', {
                  defaultValue:
                    'Один клик — заголовок, текст, теги, ключи, мета, URL и обложка. Цель: SEO-оценка 100/100.',
                })}
              </p>
            </div>

            {/* WYSIWYG */}
            <div className="mt-4">
              <div className="flex items-center justify-between">
                <Label className="text-xs">{t('admin.media.fields.body_html')}</Label>
                <div className="flex gap-1.5">
                  <AiButton
                    onClick={genOutline}
                    pending={aiOutline.isPending}
                    label={t('admin.media.ai.generate_outline')}
                  />
                </div>
              </div>
              <div className="mt-1">
                <RichTextEditor
                  value={draft.body_html ?? ''}
                  onChange={(html) => setDraft((d) => ({ ...d, body_html: html }))}
                />
              </div>
            </div>

            {/* SEO поля */}
            <div className="border-border mt-4 rounded-md border">
              <button
                type="button"
                onClick={() => setShowSeoFields((v) => !v)}
                className="text-foreground flex w-full items-center justify-between gap-1.5 px-3 py-2.5 text-sm font-bold"
              >
                <span className="inline-flex items-center gap-1.5">
                  🔧 {t('admin.media.seo.title')}
                </span>
                <ChevronDown
                  className={`size-4 transition-transform ${showSeoFields ? 'rotate-180' : ''}`}
                  strokeWidth={1.8}
                />
              </button>
              {showSeoFields ? (
                <div className="border-border grid grid-cols-1 gap-3 border-t p-3 sm:grid-cols-2">
                  <div className="sm:col-span-2">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs">{t('admin.media.seo.title_field')}</Label>
                      <span
                        className={
                          (draft.seo_title ?? draft.title ?? '').length > 60
                            ? 'text-xs text-rose-600'
                            : 'text-muted-foreground text-xs'
                        }
                      >
                        {(draft.seo_title ?? draft.title ?? '').length} / 60
                      </span>
                    </div>
                    <Input
                      value={draft.seo_title ?? ''}
                      onChange={(e) =>
                        setDraft((d) => ({ ...d, seo_title: e.target.value || null }))
                      }
                      placeholder={draft.title ?? '—'}
                      className="mt-1 h-10"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs">{t('admin.media.seo.description_field')}</Label>
                      <span
                        className={
                          (draft.seo_description ?? draft.description ?? '').length > 160
                            ? 'text-xs text-rose-600'
                            : 'text-muted-foreground text-xs'
                        }
                      >
                        {(draft.seo_description ?? draft.description ?? '').length} / 160
                      </span>
                    </div>
                    <textarea
                      value={draft.seo_description ?? ''}
                      onChange={(e) =>
                        setDraft((d) => ({ ...d, seo_description: e.target.value || null }))
                      }
                      rows={2}
                      className="border-border bg-card mt-1 w-full rounded-md border p-2 text-sm"
                      placeholder={draft.description ?? '—'}
                    />
                  </div>
                  <div>
                    <Label className="text-xs">{t('admin.media.seo.og_image')}</Label>
                    <Input
                      value={draft.og_image_url ?? ''}
                      onChange={(e) =>
                        setDraft((d) => ({ ...d, og_image_url: e.target.value || null }))
                      }
                      placeholder={draft.cover_url ?? 'https://…'}
                      className="mt-1 h-10"
                    />
                  </div>
                  <div>
                    <Label className="text-xs">{t('admin.media.seo.canonical')}</Label>
                    <Input
                      value={draft.canonical_url ?? ''}
                      onChange={(e) =>
                        setDraft((d) => ({ ...d, canonical_url: e.target.value || null }))
                      }
                      placeholder="https://finkley.app/media/…"
                      className="mt-1 h-10"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs">{t('admin.media.seo.keywords')}</Label>
                      <AiButton
                        onClick={genKeywords}
                        pending={aiKeywords.isPending}
                        label={t('admin.media.ai.generate_keywords')}
                      />
                    </div>
                    <Input
                      value={(draft.keywords ?? []).join(', ')}
                      onChange={(e) =>
                        setDraft((d) => ({
                          ...d,
                          keywords: e.target.value
                            .split(',')
                            .map((s) => s.trim())
                            .filter(Boolean),
                        }))
                      }
                      placeholder={t('admin.media.fields.keywords_placeholder', {
                        defaultValue: 'управленческий учёт, салон красоты',
                      })}
                      className="mt-1 h-10"
                    />
                  </div>
                </div>
              ) : null}
            </div>

            {/* Improve selection — глобальный «улучшить весь текст» */}
            {draft.body_html ? (
              <div className="mt-3">
                <button
                  type="button"
                  disabled={aiImprove.isPending}
                  onClick={() =>
                    aiImprove.mutate(
                      { text: draft.body_html ?? '' },
                      {
                        onSuccess: (r) => {
                          setDraft((d) => ({ ...d, body_html: r.improved }))
                          toast.success(t('admin.media.ai.toast_improve_done'))
                        },
                        onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
                      },
                    )
                  }
                  className="border-border hover:bg-muted/40 inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-xs font-semibold disabled:opacity-50"
                >
                  {aiImprove.isPending ? (
                    <Loader2 className="size-3.5 animate-spin" strokeWidth={2} />
                  ) : (
                    <Wand2 className="size-3.5" strokeWidth={2} />
                  )}
                  {t('admin.media.ai.improve_text')}
                </button>
              </div>
            ) : null}
          </div>

          {/* Actions footer */}
          <div className="border-border bg-card flex items-center justify-between gap-2 border-t px-5 py-3">
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={togglePublish}>
                {draft.draft ? (
                  <>
                    <Eye className="size-3.5" strokeWidth={2} />
                    {t('admin.media.actions.publish')}
                  </>
                ) : (
                  <>
                    <EyeOff className="size-3.5" strokeWidth={2} />
                    {t('admin.media.actions.unpublish')}
                  </>
                )}
              </Button>
              {selected ? (
                <>
                  <button
                    type="button"
                    onClick={deletePost}
                    className="text-muted-foreground hover:text-destructive inline-flex items-center gap-1 text-xs"
                  >
                    <Trash2 className="size-3.5" strokeWidth={1.8} />
                    {t('common.delete')}
                  </button>
                  <Link
                    to={`/media/${selected.slug}`}
                    target="_blank"
                    className="text-secondary text-xs underline"
                  >
                    {t('admin.media.actions.preview')}
                  </Link>
                </>
              ) : null}
            </div>
            <Button variant="primary" size="md" onClick={save} disabled={upsert.isPending}>
              <Save className="size-4" strokeWidth={2} />
              {upsert.isPending ? t('common.loading') : t('common.save')}
            </Button>
          </div>
        </div>

        {/* ---- SEO Lab (правая колонка) ---- */}
        <aside className="space-y-4 lg:max-h-[calc(100vh-180px)] lg:overflow-y-auto">
          <SeoScorePanel result={seoResult} />
          <GoogleSnippetPreview
            title={draft.seo_title ?? draft.title ?? ''}
            description={draft.seo_description ?? draft.description ?? ''}
            slug={draft.slug ?? ''}
            cover_url={draft.og_image_url ?? draft.cover_url ?? null}
          />
        </aside>
      </div>
    </div>
  )
}

/** Маленькая иконка-кнопка «✨ Сгенерировать ИИ» для inline-использования рядом с Label. */
function AiButton({
  onClick,
  pending,
  label,
}: {
  onClick: () => void
  pending: boolean
  label: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      className="inline-flex items-center gap-1 rounded-md bg-gradient-to-br from-violet-500 to-fuchsia-500 px-2 py-1 text-[10px] font-bold text-white shadow-sm hover:from-violet-600 hover:to-fuchsia-600 disabled:opacity-50"
    >
      {pending ? (
        <Loader2 className="size-3 animate-spin" strokeWidth={2.5} />
      ) : (
        <Sparkles className="size-3" strokeWidth={2.5} />
      )}
      {label}
    </button>
  )
}

/** Идеи тем для пустых статей — на старте видна большая дружелюбная карточка. */
function TopicSuggester({
  targetKeyword,
  setTargetKeyword,
  aiTopics,
  onPick,
  onGenerateFull,
  fullBusy,
}: {
  targetKeyword: string
  setTargetKeyword: (v: string) => void
  aiTopics: ReturnType<typeof useAiSuggestTopics>
  onPick: (topic: string) => void
  onGenerateFull: (keyword: string) => void
  fullBusy: boolean
}) {
  const { t } = useTranslation()
  const [keyword, setKeyword] = useState(targetKeyword)
  const [topics, setTopics] = useState<string[]>([])

  function suggest() {
    if (!keyword.trim()) return
    aiTopics.mutate(
      { target_keyword: keyword },
      {
        onSuccess: (r) => {
          setTopics(r.topics)
          setTargetKeyword(keyword)
        },
      },
    )
  }

  return (
    <div className="mb-5 rounded-lg border border-violet-200 bg-gradient-to-br from-violet-50 to-fuchsia-50 p-4">
      <div className="mb-2 flex items-center gap-2">
        <Lightbulb className="size-4 text-violet-600" strokeWidth={2} />
        <h3 className="text-sm font-bold text-violet-900">
          {t('admin.media.topic_suggest.title')}
        </h3>
      </div>
      <p className="text-xs text-violet-800/80">{t('admin.media.topic_suggest.subtitle')}</p>
      <div className="mt-3 flex gap-2">
        <Input
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          placeholder={t('admin.media.topic_suggest.placeholder')}
          className="h-9 flex-1"
          onKeyDown={(e) => e.key === 'Enter' && suggest()}
        />
        <Button
          variant="primary"
          size="sm"
          disabled={aiTopics.isPending || !keyword.trim()}
          onClick={suggest}
        >
          {aiTopics.isPending ? (
            <Loader2 className="size-3.5 animate-spin" strokeWidth={2} />
          ) : (
            <Sparkles className="size-3.5" strokeWidth={2} />
          )}
          {t('admin.media.topic_suggest.generate')}
        </Button>
      </div>

      {/* Или сразу готовую статью одним кликом */}
      <div className="my-2.5 flex items-center gap-2">
        <div className="h-px flex-1 bg-violet-200" />
        <span className="text-[10px] font-bold uppercase tracking-wider text-violet-700/70">
          {t('admin.media.topic_suggest.or', { defaultValue: 'или' })}
        </span>
        <div className="h-px flex-1 bg-violet-200" />
      </div>
      <button
        type="button"
        onClick={() => onGenerateFull(keyword)}
        disabled={fullBusy || !keyword.trim()}
        data-testid="generate-full-article-topic"
        className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-md bg-gradient-to-br from-violet-600 to-fuchsia-600 text-sm font-bold text-white shadow-sm transition-colors hover:from-violet-700 hover:to-fuchsia-700 disabled:opacity-60"
      >
        {fullBusy ? (
          <Loader2 className="size-4 animate-spin" strokeWidth={2.5} />
        ) : (
          <Wand2 className="size-4" strokeWidth={2.2} />
        )}
        {fullBusy
          ? t('admin.media.ai.full_generating', { defaultValue: 'Генерирую статью…' })
          : t('admin.media.ai.generate_full_oneclick', {
              defaultValue: 'Сразу сгенерировать готовую статью',
            })}
      </button>
      <p className="mt-1.5 text-[10px] leading-tight text-violet-800/70">
        {t('admin.media.ai.full_hint', {
          defaultValue:
            'Один клик — заголовок, текст, теги, ключи, мета, URL и обложка. Цель: SEO-оценка 100/100.',
        })}
      </p>
      {topics.length > 0 ? (
        <div className="mt-3 space-y-1.5">
          {topics.map((topic) => (
            <button
              key={topic}
              type="button"
              onClick={() => onPick(topic)}
              className="border-border block w-full rounded-md border bg-white p-2.5 text-left text-sm transition-colors hover:border-violet-300 hover:bg-violet-100"
            >
              {topic}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

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
