import type { UseMutationResult } from '@tanstack/react-query'
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
import { Label } from '@/components/ui/label'
import type { InventoryItemRow } from '@/hooks/useInventory'

type ApplyArgs = {
  material_id: string
  type: 'purchase' | 'manual_adjustment' | 'waste'
  quantity: number
  cost_cents?: number | null
  notes?: string | null
}

type Props = {
  open: boolean
  onClose: () => void
  salonId: string
  item: InventoryItemRow
  currency: string
  type: 'purchase' | 'manual_adjustment' | 'waste'
  applyMutation: UseMutationResult<number, Error, ApplyArgs>
}

export function InventoryTxDialog({ open, onClose, item, currency, type, applyMutation }: Props) {
  const { t } = useTranslation()
  const [quantity, setQuantity] = useState('')
  const [cost, setCost] = useState('')
  const [notes, setNotes] = useState('')
  const [adjustDirection, setAdjustDirection] = useState<'+' | '-'>('+')

  useEffect(() => {
    if (!open) return
    setQuantity('')
    setCost('')
    setNotes('')
    setAdjustDirection('+')
  }, [open, type])

  function submit() {
    const qNum = Number(quantity.replace(',', '.'))
    if (!Number.isFinite(qNum) || qNum <= 0) {
      toast.error(t('inventory.errors.qty_invalid'))
      return
    }
    let signedQty = qNum
    if (type === 'waste') signedQty = -qNum
    if (type === 'manual_adjustment') signedQty = adjustDirection === '+' ? qNum : -qNum
    // purchase = positive

    const costNum = cost.trim() === '' ? null : Number(cost.replace(',', '.'))
    if (costNum !== null && (!Number.isFinite(costNum) || costNum < 0)) {
      toast.error(t('inventory.errors.cost_invalid'))
      return
    }
    const costCents = costNum !== null ? Math.round(costNum * 100) : null

    applyMutation.mutate(
      {
        material_id: item.id,
        type,
        quantity: signedQty,
        cost_cents: costCents,
        notes: notes.trim() || null,
      },
      {
        onSuccess: (newStock) => {
          toast.success(t('inventory.toast_tx_applied'), {
            description: `${item.name}: ${newStock} ${item.unit}`,
          })
          onClose()
        },
        onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
      },
    )
  }

  const currencySymbol = currency === 'EUR' ? '€' : currency === 'USD' ? '$' : currency
  const titleKey =
    type === 'purchase'
      ? 'inventory.tx_dialog.purchase_title'
      : type === 'manual_adjustment'
        ? 'inventory.tx_dialog.adjust_title'
        : 'inventory.tx_dialog.waste_title'
  const subtitleKey =
    type === 'purchase'
      ? 'inventory.tx_dialog.purchase_subtitle'
      : type === 'manual_adjustment'
        ? 'inventory.tx_dialog.adjust_subtitle'
        : 'inventory.tx_dialog.waste_subtitle'

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t(titleKey, { name: item.name })}</DialogTitle>
          <DialogDescription>{t(subtitleKey)}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 px-5 pb-2 pt-4">
          {type === 'manual_adjustment' ? (
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setAdjustDirection('+')}
                className={`flex-1 rounded-md border-[1.5px] px-3 py-2 text-sm font-semibold transition-colors ${
                  adjustDirection === '+'
                    ? 'border-brand-sage bg-brand-sage-soft text-brand-sage'
                    : 'border-border bg-card text-muted-foreground'
                }`}
              >
                + {t('inventory.tx_dialog.add')}
              </button>
              <button
                type="button"
                onClick={() => setAdjustDirection('-')}
                className={`flex-1 rounded-md border-[1.5px] px-3 py-2 text-sm font-semibold transition-colors ${
                  adjustDirection === '-'
                    ? 'border-destructive bg-destructive/10 text-destructive'
                    : 'border-border bg-card text-muted-foreground'
                }`}
              >
                − {t('inventory.tx_dialog.subtract')}
              </button>
            </div>
          ) : null}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="tx-qty">
              {t('inventory.tx_dialog.qty_label', { unit: item.unit })}
            </Label>
            <Input
              id="tx-qty"
              type="number"
              inputMode="decimal"
              step="any"
              min="0"
              autoFocus
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
            />
            <p className="text-muted-foreground text-xs">
              {t('inventory.tx_dialog.current_stock', {
                stock: item.current_stock,
                unit: item.unit,
              })}
            </p>
          </div>

          {type === 'purchase' ? (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="tx-cost">
                {t('inventory.tx_dialog.cost_label', { currency: currencySymbol })}
              </Label>
              <Input
                id="tx-cost"
                type="number"
                inputMode="decimal"
                step="any"
                min="0"
                value={cost}
                onChange={(e) => setCost(e.target.value)}
                placeholder="0"
              />
              <p className="text-muted-foreground text-xs">{t('inventory.tx_dialog.cost_hint')}</p>
            </div>
          ) : null}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="tx-notes">{t('inventory.tx_dialog.notes_label')}</Label>
            <Input
              id="tx-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={
                type === 'waste'
                  ? t('inventory.tx_dialog.notes_waste_placeholder')
                  : t('inventory.tx_dialog.notes_placeholder')
              }
            />
          </div>
        </div>

        <DialogFooter>
          <Button type="button" size="lg" onClick={submit} disabled={applyMutation.isPending}>
            {applyMutation.isPending ? t('common.loading') : t('common.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
