import { Pencil, Target } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Input } from '@/components/ui/input'
import {
  useCategoryBudgets,
  useUpdateCategoryBudget,
  type CategoryBudgetRow,
} from '@/hooks/useExpenseExtras'
import { formatCurrency } from '@/lib/utils/format-currency'

/**
 * Карточка «Бюджеты по категориям» на ExpensesPage. Показывает все
 * expense_categories с прогресс-баром текущего месяца vs monthly_budget_cents.
 * Inline-edit бюджета (клик на цифру → input).
 *
 * Цвета прогресса: <70% sage, 70-100% amber, >100% destructive.
 */
export function BudgetsCard({ salonId, currency }: { salonId: string; currency: string }) {
  const { t } = useTranslation()
  const { data: rows = [] } = useCategoryBudgets(salonId)

  if (rows.length === 0) return null

  return (
    <div className="border-border bg-card shadow-finsm rounded-lg border p-5">
      <div className="mb-4 flex items-center gap-2">
        <Target className="text-brand-navy size-4" strokeWidth={1.8} />
        <h2 className="text-brand-navy text-base font-bold tracking-tight">
          {t('expenses.budgets.title')}
        </h2>
      </div>
      <div className="flex flex-col gap-3.5">
        {rows.map((row) => (
          <BudgetRow key={row.category_id} row={row} currency={currency} />
        ))}
      </div>
    </div>
  )
}

function BudgetRow({ row, currency }: { row: CategoryBudgetRow; currency: string }) {
  const { t } = useTranslation()
  const updateMutation = useUpdateCategoryBudget(undefined)
  // useUpdateCategoryBudget игнорирует первый аргумент — invalidate через
  // ['category-budgets'] всё равно сработает. Передаём undefined.
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(
    row.monthly_budget_cents != null ? String(row.monthly_budget_cents / 100) : '',
  )

  const pct = row.progress_pct ?? 0
  const barColor = pct > 100 ? 'bg-destructive' : pct > 80 ? 'bg-amber-500' : 'bg-brand-sage'

  function save() {
    const trimmed = draft.trim().replace(',', '.')
    const cents = trimmed === '' ? null : Math.round(Number(trimmed) * 100)
    if (cents != null && (Number.isNaN(cents) || cents < 0)) {
      toast.error(t('expenses.budgets.invalid_amount'))
      return
    }
    updateMutation.mutate(
      { categoryId: row.category_id, cents },
      {
        onSuccess: () => {
          toast.success(cents == null ? t('expenses.budgets.cleared') : t('expenses.budgets.saved'))
          setEditing(false)
        },
        onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
      },
    )
  }

  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <span className="text-foreground text-sm font-medium">{row.name}</span>
        <span className="num text-brand-navy text-sm font-bold">
          {formatCurrency(row.current_month_cents, currency)}
          {row.monthly_budget_cents != null ? (
            <span className="text-muted-foreground font-medium">
              {' / '}
              {formatCurrency(row.monthly_budget_cents, currency)}
            </span>
          ) : null}
        </span>
      </div>
      {row.monthly_budget_cents != null ? (
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
              step="any"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={t('expenses.budgets.amount_placeholder')}
              className="h-8 w-28 text-xs"
              autoFocus
            />
            <button
              type="button"
              onClick={save}
              className="text-brand-navy text-xs font-bold hover:underline"
              disabled={updateMutation.isPending}
            >
              {t('common.save')}
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing(false)
                setDraft(
                  row.monthly_budget_cents != null ? String(row.monthly_budget_cents / 100) : '',
                )
              }}
              className="text-muted-foreground text-xs hover:underline"
            >
              {t('common.cancel')}
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="text-secondary inline-flex items-center gap-1 text-xs font-semibold hover:underline"
          >
            <Pencil className="size-3" strokeWidth={2} />
            {row.monthly_budget_cents != null
              ? t('expenses.budgets.change_limit')
              : t('expenses.budgets.set_limit')}
          </button>
        )}
      </div>
    </div>
  )
}
