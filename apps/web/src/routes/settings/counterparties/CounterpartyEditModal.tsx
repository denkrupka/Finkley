import { Loader2, Plus, Search } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
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
  lookupNip,
  useCounterpartyCategories,
  useCreateCounterparty,
  useCreateCounterpartyCategory,
  useUpdateCounterparty,
  type CounterpartyRow,
} from '@/hooks/useCounterparties'
import { useExpenseCategories } from '@/hooks/useExpenses'
import { formatIbanForDisplay } from '@/lib/banking/iban'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  salonId: string
  /** Если задан — редактирование существующего; иначе создание. */
  counterparty?: CounterpartyRow | null
  /** Колбэк после создания/обновления; получает финальную строку. */
  onSaved?: (cp: CounterpartyRow) => void
  /** Префилл для нового контрагента (после OCR/dictation). */
  prefill?: { name?: string; nip?: string; address?: string; iban?: string } | null
}

/**
 * Модалка создания/редактирования контрагента. Поля: Название, NIP,
 * Адрес, Категория (с inline-добавлением), Заметки.
 * Кнопка «Поиск по NIP» дёргает edge function dataport-nip-lookup и
 * автозаполняет name + address.
 */
export function CounterpartyEditModal({
  open,
  onOpenChange,
  salonId,
  counterparty,
  onSaved,
  prefill,
}: Props) {
  const { t } = useTranslation()
  const isEdit = !!counterparty
  const { data: categories = [] } = useCounterpartyCategories(salonId)
  const { data: expenseCategories = [] } = useExpenseCategories(salonId)
  const createCp = useCreateCounterparty(salonId)
  const updateCp = useUpdateCounterparty(salonId)
  const createCat = useCreateCounterpartyCategory(salonId)

  const [name, setName] = useState('')
  const [nip, setNip] = useState('')
  const [address, setAddress] = useState('')
  const [categoryId, setCategoryId] = useState<string>('')
  /** Дефолтная expense_category — автоматически проставится в новый
   *  расход с этим контрагентом (OCR/KSeF/manual). */
  const [defaultExpenseCategoryId, setDefaultExpenseCategoryId] = useState<string>('')
  const [notes, setNotes] = useState('')
  const [bankIban, setBankIban] = useState('')
  const [addingCategory, setAddingCategory] = useState(false)
  const [newCategoryDraft, setNewCategoryDraft] = useState('')
  const [lookupBusy, setLookupBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    if (counterparty) {
      setName(counterparty.name)
      setNip(counterparty.nip ?? '')
      setAddress(counterparty.address ?? '')
      setCategoryId(counterparty.category_id ?? '')
      setDefaultExpenseCategoryId(
        (counterparty as typeof counterparty & { default_expense_category_id?: string | null })
          .default_expense_category_id ?? '',
      )
      setNotes(counterparty.notes ?? '')
      setBankIban(formatIbanForDisplay(counterparty.bank_account_iban))
    } else {
      setName(prefill?.name ?? '')
      setNip(prefill?.nip ?? '')
      setAddress(prefill?.address ?? '')
      setCategoryId('')
      setDefaultExpenseCategoryId('')
      setNotes('')
      setBankIban(prefill?.iban ? formatIbanForDisplay(prefill.iban) : '')
    }
    setAddingCategory(false)
    setNewCategoryDraft('')
    // eslint-disable-next-line react-hooks/exhaustive-deps -- одноразовый ресет при open/counterparty.id
  }, [open, counterparty?.id, prefill?.name, prefill?.nip, prefill?.address, prefill?.iban])

  async function handleNipLookup() {
    const cleaned = nip.replace(/[^0-9]/g, '')
    if (cleaned.length !== 10) {
      toast.error(t('counterparties.nip_invalid'))
      return
    }
    setLookupBusy(true)
    try {
      const res = await lookupNip(cleaned)
      if (res && (res.name || res.address)) {
        if (res.name && !name) setName(res.name)
        if (res.address && !address) setAddress(res.address)
        toast.success(t('counterparties.nip_found'))
      } else {
        // Data PORT не вернул данных — нестрашно, юзер заполнит руками.
        toast(t('counterparties.nip_not_found'))
      }
    } catch (e) {
      // Image #96: NIP lookup гасит ошибку тихим тостом — не блокирует
      // создание контрагента, юзер сможет ввести name/address руками.
      console.warn('NIP lookup failed', e)
      toast(t('counterparties.nip_lookup_failed'))
    } finally {
      setLookupBusy(false)
    }
  }

  async function handleCreateCategory() {
    const n = newCategoryDraft.trim()
    if (!n) return
    try {
      const cat = await createCat.mutateAsync({ name: n })
      setCategoryId(cat.id)
      setAddingCategory(false)
      setNewCategoryDraft('')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    }
  }

  function handleSave() {
    const trimmed = name.trim()
    if (!trimmed) {
      toast.error(t('counterparties.name_required'))
      return
    }
    const cleanedIban = bankIban.replace(/\s+/g, '').trim() || null
    if (isEdit && counterparty) {
      updateCp.mutate(
        {
          id: counterparty.id,
          name: trimmed,
          nip: nip.trim() || null,
          address: address.trim() || null,
          category_id: categoryId || null,
          notes: notes.trim() || null,
          bank_account_iban: cleanedIban,
          default_expense_category_id: defaultExpenseCategoryId || null,
        },
        {
          onSuccess: () => {
            toast.success(t('counterparties.toast_saved'))
            onSaved?.({
              ...counterparty,
              name: trimmed,
              nip: nip.trim() || null,
              address: address.trim() || null,
              category_id: categoryId || null,
              notes: notes.trim() || null,
              bank_account_iban: cleanedIban,
              default_expense_category_id: defaultExpenseCategoryId || null,
            })
            onOpenChange(false)
          },
          onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
        },
      )
      return
    }
    createCp.mutate(
      {
        name: trimmed,
        nip: nip.trim() || null,
        address: address.trim() || null,
        category_id: categoryId || null,
        notes: notes.trim() || null,
        bank_account_iban: cleanedIban,
        default_expense_category_id: defaultExpenseCategoryId || null,
      },
      {
        onSuccess: (cp) => {
          toast.success(t('counterparties.toast_created'))
          onSaved?.(cp)
          onOpenChange(false)
        },
        onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
      },
    )
  }

  const isPending = createCp.isPending || updateCp.isPending

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:!w-[560px] sm:!max-w-[560px]">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? t('counterparties.title_edit') : t('counterparties.title_new')}
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-3 overflow-y-auto px-5 pb-2 pt-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cp-name">{t('counterparties.name_label')} *</Label>
            <Input
              id="cp-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('counterparties.name_placeholder')}
              autoFocus
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cp-nip">{t('counterparties.nip_label')}</Label>
            <div className="flex gap-2">
              <Input
                id="cp-nip"
                value={nip}
                onChange={(e) => setNip(e.target.value)}
                placeholder="1234567890"
                inputMode="numeric"
                maxLength={13}
                className="num flex-1"
              />
              <Button
                type="button"
                variant="outline"
                onClick={handleNipLookup}
                disabled={lookupBusy || nip.replace(/[^0-9]/g, '').length !== 10}
              >
                {lookupBusy ? (
                  <Loader2 className="size-4 animate-spin" strokeWidth={2} />
                ) : (
                  <Search className="size-4" strokeWidth={2} />
                )}
                {t('counterparties.nip_lookup')}
              </Button>
            </div>
            <p className="text-muted-foreground text-[10.5px]">{t('counterparties.nip_hint')}</p>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cp-address">{t('counterparties.address_label')}</Label>
            <Input
              id="cp-address"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder={t('counterparties.address_placeholder')}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>{t('counterparties.category_label')}</Label>
            {addingCategory ? (
              <div className="flex gap-2">
                <Input
                  autoFocus
                  value={newCategoryDraft}
                  onChange={(e) => setNewCategoryDraft(e.target.value)}
                  placeholder={t('counterparties.category_new_placeholder')}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      void handleCreateCategory()
                    } else if (e.key === 'Escape') {
                      setAddingCategory(false)
                      setNewCategoryDraft('')
                    }
                  }}
                  className="flex-1"
                />
                <Button
                  type="button"
                  onClick={() => void handleCreateCategory()}
                  disabled={!newCategoryDraft.trim() || createCat.isPending}
                  size="sm"
                >
                  <Plus className="size-4" strokeWidth={2} />
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setAddingCategory(false)
                    setNewCategoryDraft('')
                  }}
                  size="sm"
                >
                  ✕
                </Button>
              </div>
            ) : (
              <div className="flex gap-2">
                <Select
                  value={categoryId || '__none__'}
                  onValueChange={(v) => setCategoryId(v === '__none__' ? '' : v)}
                >
                  <SelectTrigger className="flex-1">
                    <SelectValue placeholder={t('counterparties.category_placeholder')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">{t('counterparties.category_none')}</SelectItem>
                    {categories.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setAddingCategory(true)}
                  title={t('counterparties.category_new')}
                >
                  <Plus className="size-4" strokeWidth={2} />
                </Button>
              </div>
            )}
          </div>

          {/* Дефолтная категория расхода — автоматически проставится в новые
              expense с этим контрагентом (OCR/KSeF/manual выбор). Юзер 02.06:
              «при выборе контрагента — категория автоматом подтягивается». */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cp-default-exp-cat">
              {t('counterparties.default_expense_category_label', {
                defaultValue: 'Дефолтная категория расхода',
              })}
            </Label>
            <Select
              value={defaultExpenseCategoryId || '__none__'}
              onValueChange={(v) => setDefaultExpenseCategoryId(v === '__none__' ? '' : v)}
            >
              <SelectTrigger id="cp-default-exp-cat">
                <SelectValue
                  placeholder={t('counterparties.default_expense_category_placeholder', {
                    defaultValue: 'Без дефолта',
                  })}
                />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">
                  {t('counterparties.default_expense_category_none', {
                    defaultValue: 'Без дефолта',
                  })}
                </SelectItem>
                {expenseCategories
                  .filter((c) => !c.is_archived)
                  .map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
            <p className="text-muted-foreground text-[10px]">
              {t('counterparties.default_expense_category_hint', {
                defaultValue:
                  'При создании расхода с этим контрагентом — категория подставится автоматически.',
              })}
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cp-iban">{t('counterparties.bank_iban_label')}</Label>
            <Input
              id="cp-iban"
              value={bankIban}
              onChange={(e) => setBankIban(e.target.value)}
              onBlur={(e) => setBankIban(formatIbanForDisplay(e.target.value))}
              placeholder="PL61 1090 1014 0000 0712 1981 2874"
              inputMode="text"
              className="num"
            />
            <p className="text-muted-foreground text-[10.5px]">
              {t('counterparties.bank_iban_hint')}
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cp-notes">{t('counterparties.notes_label')}</Label>
            <textarea
              id="cp-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder={t('counterparties.notes_placeholder')}
              className="border-input bg-card text-foreground placeholder:text-muted-foreground/60 focus:ring-ring/40 w-full resize-y rounded-md border px-3 py-2 text-sm outline-none focus:ring-2"
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            size="lg"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
          >
            {t('common.cancel')}
          </Button>
          <Button
            size="lg"
            onClick={handleSave}
            disabled={isPending || !name.trim()}
            title={!name.trim() ? t('counterparties.name_required') : undefined}
          >
            {isPending ? t('common.loading') : t('common.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
