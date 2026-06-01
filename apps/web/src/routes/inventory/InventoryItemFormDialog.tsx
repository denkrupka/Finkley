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
import { useIsVatPayer } from '@/hooks/useIsVatPayer'
import { useSalon } from '@/hooks/useSalons'
import { VatBreakdownInput } from '@/components/ui/VatBreakdownInput'
import { computeNet, defaultVatRate } from '@/lib/utils/vat'

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
  const isVatPayer = useIsVatPayer(salonId)
  const { data: salon } = useSalon(salonId)
  const country = salon?.country_code ?? 'PL'
  const isEdit = !!item

  // VAT state — синхронизирован с costPerUnit (брутто).
  const [costNetCents, setCostNetCents] = useState(0)
  const [costGrossCents, setCostGrossCents] = useState(0)
  const [costRatePct, setCostRatePct] = useState<number>(() => defaultVatRate(country))

  // Продажная цена (брутто) — отдельно от закупочной. RetailSaleWizard
  // использует sale_price_cents; fallback на cost_per_unit_cents если null.
  const [saleNetCents, setSaleNetCents] = useState(0)
  const [saleGrossCents, setSaleGrossCents] = useState(0)
  const [saleRatePct, setSaleRatePct] = useState<number>(() => defaultVatRate(country))
  const [salePrice, setSalePrice] = useState('0') // for non-VAT input

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
      // VAT prefill: используем cost_net_cents+cost_vat_rate_pct если есть,
      // иначе считаем нетто из брутто по дефолтной ставке.
      const iAny = item as InventoryItemRow & {
        cost_net_cents?: number | null
        cost_vat_rate_pct?: number | null
      }
      const rate = iAny.cost_vat_rate_pct ?? defaultVatRate(country)
      const gross = item.cost_per_unit_cents
      const net = iAny.cost_net_cents ?? computeNet(gross, rate)
      setCostRatePct(rate)
      setCostGrossCents(gross)
      setCostNetCents(net)
      // Sale-price prefill: если sale_price_cents задан — берём его, иначе
      // fallback на cost (как RetailSaleWizard). Для VAT — sale_net_cents
      // или recompute от gross+defaultRate.
      const saleGross = item.sale_price_cents ?? item.cost_per_unit_cents
      const saleRate = item.sale_vat_rate_pct ?? defaultVatRate(country)
      const saleNet = item.sale_net_cents ?? computeNet(saleGross, saleRate)
      setSaleRatePct(saleRate)
      setSaleGrossCents(saleGross)
      setSaleNetCents(saleNet)
      setSalePrice(String(saleGross / 100))
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
      setSaleNetCents(0)
      setSaleGrossCents(0)
      setSaleRatePct(defaultVatRate(country))
      setSalePrice('0')
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

    const saleGrossOut = isVatPayer
      ? saleGrossCents
      : Math.round(Number(salePrice.replace(',', '.')) * 100)
    const payload = {
      name: name.trim(),
      unit: unit.trim(),
      sku: sku.trim() || null,
      category: category.trim() || null,
      min_stock: minStockNum,
      cost_per_unit_cents: Math.round(costNum * 100),
      supplier: supplier.trim() || null,
      notes: notes.trim() || null,
      // Продажная цена — отдельная колонка. NULL разрешён → fallback на
      // cost_per_unit_cents в RetailSaleWizard.
      sale_price_cents: saleGrossOut > 0 ? saleGrossOut : null,
      // VAT-разбивка: пишем только когда фирма плательщик. Иначе оставляем
      // null чтобы старая логика «брутто=net» сохранилась.
      ...(isVatPayer
        ? {
            cost_net_cents: costNetCents,
            cost_vat_rate_pct: costRatePct,
            sale_net_cents: saleNetCents > 0 ? saleNetCents : null,
            sale_vat_rate_pct: saleRatePct,
          }
        : {}),
    } as Parameters<typeof create.mutate>[0]

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
      <DialogContent className="max-h-[92vh] w-[min(1100px,96vw)] max-w-none overflow-y-auto">
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
                placeholder={t('inventory.form.unit_placeholder', { defaultValue: 'шт' })}
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
              {isVatPayer ? (
                <VatBreakdownInput
                  netCents={costNetCents}
                  ratePct={costRatePct}
                  grossCents={costGrossCents}
                  onChange={(next) => {
                    setCostNetCents(next.netCents)
                    setCostRatePct(next.ratePct)
                    setCostGrossCents(next.grossCents)
                    setCostPerUnit(String(next.grossCents / 100))
                  }}
                  countryCode={country}
                  currency={currency}
                />
              ) : (
                <Input
                  id="inv-cost"
                  type="number"
                  inputMode="decimal"
                  step="any"
                  min="0"
                  value={costPerUnit}
                  onChange={(e) => setCostPerUnit(e.target.value)}
                />
              )}
            </div>
          </div>

          {/* Цена продажи — отдельный ряд под закупочной. Юзер 02.06 чётко
              сказал: «при продаже всегда брутто, но в карточке хочу видеть
              нетто/НДС/брутто». RetailSaleWizard теперь будет брать именно
              эту цену (sale_price_cents), а не cost. */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="inv-sale-price">
              {t('inventory.form.sale_price_label', {
                currency: currencySymbol,
                defaultValue: 'Цена продажи ({{currency}})',
              })}
            </Label>
            {isVatPayer ? (
              <VatBreakdownInput
                netCents={saleNetCents}
                ratePct={saleRatePct}
                grossCents={saleGrossCents}
                onChange={(next) => {
                  setSaleNetCents(next.netCents)
                  setSaleRatePct(next.ratePct)
                  setSaleGrossCents(next.grossCents)
                  setSalePrice(String(next.grossCents / 100))
                }}
                countryCode={country}
                currency={currency}
              />
            ) : (
              <Input
                id="inv-sale-price"
                type="number"
                inputMode="decimal"
                step="any"
                min="0"
                value={salePrice}
                onChange={(e) => setSalePrice(e.target.value)}
              />
            )}
            <p className="text-muted-foreground text-[11px]">
              {t('inventory.form.sale_price_hint', {
                defaultValue:
                  'По умолчанию = закупочной. RetailSaleWizard подставит эту цену при добавлении товара в продажу.',
              })}
            </p>
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
