import { Plus, X } from 'lucide-react'
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  useCreateInventoryItem,
  useInventoryCategories,
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
  const { data: categoryOptions = [] } = useInventoryCategories(salonId)
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
  /** Inline-добавление новой категории (Image #40). Если true — рендерим
   *  text input вместо dropdown'а. Подтверждение → значение становится
   *  category для текущего материала. */
  const [addingCategory, setAddingCategory] = useState(false)
  const [newCategoryDraft, setNewCategoryDraft] = useState('')

  useEffect(() => {
    if (!open) return
    setAddingCategory(false)
    setNewCategoryDraft('')
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
      <DialogContent className="w-[min(960px,96vw)] max-w-none">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? t('inventory.form.title_edit') : t('inventory.form.title_new')}
          </DialogTitle>
          <DialogDescription>{t('inventory.form.subtitle')}</DialogDescription>
        </DialogHeader>

        <form
          className="flex min-h-0 flex-col gap-3 overflow-y-auto px-5 pb-2 pt-2"
          onSubmit={(e) => {
            e.preventDefault()
            save()
          }}
          noValidate
        >
          {/* Image #52: компактный layout 3-col чтобы модалка влезала на
              типичный экран без скролла. Раньше было 2-col → 6 строк инпутов.
              Сейчас Name (full), 3+3+2-col = 4 строки. */}
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

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
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
              {/* Inline-добавление новой категории: если addingCategory=true —
                  показываем text input + кнопки подтверждения/отмены. Имя
                  становится значением category для текущего материала; в
                  глобальный список оно попадёт после сохранения (distinct()
                  в useInventoryCategories автоматически подхватит). */}
              {addingCategory ? (
                <div className="flex items-center gap-2">
                  <Input
                    autoFocus
                    value={newCategoryDraft}
                    onChange={(e) => setNewCategoryDraft(e.target.value)}
                    placeholder={t('inventory.form.category_placeholder')}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        const v = newCategoryDraft.trim()
                        if (v) {
                          setCategory(v)
                          setAddingCategory(false)
                          setNewCategoryDraft('')
                        }
                      } else if (e.key === 'Escape') {
                        setAddingCategory(false)
                        setNewCategoryDraft('')
                      }
                    }}
                  />
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => {
                      const v = newCategoryDraft.trim()
                      if (!v) return
                      setCategory(v)
                      setAddingCategory(false)
                      setNewCategoryDraft('')
                    }}
                    disabled={!newCategoryDraft.trim()}
                  >
                    <Plus className="size-4" strokeWidth={2} />
                  </Button>
                  <button
                    type="button"
                    onClick={() => {
                      setAddingCategory(false)
                      setNewCategoryDraft('')
                    }}
                    className="text-muted-foreground hover:text-destructive grid size-9 place-items-center rounded-md"
                    aria-label={t('common.cancel')}
                  >
                    <X className="size-4" strokeWidth={1.8} />
                  </button>
                </div>
              ) : categoryOptions.length === 0 ? (
                <div className="flex items-center gap-2">
                  <Input
                    id="inv-category"
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    placeholder={t('inventory.form.category_placeholder')}
                  />
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <Select
                    value={category || '__none__'}
                    onValueChange={(v) => setCategory(v === '__none__' ? '' : v)}
                  >
                    <SelectTrigger id="inv-category" className="flex-1">
                      <SelectValue placeholder={t('inventory.form.category_placeholder')} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">{t('inventory.form.category_none')}</SelectItem>
                      {categoryOptions.map((c) => (
                        <SelectItem key={c} value={c}>
                          {c}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setAddingCategory(true)}
                    title={t('inventory.form.category_add_new')}
                  >
                    <Plus className="size-4" strokeWidth={2} />
                  </Button>
                </div>
              )}
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

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
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
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
