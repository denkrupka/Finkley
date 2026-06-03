import { Edit3, Plus, X } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { useBankTxRules, useToggleBankTxRule, type BankTxRule } from '@/hooks/useBankTxRules'
import { formatExpenseDate } from '@/lib/utils/format-date'

import { BankRuleEditDialog } from './BankRuleEditDialog'

/**
 * ADR-031: список правил банкинга (скрин 3 эталонной разводки).
 *
 * Кнопка «Добавить» открывает пустой редактор. Карандаш у строки — редактор
 * с существующим правилом. Тоггл вкл/выкл апдейтит enabled инлайн.
 */
export function BankRulesDialog({
  salonId,
  open,
  onClose,
}: {
  salonId: string
  open: boolean
  onClose: () => void
}) {
  const { data: rules = [], isLoading } = useBankTxRules(salonId)
  const toggle = useToggleBankTxRule(salonId)
  const [editOpen, setEditOpen] = useState(false)
  const [editing, setEditing] = useState<BankTxRule | undefined>(undefined)

  function openCreate() {
    setEditing(undefined)
    setEditOpen(true)
  }
  function openEdit(rule: BankTxRule) {
    setEditing(rule)
    setEditOpen(true)
  }

  function handleToggle(rule: BankTxRule) {
    toggle.mutate(
      { id: rule.id, enabled: !rule.enabled },
      {
        onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
      },
    )
  }

  return (
    <>
      <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
        <DialogContent className="sm:!max-w-2xl">
          <div className="border-border flex items-start justify-between gap-3 border-b px-5 py-3">
            <div>
              <h3 className="text-foreground text-base font-bold">Автоправила</h3>
              <p className="text-muted-foreground mt-0.5 text-xs">
                Правила для автоматической разноски транзакций банка по категориям и игнор-листа.
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="text-muted-foreground hover:text-foreground rounded-md p-1"
            >
              <X className="size-4" />
            </button>
          </div>

          <div className="space-y-3 px-5 py-4">
            <Button onClick={openCreate}>
              <Plus className="size-3.5" strokeWidth={2} />
              Добавить
            </Button>

            <div className="border-border bg-card divide-border/40 max-h-[55vh] divide-y overflow-y-auto rounded-md border">
              {isLoading ? (
                <p className="text-muted-foreground px-3 py-6 text-center text-xs">Загрузка…</p>
              ) : rules.length === 0 ? (
                <p className="text-muted-foreground px-3 py-6 text-center text-xs">
                  Пусто. Нажми «Добавить», чтобы создать первое правило.
                </p>
              ) : (
                rules.map((r) => (
                  <RuleRow
                    key={r.id}
                    rule={r}
                    onEdit={() => openEdit(r)}
                    onToggle={() => handleToggle(r)}
                  />
                ))
              )}
            </div>
          </div>

          <div className="border-border flex items-center justify-end gap-2 border-t px-5 py-3">
            <Button variant="outline" size="sm" onClick={onClose}>
              Закрыть
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <BankRuleEditDialog
        salonId={salonId}
        open={editOpen}
        onOpenChange={setEditOpen}
        rule={editing}
      />
    </>
  )
}

function RuleRow({
  rule,
  onEdit,
  onToggle,
}: {
  rule: BankTxRule
  onEdit: () => void
  onToggle: () => void
}) {
  return (
    <div className="flex items-center gap-3 px-3 py-2.5">
      <span className="text-muted-foreground/60 select-none text-sm" aria-hidden>
        ≡
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-foreground truncate text-sm font-semibold">{rule.name}</p>
      </div>
      <span className="text-muted-foreground hidden text-xs sm:inline">
        Создано {formatExpenseDate(rule.created_at)}
      </span>
      <label
        className="inline-flex cursor-pointer items-center"
        title={rule.enabled ? 'Выключить' : 'Включить'}
      >
        <input
          type="checkbox"
          checked={rule.enabled}
          onChange={onToggle}
          className="peer sr-only"
        />
        <span className="bg-muted peer-checked:bg-foreground relative h-5 w-9 rounded-full transition-colors">
          <span className="bg-card absolute left-0.5 top-0.5 size-4 rounded-full shadow transition-transform peer-checked:translate-x-4" />
        </span>
      </label>
      <button
        type="button"
        onClick={onEdit}
        className="text-muted-foreground hover:text-foreground grid size-8 place-items-center rounded-md"
        aria-label="edit"
      >
        <Edit3 className="size-4" strokeWidth={1.8} />
      </button>
    </div>
  )
}
