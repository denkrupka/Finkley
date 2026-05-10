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
import {
  useCreateInventoryItem,
  useUpdateInventoryItem,
  type InventoryItemRow,
} from '@/hooks/useInventory'

type Props = {
  open: boolean
  onClose: () => void
  salonId: string
  currency: string
  item?: InventoryItemRow | null
}

const COMMON_UNITS = ['шт', 'мл', 'г', 'л', 'кг', 'м']

export function InventoryItemFormDialog({ open, onClose, salonId, currency, item }: Props) {
  const { t } = useTranslation()
  const create = useCreateInventoryItem(salonId)
  const update = useUpdateInventoryItem(salonId)
  const isEdit = !!item

  const [name, setName] = useState('')
  const [unit, setUnit] = useState('шт')
  const [sku, setSku] = useState('')
  const [category, setCategory] = useState('')
  const [stock, setStock] = useState('0')
  const [minStock, setMinStock] = useState('0')
  const [costPerUnit, setCostPerUnit] = useState('0')
  const [supplier, setSupplier] = useState('')
  const [notes, setNotes] = useState('')

  useEffect(() => {
    if (!open) return
    if (item) {
      setName(item.name)
      setUnit(item.unit)
      setSku(item.sku ?? '')
      setCategory(item.category ?? '')
      setStock(String(item.current_stock))
      setMinStock(String(item.min_stock))
      setCostPerUnit(String(item.cost_per_unit_cents / 100))
      setSupplier(item.supplier ?? '')
      setNotes(item.notes ?? '')
    } else {
      setName('')
      setUnit('шт')
      setSku('')
      setCategory('')
      setStock('0')
      setMinStock('0')
      setCostPerUnit('0')
      setSupplier('')
      setNotes('')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- одноразовый sync на open / смену item
  }, [open, item?.id])

  function save() {
    if (!name.trim()) {
      toast.error(t('inventory.errors.name_required'))
      return
    }
    const stockNum = Number(stock.replace(',', '.'))
    const minStockNum = Number(minStock.replace(',', '.'))
    const costNum = Number(costPerUnit.replace(',', '.'))
    if (!Number.isFinite(stockNum) || stockNum < 0) {
      toast.error(t('inventory.errors.stock_invalid'))
      return
    }
    if (!Number.isFinite(minStockNum) || minStockNum < 0) {
      toast.error(t('inventory.errors.min_invalid'))
      return
    }
    if (!Number.isFinite(costNum) || costNum < 0) {
      toast.error(t('inventory.errors.cost_invalid'))
      return
    }

    const payload = {
      name: name.trim(),
      unit: unit.trim(),
      sku: sku.trim() || null,
      category: category.trim() || null,
      min_stock: minStockNum,
      cost_per_unit_cents: Math.round(costNum * 100),
      supplier: supplier.trim() || null,
      notes: notes.trim() || null,
    }

    if (isEdit && item) {
      update.mutate(
        { id: item.id, ...payload },
        {
          onSuccess: () => {
            toast.success(t('inventory.toast_saved'))
            onClose()
          },
          onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
        },
      )
    } else {
      create.mutate(
        { ...payload, current_stock: stockNum },
        {
          onSuccess: () => {
            toast.success(t('inventory.toast_created'))
            onClose()
          },
          onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
        },
      )
    }
  }

  const pending = create.isPending || update.isPending
  const currencySymbol = currency === 'EUR' ? '€' : currency === 'USD' ? '$' : currency

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {isEdit ? t('inventory.form.title_edit') : t('inventory.form.title_new')}
          </DialogTitle>
          <DialogDescription>{t('inventory.form.subtitle')}</DialogDescription>
        </DialogHeader>

        <form
          className="flex min-h-0 flex-col gap-4 overflow-y-auto px-5 pb-2 pt-4"
          onSubmit={(e) => {
            e.preventDefault()
            save()
          }}
          noValidate
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="inv-name">{t('inventory.form.name_label')}</Label>
            <Input
              id="inv-name"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('inventory.form.name_placeholder')}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="inv-unit">{t('inventory.form.unit_label')}</Label>
              <Input
                id="inv-unit"
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                placeholder="шт"
                list="inv-unit-suggest"
              />
              <datalist id="inv-unit-suggest">
                {COMMON_UNITS.map((u) => (
                  <option key={u} value={u} />
                ))}
              </datalist>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="inv-category">{t('inventory.form.category_label')}</Label>
              <Input
                id="inv-category"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder={t('inventory.form.category_placeholder')}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="inv-stock">{t('inventory.form.stock_label')}</Label>
              <Input
                id="inv-stock"
                type="number"
                inputMode="decimal"
                step="any"
                min="0"
                value={stock}
                onChange={(e) => setStock(e.target.value)}
                disabled={isEdit}
              />
              {isEdit ? (
                <p className="text-muted-foreground text-xs">
                  {t('inventory.form.stock_edit_hint')}
                </p>
              ) : null}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="inv-min">{t('inventory.form.min_label')}</Label>
              <Input
                id="inv-min"
                type="number"
                inputMode="decimal"
                step="any"
                min="0"
                value={minStock}
                onChange={(e) => setMinStock(e.target.value)}
              />
              <p className="text-muted-foreground text-xs">{t('inventory.form.min_hint')}</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="inv-cost">
                {t('inventory.form.cost_label', { currency: currencySymbol })}
              </Label>
              <Input
                id="inv-cost"
                type="number"
                inputMode="decimal"
                step="any"
                min="0"
                value={costPerUnit}
                onChange={(e) => setCostPerUnit(e.target.value)}
              />
              <p className="text-muted-foreground text-xs">{t('inventory.form.cost_hint')}</p>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="inv-sku">{t('inventory.form.sku_label')}</Label>
              <Input
                id="inv-sku"
                value={sku}
                onChange={(e) => setSku(e.target.value)}
                placeholder="WLA-001"
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="inv-supplier">{t('inventory.form.supplier_label')}</Label>
            <Input
              id="inv-supplier"
              value={supplier}
              onChange={(e) => setSupplier(e.target.value)}
              placeholder={t('inventory.form.supplier_placeholder')}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="inv-notes">{t('inventory.form.notes_label')}</Label>
            <Input
              id="inv-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={t('inventory.form.notes_placeholder')}
            />
          </div>
        </form>

        <DialogFooter>
          <Button type="button" size="lg" onClick={save} disabled={pending}>
            {pending ? t('common.loading') : isEdit ? t('common.save') : t('inventory.form.create')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
