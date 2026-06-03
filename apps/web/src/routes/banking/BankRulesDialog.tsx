import { Plus, Trash2, X } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { useExpenseCategories } from '@/hooks/useExpenses'
import {
  useBankTxRules,
  useCreateBankTxRule,
  useDeleteBankTxRule,
  type BankTxRule,
} from '@/hooks/useBankTxRules'

/**
 * Bug 03.06 (Денис): «Параметры» Banking — правила обработки транзакций.
 * 2 таба:
 *   - Правила (auto_create): Контрагент-pattern → Категория.
 *     При появлении tx с counterparty match → создаётся expense
 *     (source='bank_ai', BankAI badge).
 *   - Игнор-лист: Контрагенты для пропуска (личные траты — SMYK, Biedronka).
 *     Tx помечается is_personal=true, в expenses не идёт, в UI — тег «Личное».
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
  const [tab, setTab] = useState<'auto' | 'ignore'>('auto')
  const { data: rules = [] } = useBankTxRules(salonId)
  const { data: categories = [] } = useExpenseCategories(salonId)
  const create = useCreateBankTxRule(salonId)
  const del = useDeleteBankTxRule(salonId)
  const [pattern, setPattern] = useState('')
  const [categoryId, setCategoryId] = useState('')

  const autoRules = rules.filter((r) => r.action === 'auto_create')
  const ignoreRules = rules.filter((r) => r.action === 'ignore')

  function add() {
    if (!pattern.trim()) {
      toast.error('Введи название контрагента')
      return
    }
    if (tab === 'auto' && !categoryId) {
      toast.error('Выбери категорию')
      return
    }
    create.mutate(
      {
        counterparty_pattern: pattern,
        action: tab === 'auto' ? 'auto_create' : 'ignore',
        category_id: tab === 'auto' ? categoryId : null,
      },
      {
        onSuccess: () => {
          setPattern('')
          setCategoryId('')
          toast.success('Правило добавлено')
        },
        onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
      },
    )
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:!max-w-2xl">
        <div className="border-border flex items-start justify-between gap-3 border-b px-5 py-3">
          <div>
            <h3 className="text-foreground text-base font-bold">Правила банкинга</h3>
            <p className="text-muted-foreground mt-0.5 text-xs">
              Автокатегории для новых транзакций и игнор-лист личных трат.
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

        <div className="border-border bg-muted/20 flex gap-1 border-b p-1">
          <button
            type="button"
            onClick={() => setTab('auto')}
            className={`flex-1 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
              tab === 'auto'
                ? 'bg-card text-foreground shadow-finsm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            Авто-категории ({autoRules.length})
          </button>
          <button
            type="button"
            onClick={() => setTab('ignore')}
            className={`flex-1 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
              tab === 'ignore'
                ? 'bg-card text-foreground shadow-finsm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            Игнорировать ({ignoreRules.length})
          </button>
        </div>

        <div className="space-y-3 px-5 py-4">
          <p className="text-muted-foreground text-xs">
            {tab === 'auto'
              ? 'При появлении транзакции с этим контрагентом — автоматически создаётся расход в указанной категории. AI проверит что такого расхода ещё нет (по сумме/номеру/дате) чтобы не дублировать.'
              : 'Транзакции с этими контрагентами не попадут в расходы (это личные траты). В списке транзакций они получают тег «Личное». Можно вручную привязать или создать расход — тег пропадёт.'}
          </p>

          {/* Add form */}
          <div className="border-border bg-muted/10 flex flex-wrap items-end gap-2 rounded-md border p-3">
            <div className="min-w-0 flex-1">
              <label className="text-muted-foreground text-[10px] font-bold uppercase tracking-wider">
                Контрагент (часть названия)
              </label>
              <Input
                type="text"
                value={pattern}
                onChange={(e) => setPattern(e.target.value)}
                placeholder={tab === 'auto' ? 'Например: Enea' : 'Например: Biedronka'}
                className="mt-1 h-9"
              />
            </div>
            {tab === 'auto' ? (
              <div className="min-w-[180px] flex-1">
                <label className="text-muted-foreground text-[10px] font-bold uppercase tracking-wider">
                  Категория
                </label>
                <select
                  value={categoryId}
                  onChange={(e) => setCategoryId(e.target.value)}
                  className="border-border bg-card mt-1 h-9 w-full rounded-md border px-2 text-sm"
                >
                  <option value="">— выбери —</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
            <Button onClick={add} disabled={create.isPending} size="sm">
              <Plus className="size-3.5" strokeWidth={2} />
              Добавить
            </Button>
          </div>

          {/* List */}
          <div className="border-border bg-card divide-border/40 max-h-[40vh] divide-y overflow-y-auto rounded-md border">
            {(tab === 'auto' ? autoRules : ignoreRules).length === 0 ? (
              <p className="text-muted-foreground px-3 py-6 text-center text-xs">
                Пусто. Добавь правило выше.
              </p>
            ) : (
              (tab === 'auto' ? autoRules : ignoreRules).map((r: BankTxRule) => {
                const cat = categories.find((c) => c.id === r.category_id)
                return (
                  <div key={r.id} className="flex items-center justify-between gap-2 px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-foreground truncate text-sm font-semibold">
                        {r.counterparty_pattern}
                      </p>
                      {cat ? (
                        <p className="text-muted-foreground mt-0.5 truncate text-xs">
                          → {cat.name}
                        </p>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      onClick={() => del.mutate(r.id)}
                      className="text-muted-foreground hover:text-destructive grid size-8 place-items-center rounded-md"
                      aria-label="delete"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                )
              })
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
  )
}
