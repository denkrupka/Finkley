import { Pencil, Plus, Target, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  useFinancialSettings,
  useUpdateFinancialSettings,
  type FinancialSettings,
  type ParameterItem,
} from '@/hooks/useFinancialSettings'
import { formatCurrency } from '@/lib/utils/format-currency'

/**
 * IncomeBudgetsCard — «Плановые доходы по категориям». Image #120:
 * визуально мимикрирует под BudgetsCard (плановые расходы), чтобы
 * Finance → Бюджеты выглядела единообразно: одна карточка с заголовком
 * «Бюджеты по доходам», список позиций, у каждой — название + плановая
 * сумма + inline-edit с pencil-кнопкой.
 *
 * Данные: financial_settings.other_income.items (jsonb на salons.
 * financial_settings). Отдельной таблицы income_categories нет, поэтому
 * Add/Rename/Delete делаем прямо здесь — иначе юзеру некуда «завести» новый
 * тип планового дохода, в отличие от расходов (там категории живут в
 * expense_categories и редактируются в /services).
 */
export function IncomeBudgetsCard({ salonId, currency }: { salonId: string; currency: string }) {
  const { t } = useTranslation()
  const { data: settings, isLoading } = useFinancialSettings(salonId)
  const save = useUpdateFinancialSettings(salonId)

  // Локальный draft: оптимистически меняем UI, на каждом действии шлём
  // полный объект financial_settings в Supabase. На больших списках это
  // дороже отдельных мутаций, но для <20 позиций — приемлемо и проще.
  const [draft, setDraft] = useState<FinancialSettings | null>(null)
  useEffect(() => {
    if (settings) setDraft(settings)
  }, [settings])

  if (isLoading || !draft) {
    return (
      <div className="border-border bg-card shadow-finsm rounded-lg border p-5">
        <div className="bg-muted/40 h-24 animate-pulse rounded-md" />
      </div>
    )
  }

  const items = draft.other_income.items.filter((it) => !it.archived)

  function persist(next: FinancialSettings, successKey?: string) {
    setDraft(next)
    save.mutate(next, {
      onSuccess: () => {
        if (successKey) toast.success(t(successKey))
      },
      onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
    })
  }

  function updateItem(id: string, patch: Partial<ParameterItem>) {
    if (!draft) return
    const next: FinancialSettings = {
      ...draft,
      other_income: {
        items: draft.other_income.items.map((it) => (it.id === id ? { ...it, ...patch } : it)),
      },
    }
    persist(next, 'expenses.budgets.saved')
  }

  function addItem(label: string) {
    if (!draft) return
    const trimmed = label.trim()
    if (!trimmed) return
    const id = `income_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
    const next: FinancialSettings = {
      ...draft,
      other_income: {
        items: [...draft.other_income.items, { id, label: trimmed, amount_cents: 0 }],
      },
    }
    persist(next, 'expenses.budgets.saved')
  }

  function archiveItem(id: string) {
    if (!draft) return
    if (!window.confirm(t('finance.income_budgets.confirm_archive'))) return
    const next: FinancialSettings = {
      ...draft,
      other_income: {
        items: draft.other_income.items.map((it) =>
          it.id === id ? { ...it, archived: true } : it,
        ),
      },
    }
    persist(next)
  }

  return (
    <div className="border-border bg-card shadow-finsm rounded-lg border p-5">
      <div className="mb-4 flex items-center gap-2">
        <Target className="text-brand-navy size-4" strokeWidth={1.8} />
        <h2 className="text-brand-navy text-base font-bold tracking-tight">
          {t('finance.income_budgets.title')}
        </h2>
      </div>
      <div className="flex flex-col gap-3.5">
        {items.length === 0 ? (
          <p className="text-muted-foreground text-sm italic">
            {t('finance.income_budgets.empty')}
          </p>
        ) : (
          items.map((it) => (
            <IncomeRow
              key={it.id}
              item={it}
              currency={currency}
              onChange={(patch) => updateItem(it.id, patch)}
              onArchive={() => archiveItem(it.id)}
            />
          ))
        )}
      </div>
      <div className="border-border/60 mt-5 border-t pt-4">
        <AddRow onAdd={addItem} />
      </div>
    </div>
  )
}

function IncomeRow({
  item,
  currency,
  onChange,
  onArchive,
}: {
  item: ParameterItem
  currency: string
  onChange: (patch: Partial<ParameterItem>) => void
  onArchive: () => void
}) {
  const { t } = useTranslation()
  const [editing, setEditing] = useState(false)
  const [renameMode, setRenameMode] = useState(false)
  const [amountDraft, setAmountDraft] = useState(
    item.amount_cents != null ? String(item.amount_cents / 100) : '',
  )
  const [labelDraft, setLabelDraft] = useState(item.label)

  function saveAmount() {
    const trimmed = amountDraft.trim().replace(',', '.')
    const cents = trimmed === '' ? 0 : Math.round(Number(trimmed) * 100)
    if (Number.isNaN(cents) || cents < 0) {
      toast.error(t('expenses.budgets.invalid_amount'))
      return
    }
    onChange({ amount_cents: cents })
    setEditing(false)
  }

  function saveLabel() {
    const trimmed = labelDraft.trim()
    if (!trimmed) {
      toast.error(t('finance.income_budgets.label_required'))
      return
    }
    onChange({ label: trimmed })
    setRenameMode(false)
  }

  const hasAmount = (item.amount_cents ?? 0) > 0

  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        {renameMode ? (
          <div className="flex flex-1 items-center gap-2">
            <Input
              value={labelDraft}
              onChange={(e) => setLabelDraft(e.target.value)}
              className="h-8 max-w-xs text-sm"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  saveLabel()
                }
              }}
            />
            <button
              type="button"
              onClick={saveLabel}
              className="text-brand-navy text-xs font-bold hover:underline"
            >
              {t('common.save')}
            </button>
            <button
              type="button"
              onClick={() => {
                setRenameMode(false)
                setLabelDraft(item.label)
              }}
              className="text-muted-foreground text-xs hover:underline"
            >
              {t('common.cancel')}
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setRenameMode(true)}
            className="text-foreground hover:text-secondary text-sm font-medium"
            title={t('finance.income_budgets.rename_hint')}
          >
            {item.label}
          </button>
        )}
        <span className="num text-brand-navy text-sm font-bold">
          {formatCurrency(item.amount_cents ?? 0, currency)}
        </span>
      </div>
      {!hasAmount ? (
        <p className="text-muted-foreground text-xs italic">
          {t('finance.income_budgets.no_amount')}
        </p>
      ) : null}
      <div className="mt-1.5 flex items-center gap-2">
        {editing ? (
          <>
            <Input
              type="number"
              inputMode="decimal"
              min="0"
              step="any"
              value={amountDraft}
              onChange={(e) => setAmountDraft(e.target.value)}
              placeholder={t('expenses.budgets.amount_placeholder')}
              className="h-8 w-28 text-xs"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  saveAmount()
                }
              }}
            />
            <button
              type="button"
              onClick={saveAmount}
              className="text-brand-navy text-xs font-bold hover:underline"
            >
              {t('common.save')}
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing(false)
                setAmountDraft(item.amount_cents != null ? String(item.amount_cents / 100) : '')
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
              {hasAmount
                ? t('finance.income_budgets.change_amount')
                : t('finance.income_budgets.set_amount')}
            </button>
            <button
              type="button"
              onClick={onArchive}
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

function AddRow({ onAdd }: { onAdd: (label: string) => void }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [label, setLabel] = useState('')

  function submit() {
    onAdd(label)
    setLabel('')
    setOpen(false)
  }

  if (!open) {
    return (
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Plus className="size-4" strokeWidth={2} />
        {t('finance.income_budgets.add')}
      </Button>
    )
  }

  return (
    <div className="flex items-center gap-2">
      <Input
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        placeholder={t('finance.income_budgets.add_placeholder')}
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
        disabled={!label.trim()}
      >
        {t('common.save')}
      </button>
      <button
        type="button"
        onClick={() => {
          setOpen(false)
          setLabel('')
        }}
        className="text-muted-foreground text-xs hover:underline"
      >
        {t('common.cancel')}
      </button>
    </div>
  )
}
