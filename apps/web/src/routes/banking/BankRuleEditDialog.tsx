import { Plus, Trash2, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  useCreateBankTxRule,
  useDeleteBankTxRule,
  useUpdateBankTxRule,
  type BankTxRule,
} from '@/hooks/useBankTxRules'
import { useExpenseCategories } from '@/hooks/useExpenses'
import { useOtherIncomeCategories } from '@/hooks/useOtherIncomes'
import {
  BankTxRuleInputSchema,
  ruleNumberFields,
  ruleNumberOps,
  ruleTextFields,
  ruleTextOps,
  type RuleAction,
  type RuleAppliesTo,
  type RuleCondition,
  type RuleNumberField,
  type RuleNumberOp,
  type RuleTextField,
  type RuleTextOp,
} from '@/lib/banking/bank-rule-schema'
import { cn } from '@/lib/utils/cn'

/**
 * ADR-031: редактор bank_tx_rule.
 *
 * Скрины эталона — 1, 2 (Финкли 03.06):
 *  - Имя + тоггл вкл/выкл
 *  - Доход/Расход/Оба
 *  - N условий (field+op+value), AND
 *  - N действий (set_category / set_counterparty / ignore)
 *  - Кнопки Сохранить / Отмена / Удалить
 */
export function BankRuleEditDialog({
  salonId,
  open,
  onOpenChange,
  rule,
}: {
  salonId: string
  open: boolean
  onOpenChange: (v: boolean) => void
  /** undefined → create-mode, иначе edit-mode. */
  rule: BankTxRule | undefined
}) {
  const { data: expenseCategoriesData = [] } = useExpenseCategories(salonId)
  const { data: incomeCategoriesData = [] } = useOtherIncomeCategories(salonId)
  const create = useCreateBankTxRule(salonId)
  const update = useUpdateBankTxRule(salonId)
  const del = useDeleteBankTxRule(salonId)

  const [name, setName] = useState('')
  const [enabled, setEnabled] = useState(true)
  const [appliesTo, setAppliesTo] = useState<RuleAppliesTo>('expense')
  const [conditions, setConditions] = useState<RuleCondition[]>([
    { field: 'counterparty', op: 'contains', value: '' },
  ])
  const [actions, setActions] = useState<RuleAction[]>([])

  // Hydrate state from rule на каждое открытие/смену rule.
  useEffect(() => {
    if (!open) return
    if (rule) {
      setName(rule.name)
      setEnabled(rule.enabled)
      setAppliesTo(rule.applies_to)
      setConditions(
        rule.conditions.length > 0
          ? rule.conditions
          : [{ field: 'counterparty', op: 'contains', value: '' }],
      )
      setActions(rule.actions)
    } else {
      setName('')
      setEnabled(true)
      setAppliesTo('expense')
      setConditions([{ field: 'counterparty', op: 'contains', value: '' }])
      setActions([])
    }
  }, [open, rule])

  function addCondition() {
    setConditions((arr) => [...arr, { field: 'counterparty', op: 'contains', value: '' }])
  }
  function removeCondition(idx: number) {
    setConditions((arr) => arr.filter((_, i) => i !== idx))
  }
  function patchCondition(idx: number, patch: Partial<RuleCondition>) {
    setConditions((arr) =>
      arr.map((c, i) => {
        if (i !== idx) return c
        const next = { ...c, ...patch } as RuleCondition
        return next
      }),
    )
  }

  // Активный набор категорий зависит от applies_to. set_category хранит
  // UUID; для income это id из other_income_categories, для expense —
  // из expense_categories. Banking-sync edge function знает по applies_to
  // правила в какую таблицу класть результат.
  const activeCategories = appliesTo === 'income' ? incomeCategoriesData : expenseCategoriesData

  // При переключении applies_to сбрасываем category_id в set_category-
  // actions: id из другой таблицы не валиден. Юзер заново выбирает.
  useEffect(() => {
    setActions((arr) =>
      arr.map((a) => {
        if (a.type !== 'set_category') return a
        return { type: 'set_category', category_id: activeCategories[0]?.id ?? '' }
      }),
    )
    // applies_to — единственный триггер, activeCategories пересчитывается
    // как side-effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appliesTo])

  function addAction() {
    const first = activeCategories[0]
    if (!first) {
      setActions((arr) => [...arr, { type: 'set_counterparty', counterparty: '' }])
      return
    }
    setActions((arr) => [...arr, { type: 'set_category', category_id: first.id }])
  }
  function removeAction(idx: number) {
    setActions((arr) => arr.filter((_, i) => i !== idx))
  }
  function patchAction(idx: number, next: RuleAction) {
    setActions((arr) => arr.map((a, i) => (i === idx ? next : a)))
  }

  async function save() {
    const parsed = BankTxRuleInputSchema.safeParse({
      name,
      enabled,
      applies_to: appliesTo,
      conditions,
      actions,
      sort_order: rule?.sort_order ?? 0,
    })
    if (!parsed.success) {
      const first = parsed.error.issues[0]
      toast.error(first?.message ?? 'Невалидное правило')
      return
    }
    try {
      if (rule) {
        await update.mutateAsync({ id: rule.id, patch: parsed.data })
        toast.success('Правило обновлено')
      } else {
        await create.mutateAsync(parsed.data)
        toast.success('Правило добавлено')
      }
      onOpenChange(false)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    }
  }

  async function handleDelete() {
    if (!rule) return
    if (!confirm(`Удалить правило «${rule.name}»?`)) return
    try {
      await del.mutateAsync(rule.id)
      toast.success('Правило удалено')
      onOpenChange(false)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:!max-w-3xl">
        <div className="border-border flex items-start justify-between gap-3 border-b px-5 py-3">
          <h3 className="text-foreground text-base font-bold">
            {rule ? 'Редактирование правила' : 'Новое правило'}
          </h3>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="text-muted-foreground hover:text-foreground rounded-md p-1"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="max-h-[70vh] space-y-4 overflow-y-auto px-5 py-4">
          {/* Имя + тоггл */}
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-4">
            <div className="w-full min-w-0 sm:min-w-[260px] sm:flex-1">
              <label className="text-muted-foreground text-[10px] font-bold uppercase tracking-wider">
                Имя
              </label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Например: FACEBOOK"
                className="mt-1 h-10"
              />
            </div>
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={!enabled}
                onChange={(e) => setEnabled(!e.target.checked)}
                className="size-4 cursor-pointer"
              />
              <span className="text-muted-foreground">Выключить правило</span>
            </label>
          </div>

          {/* Доход / Расход / Оба */}
          <div>
            <p className="text-foreground mb-2 text-sm font-semibold">
              Правило будет применяться для:
            </p>
            <div className="flex gap-2">
              <Pill active={appliesTo === 'income'} onClick={() => setAppliesTo('income')}>
                Доход
              </Pill>
              <Pill active={appliesTo === 'expense'} onClick={() => setAppliesTo('expense')}>
                Расход
              </Pill>
              <Pill active={appliesTo === 'both'} onClick={() => setAppliesTo('both')}>
                Оба
              </Pill>
            </div>
          </div>

          <SectionDivider label="Условие" />

          <div className="space-y-2">
            {conditions.map((c, idx) => (
              <ConditionRow
                key={idx}
                condition={c}
                onChange={(patch) => patchCondition(idx, patch)}
                onRemove={conditions.length > 1 ? () => removeCondition(idx) : undefined}
              />
            ))}
            <AddRowButton onClick={addCondition}>Добавить ещё одно условие</AddRowButton>
          </div>

          <SectionDivider label="Выбрать" />

          <div className="space-y-2">
            {actions.map((a, idx) => (
              <ActionRow
                key={idx}
                action={a}
                categories={activeCategories
                  .filter(
                    (c) => !(c.is_system && (c.name === 'Комиссии' || c.name === 'БЕЗ КАТЕГОРИИ')),
                  )
                  .map((c) => ({ id: c.id, name: c.name }))}
                onChange={(next) => patchAction(idx, next)}
                onRemove={() => removeAction(idx)}
              />
            ))}
            <AddRowButton onClick={addAction}>Добавить ещё одно действие</AddRowButton>
          </div>
        </div>

        <div className="border-border flex flex-col gap-2 border-t px-5 py-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            <Button
              onClick={save}
              disabled={create.isPending || update.isPending}
              className="w-full sm:w-auto"
            >
              Сохранить изменения
            </Button>
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              className="w-full sm:w-auto"
            >
              Отмена изменений
            </Button>
          </div>
          {rule ? (
            <Button
              variant="outline"
              onClick={handleDelete}
              disabled={del.isPending}
              className="text-destructive hover:bg-destructive/10 border-destructive/30 w-full sm:w-auto"
            >
              Удалить правило
            </Button>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function Pill({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-full px-4 py-1.5 text-sm font-semibold transition-colors',
        active ? 'bg-foreground text-background' : 'text-muted-foreground hover:bg-muted/40',
      )}
    >
      {children}
    </button>
  )
}

function SectionDivider({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 py-1">
      <div className="border-border h-px flex-1 border-t" />
      <span className="text-muted-foreground text-xs font-semibold uppercase tracking-wider">
        {label}
      </span>
      <div className="border-border h-px flex-1 border-t" />
    </div>
  )
}

function AddRowButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="border-border text-muted-foreground hover:text-foreground hover:border-foreground/40 flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed py-2.5 text-sm font-medium transition-colors"
    >
      <Plus className="size-3.5" strokeWidth={2} />
      {children}
    </button>
  )
}

const FIELD_LABELS_RU: Record<RuleTextField | RuleNumberField, string> = {
  counterparty: 'Контрагент',
  description: 'Комментарий',
  amount: 'Сумма',
  amount_abs: '|Сумма|',
}

const TEXT_OP_LABELS_RU: Record<RuleTextOp, string> = {
  contains: 'Содержит',
  not_contains: 'Не содержит',
  equals: 'Равно',
  starts_with: 'Начинается с',
  ends_with: 'Заканчивается на',
  regex: 'Регулярка',
}

const NUMBER_OP_LABELS_RU: Record<RuleNumberOp, string> = {
  equals: 'Равно',
  gt: 'Больше',
  gte: 'Больше или равно',
  lt: 'Меньше',
  lte: 'Меньше или равно',
}

function isTextField(f: string): f is RuleTextField {
  return (ruleTextFields as readonly string[]).includes(f)
}

function ConditionRow({
  condition,
  onChange,
  onRemove,
}: {
  condition: RuleCondition
  onChange: (patch: Partial<RuleCondition>) => void
  onRemove?: () => void
}) {
  const isText = isTextField(condition.field)

  function handleFieldChange(nextField: string) {
    if (isTextField(nextField)) {
      // text → text: оставляем op если он text, иначе contains.
      const nextOp: RuleTextOp = (ruleTextOps as readonly string[]).includes(condition.op)
        ? (condition.op as RuleTextOp)
        : 'contains'
      onChange({
        field: nextField as RuleTextField,
        op: nextOp,
        value: typeof condition.value === 'string' ? condition.value : '',
      })
    } else {
      const nextOp: RuleNumberOp = (ruleNumberOps as readonly string[]).includes(condition.op)
        ? (condition.op as RuleNumberOp)
        : 'gte'
      onChange({
        field: nextField as RuleNumberField,
        op: nextOp,
        value: typeof condition.value === 'number' ? condition.value : 0,
      })
    }
  }

  return (
    <div className="border-border bg-muted/10 relative flex flex-col gap-2 rounded-md border p-3 sm:flex-row sm:flex-wrap sm:items-end">
      <div className="w-full min-w-0 sm:min-w-[140px] sm:flex-1">
        <label className="text-muted-foreground text-[10px] font-bold uppercase tracking-wider">
          Поле
        </label>
        <Select value={condition.field} onValueChange={handleFieldChange}>
          <SelectTrigger className="mt-1 h-10">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {[...ruleTextFields, ...ruleNumberFields].map((f) => (
              <SelectItem key={f} value={f}>
                {FIELD_LABELS_RU[f]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="w-full min-w-0 sm:min-w-[140px] sm:flex-1">
        <label className="text-muted-foreground text-[10px] font-bold uppercase tracking-wider">
          Условие
        </label>
        <Select
          value={condition.op}
          onValueChange={(v) => onChange({ op: v } as Partial<RuleCondition>)}
        >
          <SelectTrigger className="mt-1 h-10">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {isText
              ? ruleTextOps.map((op) => (
                  <SelectItem key={op} value={op}>
                    {TEXT_OP_LABELS_RU[op]}
                  </SelectItem>
                ))
              : ruleNumberOps.map((op) => (
                  <SelectItem key={op} value={op}>
                    {NUMBER_OP_LABELS_RU[op]}
                  </SelectItem>
                ))}
          </SelectContent>
        </Select>
      </div>
      <div className="w-full min-w-0 sm:min-w-[200px] sm:flex-[2]">
        <label className="text-muted-foreground text-[10px] font-bold uppercase tracking-wider">
          {isText ? 'Текст' : 'Сумма (PLN)'}
        </label>
        {isText ? (
          <Input
            value={String(condition.value ?? '')}
            onChange={(e) => onChange({ value: e.target.value } as Partial<RuleCondition>)}
            className="mt-1 h-10"
          />
        ) : (
          <Input
            type="number"
            step="0.01"
            value={typeof condition.value === 'number' ? (condition.value / 100).toFixed(2) : ''}
            onChange={(e) => {
              const pln = parseFloat(e.target.value)
              const cents = Number.isFinite(pln) ? Math.round(pln * 100) : 0
              onChange({ value: cents } as Partial<RuleCondition>)
            }}
            className="mt-1 h-10"
          />
        )}
      </div>
      {onRemove ? (
        <button
          type="button"
          onClick={onRemove}
          className="text-muted-foreground hover:text-destructive absolute right-2 top-2 grid size-8 place-items-center rounded-md sm:static sm:size-10"
          aria-label="delete"
        >
          <Trash2 className="size-4" />
        </button>
      ) : null}
    </div>
  )
}

const ACTION_TYPE_LABELS_RU: Record<RuleAction['type'], string> = {
  set_category: 'Категорию',
  set_counterparty: 'Контрагента',
  ignore: 'Игнорировать',
}

function ActionRow({
  action,
  categories,
  onChange,
  onRemove,
}: {
  action: RuleAction
  categories: { id: string; name: string }[]
  onChange: (next: RuleAction) => void
  onRemove: () => void
}) {
  function handleTypeChange(t: RuleAction['type']) {
    if (t === 'set_category') {
      onChange({ type: 'set_category', category_id: categories[0]?.id ?? '' })
    } else if (t === 'set_counterparty') {
      onChange({ type: 'set_counterparty', counterparty: '' })
    } else {
      onChange({ type: 'ignore' })
    }
  }
  const availableTypes = ['set_category', 'set_counterparty', 'ignore'] as const

  return (
    <div className="border-border bg-muted/10 relative flex flex-col gap-2 rounded-md border p-3 sm:flex-row sm:flex-wrap sm:items-end">
      <div className="w-full min-w-0 sm:min-w-[160px] sm:flex-1">
        <label className="text-muted-foreground text-[10px] font-bold uppercase tracking-wider">
          Действие
        </label>
        <Select
          value={action.type}
          onValueChange={(v) => handleTypeChange(v as RuleAction['type'])}
        >
          <SelectTrigger className="mt-1 h-10">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {availableTypes.map((t) => (
              <SelectItem key={t} value={t}>
                {ACTION_TYPE_LABELS_RU[t]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="w-full min-w-0 sm:min-w-[200px] sm:flex-[2]">
        {action.type === 'set_category' ? (
          <>
            <label className="text-muted-foreground text-[10px] font-bold uppercase tracking-wider">
              Категория
            </label>
            <Select
              value={action.category_id}
              onValueChange={(v) => onChange({ type: 'set_category', category_id: v })}
            >
              <SelectTrigger className="mt-1 h-10">
                <SelectValue placeholder="— выбери —" />
              </SelectTrigger>
              <SelectContent>
                {categories.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </>
        ) : action.type === 'set_counterparty' ? (
          <>
            <label className="text-muted-foreground text-[10px] font-bold uppercase tracking-wider">
              Имя контрагента
            </label>
            <Input
              value={action.counterparty}
              onChange={(e) => onChange({ type: 'set_counterparty', counterparty: e.target.value })}
              className="mt-1 h-10"
            />
          </>
        ) : (
          <p className="text-muted-foreground mt-6 text-xs">
            Транзакция будет помечена как личная (тег «Личное») и не попадёт в расходы.
          </p>
        )}
      </div>
      <button
        type="button"
        onClick={onRemove}
        className="text-muted-foreground hover:text-destructive absolute right-2 top-2 grid size-8 place-items-center rounded-md sm:static sm:size-10"
        aria-label="delete"
      >
        <Trash2 className="size-4" />
      </button>
    </div>
  )
}
