import { ArrowLeft, Coins, Plus, Trash2, Undo2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useParams } from 'react-router-dom'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  useCreateOtherIncomeCategory,
  useDeleteOtherIncomeCategory,
  useOtherIncomeCategories,
  useUpdateOtherIncomeCategory,
} from '@/hooks/useOtherIncomes'
import { cn } from '@/lib/utils/cn'

/**
 * /{salonId}/settings/income-categories — справочник «Доходы»:
 * CRUD категорий прочих доходов (Аренда кресла, Кэшбек, Проценты, Возврат
 * от поставщика, Прочее). Эти категории показываются в /income → Прочие
 * доходы в дропдауне «Категория» и в финансовом отчёте как строки в
 * разделе «Прочие доходы (план/факт)».
 *
 * UX: inline-редактирование имени (Input + Enter/blur — save), кнопка
 * «+ Категория» добавляет пустую строку в edit-mode, архив — soft-delete
 * (is_archived=true, история incomes не теряется), кнопка полного удаления
 * показывается только в архиве.
 *
 * System-категории (is_system=true) — это пресет из миграции seed-данных.
 * Их можно архивировать/переименовывать, но нельзя удалять полностью —
 * RPC/триггер вернёт ошибку.
 */
export function IncomeCategoriesPage() {
  const { t } = useTranslation()
  const { salonId } = useParams<{ salonId: string }>()
  const [showArchived, setShowArchived] = useState(false)

  const { data: categories = [], isLoading } = useOtherIncomeCategories(salonId, {
    includeArchived: showArchived,
  })
  const create = useCreateOtherIncomeCategory(salonId)
  const update = useUpdateOtherIncomeCategory(salonId)
  const remove = useDeleteOtherIncomeCategory(salonId)

  /** id строки которая сейчас редактируется (Input открыт). null = нет. */
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draftName, setDraftName] = useState('')

  function startEdit(id: string, currentName: string) {
    setEditingId(id)
    setDraftName(currentName)
  }

  function saveEdit() {
    if (!editingId) return
    const trimmed = draftName.trim()
    if (trimmed.length < 1) {
      setEditingId(null)
      return
    }
    update.mutate(
      { id: editingId, name: trimmed },
      {
        onSuccess: () => {
          toast.success(t('income_categories.toast_updated'))
          setEditingId(null)
        },
        onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
      },
    )
  }

  function addNew() {
    create.mutate(
      { name: t('income_categories.new_default_name') },
      {
        onSuccess: ({ id }) => {
          toast.success(t('income_categories.toast_created'))
          startEdit(id, t('income_categories.new_default_name'))
        },
        onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
      },
    )
  }

  function archive(id: string) {
    update.mutate(
      { id, is_archived: true },
      {
        onSuccess: () => toast.success(t('income_categories.toast_archived')),
        onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
      },
    )
  }

  function restore(id: string) {
    update.mutate(
      { id, is_archived: false },
      {
        onSuccess: () => toast.success(t('income_categories.toast_restored')),
        onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
      },
    )
  }

  function destroy(id: string, name: string, isSystem: boolean) {
    if (isSystem) {
      toast.error(t('income_categories.cannot_delete_system'))
      return
    }
    if (!confirm(t('income_categories.confirm_delete', { name }))) return
    remove.mutate(id, {
      onSuccess: () => toast.success(t('income_categories.toast_deleted')),
      onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
    })
  }

  if (!salonId) return null

  return (
    <div className="flex flex-1 flex-col px-5 py-7 sm:px-8 lg:pb-12">
      <header className="mb-6 flex flex-col gap-2">
        <Link
          to={`/${salonId}/settings?tab=catalogs`}
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-xs"
        >
          <ArrowLeft className="size-3.5" strokeWidth={2} />
          {t('income_categories.back_to_catalogs')}
        </Link>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex items-center gap-3">
            <span className="bg-brand-sage-soft text-brand-sage grid size-10 place-items-center rounded-md">
              <Coins className="size-5" strokeWidth={1.7} />
            </span>
            <div>
              <h1 className="text-brand-navy text-2xl font-bold tracking-tight">
                {t('income_categories.title')}
              </h1>
              <p className="text-muted-foreground mt-1 text-sm">
                {t('income_categories.subtitle')}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <label className="text-muted-foreground inline-flex items-center gap-1.5 whitespace-nowrap text-xs">
              <input
                type="checkbox"
                checked={showArchived}
                onChange={(e) => setShowArchived(e.target.checked)}
                className="size-3.5"
              />
              {t('income_categories.show_archived')}
            </label>
            <Button onClick={addNew} disabled={create.isPending}>
              <Plus className="size-4" strokeWidth={2} />
              {t('income_categories.add')}
            </Button>
          </div>
        </div>
      </header>

      <section className="border-border bg-card shadow-finsm overflow-hidden rounded-lg border">
        {isLoading ? (
          <div className="text-muted-foreground p-6 text-sm">{t('common.loading')}</div>
        ) : categories.length === 0 ? (
          <div className="text-muted-foreground p-6 text-sm">{t('income_categories.empty')}</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-border bg-muted/10 border-b">
              <tr className="text-muted-foreground text-left text-[11px] font-semibold uppercase tracking-wider">
                <th className="px-4 py-3">{t('income_categories.col_name')}</th>
                <th className="w-32 px-4 py-3 text-center">{t('income_categories.col_status')}</th>
                <th className="w-28 px-4 py-3 text-right" />
              </tr>
            </thead>
            <tbody className="divide-border divide-y">
              {categories.map((c) => {
                const isEditing = editingId === c.id
                return (
                  <tr
                    key={c.id}
                    className={cn(
                      'hover:bg-muted/30 transition-colors',
                      c.is_archived && 'opacity-60',
                    )}
                  >
                    <td className="px-4 py-2">
                      {isEditing ? (
                        <Input
                          autoFocus
                          value={draftName}
                          onChange={(e) => setDraftName(e.target.value)}
                          onBlur={saveEdit}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault()
                              saveEdit()
                            } else if (e.key === 'Escape') {
                              setEditingId(null)
                            }
                          }}
                          className="h-8 max-w-[360px]"
                          disabled={update.isPending}
                        />
                      ) : (
                        <button
                          type="button"
                          onClick={() => startEdit(c.id, c.name)}
                          className="text-foreground hover:text-primary text-left text-sm font-semibold"
                          disabled={c.is_archived}
                        >
                          {c.name}
                        </button>
                      )}
                    </td>
                    <td className="px-4 py-2 text-center">
                      {c.is_system ? (
                        <span className="bg-brand-teal-soft text-brand-teal-deep rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider">
                          {t('income_categories.badge_system')}
                        </span>
                      ) : c.is_archived ? (
                        <span className="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider">
                          {t('income_categories.badge_archived')}
                        </span>
                      ) : (
                        <span className="text-muted-foreground text-xs">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <div className="inline-flex items-center gap-1">
                        {c.is_archived ? (
                          <>
                            <button
                              type="button"
                              onClick={() => restore(c.id)}
                              title={t('income_categories.restore')}
                              aria-label={t('income_categories.restore')}
                              className="text-secondary hover:text-secondary/80 grid size-7 place-items-center rounded-md"
                            >
                              <Undo2 className="size-3.5" strokeWidth={2} />
                            </button>
                            {!c.is_system ? (
                              <button
                                type="button"
                                onClick={() => destroy(c.id, c.name, c.is_system)}
                                title={t('income_categories.delete_permanent')}
                                aria-label={t('income_categories.delete_permanent')}
                                className="text-muted-foreground hover:text-destructive grid size-7 place-items-center rounded-md font-semibold"
                              >
                                ✕
                              </button>
                            ) : null}
                          </>
                        ) : (
                          <button
                            type="button"
                            onClick={() => archive(c.id)}
                            title={t('income_categories.archive')}
                            aria-label={t('income_categories.archive')}
                            className="text-muted-foreground hover:text-destructive grid size-7 place-items-center rounded-md"
                          >
                            <Trash2 className="size-3.5" strokeWidth={1.8} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </section>

      <p className="text-muted-foreground mt-4 text-xs leading-relaxed">
        {t('income_categories.hint')}
      </p>
    </div>
  )
}
