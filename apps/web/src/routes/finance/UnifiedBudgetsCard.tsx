import { Pencil, Plus, Target, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  useArchiveExpenseCategory,
  useCategoryBudgetsFull,
  useCreateExpenseCategory,
  useUpdateCategoryKindAndBudget,
  type CategoryBudgetFull,
} from '@/hooks/useExpenseExtras'
import { formatCurrency } from '@/lib/utils/format-currency'

/**
 * UnifiedBudgetsCard — #6/#7. Источник истины: expense_categories.
 * Категории расходов теперь имеют kind ('fixed' | 'variable') + лимит
 * (cents для fixed, % для variable). Здесь рендерим их в двух блоках с
 * progress-bar факт vs план:
 *   - Fixed: «Аренда 500/1000 PLN» — цвет sage/amber/destructive
 *   - Variable: «Расходники 4.2/5%» от выручки — те же цвета по близости
 *
 * Эти же категории видны в форме расхода (ExpenseFormModal) — там юзер
 * выбирает их в селекте. Полный круг: одна и та же категория из
 * Справочников = в Бюджетах = в форме = в Отчётах.
 */
type Kind = 'fixed' | 'variable'

export function UnifiedBudgetsCard({
  salonId,
  currency,
  kind,
}: {
  salonId: string
  currency: string
  kind: Kind
}) {
  const { t } = useTranslation()
  const { data: all = [], isLoading } = useCategoryBudgetsFull(salonId)
  const create = useCreateExpenseCategory(salonId)

  const rows = all.filter((c) => c.kind === kind)
  const titleKey =
    kind === 'fixed'
      ? 'finance.section_budgets.fixed_title'
      : 'finance.section_budgets.variable_title'
  const emptyKey =
    kind === 'fixed'
      ? 'finance.section_budgets.fixed_empty'
      : 'finance.section_budgets.variable_empty'
  const addKey =
    kind === 'fixed' ? 'finance.section_budgets.fixed_add' : 'finance.section_budgets.variable_add'
  const addPhKey =
    kind === 'fixed'
      ? 'finance.section_budgets.fixed_add_placeholder'
      : 'finance.section_budgets.variable_add_placeholder'

  if (isLoading) {
    return (
      <div className="border-border bg-card shadow-finsm rounded-lg border p-5">
        <div className="bg-muted/40 h-24 animate-pulse rounded-md" />
      </div>
    )
  }

  function handleAdd(name: string) {
    create.mutate(
      {
        name,
        kind,
        monthly_budget_cents: kind === 'fixed' ? 0 : null,
        monthly_budget_pct: kind === 'variable' ? 0 : null,
      },
      {
        onSuccess: () => toast.success(t('expenses.budgets.saved')),
        onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
      },
    )
  }

  return (
    <div className="border-border bg-card shadow-finsm rounded-lg border p-5">
      <div className="mb-4 flex items-center gap-2">
        <Target className="text-brand-navy size-4" strokeWidth={1.8} />
        <h2 className="text-brand-navy text-base font-bold tracking-tight">{t(titleKey)}</h2>
      </div>
      <div className="flex flex-col gap-3.5">
        {rows.length === 0 ? (
          <p className="text-muted-foreground text-sm italic">{t(emptyKey)}</p>
        ) : (
          rows.map((row) => (
            <UnifiedBudgetRow
              key={row.category_id}
              row={row}
              salonId={salonId}
              currency={currency}
            />
          ))
        )}
      </div>
      <div className="border-border/60 mt-5 border-t pt-4">
        <AddRow label={t(addKey)} placeholder={t(addPhKey)} onAdd={handleAdd} />
      </div>
    </div>
  )
}

function UnifiedBudgetRow({
  row,
  salonId,
  currency,
}: {
  row: CategoryBudgetFull
  salonId: string
  currency: string
}) {
  const { t } = useTranslation()
  const updateMut = useUpdateCategoryKindAndBudget(salonId)
  const archive = useArchiveExpenseCategory(salonId)
  const [editing, setEditing] = useState(false)
  const initialDraft =
    row.kind === 'fixed'
      ? row.monthly_budget_cents != null
        ? String(row.monthly_budget_cents / 100)
        : ''
      : row.monthly_budget_pct != null
        ? String(row.monthly_budget_pct)
        : ''
  const [draft, setDraft] = useState(initialDraft)

  const pct = row.progress_pct ?? 0
  const barColor = pct > 100 ? 'bg-destructive' : pct > 80 ? 'bg-amber-500' : 'bg-brand-sage'

  const hasPlan =
    row.kind === 'fixed'
      ? row.monthly_budget_cents != null && row.monthly_budget_cents > 0
      : row.monthly_budget_pct != null && row.monthly_budget_pct > 0

  function save() {
    const trimmed = draft.trim().replace(',', '.')
    const num = trimmed === '' ? 0 : Number(trimmed)
    if (Number.isNaN(num) || num < 0) {
      toast.error(t('expenses.budgets.invalid_amount'))
      return
    }
    updateMut.mutate(
      row.kind === 'fixed'
        ? { categoryId: row.category_id, monthly_budget_cents: Math.round(num * 100) }
        : { categoryId: row.category_id, monthly_budget_pct: Math.min(100, num) },
      {
        onSuccess: () => {
          toast.success(t('expenses.budgets.saved'))
          setEditing(false)
        },
        onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
      },
    )
  }

  function archiveThis() {
    if (!window.confirm(t('finance.section_budgets.confirm_archive'))) return
    archive.mutate(row.category_id, {
      onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
    })
  }

  // Дисплей факта vs плана.
  const factStr =
    row.kind === 'fixed'
      ? formatCurrency(row.current_month_cents, currency)
      : row.progress_pct != null
        ? `${row.progress_pct.toFixed(1)}%`
        : '—'
  const planStr =
    row.kind === 'fixed'
      ? row.monthly_budget_cents != null
        ? formatCurrency(row.monthly_budget_cents, currency)
        : null
      : row.monthly_budget_pct != null
        ? `${row.monthly_budget_pct.toFixed(1)}%`
        : null

  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <span className="text-foreground text-sm font-medium">{row.name}</span>
        <span className="num text-brand-navy text-sm font-bold">
          {factStr}
          {planStr ? <span className="text-muted-foreground font-medium"> / {planStr}</span> : null}
        </span>
      </div>
      {hasPlan ? (
        <div className="bg-background h-2.5 overflow-hidden rounded-full">
          <div
            className={`${barColor} h-full rounded-full transition-all`}
            style={{ width: `${Math.min(100, pct)}%` }}
          />
        </div>
      ) : (
        <p className="text-muted-foreground text-xs italic">{t('expenses.budgets.no_limit')}</p>
      )}
      <div className="mt-1.5 flex items-center gap-2">
        {editing ? (
          <>
            <Input
              type="number"
              inputMode="decimal"
              min="0"
              step={row.kind === 'fixed' ? 'any' : '0.1'}
              max={row.kind === 'variable' ? 100 : undefined}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className="h-8 w-28 text-xs"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  save()
                }
              }}
            />
            {row.kind === 'variable' ? (
              <span className="text-muted-foreground text-xs">%</span>
            ) : null}
            <button
              type="button"
              onClick={save}
              className="text-brand-navy text-xs font-bold hover:underline"
              disabled={updateMut.isPending}
            >
              {t('common.save')}
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing(false)
                setDraft(initialDraft)
              }}
              className="text-muted-foreground text-xs hover:underline"
            >
              {t('common.cancel')}
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="text-secondary inline-flex items-center gap-1 text-xs font-semibold hover:underline"
            >
              <Pencil className="size-3" strokeWidth={2} />
              {hasPlan
                ? t('finance.section_budgets.change')
                : row.kind === 'fixed'
                  ? t('finance.section_budgets.set_amount')
                  : t('finance.section_budgets.set_pct')}
            </button>
            <button
              type="button"
              onClick={archiveThis}
              className="text-muted-foreground hover:text-destructive ml-auto inline-flex items-center gap-1 text-xs"
              aria-label={t('common.delete')}
              title={t('common.delete')}
            >
              <Trash2 className="size-3" strokeWidth={1.8} />
            </button>
          </>
        )}
      </div>
    </div>
  )
}

function AddRow({
  label,
  placeholder,
  onAdd,
}: {
  label: string
  placeholder: string
  onAdd: (label: string) => void
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')

  function submit() {
    onAdd(name)
    setName('')
    setOpen(false)
  }

  if (!open) {
    return (
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Plus className="size-4" strokeWidth={2} />
        {label}
      </Button>
    )
  }
  return (
    <div className="flex items-center gap-2">
      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={placeholder}
        className="h-8 max-w-xs text-sm"
        autoFocus
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            submit()
          }
        }}
      />
      <button
        type="button"
        onClick={submit}
        className="text-brand-navy text-xs font-bold hover:underline"
        disabled={!name.trim()}
      >
        {t('common.save')}
      </button>
      <button
        type="button"
        onClick={() => {
          setOpen(false)
          setName('')
        }}
        className="text-muted-foreground text-xs hover:underline"
      >
        {t('common.cancel')}
      </button>
    </div>
  )
}
