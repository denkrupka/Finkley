import { Eye, EyeOff, Plus, Save, Search, Trash2, Upload } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'

import { RichTextEditor } from '@/components/editor/RichTextEditor'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  useAllMediaPosts,
  useDeleteMediaPost,
  useIsAppAdmin,
  useUpsertMediaPost,
  type MediaPost,
} from '@/hooks/useMediaPosts'
import { supabase } from '@/lib/supabase/client'

/**
 * Админка постов finsalon.app/media. Доступ — только пользователи в app_admins.
 *
 * UX:
 * - Сайдбар слева: список статей со статусом draft/published
 * - Главная область: WYSIWYG-редактор (TipTap) + раздел SEO + раздел метаданных
 * - Сохраняет HTML в `body_html` (новое) и оставляет body_md пустым для новых
 *   статей. Старые посты (с body_md) сначала отдают свой markdown в редактор
 *   как «начальный HTML» — это упрощённый импорт, юзер при сохранении уже
 *   получит HTML-версию.
 */
export function AdminMediaPage() {
  const { t } = useTranslation()
  const { data: isAdmin, isLoading: adminLoading } = useIsAppAdmin()
  const { data: posts = [], isLoading } = useAllMediaPosts()
  const upsert = useUpsertMediaPost()
  const remove = useDeleteMediaPost()
  const [selected, setSelected] = useState<MediaPost | null>(null)
  const [draft, setDraft] = useState<Partial<MediaPost>>({})

  useEffect(() => {
    if (selected) {
      setDraft({
        ...selected,
        // Если body_html ещё не сохранён — стартуем с markdown как HTML заглушки.
        body_html: selected.body_html || markdownToHtml(selected.body_md ?? ''),
      })
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
    }
  }, [selected])

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

  // SEO-character-counter
  const seoTitleLen = (draft.seo_title ?? draft.title ?? '').length
  const seoDescLen = (draft.seo_description ?? draft.description ?? '').length

  return (
    <div className="flex flex-1 flex-col px-5 py-7 sm:px-8 lg:pb-12">
      <header className="mb-5 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-brand-navy text-2xl font-bold tracking-tight">
            {t('admin.media.title')}
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">{t('admin.media.subtitle')}</p>
        </div>
        <Button
          variant="primary"
          size="md"
          onClick={() => setSelected(null)}
          data-testid="new-post"
        >
          <Plus className="size-4" strokeWidth={2} />
          {t('admin.media.new_post')}
        </Button>
      </header>

      <div className="border-border bg-card shadow-finsm flex min-h-0 flex-1 overflow-hidden rounded-lg border">
        {/* Список */}
        <aside className="border-border w-72 shrink-0 border-r">
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

        {/* Редактор */}
        <div className="flex min-w-0 flex-1 flex-col overflow-y-auto p-5">
          {/* Метаданные */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label className="text-xs">{t('admin.media.fields.title')}</Label>
              <Input
                value={draft.title ?? ''}
                onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
                className="h-10"
                data-testid="post-title"
              />
            </div>
            <div>
              <Label className="text-xs">{t('admin.media.fields.slug')}</Label>
              <Input
                value={draft.slug ?? ''}
                onChange={(e) => setDraft((d) => ({ ...d, slug: e.target.value }))}
                placeholder="zachem-salonu-finansy"
                className="h-10"
              />
            </div>
            <div className="sm:col-span-2">
              <Label className="text-xs">{t('admin.media.fields.description')}</Label>
              <Input
                value={draft.description ?? ''}
                onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
                className="h-10"
              />
            </div>
            <div>
              <Label className="text-xs">{t('admin.media.fields.cover_url')}</Label>
              <div className="flex gap-2">
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
                placeholder="финансы, KPI, маржа"
                className="h-10"
              />
            </div>
          </div>

          {/* WYSIWYG */}
          <div className="mt-4">
            <Label className="text-xs">{t('admin.media.fields.body_html')}</Label>
            <RichTextEditor
              value={draft.body_html ?? ''}
              onChange={(html) => setDraft((d) => ({ ...d, body_html: html }))}
            />
          </div>

          {/* SEO panel */}
          <details className="border-border mt-4 rounded-md border p-3" open>
            <summary className="text-foreground flex cursor-pointer items-center gap-1.5 text-sm font-bold">
              <Search className="size-4" strokeWidth={1.8} />
              {t('admin.media.seo.title')}
            </summary>
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs">{t('admin.media.seo.title_field')}</Label>
                  <span
                    className={
                      seoTitleLen > 60 ? 'text-xs text-rose-600' : 'text-muted-foreground text-xs'
                    }
                  >
                    {seoTitleLen} / 60
                  </span>
                </div>
                <Input
                  value={draft.seo_title ?? ''}
                  onChange={(e) => setDraft((d) => ({ ...d, seo_title: e.target.value || null }))}
                  placeholder={draft.title ?? '—'}
                  className="h-10"
                />
                <p className="text-muted-foreground mt-1 text-[10px]">
                  {t('admin.media.seo.title_hint')}
                </p>
              </div>
              <div className="sm:col-span-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs">{t('admin.media.seo.description_field')}</Label>
                  <span
                    className={
                      seoDescLen > 160 ? 'text-xs text-rose-600' : 'text-muted-foreground text-xs'
                    }
                  >
                    {seoDescLen} / 160
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
                  placeholder="https://…"
                  className="h-10"
                />
              </div>
              <div>
                <Label className="text-xs">{t('admin.media.seo.canonical')}</Label>
                <Input
                  value={draft.canonical_url ?? ''}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, canonical_url: e.target.value || null }))
                  }
                  placeholder="https://finsalon.app/media/…"
                  className="h-10"
                />
              </div>
              <div className="sm:col-span-2">
                <Label className="text-xs">{t('admin.media.seo.keywords')}</Label>
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
                  placeholder="управленческий учёт, салон красоты"
                  className="h-10"
                />
              </div>
            </div>
          </details>

          {/* Actions */}
          <div className="border-border bg-card sticky bottom-0 mt-4 flex items-center justify-between gap-2 border-t pt-3">
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
                <button
                  type="button"
                  onClick={deletePost}
                  className="text-muted-foreground hover:text-destructive inline-flex items-center gap-1 text-xs"
                >
                  <Trash2 className="size-3.5" strokeWidth={1.8} />
                  {t('common.delete')}
                </button>
              ) : null}
              {selected ? (
                <Link
                  to={`https://finsalon.app/media/${selected.slug}/`}
                  target="_blank"
                  className="text-secondary text-xs underline"
                >
                  {t('admin.media.actions.preview')}
                </Link>
              ) : null}
            </div>
            <Button variant="primary" size="md" onClick={save} disabled={upsert.isPending}>
              <Save className="size-4" strokeWidth={2} />
              {upsert.isPending ? t('common.loading') : t('common.save')}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * Минимальная конвертация markdown в HTML — используется при первом
 * редактировании старого поста (где есть только body_md). Дальше юзер
 * сохраняет HTML через TipTap.
 */
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
