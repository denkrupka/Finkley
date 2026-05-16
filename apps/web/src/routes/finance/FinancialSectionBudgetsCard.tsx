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
 * FinancialSectionBudgetsCard — image #128. Универсальная карточка для
 * блоков «Постоянные расходы» (kind='money') и «Переменные расходы»
 * (kind='pct') в Бюджетах. Список тянется НЕ из expense_categories, а
 * напрямую из financial_settings — это тот же источник, что и в
 * Справочниках, чтобы Бюджеты и Справочники всегда были синхронизированы.
 *
 * Для kind='money' хранится amount_cents, для kind='pct' — pct (0..100).
 *
 * Inline-edit + rename + archive (soft-delete) + add. Все мутации шлют
 * полный financial_settings в Supabase — для <30 позиций это нормально.
 */
type Section = 'fixed' | 'variable'

type Props = {
  salonId: string
  currency: string
  section: Section
  /** money = деньги (для fixed), pct = проценты (для variable). */
  kind: 'money' | 'pct'
  title: string
  emptyHint: string
  addLabel: string
  addPlaceholder: string
}

export function FinancialSectionBudgetsCard({
  salonId,
  currency,
  section,
  kind,
  title,
  emptyHint,
  addLabel,
  addPlaceholder,
}: Props) {
  const { t } = useTranslation()
  const { data: settings, isLoading } = useFinancialSettings(salonId)
  const save = useUpdateFinancialSettings(salonId)

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

  const items = draft[section].items.filter((it) => !it.archived)

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
      [section]: {
        items: draft[section].items.map((it) => (it.id === id ? { ...it, ...patch } : it)),
      },
    }
    persist(next, 'expenses.budgets.saved')
  }

  function addItem(label: string) {
    if (!draft) return
    const trimmed = label.trim()
    if (!trimmed) return
    const id = `${section}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
    const newItem: ParameterItem =
      kind === 'money'
        ? { id, label: trimmed, amount_cents: 0, period: 'month' }
        : { id, label: trimmed, pct: 0 }
    const next: FinancialSettings = {
      ...draft,
      [section]: { items: [...draft[section].items, newItem] },
    }
    persist(next, 'expenses.budgets.saved')
  }

  function archiveItem(id: string) {
    if (!draft) return
    if (!window.confirm(t('finance.section_budgets.confirm_archive'))) return
    const next: FinancialSettings = {
      ...draft,
      [section]: {
        items: draft[section].items.map((it) => (it.id === id ? { ...it, archived: true } : it)),
      },
    }
    persist(next)
  }

  return (
    <div className="border-border bg-card shadow-finsm rounded-lg border p-5">
      <div className="mb-4 flex items-center gap-2">
        <Target className="text-brand-navy size-4" strokeWidth={1.8} />
        <h2 className="text-brand-navy text-base font-bold tracking-tight">{title}</h2>
      </div>
      <div className="flex flex-col gap-3.5">
        {items.length === 0 ? (
          <p className="text-muted-foreground text-sm italic">{emptyHint}</p>
        ) : (
          items.map((it) => (
            <SectionRow
              key={it.id}
              item={it}
              kind={kind}
              currency={currency}
              onChange={(patch) => updateItem(it.id, patch)}
              onArchive={() => archiveItem(it.id)}
            />
          ))
        )}
      </div>
      <div className="border-border/60 mt-5 border-t pt-4">
        <AddRow label={addLabel} placeholder={addPlaceholder} onAdd={addItem} />
      </div>
    </div>
  )
}

function SectionRow({
  item,
  kind,
  currency,
  onChange,
  onArchive,
}: {
  item: ParameterItem
  kind: 'money' | 'pct'
  currency: string
  onChange: (patch: Partial<ParameterItem>) => void
  onArchive: () => void
}) {
  const { t } = useTranslation()
  const [editing, setEditing] = useState(false)
  const [renameMode, setRenameMode] = useState(false)
  const initialValue =
    kind === 'money'
      ? item.amount_cents != null
        ? String(item.amount_cents / 100)
        : ''
      : item.pct != null
        ? String(item.pct)
        : ''
  const [valueDraft, setValueDraft] = useState(initialValue)
  const [labelDraft, setLabelDraft] = useState(item.label)

  function saveValue() {
    const trimmed = valueDraft.trim().replace(',', '.')
    const num = trimmed === '' ? 0 : Number(trimmed)
    if (Number.isNaN(num) || num < 0) {
      toast.error(t('expenses.budgets.invalid_amount'))
      return
    }
    if (kind === 'money') {
      onChange({ amount_cents: Math.round(num * 100) })
    } else {
      // % принимаем 0..100, ограничиваем по верху чтобы не было «250%».
      onChange({ pct: Math.min(100, num) })
    }
    setEditing(false)
  }

  function saveLabel() {
    const trimmed = labelDraft.trim()
    if (!trimmed) {
      toast.error(t('finance.section_budgets.label_required'))
      return
    }
    onChange({ label: trimmed })
    setRenameMode(false)
  }

  const hasValue = kind === 'money' ? (item.amount_cents ?? 0) > 0 : (item.pct ?? 0) > 0
  const displayValue =
    kind === 'money'
      ? formatCurrency(item.amount_cents ?? 0, currency)
      : `${(item.pct ?? 0).toFixed(item.pct && item.pct % 1 !== 0 ? 1 : 0)}%`

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
            title={t('finance.section_budgets.rename_hint')}
          >
            {item.label}
          </button>
        )}
        <span className="num text-brand-navy text-sm font-bold">{displayValue}</span>
      </div>
      {!hasValue ? (
        <p className="text-muted-foreground text-xs italic">
          {kind === 'money'
            ? t('finance.section_budgets.no_amount')
            : t('finance.section_budgets.no_pct')}
        </p>
      ) : null}
      <div className="mt-1.5 flex items-center gap-2">
        {editing ? (
          <>
            <Input
              type="number"
              inputMode="decimal"
              min="0"
              step={kind === 'money' ? 'any' : '0.1'}
              max={kind === 'pct' ? 100 : undefined}
              value={valueDraft}
              onChange={(e) => setValueDraft(e.target.value)}
              placeholder={kind === 'money' ? '0' : '0'}
              className="h-8 w-28 text-xs"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  saveValue()
                }
              }}
            />
            {kind === 'pct' ? <span className="text-muted-foreground text-xs">%</span> : null}
            <button
              type="button"
              onClick={saveValue}
              className="text-brand-navy text-xs font-bold hover:underline"
            >
              {t('common.save')}
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing(false)
                setValueDraft(initialValue)
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
              {hasValue
                ? t('finance.section_budgets.change')
                : kind === 'money'
                  ? t('finance.section_budgets.set_amount')
                  : t('finance.section_budgets.set_pct')}
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
