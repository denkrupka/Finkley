import { ArrowLeft, Coins, CreditCard, FolderTree, Plus, Trash2, Undo2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { PageTabsNav, type PageTab } from '@/components/ui/PageTabsNav'
import {
  useCreateOtherIncomeCategory,
  useDeleteOtherIncomeCategory,
  useOtherIncomeCategories,
  useUpdateOtherIncomeCategory,
} from '@/hooks/useOtherIncomes'
import {
  usePaymentMethods,
  useUpdatePaymentMethod,
  type PaymentMethodRow,
} from '@/hooks/usePaymentMethods'
import { cn } from '@/lib/utils/cn'

type Tab = 'categories' | 'methods'
const TABS: PageTab<Tab>[] = [
  { id: 'categories', labelKey: 'income_categories.tabs.categories', icon: FolderTree },
  { id: 'methods', labelKey: 'income_categories.tabs.methods', icon: CreditCard },
]

function isTab(v: string | null): v is Tab {
  return v === 'categories' || v === 'methods'
}

/**
 * /{salonId}/settings/income-categories — справочник «Доходы». Две подвкладки:
 *   - Категории доходов (other_income_categories): CRUD категорий прочих
 *     доходов. Используются в /income → Прочие доходы.
 *   - Методы оплаты (payment_methods): label + sort_order + is_archived
 *     для 5 системных кодов (cash/card/transfer/online/mixed). Используются
 *     везде где есть форма с выбором метода оплаты.
 */
export function IncomeCategoriesPage() {
  const { t } = useTranslation()
  const { salonId } = useParams<{ salonId: string }>()
  const [params, setParams] = useSearchParams()
  const tabParam = params.get('tab')
  const active: Tab = isTab(tabParam) ? tabParam : 'categories'

  function setActive(id: Tab) {
    const next = new URLSearchParams(params)
    next.set('tab', id)
    setParams(next, { replace: true })
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

      <PageTabsNav tabs={TABS} active={active} onChange={setActive} t={t} />

      {active === 'categories' ? (
        <CategoriesSection salonId={salonId} />
      ) : (
        <PaymentMethodsSection salonId={salonId} />
      )}
    </div>
  )
}

// =============================================================================
// Sub-section: Categories
// =============================================================================

function CategoriesSection({ salonId }: { salonId: string }) {
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

  return (
    <>
      <div className="mb-4 flex items-center justify-between gap-3">
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
                              className="text-secondary hover:text-secondary/80 grid size-7 place-items-center rounded-md"
                            >
                              <Undo2 className="size-3.5" strokeWidth={2} />
                            </button>
                            {!c.is_system ? (
                              <button
                                type="button"
                                onClick={() => destroy(c.id, c.name, c.is_system)}
                                title={t('income_categories.delete_permanent')}
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
    </>
  )
}

// =============================================================================
// Sub-section: Payment Methods
// =============================================================================

function PaymentMethodsSection({ salonId }: { salonId: string }) {
  const { t } = useTranslation()
  const [showArchived, setShowArchived] = useState(false)
  const { data: methods = [], isLoading } = usePaymentMethods(salonId, {
    includeArchived: showArchived,
  })
  const update = useUpdatePaymentMethod(salonId)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [draftLabel, setDraftLabel] = useState('')

  function startEdit(m: PaymentMethodRow) {
    setEditingId(m.id)
    setDraftLabel(m.label)
  }

  function saveEdit() {
    if (!editingId) return
    const trimmed = draftLabel.trim()
    if (trimmed.length < 1) {
      setEditingId(null)
      return
    }
    update.mutate(
      { id: editingId, label: trimmed },
      {
        onSuccess: () => {
          toast.success(t('income_categories.methods.toast_updated'))
          setEditingId(null)
        },
        onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
      },
    )
  }

  function toggleArchive(m: PaymentMethodRow) {
    update.mutate(
      { id: m.id, is_archived: !m.is_archived },
      {
        onSuccess: () =>
          toast.success(
            m.is_archived
              ? t('income_categories.toast_restored')
              : t('income_categories.toast_archived'),
          ),
        onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
      },
    )
  }

  return (
    <>
      <div className="mb-4 flex items-center justify-between gap-3">
        <label className="text-muted-foreground inline-flex items-center gap-1.5 whitespace-nowrap text-xs">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(e) => setShowArchived(e.target.checked)}
            className="size-3.5"
          />
          {t('income_categories.show_archived')}
        </label>
        <span className="text-muted-foreground text-[11px]">
          {t('income_categories.methods.no_add_hint')}
        </span>
      </div>

      <section className="border-border bg-card shadow-finsm overflow-hidden rounded-lg border">
        {isLoading ? (
          <div className="text-muted-foreground p-6 text-sm">{t('common.loading')}</div>
        ) : methods.length === 0 ? (
          <div className="text-muted-foreground p-6 text-sm">
            {t('income_categories.methods.empty')}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-border bg-muted/10 border-b">
              <tr className="text-muted-foreground text-left text-[11px] font-semibold uppercase tracking-wider">
                <th className="w-24 px-4 py-3">{t('income_categories.methods.col_code')}</th>
                <th className="px-4 py-3">{t('income_categories.methods.col_label')}</th>
                <th className="w-32 px-4 py-3 text-center">{t('income_categories.col_status')}</th>
                <th className="w-28 px-4 py-3 text-right" />
              </tr>
            </thead>
            <tbody className="divide-border divide-y">
              {methods.map((m) => {
                const isEditing = editingId === m.id
                return (
                  <tr
                    key={m.id}
                    className={cn(
                      'hover:bg-muted/30 transition-colors',
                      m.is_archived && 'opacity-60',
                    )}
                  >
                    <td className="text-muted-foreground px-4 py-2 font-mono text-xs">{m.code}</td>
                    <td className="px-4 py-2">
                      {isEditing ? (
                        <Input
                          autoFocus
                          value={draftLabel}
                          onChange={(e) => setDraftLabel(e.target.value)}
                          onBlur={saveEdit}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault()
                              saveEdit()
                            } else if (e.key === 'Escape') {
                              setEditingId(null)
                            }
                          }}
                          className="h-8 max-w-[300px]"
                          disabled={update.isPending}
                        />
                      ) : (
                        <button
                          type="button"
                          onClick={() => startEdit(m)}
                          className="text-foreground hover:text-primary text-left text-sm font-semibold"
                          disabled={m.is_archived}
                        >
                          {m.label}
                        </button>
                      )}
                    </td>
                    <td className="px-4 py-2 text-center">
                      {m.is_archived ? (
                        <span className="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider">
                          {t('income_categories.badge_archived')}
                        </span>
                      ) : (
                        <span className="bg-brand-teal-soft text-brand-teal-deep rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider">
                          {t('income_categories.methods.badge_active')}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <button
                        type="button"
                        onClick={() => toggleArchive(m)}
                        title={
                          m.is_archived
                            ? t('income_categories.restore')
                            : t('income_categories.archive')
                        }
                        className={cn(
                          'grid size-7 place-items-center rounded-md',
                          m.is_archived
                            ? 'text-secondary hover:text-secondary/80'
                            : 'text-muted-foreground hover:text-destructive',
                        )}
                      >
                        {m.is_archived ? (
                          <Undo2 className="size-3.5" strokeWidth={2} />
                        ) : (
                          <Trash2 className="size-3.5" strokeWidth={1.8} />
                        )}
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </section>

      <p className="text-muted-foreground mt-4 text-xs leading-relaxed">
        {t('income_categories.methods.hint')}
      </p>
    </>
  )
}
