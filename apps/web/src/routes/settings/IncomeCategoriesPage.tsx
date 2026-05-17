import { ArrowLeft, ChevronDown, ChevronRight, Coins, Plus, Trash2, Undo2 } from 'lucide-react'
import { useMemo, useState } from 'react'
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
  type OtherIncomeCategoryRow,
} from '@/hooks/useOtherIncomes'
import { cn } from '@/lib/utils/cn'

/**
 * /{salonId}/settings/income-categories — справочник категорий прочих доходов.
 *
 * Image #81: ранее были две вкладки «Категории» / «Методы оплаты». По запросу
 * владельца «Методы оплаты» удалены (replaced by Кассы — см. cash_register_id
 * в визитах/расходах, миграция 20260516000001), а «Категории» больше не
 * обёрнуты в табы — содержимое сразу на странице.
 */
export function IncomeCategoriesPage() {
  const { t } = useTranslation()
  const { salonId } = useParams<{ salonId: string }>()
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
        <div className="flex items-center gap-3">
          <span className="bg-brand-sage-soft text-brand-sage grid size-10 place-items-center rounded-md">
            <Coins className="size-5" strokeWidth={1.7} />
          </span>
          <div>
            <h1 className="text-brand-navy text-2xl font-bold tracking-tight">
              {t('settings.catalogs.items.income.title')}
            </h1>
            <p className="text-muted-foreground mt-1 text-sm">
              {t('settings.catalogs.items.income.subtitle')}
            </p>
          </div>
        </div>
      </header>

      <CategoriesSection salonId={salonId} />
    </div>
  )
}

// =============================================================================
// Sub-section: Categories
// =============================================================================

export function CategoriesSection({ salonId }: { salonId: string }) {
  const { t } = useTranslation()
  const [showArchived, setShowArchived] = useState(false)
  const { data: categories = [], isLoading } = useOtherIncomeCategories(salonId, {
    includeArchived: showArchived,
  })
  const create = useCreateOtherIncomeCategory(salonId)
  const update = useUpdateOtherIncomeCategory(salonId)
  const remove = useDeleteOtherIncomeCategory(salonId)

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

  function addNew(parentId: string | null = null) {
    create.mutate(
      { name: t('income_categories.new_default_name'), parent_id: parentId },
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
      { onSuccess: () => toast.success(t('income_categories.toast_archived')) },
    )
  }

  function restore(id: string) {
    update.mutate(
      { id, is_archived: false },
      { onSuccess: () => toast.success(t('income_categories.toast_restored')) },
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
    })
  }

  // Иерархия: rootItems + childrenByParent (как ParametersCard).
  const { rootItems, childrenByParent } = useMemo(() => {
    const childrenMap = new Map<string, OtherIncomeCategoryRow[]>()
    const roots: OtherIncomeCategoryRow[] = []
    for (const c of categories) {
      if (c.parent_id) {
        const arr = childrenMap.get(c.parent_id) ?? []
        arr.push(c)
        childrenMap.set(c.parent_id, arr)
      } else {
        roots.push(c)
      }
    }
    return { rootItems: roots, childrenByParent: childrenMap }
  }, [categories])

  function renderRow(c: OtherIncomeCategoryRow, depth: number): React.ReactNode[] {
    const isEditing = editingId === c.id
    const children = childrenByParent.get(c.id) ?? []
    const hasChildren = children.length > 0
    const row = (
      <tr
        key={c.id}
        className={cn(
          'border-border/40 hover:bg-muted/20 border-t transition-colors',
          c.is_archived && 'opacity-60',
        )}
      >
        <td className="px-4 py-1.5 align-middle">
          <div className="flex min-w-0 items-center gap-1.5" style={{ paddingLeft: depth * 18 }}>
            {hasChildren ? (
              <ChevronDown className="text-muted-foreground size-3.5 shrink-0" strokeWidth={2} />
            ) : depth > 0 ? (
              <ChevronRight
                className="text-muted-foreground/50 size-3.5 shrink-0"
                strokeWidth={2}
              />
            ) : (
              <span className="w-3.5 shrink-0" />
            )}
            <Input
              value={isEditing ? draftName : c.name}
              onFocus={() => {
                if (!isEditing && !c.is_archived) startEdit(c.id, c.name)
              }}
              onChange={(e) => setDraftName(e.target.value)}
              onBlur={() => {
                if (isEditing) saveEdit()
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  ;(e.target as HTMLInputElement).blur()
                } else if (e.key === 'Escape') {
                  setEditingId(null)
                }
              }}
              disabled={c.is_archived || update.isPending}
              className="h-8 min-w-0 flex-1 text-sm"
            />
            {c.is_system ? (
              <span className="bg-brand-teal-soft text-brand-teal-deep shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider">
                {t('income_categories.badge_system')}
              </span>
            ) : null}
            {c.is_archived ? (
              <span className="bg-muted text-muted-foreground shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider">
                {t('income_categories.badge_archived')}
              </span>
            ) : null}
          </div>
        </td>
        <td className="px-4 py-1.5 text-right align-middle">
          <div className="inline-flex items-center gap-1">
            {!c.is_archived ? (
              <>
                <button
                  type="button"
                  onClick={() => addNew(c.id)}
                  title={t('income_categories.add_subcategory')}
                  aria-label={t('income_categories.add_subcategory')}
                  className="text-muted-foreground hover:text-foreground grid size-7 place-items-center rounded-md"
                  disabled={create.isPending}
                >
                  <Plus className="size-3.5" strokeWidth={2} />
                </button>
                <button
                  type="button"
                  onClick={() => archive(c.id)}
                  title={t('income_categories.archive')}
                  aria-label={t('income_categories.archive')}
                  className="text-muted-foreground hover:text-destructive grid size-7 place-items-center rounded-md"
                >
                  <Trash2 className="size-3.5" strokeWidth={1.8} />
                </button>
              </>
            ) : (
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
            )}
          </div>
        </td>
      </tr>
    )
    const childRows = children.flatMap((c) => renderRow(c, depth + 1))
    return [row, ...childRows]
  }

  return (
    <section className="border-border bg-card shadow-finsm overflow-hidden rounded-lg border">
      <header className="border-border bg-muted/10 border-b px-5 py-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h3 className="text-brand-navy text-base font-bold tracking-tight">
              {t('income_categories.section_title')}
            </h3>
            <p className="text-muted-foreground mt-0.5 text-xs">
              {t('income_categories.section_subtitle')}
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-3">
            <label className="text-muted-foreground inline-flex items-center gap-1.5 whitespace-nowrap text-xs">
              <input
                type="checkbox"
                checked={showArchived}
                onChange={(e) => setShowArchived(e.target.checked)}
                className="size-3.5"
              />
              {t('income_categories.show_archived')}
            </label>
            <Button onClick={() => addNew(null)} disabled={create.isPending}>
              <Plus className="size-4" strokeWidth={2} />
              {t('income_categories.add_position')}
            </Button>
          </div>
        </div>
      </header>

      {isLoading ? (
        <div className="text-muted-foreground p-6 text-sm">{t('common.loading')}</div>
      ) : categories.length === 0 ? (
        <div className="text-muted-foreground p-6 text-sm">{t('income_categories.empty')}</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/10 text-muted-foreground border-border text-xs uppercase tracking-wider">
              <tr>
                <th className="px-4 py-2 text-left font-semibold">
                  {t('income_categories.col_name')}
                </th>
                <th className="w-28 px-4 py-2 text-right font-semibold" />
              </tr>
            </thead>
            <tbody>{rootItems.flatMap((c) => renderRow(c, 0))}</tbody>
          </table>
        </div>
      )}

      <p className="text-muted-foreground border-border border-t px-5 py-3 text-xs leading-relaxed">
        {t('income_categories.hint')}
      </p>
    </section>
  )
}
