import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  ArrowLeft,
  ArrowRight,
  Check,
  FileText,
  Loader2,
  Package,
  Pencil,
  Plus,
  Receipt,
  ShoppingBag,
  SkipForward,
  Trash2,
  Wallet,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { SearchableSelect } from '@/components/ui/SearchableSelect'
import { useInventoryItems, type InventoryItemRow } from '@/hooks/useInventory'
import {
  useCreateOtherIncome,
  useCreateOtherIncomeCategory,
  useOtherIncomeCategories,
} from '@/hooks/useOtherIncomes'
import { useCashRegisters } from '@/hooks/useCashRegisters'
import { useRequireCashShift } from '@/hooks/useCashShifts'
import { useCreateVisit, type PaymentMethod } from '@/hooks/useVisits'
import { supabase } from '@/lib/supabase/client'
import { cn } from '@/lib/utils/cn'
import { formatCurrency } from '@/lib/utils/format-currency'

/**
 * Многошаговый wizard «Новая продажа» (4 шага).
 *
 * Шаг 1 — Что продали:
 *   - Вкладка «Товар»: SearchableSelect из inventory (поиск по name/sku/supplier)
 *   - Вкладка «Другое»: ручной ввод имени + цены
 *   - Таблица позиций с inline-редактированием qty/price/discount
 *   - Подсумма
 *
 * Шаг 2 — Кто продал:
 *   - По дефолту = текущий пользователь (если он есть в staff), иначе «без мастера»
 *   - Можно вручную выбрать другого мастера
 *
 * Шаг 3 — Оплата:
 *   - Метод оплаты из справочника payment_methods (pills)
 *   - Доп. скидка на всю продажу
 *   - Комментарий
 *
 * Шаг 4 — Документ:
 *   - Чек / Фактура / Пропустить
 *
 * Submit:
 *   - Создаёт N visits (kind='retail', status='paid') — по одному на позицию
 *   - Декрементит inventory.current_stock через inventory_apply_tx
 *     (type='manual_adjustment', negative quantity, notes='Retail sale')
 *   - Переход на /income?tab=sales
 */
const LAST_SALE_STAFF_KEY = 'finkley:last-sale-staff'

export function RetailSaleWizard({
  salonId,
  currency,
  staff,
  onDone,
}: {
  salonId: string
  currency: string
  staff: { id: string; full_name: string }[]
  onDone: () => void
}) {
  const { t } = useTranslation()
  const createVisit = useCreateVisit(salonId)
  const createOtherIncome = useCreateOtherIncome(salonId)
  const createOtherCategory = useCreateOtherIncomeCategory(salonId)
  const { data: cashRegisters = [] } = useCashRegisters(salonId)
  const { hasOpenShift } = useRequireCashShift(salonId)
  const { data: inventory = [] } = useInventoryItems(salonId, { includeArchived: false })
  const { data: otherCategories = [] } = useOtherIncomeCategories(salonId)

  // ── State ──────────────────────────────────────────────────────────────
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1)
  const [lines, setLines] = useState<SaleLine[]>([])
  // По дефолту staffId = последний выбранный (localStorage) или первый из списка.
  const [staffId, setStaffId] = useState<string>(() => {
    if (typeof window === 'undefined') return ''
    return window.localStorage.getItem(LAST_SALE_STAFF_KEY) ?? ''
  })
  // Image #82: вместо payment_method-pills используем cash_registers.
  // Касса теперь источник истины (cash_register_id). payment_method
  // выводим из label кассы: «Касса/нал/Gotówka» → 'cash', «Карта/Karta/
  // Terminal» → 'card'. Это критично для модуля Касса (computeExpected
  // суммирует наличку и карту), поэтому хардкодить 'card' нельзя.
  const [cashRegisterId, setCashRegisterId] = useState<string>('')
  const paymentMethod: PaymentMethod = (() => {
    const reg = cashRegisters.find((r) => r.id === cashRegisterId)
    if (!reg) return 'card'
    const l = reg.label.toLowerCase()
    if (/(касс|нал|gotówk|gotowk|сейф|seif|safe)/i.test(l)) return 'cash'
    return 'card'
  })()
  const [extraDiscount, setExtraDiscount] = useState('') // string из input, потом *100
  // Image #90: режим ввода доп. скидки — фиксированная сумма или %.
  // При 'percent' значение трактуется как процент от linesTotalCents;
  // при 'amount' — как сумма в валюте (как раньше).
  const [extraDiscountMode, setExtraDiscountMode] = useState<'amount' | 'percent'>('amount')
  const [comment, setComment] = useState('')
  const [documentType, setDocumentType] = useState<'receipt' | 'invoice' | 'skip'>('skip')
  const [submitting, setSubmitting] = useState(false)

  // Шаг 1 — табы: товар / другое
  const [addTab, setAddTab] = useState<'inventory' | 'other'>('inventory')

  // Если сохранённого staffId нет в актуальном списке (мастер удалён) —
  // подставляем первого активного.
  useEffect(() => {
    if (staffId && staff.find((s) => s.id === staffId)) return
    if (staff.length > 0) setStaffId(staff[0]!.id)
  }, [staff, staffId])

  // ── Auto-set default cash register = первая активная (image #82) ───────
  useEffect(() => {
    if (cashRegisters.length > 0 && !cashRegisters.find((r) => r.id === cashRegisterId)) {
      setCashRegisterId(cashRegisters[0]!.id)
    }
  }, [cashRegisters, cashRegisterId])

  // ── Подсчёты ───────────────────────────────────────────────────────────
  const linesTotalCents = lines.reduce(
    (acc, l) => acc + Math.max(0, l.quantity * l.unitPriceCents - l.lineDiscountCents),
    0,
  )
  const extraDiscountCents =
    extraDiscountMode === 'percent'
      ? Math.max(
          0,
          Math.min(
            linesTotalCents,
            Math.round((linesTotalCents * parseDecimal(extraDiscount)) / 100),
          ),
        )
      : Math.max(0, Math.round(parseDecimal(extraDiscount) * 100))
  const grandTotalCents = Math.max(0, linesTotalCents - extraDiscountCents)

  // ── Validation ─────────────────────────────────────────────────────────
  const step1Valid = lines.length > 0 && lines.every((l) => l.quantity > 0 && l.unitPriceCents > 0)
  const step3Valid = !!cashRegisterId

  // ── Actions ────────────────────────────────────────────────────────────
  function addLineFromInventory(itemId: string) {
    const item = inventory.find((i) => i.id === itemId)
    if (!item) return
    // Если уже есть в lines — увеличиваем qty вместо дубликата.
    const existing = lines.find((l) => l.inventoryItemId === itemId)
    if (existing) {
      setLines((prev) =>
        prev.map((l) => (l.inventoryItemId === itemId ? { ...l, quantity: l.quantity + 1 } : l)),
      )
      return
    }
    setLines((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        kind: 'retail',
        inventoryItemId: item.id,
        otherCategoryId: null,
        name: item.name,
        code: item.sku ?? null,
        manufacturer: item.supplier ?? null,
        unit: item.unit,
        quantity: 1,
        unitPriceCents: item.cost_per_unit_cents || 0,
        lineDiscountCents: 0,
      },
    ])
  }

  function addOtherIncomeLine(input: {
    name: string
    priceCents: number
    categoryId: string | null
  }) {
    setLines((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        kind: 'other_income',
        inventoryItemId: null,
        otherCategoryId: input.categoryId,
        name: input.name.trim(),
        code: null,
        manufacturer: null,
        unit: null,
        quantity: 1,
        unitPriceCents: input.priceCents,
        lineDiscountCents: 0,
      },
    ])
  }

  /**
   * Ручной ввод retail-позиции, когда товара нет в /inventory.
   * Создаёт SaleLine с kind='retail' и inventoryItemId=null — на submit
   * это даст visit kind='retail' без списания со склада (inventory_apply_tx
   * пропускается через `if (l.inventoryItemId)`).
   *
   * Bug bf 37daad51: владелец застряла в «Товар со склада» когда товара
   * ещё не было в инвентаре. Теперь можно ввести название и цену прямо
   * в форме без предварительного создания товара в справочнике.
   */
  function addManualRetailLine(input: { name: string; priceCents: number }) {
    setLines((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        kind: 'retail',
        inventoryItemId: null,
        otherCategoryId: null,
        name: input.name.trim(),
        code: null,
        manufacturer: null,
        unit: null,
        quantity: 1,
        unitPriceCents: input.priceCents,
        lineDiscountCents: 0,
      },
    ])
  }

  function patchLine(id: string, patch: Partial<SaleLine>) {
    setLines((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)))
  }

  function removeLine(id: string) {
    setLines((prev) => prev.filter((l) => l.id !== id))
  }

  async function submitSale() {
    if (!step1Valid || !step3Valid) return
    // Per-user касса: продажа требует открытую смену.
    if (!hasOpenShift) {
      toast.error(t('finance.cash.gate_required_title'), {
        description: t('finance.cash.gate_required_sale'),
      })
      return
    }
    setSubmitting(true)
    try {
      // Создаём visit per line, помечаем status='paid'. Для группировки в UI
      // нужен group_key (random uuid). distribute extraDiscountCents
      // пропорционально по линиям, чтобы сумма visits = grandTotal.
      const groupKey = crypto.randomUUID()
      const docNote =
        documentType === 'receipt' ? '[Чек]' : documentType === 'invoice' ? '[Фактура]' : ''
      const lineNotes = [comment, docNote].filter(Boolean).join(' ')

      // Пропорциональное распределение extra discount по линиям
      const baseTotalCents = lines.reduce(
        (acc, l) => acc + l.quantity * l.unitPriceCents - l.lineDiscountCents,
        0,
      )

      for (let i = 0; i < lines.length; i++) {
        const l = lines[i]!
        const lineGross = l.quantity * l.unitPriceCents
        const shareOfExtra =
          baseTotalCents > 0
            ? Math.round((extraDiscountCents * (lineGross - l.lineDiscountCents)) / baseTotalCents)
            : 0
        const finalAmount = Math.max(0, lineGross - l.lineDiscountCents - shareOfExtra)

        if (l.kind === 'other_income') {
          // Прочий доход — пишем в other_incomes, а не в visits.
          await createOtherIncome.mutateAsync({
            salon_id: salonId,
            income_at: new Date().toISOString().slice(0, 10),
            amount_cents: finalAmount,
            category_id: l.otherCategoryId,
            payment_method: paymentMethod,
            cash_register_id: cashRegisterId || null,
            comment: [l.name, lineNotes].filter(Boolean).join(' · ') || null,
          })
          continue
        }

        await createVisit.mutateAsync({
          salon_id: salonId,
          staff_id: staffId || null,
          client_id: null,
          service_id: null,
          service_name_snapshot: `${l.name}${l.quantity > 1 ? ` ×${l.quantity}` : ''}`,
          visit_at: new Date().toISOString(),
          amount_cents: finalAmount,
          tip_cents: 0,
          discount_cents: l.lineDiscountCents + shareOfExtra,
          payment_method: paymentMethod,
          cash_register_id: cashRegisterId || null,
          // Для финотчёта (разбивка «Продажи» по категориям склада).
          inventory_item_id: l.inventoryItemId,
          comment: lineNotes || null,
          kind: 'retail',
          status: 'paid',
          group_key: lines.length > 1 ? groupKey : null,
        })

        // Списание со склада: только для inventory-позиций.
        if (l.inventoryItemId && l.quantity > 0) {
          const { error: invErr } = await supabase.rpc('inventory_apply_tx', {
            p_material_id: l.inventoryItemId,
            p_type: 'manual_adjustment',
            p_quantity: -l.quantity,
            p_cost_cents: null,
            p_notes: `Розничная продажа${docNote ? ' ' + docNote : ''}`,
          })
          if (invErr) {
            console.warn('inventory_apply_tx failed', invErr)
            // Не критично — продажа уже создана. Просто toast предупреждения.
            toast.error(
              t('retail_wizard.toast_stock_warning', { name: l.name, error: invErr.message }),
            )
          }
        }
      }
      // Запомним выбранного staff для следующей продажи.
      if (staffId) {
        window.localStorage.setItem(LAST_SALE_STAFF_KEY, staffId)
      }
      toast.success(t('retail_wizard.toast_done', { count: lines.length }))
      onDone()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setSubmitting(false)
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <div className="flex max-h-[80vh] min-h-0 flex-col">
      <StepIndicator step={step} t={t} />

      <div className="flex-1 overflow-y-auto px-4 pb-2 pt-3 sm:px-5">
        {step === 1 ? (
          <Step1
            inventory={inventory}
            lines={lines}
            currency={currency}
            tab={addTab}
            onTabChange={setAddTab}
            onAddFromInventory={addLineFromInventory}
            onAddManualRetail={addManualRetailLine}
            onAddOtherIncome={addOtherIncomeLine}
            onPatchLine={patchLine}
            onRemoveLine={removeLine}
            linesTotalCents={linesTotalCents}
            otherCategories={otherCategories.map((c) => ({ id: c.id, name: c.name }))}
            onCreateOtherCategory={async (name) => {
              const res = await createOtherCategory.mutateAsync({ name })
              return res.id
            }}
          />
        ) : null}
        {step === 2 ? <Step2 staff={staff} staffId={staffId} onChange={setStaffId} /> : null}
        {step === 3 ? (
          <Step3
            grandTotalCents={linesTotalCents - extraDiscountCents}
            linesTotalCents={linesTotalCents}
            currency={currency}
            extraDiscount={extraDiscount}
            onExtraDiscountChange={setExtraDiscount}
            extraDiscountMode={extraDiscountMode}
            onExtraDiscountModeChange={setExtraDiscountMode}
            cashRegisterId={cashRegisterId}
            onCashRegisterChange={setCashRegisterId}
            cashRegisters={cashRegisters}
            comment={comment}
            onCommentChange={setComment}
          />
        ) : null}
        {step === 4 ? (
          <Step4
            selected={documentType}
            onSelect={setDocumentType}
            totalCents={grandTotalCents}
            currency={currency}
          />
        ) : null}
      </div>

      <footer className="border-border flex items-center justify-between gap-2 border-t px-4 py-3 sm:px-5">
        {step > 1 ? (
          <Button variant="outline" size="md" onClick={() => setStep((s) => (s - 1) as 1 | 2 | 3)}>
            <ArrowLeft className="size-4" strokeWidth={2} />
            {t('common.back')}
          </Button>
        ) : (
          <span />
        )}
        {step < 4 ? (
          <Button
            size="md"
            onClick={() => setStep((s) => (s + 1) as 2 | 3 | 4)}
            disabled={(step === 1 && !step1Valid) || (step === 3 && !step3Valid)}
          >
            {t('common.next')}
            <ArrowRight className="size-4" strokeWidth={2} />
          </Button>
        ) : (
          <Button size="md" onClick={submitSale} disabled={submitting}>
            {submitting ? (
              <Loader2 className="size-4 animate-spin" strokeWidth={2} />
            ) : (
              <Check className="size-4" strokeWidth={2.4} />
            )}
            {t('retail_wizard.complete')}
          </Button>
        )}
      </footer>
    </div>
  )
}

// =============================================================================
// Types & helpers
// =============================================================================

type SaleLine = {
  id: string
  /** 'retail' = товар со склада, создаёт visit kind=retail.
   *  'other_income' = прочий доход (аренда, кэшбек, проценты), создаёт other_income. */
  kind: 'retail' | 'other_income'
  inventoryItemId: string | null
  /** Для 'other_income' — выбранная категория. */
  otherCategoryId: string | null
  name: string
  code: string | null
  manufacturer: string | null
  unit: string | null
  quantity: number
  unitPriceCents: number
  lineDiscountCents: number
}

function parseDecimal(s: string): number {
  if (!s) return 0
  const n = Number(s.replace(',', '.'))
  return Number.isFinite(n) ? n : 0
}

// =============================================================================
// Step indicator
// =============================================================================

function StepIndicator({ step, t }: { step: 1 | 2 | 3 | 4; t: (k: string) => string }) {
  const steps = [
    { id: 1, label: t('retail_wizard.step1_title'), icon: ShoppingBag },
    { id: 2, label: t('retail_wizard.step2_title'), icon: Pencil },
    { id: 3, label: t('retail_wizard.step3_title'), icon: Wallet },
    { id: 4, label: t('retail_wizard.step4_title'), icon: Receipt },
  ]
  return (
    <div className="border-border bg-muted/30 flex items-center gap-1 border-b px-3 py-2.5 sm:gap-2 sm:px-5 sm:py-3">
      {steps.map((s, i) => {
        const active = s.id === step
        const done = s.id < step
        const Icon = s.icon
        return (
          <div key={s.id} className="flex min-w-0 flex-1 items-center gap-1 sm:gap-1.5">
            <span
              className={cn(
                'grid size-7 shrink-0 place-items-center rounded-full text-[11px] font-bold transition-colors',
                done
                  ? 'bg-brand-sage text-white'
                  : active
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-card text-muted-foreground border-border border',
              )}
            >
              {done ? (
                <Check className="size-3.5" strokeWidth={3} />
              ) : (
                <Icon className="size-3.5" strokeWidth={2} />
              )}
            </span>
            {/* На мобиле название скрываем — иначе 4 шага не влезают.
                Видно только подсветка активного chip'а. */}
            <span
              className={cn(
                'hidden truncate text-[11px] font-semibold sm:inline',
                active ? 'text-foreground' : 'text-muted-foreground',
              )}
            >
              {s.label}
            </span>
            {i < steps.length - 1 ? (
              <span className={cn('h-px flex-1', done ? 'bg-brand-sage' : 'bg-border')} />
            ) : null}
          </div>
        )
      })}
    </div>
  )
}

// =============================================================================
// Step 1 — Что продали
// =============================================================================

function Step1({
  inventory,
  lines,
  currency,
  tab,
  onTabChange,
  onAddFromInventory,
  onAddManualRetail,
  onAddOtherIncome,
  onPatchLine,
  onRemoveLine,
  linesTotalCents,
  otherCategories,
  onCreateOtherCategory,
}: {
  inventory: InventoryItemRow[]
  lines: SaleLine[]
  currency: string
  tab: 'inventory' | 'other'
  onTabChange: (t: 'inventory' | 'other') => void
  onAddFromInventory: (itemId: string) => void
  onAddManualRetail: (input: { name: string; priceCents: number }) => void
  onAddOtherIncome: (input: { name: string; priceCents: number; categoryId: string | null }) => void
  onPatchLine: (id: string, patch: Partial<SaleLine>) => void
  onRemoveLine: (id: string) => void
  linesTotalCents: number
  otherCategories: Array<{ id: string; name: string }>
  onCreateOtherCategory: (name: string) => Promise<string>
}) {
  const { t } = useTranslation()
  const [selectedItemId, setSelectedItemId] = useState<string>('')
  const [otherName, setOtherName] = useState('')
  const [otherPrice, setOtherPrice] = useState('')
  const [otherCategoryId, setOtherCategoryId] = useState<string>('')
  const [addingCategory, setAddingCategory] = useState(false)
  const [newCategoryDraft, setNewCategoryDraft] = useState('')
  // Ручной ввод retail-позиции внутри inventory-вкладки — для случая когда
  // товара ещё нет в /inventory, а продажу записать надо. См. bug 37daad51.
  const [manualName, setManualName] = useState('')
  const [manualPrice, setManualPrice] = useState('')

  const options = useMemo(
    () =>
      inventory.map((i) => ({
        value: i.id,
        label: i.name,
        hint: [i.sku, i.supplier].filter(Boolean).join(' · ') || i.unit,
        searchText: `${i.sku ?? ''} ${i.supplier ?? ''}`,
      })),
    [inventory],
  )

  function addFromInventory() {
    if (!selectedItemId) return
    onAddFromInventory(selectedItemId)
    setSelectedItemId('')
  }

  function addOther() {
    const trimmed = otherName.trim()
    if (!trimmed) return
    const priceCents = Math.round(parseDecimal(otherPrice) * 100)
    if (priceCents <= 0) return
    onAddOtherIncome({
      name: trimmed,
      priceCents,
      categoryId: otherCategoryId || null,
    })
    setOtherName('')
    setOtherPrice('')
    // Категорию запоминаем — обычно несколько подряд одной категории.
  }

  function addManual() {
    const trimmed = manualName.trim()
    if (!trimmed) return
    const priceCents = Math.round(parseDecimal(manualPrice) * 100)
    if (priceCents <= 0) return
    onAddManualRetail({ name: trimmed, priceCents })
    setManualName('')
    setManualPrice('')
  }

  async function submitNewCategory() {
    const trimmed = newCategoryDraft.trim()
    if (!trimmed) return
    try {
      const id = await onCreateOtherCategory(trimmed)
      setOtherCategoryId(id)
      setAddingCategory(false)
      setNewCategoryDraft('')
    } catch {
      // toast уже выкинет хук — здесь silent
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Тип добавления */}
      <div className="border-border bg-card grid grid-cols-2 rounded-md border p-1">
        <button
          type="button"
          onClick={() => onTabChange('inventory')}
          className={cn(
            'inline-flex items-center justify-center gap-1.5 rounded-sm px-3 py-2 text-xs font-semibold transition-colors',
            tab === 'inventory'
              ? 'bg-primary text-primary-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          <Package className="size-3.5" strokeWidth={1.8} />
          {t('retail_wizard.tab_inventory')}
        </button>
        <button
          type="button"
          onClick={() => onTabChange('other')}
          className={cn(
            'inline-flex items-center justify-center gap-1.5 rounded-sm px-3 py-2 text-xs font-semibold transition-colors',
            tab === 'other'
              ? 'bg-primary text-primary-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          <Pencil className="size-3.5" strokeWidth={1.8} />
          {t('retail_wizard.tab_other')}
        </button>
      </div>

      {tab === 'inventory' ? (
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <div className="min-w-0 flex-1">
              <Label className="text-muted-foreground text-[11px] font-semibold uppercase">
                {t('retail_wizard.pick_item')}
              </Label>
              <SearchableSelect
                value={selectedItemId}
                onChange={setSelectedItemId}
                options={options}
                placeholder={t('retail_wizard.pick_item_placeholder')}
                searchPlaceholder={t('retail_wizard.search_inventory')}
                emptyText={t('common.no_results')}
                disabled={options.length === 0}
              />
            </div>
            <Button onClick={addFromInventory} disabled={!selectedItemId} size="md">
              <Plus className="size-4" strokeWidth={2} />
              {t('retail_wizard.add')}
            </Button>
          </div>

          {/* Ручной ввод товара — на случай если позиции ещё нет в /inventory.
              Создаёт retail-линию без списания со склада. */}
          <div className="border-border bg-muted/20 rounded-md border border-dashed p-3">
            <p className="text-muted-foreground mb-2 text-[11px] font-semibold uppercase tracking-wider">
              {options.length === 0
                ? t('retail_wizard.manual_inventory_empty_hint')
                : t('retail_wizard.manual_inventory_hint')}
            </p>
            <div className="flex flex-col gap-2 sm:grid sm:grid-cols-[1fr_140px_auto] sm:items-end">
              <Input
                value={manualName}
                onChange={(e) => setManualName(e.target.value)}
                placeholder={t('retail_wizard.manual_name_placeholder')}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    addManual()
                  }
                }}
                data-testid="rw-manual-name"
              />
              <Input
                inputMode="decimal"
                value={manualPrice}
                onChange={(e) => setManualPrice(e.target.value)}
                placeholder={t('retail_wizard.manual_price_placeholder', { currency })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    addManual()
                  }
                }}
                data-testid="rw-manual-price"
              />
              <Button
                type="button"
                variant="outline"
                onClick={addManual}
                disabled={!manualName.trim() || parseDecimal(manualPrice) <= 0}
                size="md"
              >
                <Plus className="size-4" strokeWidth={2} />
                {t('retail_wizard.add')}
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {/* Категория прочих доходов с inline-добавлением */}
          <div>
            <Label className="text-muted-foreground text-[11px] font-semibold uppercase">
              {t('retail_wizard.other_category')}
            </Label>
            {addingCategory ? (
              <div className="flex items-center gap-2">
                <Input
                  autoFocus
                  value={newCategoryDraft}
                  onChange={(e) => setNewCategoryDraft(e.target.value)}
                  placeholder={t('retail_wizard.other_category_new_placeholder')}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      void submitNewCategory()
                    } else if (e.key === 'Escape') {
                      setAddingCategory(false)
                      setNewCategoryDraft('')
                    }
                  }}
                />
                <Button
                  type="button"
                  size="sm"
                  onClick={() => void submitNewCategory()}
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
                  <Trash2 className="size-4" strokeWidth={1.8} />
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <SearchableSelect
                  value={otherCategoryId}
                  onChange={setOtherCategoryId}
                  options={otherCategories.map((c) => ({ value: c.id, label: c.name }))}
                  placeholder={t('retail_wizard.other_category_placeholder')}
                  searchPlaceholder={t('retail_wizard.other_category_search')}
                  emptyText={t('common.no_results')}
                  triggerClassName="flex-1"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setAddingCategory(true)}
                  title={t('retail_wizard.other_category_new')}
                >
                  <Plus className="size-4" strokeWidth={2} />
                </Button>
              </div>
            )}
          </div>

          {/* Имя + цена + добавить */}
          <div className="flex flex-col gap-2 sm:grid sm:grid-cols-[1fr_140px_auto] sm:items-end">
            <div>
              <Label className="text-muted-foreground text-[11px] font-semibold uppercase">
                {t('retail_wizard.other_name')}
              </Label>
              <Input
                value={otherName}
                onChange={(e) => setOtherName(e.target.value)}
                placeholder={t('retail_wizard.other_name_placeholder')}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    addOther()
                  }
                }}
              />
            </div>
            <div>
              <Label className="text-muted-foreground text-[11px] font-semibold uppercase">
                {t('retail_wizard.other_price', { currency })}
              </Label>
              <Input
                inputMode="decimal"
                value={otherPrice}
                onChange={(e) => setOtherPrice(e.target.value)}
                placeholder="0"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    addOther()
                  }
                }}
              />
            </div>
            <Button
              onClick={addOther}
              disabled={!otherName.trim() || parseDecimal(otherPrice) <= 0}
              size="md"
            >
              <Plus className="size-4" strokeWidth={2} />
              {t('retail_wizard.add')}
            </Button>
          </div>
        </div>
      )}

      {/* Таблица позиций — overflow-x-auto чтобы на узких экранах
          можно было скроллить горизонтально. */}
      <div className="border-border bg-card overflow-x-auto rounded-md border">
        {lines.length === 0 ? (
          <p className="text-muted-foreground p-4 text-center text-xs">
            {t('retail_wizard.empty_lines')}
          </p>
        ) : (
          <table className="w-full min-w-[520px] text-sm">
            <thead className="border-border bg-muted/20 border-b">
              <tr className="text-muted-foreground text-left text-[10px] font-semibold uppercase tracking-wider">
                <th className="px-3 py-2">{t('retail_wizard.col_name')}</th>
                <th className="w-20 px-3 py-2 text-right">{t('retail_wizard.col_qty')}</th>
                <th className="w-24 px-3 py-2 text-right">{t('retail_wizard.col_price')}</th>
                <th className="w-24 px-3 py-2 text-right">{t('retail_wizard.col_discount')}</th>
                <th className="w-24 px-3 py-2 text-right">{t('retail_wizard.col_total')}</th>
                <th className="w-10 px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-border divide-y">
              {lines.map((l) => {
                const lineTotal = Math.max(0, l.quantity * l.unitPriceCents - l.lineDiscountCents)
                return (
                  <tr key={l.id}>
                    <td className="px-3 py-2">
                      <p className="text-foreground truncate text-sm font-semibold">{l.name}</p>
                      <p className="text-muted-foreground truncate text-[10px]">
                        {[l.code, l.manufacturer].filter(Boolean).join(' · ') ||
                          (l.inventoryItemId ? '' : t('retail_wizard.badge_manual'))}
                      </p>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Input
                        type="number"
                        inputMode="decimal"
                        step="any"
                        min="0"
                        value={l.quantity}
                        onChange={(e) =>
                          onPatchLine(l.id, { quantity: parseDecimal(e.target.value) })
                        }
                        className="num h-8 text-right text-xs"
                      />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Input
                        type="number"
                        inputMode="decimal"
                        step="any"
                        min="0"
                        value={(l.unitPriceCents / 100).toFixed(2)}
                        onChange={(e) =>
                          onPatchLine(l.id, {
                            unitPriceCents: Math.round(parseDecimal(e.target.value) * 100),
                          })
                        }
                        className="num h-8 text-right text-xs"
                      />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Input
                        type="number"
                        inputMode="decimal"
                        step="any"
                        min="0"
                        value={(l.lineDiscountCents / 100).toFixed(2)}
                        onChange={(e) =>
                          onPatchLine(l.id, {
                            lineDiscountCents: Math.round(parseDecimal(e.target.value) * 100),
                          })
                        }
                        className="num h-8 text-right text-xs"
                      />
                    </td>
                    <td className="num text-foreground px-3 py-2 text-right text-sm font-bold">
                      {formatCurrency(lineTotal, currency)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button
                        type="button"
                        onClick={() => onRemoveLine(l.id)}
                        className="text-muted-foreground hover:text-destructive grid size-7 place-items-center rounded-md"
                      >
                        <Trash2 className="size-3.5" strokeWidth={1.8} />
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot className="border-border bg-muted/10 border-t">
              <tr>
                <td colSpan={4} className="px-3 py-2 text-right text-xs font-semibold">
                  {t('retail_wizard.subtotal')}
                </td>
                <td className="num text-brand-sage-deep px-3 py-2 text-right text-base font-bold">
                  {formatCurrency(linesTotalCents, currency)}
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        )}
      </div>
    </div>
  )
}

// =============================================================================
// Step 2 — Кто продал
// =============================================================================

function Step2({
  staff,
  staffId,
  onChange,
}: {
  staff: { id: string; full_name: string }[]
  staffId: string
  onChange: (id: string) => void
}) {
  const { t } = useTranslation()

  return (
    <div className="flex flex-col gap-4 py-4">
      <div className="flex flex-col gap-1.5">
        <Label>{t('retail_wizard.step2_label')}</Label>
        <p className="text-muted-foreground text-xs">{t('retail_wizard.step2_hint')}</p>
      </div>

      {/* Все мастера в виде кликабельных карточек — быстрее чем dropdown */}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {staff.map((s) => {
          const active = staffId === s.id
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => onChange(s.id)}
              className={cn(
                'border-border bg-card flex items-center justify-between gap-2 rounded-md border p-3 text-left transition-colors',
                active ? 'border-primary bg-primary/5' : 'hover:bg-muted/40',
              )}
            >
              <span className="text-foreground truncate text-sm font-semibold">{s.full_name}</span>
              {active ? <Check className="text-primary size-4 shrink-0" strokeWidth={2.4} /> : null}
            </button>
          )
        })}
        <button
          type="button"
          onClick={() => onChange('')}
          className={cn(
            'border-border bg-card flex items-center justify-between gap-2 rounded-md border p-3 text-left transition-colors',
            staffId === ''
              ? 'border-primary bg-primary/5'
              : 'text-muted-foreground hover:bg-muted/40',
          )}
        >
          <span className="truncate text-sm font-semibold">{t('retail_wizard.no_staff')}</span>
          {staffId === '' ? (
            <Check className="text-primary size-4 shrink-0" strokeWidth={2.4} />
          ) : null}
        </button>
      </div>
    </div>
  )
}

// =============================================================================
// Step 3 — Оплата
// =============================================================================

function Step3({
  grandTotalCents,
  linesTotalCents,
  currency,
  extraDiscount,
  onExtraDiscountChange,
  extraDiscountMode,
  onExtraDiscountModeChange,
  cashRegisterId,
  onCashRegisterChange,
  cashRegisters,
  comment,
  onCommentChange,
}: {
  grandTotalCents: number
  linesTotalCents: number
  currency: string
  extraDiscount: string
  onExtraDiscountChange: (v: string) => void
  extraDiscountMode: 'amount' | 'percent'
  onExtraDiscountModeChange: (m: 'amount' | 'percent') => void
  /** Image #82: касса вместо payment_method. */
  cashRegisterId: string
  onCashRegisterChange: (id: string) => void
  cashRegisters: Array<{ id: string; label: string }>
  comment: string
  onCommentChange: (v: string) => void
}) {
  const { t } = useTranslation()

  return (
    <div className="flex flex-col gap-4 py-4">
      <div className="border-brand-yellow-deep bg-brand-yellow rounded-md border-[1.5px] p-4">
        <p className="text-brand-navy text-[11px] font-semibold uppercase tracking-wider">
          {t('retail_wizard.step3_total')}
        </p>
        <p className="num text-brand-navy mt-1 text-3xl font-bold tracking-tight">
          {formatCurrency(grandTotalCents, currency)}
        </p>
        {grandTotalCents !== linesTotalCents ? (
          <p className="text-brand-navy/70 mt-1 text-xs">
            {t('retail_wizard.step3_subtotal')}:{' '}
            <span className="num font-semibold">{formatCurrency(linesTotalCents, currency)}</span>
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="rw-extra-discount">
          {extraDiscountMode === 'percent'
            ? t('retail_wizard.step3_extra_discount_pct')
            : t('retail_wizard.step3_extra_discount', { currency })}
        </Label>
        <div className="flex gap-2">
          <Input
            id="rw-extra-discount"
            inputMode="decimal"
            value={extraDiscount}
            onChange={(e) => onExtraDiscountChange(e.target.value)}
            placeholder="0"
            className="flex-1"
          />
          {/* Image #90: toggle %/Сумма. % трактуется как процент от
              суммы позиций, сумма — как фиксированное значение. */}
          <div className="border-border bg-card inline-flex items-center rounded-md border-[1.5px] p-0.5">
            {(['amount', 'percent'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => onExtraDiscountModeChange(mode)}
                className={
                  'h-9 min-w-[44px] rounded-[6px] px-3 text-xs font-semibold transition-colors ' +
                  (extraDiscountMode === mode
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground')
                }
              >
                {mode === 'amount' ? currency : '%'}
              </button>
            ))}
          </div>
        </div>
        <p className="text-muted-foreground text-[10px]">{t('retail_wizard.step3_extra_hint')}</p>
      </div>

      {/* Image #82: касса вместо способа оплаты. */}
      <div className="flex flex-col gap-1.5">
        <Label>{t('retail_wizard.step3_cash_register')}</Label>
        {cashRegisters.length === 0 ? (
          <p className="text-muted-foreground text-xs">
            {t('retail_wizard.step3_cash_register_empty')}
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {cashRegisters.map((r) => {
              const active = cashRegisterId === r.id
              return (
                <button
                  type="button"
                  key={r.id}
                  onClick={() => onCashRegisterChange(r.id)}
                  className={cn(
                    'h-10 rounded-full border-[1.5px] px-4 text-sm font-semibold transition-colors',
                    active
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-border bg-card hover:bg-muted/40',
                  )}
                >
                  {r.label}
                </button>
              )
            })}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="rw-comment">{t('retail_wizard.step3_comment')}</Label>
        <Input
          id="rw-comment"
          value={comment}
          onChange={(e) => onCommentChange(e.target.value)}
          placeholder={t('retail_wizard.step3_comment_placeholder')}
        />
      </div>
    </div>
  )
}

// =============================================================================
// Step 4 — Документ
// =============================================================================

function Step4({
  selected,
  onSelect,
  totalCents,
  currency,
}: {
  selected: 'receipt' | 'invoice' | 'skip'
  onSelect: (v: 'receipt' | 'invoice' | 'skip') => void
  totalCents: number
  currency: string
}) {
  const { t } = useTranslation()
  const options = [
    {
      id: 'receipt' as const,
      label: t('retail_wizard.step4_receipt'),
      hint: t('retail_wizard.step4_receipt_hint'),
      icon: Receipt,
    },
    {
      id: 'invoice' as const,
      label: t('retail_wizard.step4_invoice'),
      hint: t('retail_wizard.step4_invoice_hint'),
      icon: FileText,
    },
    {
      id: 'skip' as const,
      label: t('retail_wizard.step4_skip'),
      hint: t('retail_wizard.step4_skip_hint'),
      icon: SkipForward,
    },
  ]
  return (
    <div className="flex flex-col gap-4 py-4">
      <div className="text-center">
        <p className="text-muted-foreground text-[11px] font-semibold uppercase tracking-wider">
          {t('retail_wizard.step4_total_to_pay')}
        </p>
        <p className="num text-brand-navy mt-1 text-3xl font-bold tracking-tight">
          {formatCurrency(totalCents, currency)}
        </p>
      </div>
      <div className="flex flex-col gap-2">
        {options.map((o) => {
          const Icon = o.icon
          const active = selected === o.id
          return (
            <button
              key={o.id}
              type="button"
              onClick={() => onSelect(o.id)}
              className={cn(
                'border-border bg-card flex items-center gap-3 rounded-md border p-3 text-left transition-colors',
                active ? 'border-primary bg-primary/5' : 'hover:bg-muted/40',
              )}
            >
              <span
                className={cn(
                  'grid size-9 shrink-0 place-items-center rounded-md',
                  active ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground',
                )}
              >
                <Icon className="size-4" strokeWidth={1.8} />
              </span>
              <span className="min-w-0 flex-1">
                <p className="text-foreground text-sm font-semibold">{o.label}</p>
                <p className="text-muted-foreground text-[11px]">{o.hint}</p>
              </span>
              {active ? <Check className="text-primary size-4" strokeWidth={2.4} /> : null}
            </button>
          )
        })}
      </div>
    </div>
  )
}
