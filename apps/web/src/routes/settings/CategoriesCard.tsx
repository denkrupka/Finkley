import { Archive, Loader2, Plus } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useParams } from 'react-router-dom'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  useCreateExpenseCategory,
  useExpenseCategories,
  useUpdateExpenseCategory,
} from '@/hooks/useExpenses'
import {
  useCreateServiceCategory,
  useServiceCategories,
  useUpdateServiceCategory,
} from '@/hooks/useServices'

/**
 * CategoriesCard — CRUD для service_categories и expense_categories.
 * Inline-edit имени, добавление новой, архивирование. Восстановление —
 * через прямой SQL/архив-таб (упрощаем; пользователь редко нужно).
 *
 * is_system категории расходов (создаются онбордингом) можно переименовать,
 * но архивирование разрешено только если в БД нет привязанных активных
 * расходов — это обработано на уровне UI confirm + RLS.
 */
export function CategoriesCard() {
  const { t } = useTranslation()
  const { salonId } = useParams<{ salonId: string }>()
  const services = useServiceCategories(salonId)
  const expenses = useExpenseCategories(salonId)
  const createService = useCreateServiceCategory(salonId)
  const updateService = useUpdateServiceCategory(salonId)
  const createExpense = useCreateExpenseCategory(salonId)
  const updateExpense = useUpdateExpenseCategory(salonId)

  const isPending =
    createService.isPending ||
    updateService.isPending ||
    createExpense.isPending ||
    updateExpense.isPending

  if (!salonId) return null

  return (
    <section className="border-border bg-card shadow-finsm rounded-lg border p-5 sm:p-6">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-brand-navy text-base font-bold tracking-tight">
            {t('settings.categories.title')}
          </h2>
          <p className="text-muted-foreground mt-1 text-sm">{t('settings.categories.subtitle')}</p>
        </div>
        {isPending ? (
          <Loader2 className="text-muted-foreground size-4 animate-spin" strokeWidth={2} />
        ) : null}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <CategoryColumn
          title={t('settings.categories.service_title')}
          items={services.data ?? []}
          onCreate={(name) =>
            createService.mutate(
              { name },
              {
                onSuccess: () => toast.success(t('settings.categories.toast_created')),
                onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
              },
            )
          }
          onRename={(id, name) =>
            updateService.mutate(
              { id, name },
              { onError: (err) => toast.error(err instanceof Error ? err.message : String(err)) },
            )
          }
          onArchive={(id) =>
            updateService.mutate(
              { id, is_archived: true },
              {
                onSuccess: () => toast.success(t('settings.categories.toast_archived')),
                onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
              },
            )
          }
        />
        <CategoryColumn
          title={t('settings.categories.expense_title')}
          items={expenses.data ?? []}
          onCreate={(name) =>
            createExpense.mutate(
              { name },
              {
                onSuccess: () => toast.success(t('settings.categories.toast_created')),
                onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
              },
            )
          }
          onRename={(id, name) =>
            updateExpense.mutate(
              { id, name },
              { onError: (err) => toast.error(err instanceof Error ? err.message : String(err)) },
            )
          }
          onArchive={(id) =>
            updateExpense.mutate(
              { id, is_archived: true },
              {
                onSuccess: () => toast.success(t('settings.categories.toast_archived')),
                onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
              },
            )
          }
        />
      </div>
    </section>
  )
}

interface CategoryItem {
  id: string
  name: string
  is_system?: boolean
}

/**
 * Системные категории, имя которых служит ключом для edge functions
 * (findSystemCategoryId(name)). Их переименование/архивирование сломает
 * ksef/wfirma/fakturownia/infakt-proxy fallback + banking-sync auto-commission
 * trigger. Остальные is_system (Аренда/Зарплата/...) — переименовываемые.
 */
const PROTECTED_SYSTEM_NAMES = new Set(['Комиссии', 'БЕЗ КАТЕГОРИИ'])

function CategoryColumn({
  title,
  items,
  onCreate,
  onRename,
  onArchive,
}: {
  title: string
  items: CategoryItem[]
  onCreate: (name: string) => void
  onRename: (id: string, name: string) => void
  onArchive: (id: string) => void
}) {
  const { t } = useTranslation()
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [newName, setNewName] = useState('')

  useEffect(() => {
    setDrafts((prev) => {
      const next = { ...prev }
      for (const it of items) if (next[it.id] === undefined) next[it.id] = it.name
      return next
    })
  }, [items])

  function commitName(id: string) {
    const v = (drafts[id] ?? '').trim()
    const orig = items.find((i) => i.id === id)?.name ?? ''
    if (!v || v === orig) return
    onRename(id, v)
  }

  function archive(id: string, isSystem?: boolean) {
    const msg = isSystem
      ? t('settings.categories.confirm_archive_system')
      : t('settings.categories.confirm_archive')
    if (!confirm(msg)) return
    onArchive(id)
  }

  function add() {
    const v = newName.trim()
    if (!v) return
    onCreate(v)
    setNewName('')
  }

  return (
    <div className="border-border rounded-md border p-4">
      <h3 className="text-foreground mb-3 text-sm font-bold tracking-tight">{title}</h3>

      <ul className="flex flex-col gap-2">
        {items.length === 0 ? (
          <li className="text-muted-foreground text-sm">{t('settings.categories.empty')}</li>
        ) : (
          items.map((it) => {
            const isProtected = it.is_system && PROTECTED_SYSTEM_NAMES.has(it.name)
            return (
              <li key={it.id} className="flex items-center gap-2">
                <Input
                  className="h-8"
                  value={drafts[it.id] ?? ''}
                  onChange={(e) => setDrafts((p) => ({ ...p, [it.id]: e.target.value }))}
                  onBlur={() => commitName(it.id)}
                  readOnly={isProtected}
                  title={
                    isProtected
                      ? 'Системная категория — её имя используется при автоматических импортах и не редактируется.'
                      : undefined
                  }
                />
                {isProtected ? (
                  <span className="text-muted-foreground/60 grid size-8 place-items-center">
                    <Archive className="size-4 opacity-30" strokeWidth={1.8} />
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => archive(it.id, it.is_system)}
                    className="text-muted-foreground hover:text-destructive grid size-8 place-items-center rounded-md transition-colors"
                    title={t('settings.categories.archive')}
                  >
                    <Archive className="size-4" strokeWidth={1.8} />
                  </button>
                )}
              </li>
            )
          })
        )}
      </ul>

      <form
        className="border-border mt-3 flex items-center gap-2 border-t pt-3"
        onSubmit={(e) => {
          e.preventDefault()
          add()
        }}
      >
        <Input
          className="h-8"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder={t('settings.categories.new_placeholder')}
        />
        <Button size="sm" type="submit" disabled={!newName.trim()}>
          <Plus className="size-4" strokeWidth={2} />
          {t('settings.categories.add')}
        </Button>
      </form>
    </div>
  )
}
