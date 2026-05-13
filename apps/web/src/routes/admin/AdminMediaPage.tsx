import { Eye, EyeOff, Plus, Save, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'

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

/**
 * Админка постов finsalon.app/media. Доступ — только пользователи в app_admins.
 * Создание/редактирование markdown-постов, флаг draft/publish, теги, обложка.
 *
 * При сохранении статья появляется в Supabase. Astro landing подтягивает
 * опубликованные посты при следующей сборке (GitHub Action собирает landing
 * на push в main + есть cron-кнопка).
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
    if (selected) setDraft(selected)
    else setDraft({ slug: '', title: '', description: '', body_md: '', tags: [], draft: true })
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
        cover_url: draft.cover_url ?? null,
        tags: draft.tags ?? [],
        author: draft.author ?? 'Finkley',
        draft: draft.draft ?? true,
        published_at: draft.published_at ?? new Date().toISOString(),
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
            <ul className="max-h-[70vh] overflow-y-auto">
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
              <Input
                value={draft.cover_url ?? ''}
                onChange={(e) => setDraft((d) => ({ ...d, cover_url: e.target.value }))}
                placeholder="https://…"
                className="h-10"
              />
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

          <div className="mt-3">
            <Label className="text-xs">{t('admin.media.fields.body_md')}</Label>
            <textarea
              value={draft.body_md ?? ''}
              onChange={(e) => setDraft((d) => ({ ...d, body_md: e.target.value }))}
              rows={20}
              className="border-border bg-card mt-1 w-full rounded-md border p-3 font-mono text-sm"
              placeholder="# Заголовок..."
            />
          </div>

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
