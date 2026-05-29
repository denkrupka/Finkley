import {
  Banknote,
  BookOpen,
  CalendarClock,
  ChevronDown,
  Pencil,
  Plus,
  Save,
  Settings,
  Trash2,
  UserPlus,
  Users,
  X,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useParams } from 'react-router-dom'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  useCreateKbArticle,
  useDeleteKbArticle,
  useKbArticles,
  useSeedKbArticles,
  useUpdateKbArticle,
  type KbArticleRow,
  type KbSection,
} from '@/hooks/useKbArticles'
import { useSalonMembership } from '@/hooks/useSalons'
import { cn } from '@/lib/utils/cn'

import { KB_SEED } from './kb-seed'

type SectionDef = {
  id: KbSection
  titleKey: string
  titleDefault: string
  subtitleKey: string
  subtitleDefault: string
  icon: typeof BookOpen
}

const SECTIONS: ReadonlyArray<SectionDef> = [
  {
    id: 'staff',
    titleKey: 'knowledge.sections.staff.title',
    titleDefault: 'Персонал',
    subtitleKey: 'knowledge.sections.staff.subtitle',
    subtitleDefault: 'Найм, управление, контроль, расчёт зарплаты',
    icon: UserPlus,
  },
  {
    id: 'clients',
    titleKey: 'knowledge.sections.clients.title',
    titleDefault: 'Клиенты',
    subtitleKey: 'knowledge.sections.clients.subtitle',
    subtitleDefault: 'Привлечение новых, удержание постоянных',
    icon: Users,
  },
  {
    id: 'finance',
    titleKey: 'knowledge.sections.finance.title',
    titleDefault: 'Финансы',
    subtitleKey: 'knowledge.sections.finance.subtitle',
    subtitleDefault: 'Управление прибылью салона',
    icon: Banknote,
  },
  {
    id: 'schedule',
    titleKey: 'knowledge.sections.schedule.title',
    titleDefault: 'Расписание',
    subtitleKey: 'knowledge.sections.schedule.subtitle',
    subtitleDefault: 'Работа администратора, записи, напоминания',
    icon: CalendarClock,
  },
  {
    id: 'operations',
    titleKey: 'knowledge.sections.operations.title',
    titleDefault: 'Операционные вопросы',
    subtitleKey: 'knowledge.sections.operations.subtitle',
    subtitleDefault: 'Расходники, площадь, доп.продажи, скрипты',
    icon: Settings,
  },
]

export function KnowledgePage() {
  const { t } = useTranslation()
  const { salonId } = useParams<{ salonId: string }>()
  const { data: articles = [], isLoading } = useKbArticles(salonId)
  const { data: membership } = useSalonMembership(salonId)
  const canEdit = membership?.role === 'owner' || membership?.role === 'admin'

  const seed = useSeedKbArticles(salonId)
  const create = useCreateKbArticle(salonId)
  const update = useUpdateKbArticle(salonId)
  const remove = useDeleteKbArticle(salonId)

  const [activeSection, setActiveSection] = useState<KbSection>('staff')
  const [openArticle, setOpenArticle] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [editBody, setEditBody] = useState('')
  const [creatingInSection, setCreatingInSection] = useState<KbSection | null>(null)

  // Авто-seed на первом открытии: если у юзера в БД ноль статей, заливаем
  // стартовый набор. Идемпотентно — следующие визиты не плодят дубликатов.
  useEffect(() => {
    if (!salonId || isLoading) return
    if (articles.length > 0) return
    if (seed.isPending || seed.isSuccess) return
    seed.mutate(KB_SEED)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot когда видим пустую БД
  }, [salonId, isLoading, articles.length])

  const sectionArticles = articles
    .filter((a) => a.section === activeSection)
    .sort((a, b) => a.sort_order - b.sort_order)

  function startEdit(a: KbArticleRow) {
    setEditingId(a.id)
    setEditTitle(a.title)
    setEditBody(a.body)
    setOpenArticle(a.id)
  }

  function cancelEdit() {
    setEditingId(null)
    setEditTitle('')
    setEditBody('')
  }

  function saveEdit() {
    if (!editingId) return
    if (!editTitle.trim()) {
      toast.error(t('knowledge.toast.title_required'))
      return
    }
    update.mutate(
      { id: editingId, title: editTitle.trim(), body: editBody },
      {
        onSuccess: () => {
          toast.success(t('knowledge.toast.saved'))
          cancelEdit()
        },
        onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
      },
    )
  }

  function deleteArticle(id: string) {
    if (!confirm(t('knowledge.confirm.delete_article'))) return
    remove.mutate(id, {
      onSuccess: () => toast.success(t('knowledge.toast.deleted')),
      onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
    })
  }

  function startCreate() {
    setCreatingInSection(activeSection)
    setEditTitle('')
    setEditBody('')
  }

  function saveNew() {
    if (!creatingInSection) return
    if (!editTitle.trim()) {
      toast.error(t('knowledge.toast.title_required'))
      return
    }
    create.mutate(
      { section: creatingInSection, title: editTitle.trim(), body: editBody },
      {
        onSuccess: (created) => {
          toast.success(t('knowledge.toast.article_created'))
          setOpenArticle(created.id)
          setCreatingInSection(null)
          setEditTitle('')
          setEditBody('')
        },
        onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
      },
    )
  }

  return (
    <div className="flex flex-1 flex-col px-5 py-7 sm:px-8 lg:pb-12">
      <header className="mb-6 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-brand-navy text-2xl font-bold tracking-tight">
            {t('knowledge.title')}
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">{t('knowledge.subtitle_v2')}</p>
        </div>
        {canEdit ? (
          <Button size="sm" onClick={startCreate} disabled={create.isPending}>
            <Plus className="size-4" strokeWidth={2} />
            {t('knowledge.add_article')}
          </Button>
        ) : null}
      </header>

      {/* Section tabs */}
      <div className="border-border bg-card shadow-finsm mb-5 rounded-lg border p-1.5">
        <nav className="-mx-1.5 flex gap-1 overflow-x-auto px-1.5">
          {SECTIONS.map((s) => {
            const Icon = s.icon
            const isActive = s.id === activeSection
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => {
                  setActiveSection(s.id)
                  setOpenArticle(null)
                  cancelEdit()
                  setCreatingInSection(null)
                }}
                className={cn(
                  'flex shrink-0 items-center gap-2 rounded-md px-3 py-2 text-sm font-semibold transition-colors',
                  isActive
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'text-muted-foreground hover:bg-muted/40 hover:text-foreground',
                )}
              >
                <Icon className="size-4" strokeWidth={1.8} />
                {t(s.titleKey, { defaultValue: s.titleDefault })}
              </button>
            )
          })}
        </nav>
      </div>

      {/* Section header */}
      <div className="mb-4">
        <h2 className="text-brand-navy text-lg font-bold">
          {(() => {
            const s = SECTIONS.find((x) => x.id === activeSection)
            return s ? t(s.titleKey, { defaultValue: s.titleDefault }) : ''
          })()}
        </h2>
        <p className="text-muted-foreground text-sm">
          {(() => {
            const s = SECTIONS.find((x) => x.id === activeSection)
            return s ? t(s.subtitleKey, { defaultValue: s.subtitleDefault }) : ''
          })()}
        </p>
      </div>

      {/* New article form (если creating в этой секции) */}
      {creatingInSection === activeSection ? (
        <div className="border-secondary/40 bg-secondary/5 mb-3 rounded-lg border p-4">
          <Label className="mb-1.5 block">{t('knowledge.form.title_label')}</Label>
          <Input
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
            placeholder={t('knowledge.form.title_placeholder')}
            className="mb-2"
          />
          <Label className="mb-1.5 block">{t('knowledge.form.body_label')}</Label>
          <textarea
            value={editBody}
            onChange={(e) => setEditBody(e.target.value)}
            rows={8}
            placeholder={t('knowledge.form.body_placeholder')}
            className="border-border bg-card text-foreground w-full rounded-md border p-3 text-sm leading-relaxed outline-none"
          />
          <div className="mt-3 flex gap-2">
            <Button size="sm" onClick={saveNew} disabled={create.isPending}>
              <Save className="size-4" strokeWidth={2} />
              {t('knowledge.form.create')}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setCreatingInSection(null)}>
              <X className="size-4" strokeWidth={2} />
              {t('knowledge.form.cancel')}
            </Button>
          </div>
        </div>
      ) : null}

      {/* Articles list */}
      {isLoading || (articles.length === 0 && seed.isPending) ? (
        <div className="bg-muted/40 h-32 animate-pulse rounded-md" />
      ) : sectionArticles.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t('knowledge.empty_section')}</p>
      ) : (
        <ul className="border-border bg-card shadow-finsm divide-border divide-y overflow-hidden rounded-lg border">
          {sectionArticles.map((a) => {
            const isOpen = openArticle === a.id
            const isEditingThis = editingId === a.id
            return (
              <li key={a.id}>
                <button
                  type="button"
                  onClick={() => {
                    if (isEditingThis) return
                    setOpenArticle(isOpen ? null : a.id)
                  }}
                  className="hover:bg-muted/40 flex w-full items-center justify-between gap-3 px-5 py-4 text-left transition-colors"
                  aria-expanded={isOpen}
                >
                  <span className="text-foreground text-base font-semibold">{a.title}</span>
                  <ChevronDown
                    className={cn(
                      'text-muted-foreground size-4 shrink-0 transition-transform',
                      isOpen ? 'rotate-180' : '',
                    )}
                    strokeWidth={2}
                  />
                </button>
                {isOpen ? (
                  <div className="px-5 pb-4">
                    {isEditingThis ? (
                      <>
                        <Label className="mb-1.5 block">{t('knowledge.form.title_label')}</Label>
                        <Input
                          value={editTitle}
                          onChange={(e) => setEditTitle(e.target.value)}
                          className="mb-2"
                        />
                        <Label className="mb-1.5 block">{t('knowledge.form.body_label')}</Label>
                        <textarea
                          value={editBody}
                          onChange={(e) => setEditBody(e.target.value)}
                          rows={10}
                          className="border-border bg-card text-foreground w-full rounded-md border p-3 text-sm leading-relaxed outline-none"
                        />
                        <div className="mt-3 flex gap-2">
                          <Button size="sm" onClick={saveEdit} disabled={update.isPending}>
                            <Save className="size-4" strokeWidth={2} />
                            {t('knowledge.form.save')}
                          </Button>
                          <Button size="sm" variant="outline" onClick={cancelEdit}>
                            <X className="size-4" strokeWidth={2} />
                            {t('knowledge.form.cancel')}
                          </Button>
                        </div>
                      </>
                    ) : (
                      <>
                        <p className="text-foreground/80 whitespace-pre-wrap text-sm leading-relaxed">
                          {a.body}
                        </p>
                        {canEdit ? (
                          <div className="mt-3 flex gap-2">
                            <button
                              type="button"
                              onClick={() => startEdit(a)}
                              className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-xs font-medium"
                            >
                              <Pencil className="size-3" strokeWidth={2} />
                              {t('knowledge.actions.edit')}
                            </button>
                            <button
                              type="button"
                              onClick={() => deleteArticle(a.id)}
                              className="text-muted-foreground hover:text-destructive inline-flex items-center gap-1 text-xs font-medium"
                            >
                              <Trash2 className="size-3" strokeWidth={2} />
                              {t('knowledge.actions.delete')}
                            </button>
                          </div>
                        ) : null}
                      </>
                    )}
                  </div>
                ) : null}
              </li>
            )
          })}
        </ul>
      )}

      <p className="text-muted-foreground mt-6 text-xs">
        {canEdit ? t('knowledge.footer.editable_hint') : t('knowledge.footer.readonly_hint')}
      </p>
    </div>
  )
}
