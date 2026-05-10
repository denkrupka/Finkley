import { ClipboardCheck, Save } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { useStocktake, type InventoryItemRow } from '@/hooks/useInventory'
import { cn } from '@/lib/utils/cn'

type Props = {
  open: boolean
  onClose: () => void
  salonId: string
  items: InventoryItemRow[]
}

/**
 * Mass-stocktake: вводишь актуальный остаток для каждого материала, затем
 * нажимаешь Сохранить — для тех у кого изменилось значение, делаем
 * inventory_stocktake RPC. Видим разницу (delta) сразу для каждой строки.
 */
export function StocktakeDialog({ open, onClose, salonId, items }: Props) {
  const { t } = useTranslation()
  const stocktake = useStocktake(salonId)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [notes, setNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!open) return
    // Pre-populate с текущим стоком
    const initial: Record<string, string> = {}
    for (const it of items) initial[it.id] = String(it.current_stock)
    setDrafts(initial)
    setNotes(`${t('inventory.stocktake.default_note')} ${new Date().toLocaleDateString('ru-RU')}`)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  function deltaOf(item: InventoryItemRow): number | null {
    const v = drafts[item.id]
    if (v === undefined || v.trim() === '') return null
    const n = Number(v.replace(',', '.'))
    if (!Number.isFinite(n)) return null
    return n - item.current_stock
  }

  async function submit() {
    const changed = items.filter((it) => {
      const d = deltaOf(it)
      return d !== null && Math.abs(d) > 0.0001
    })
    if (changed.length === 0) {
      toast.info(t('inventory.stocktake.no_changes'))
      onClose()
      return
    }

    setSubmitting(true)
    let successCount = 0
    let failCount = 0
    for (const it of changed) {
      const v = Number(drafts[it.id]!.replace(',', '.'))
      try {
        await stocktake.mutateAsync({
          material_id: it.id,
          actual_stock: v,
          notes: notes.trim() || undefined,
        })
        successCount++
      } catch (err) {
        failCount++
        console.error('stocktake', it.id, err)
      }
    }
    setSubmitting(false)
    if (failCount > 0) {
      toast.error(t('inventory.stocktake.partial_fail', { ok: successCount, fail: failCount }))
    } else {
      toast.success(t('inventory.stocktake.saved', { count: successCount }))
    }
    onClose()
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:!max-w-[640px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ClipboardCheck className="text-brand-teal size-5" strokeWidth={1.8} />
            {t('inventory.stocktake.title')}
          </DialogTitle>
          <DialogDescription>{t('inventory.stocktake.subtitle')}</DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-col gap-3 overflow-y-auto px-5 pb-2 pt-4">
          {items.length === 0 ? (
            <p className="text-muted-foreground text-sm">{t('inventory.empty')}</p>
          ) : (
            <>
              <div className="text-muted-foreground grid grid-cols-[1fr_120px_120px_60px] gap-2 text-xs font-bold uppercase">
                <span>{t('inventory.stocktake.col_name')}</span>
                <span className="text-right">{t('inventory.stocktake.col_system')}</span>
                <span className="text-right">{t('inventory.stocktake.col_actual')}</span>
                <span className="text-right">Δ</span>
              </div>
              {items.map((it) => {
                const d = deltaOf(it)
                return (
                  <div
                    key={it.id}
                    className="border-border grid grid-cols-[1fr_120px_120px_60px] items-center gap-2 border-b py-2 last:border-b-0"
                  >
                    <span className="text-foreground truncate text-sm">
                      {it.name} <span className="text-muted-foreground text-xs">{it.unit}</span>
                    </span>
                    <span className="num text-muted-foreground text-right text-sm">
                      {it.current_stock}
                    </span>
                    <Input
                      type="number"
                      inputMode="decimal"
                      step="any"
                      min="0"
                      value={drafts[it.id] ?? ''}
                      onChange={(e) => setDrafts((p) => ({ ...p, [it.id]: e.target.value }))}
                      className="num h-9 text-right text-sm"
                    />
                    <span
                      className={cn(
                        'num text-right text-xs font-semibold',
                        d === null
                          ? 'text-muted-foreground/50'
                          : d > 0
                            ? 'text-brand-sage'
                            : d < 0
                              ? 'text-destructive'
                              : 'text-muted-foreground',
                      )}
                    >
                      {d === null ? '—' : d > 0 ? `+${d.toFixed(2)}` : d < 0 ? d.toFixed(2) : '0'}
                    </span>
                  </div>
                )
              })}

              <div className="mt-3 flex flex-col gap-1.5">
                <label htmlFor="stocktake-notes" className="text-xs font-semibold">
                  {t('inventory.stocktake.notes_label')}
                </label>
                <Input
                  id="stocktake-notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder={t('inventory.stocktake.notes_placeholder')}
                />
              </div>
            </>
          )}
        </div>

        <DialogFooter>
          <Button
            type="button"
            size="lg"
            onClick={submit}
            disabled={submitting || items.length === 0}
          >
            <Save className="size-4" strokeWidth={2} />
            {submitting ? t('common.loading') : t('inventory.stocktake.save_all')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
