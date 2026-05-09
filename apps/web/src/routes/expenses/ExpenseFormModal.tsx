import { zodResolver } from '@hookform/resolvers/zod'
import { addMonths, addWeeks, format } from 'date-fns'
import { Camera, Loader2, Paperclip, X } from 'lucide-react'
import { useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { z } from 'zod'

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
  uploadReceipt,
  useCreateExpense,
  useExpenseCategories,
  type ExpenseCategoryRow,
  type ExpenseRecurrence,
} from '@/hooks/useExpenses'
import { useSalonIntegrations, useWfirmaPushExpense } from '@/hooks/useIntegrations'
import { useOcrReceipt } from '@/hooks/useOcrReceipt'
import type { PaymentMethod } from '@/hooks/useVisits'

const PAYMENT_OPTIONS: PaymentMethod[] = ['cash', 'card', 'transfer']

type FormValues = {
  expense_at: string
  category_id: string
  amount: string
  payment_method: PaymentMethod | ''
  comment: string
  recurrence: ExpenseRecurrence
}

const schema = z.object({
  expense_at: z.string().min(1),
  category_id: z.string().min(1, 'expenses.errors.category_required'),
  amount: z
    .string()
    .min(1, 'expenses.errors.amount_required')
    .refine((v) => Number(v.replace(',', '.')) > 0, 'expenses.errors.amount_positive'),
  payment_method: z.enum(['cash', 'card', 'transfer', '']).optional().default(''),
  comment: z.string().max(500).optional().default(''),
  recurrence: z.enum(['none', 'weekly', 'monthly']).default('none'),
})

/** Считает дату следующего повторения от исходной даты расхода. */
function nextOccurrence(expenseAt: string, recurrence: ExpenseRecurrence): string | null {
  if (recurrence === 'none') return null
  const base = new Date(expenseAt)
  if (Number.isNaN(base.getTime())) return null
  const next = recurrence === 'weekly' ? addWeeks(base, 1) : addMonths(base, 1)
  return format(next, 'yyyy-MM-dd')
}

/**
 * Лёгкий fuzzy match: ищет существующую категорию у которой имя содержит
 * слова из guess (или наоборот). Возвращает id первой найденной или null.
 * Не пытается быть умнее — лучше пусто, чем неправильная категория.
 */
function findCategoryByGuess(
  guess: string | null,
  categories: ExpenseCategoryRow[],
): string | null {
  if (!guess) return null
  const g = guess.toLowerCase().trim()
  if (!g) return null
  // Точное совпадение приоритетнее
  const exact = categories.find((c) => c.name.toLowerCase().trim() === g)
  if (exact) return exact.id
  // Содержит слова друг друга
  const partial = categories.find((c) => {
    const n = c.name.toLowerCase()
    return n.includes(g) || g.includes(n)
  })
  return partial?.id ?? null
}

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  salonId: string
  currency: string
  /** Если передано — преселектируем эту категорию */
  defaultCategoryId?: string | null
}

export function ExpenseFormModal({
  open,
  onOpenChange,
  salonId,
  currency,
  defaultCategoryId,
}: Props) {
  const { t } = useTranslation()
  const { data: categories = [] } = useExpenseCategories(salonId)
  const { data: integrations = [] } = useSalonIntegrations(salonId)
  const createExpense = useCreateExpense(salonId)
  const wfirmaPush = useWfirmaPushExpense(salonId)
  const ocr = useOcrReceipt()

  const today = format(new Date(), 'yyyy-MM-dd')

  const [receiptFile, setReceiptFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  // OCR-извлечённые NIP'ы — попадают в expenses.metadata при save и используются
  // edge function wfirma-proxy для решения auto-push (см. ADR-012).
  const [ocrNips, setOcrNips] = useState<{ buyer_nip: string | null; vendor_nip: string | null }>({
    buyer_nip: null,
    vendor_nip: null,
  })

  const wfirmaConnected = integrations.some(
    (i) => i.provider === 'wfirma' && i.status === 'connected',
  )

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      expense_at: today,
      category_id: defaultCategoryId ?? '',
      amount: '',
      payment_method: '',
      comment: '',
      recurrence: 'none',
    },
  })

  async function onSubmit(values: FormValues) {
    const amountCents = Math.round(Number(values.amount.replace(',', '.')) * 100)

    let receiptUrl: string | null = null
    if (receiptFile) {
      try {
        setUploading(true)
        receiptUrl = await uploadReceipt(salonId, receiptFile)
      } catch (err) {
        setUploading(false)
        toast.error(t('expenses.toast_upload_failed'), {
          description: err instanceof Error ? err.message : String(err),
        })
        return
      } finally {
        setUploading(false)
      }
    }

    const metadata: Record<string, unknown> = {}
    if (ocrNips.buyer_nip) metadata.buyer_nip = ocrNips.buyer_nip
    if (ocrNips.vendor_nip) metadata.vendor_nip = ocrNips.vendor_nip

    createExpense.mutate(
      {
        salon_id: salonId,
        expense_at: values.expense_at,
        category_id: values.category_id || null,
        amount_cents: amountCents,
        payment_method: values.payment_method || null,
        comment: values.comment || null,
        receipt_url: receiptUrl,
        recurrence: values.recurrence,
        next_occurrence_at: nextOccurrence(values.expense_at, values.recurrence),
        metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
      },
      {
        onSuccess: (created) => {
          toast.success(t('expenses.toast_added'))
          form.reset({
            expense_at: today,
            category_id: defaultCategoryId ?? '',
            amount: '',
            payment_method: '',
            comment: '',
            recurrence: 'none',
          })
          setReceiptFile(null)
          setOcrNips({ buyer_nip: null, vendor_nip: null })
          onOpenChange(false)

          // Auto-push в wFirma если подключена и есть чек.
          // Edge function сам решит — пушить или скипнуть (по NIP).
          if (wfirmaConnected && receiptUrl && created?.id) {
            wfirmaPush.mutate(
              { expenseId: created.id, auto: true },
              {
                onSuccess: (res) => {
                  if (res.kind === 'ok') {
                    toast.success(t('expenses.wfirma.toast_auto_pushed'))
                  } else if (res.kind === 'skipped') {
                    if (res.reason === 'nip_mismatch') {
                      toast.info(t('expenses.wfirma.toast_skipped_nip_mismatch'))
                    } else if (res.reason === 'no_buyer_nip') {
                      toast.info(t('expenses.wfirma.toast_skipped_no_nip'))
                    }
                    // no_receipt здесь не возникает — мы попадаем сюда только при receiptUrl
                  } else if (res.kind === 'error') {
                    toast.error(t('expenses.wfirma.toast_push_failed'), {
                      description: res.reason,
                    })
                  }
                },
                // onError ловит сетевые сбои; локальную проблему уже логируем выше
                onError: (err) => {
                  toast.error(t('expenses.wfirma.toast_push_failed'), {
                    description: err instanceof Error ? err.message : String(err),
                  })
                },
              },
            )
          }
        },
        onError: (err) => {
          toast.error(t('expenses.toast_error'), {
            description: err instanceof Error ? err.message : String(err),
          })
        },
      },
    )
  }

  const currencySymbol = currency === 'EUR' ? '€' : currency === 'USD' ? '$' : currency

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('expenses.form.title_new')}</DialogTitle>
        </DialogHeader>

        <form
          className="flex min-h-0 flex-col gap-4 overflow-y-auto px-5 pb-2 pt-4"
          onSubmit={form.handleSubmit(onSubmit)}
          noValidate
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="exp-date">{t('expenses.form.date_label')}</Label>
            <Input id="exp-date" type="date" {...form.register('expense_at')} />
          </div>

          <Controller
            name="category_id"
            control={form.control}
            render={({ field }) => (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="exp-cat">{t('expenses.form.category_label')}</Label>
                <Select
                  value={field.value}
                  onValueChange={field.onChange}
                  disabled={categories.length === 0}
                >
                  <SelectTrigger id="exp-cat" data-testid="exp-cat">
                    <SelectValue
                      placeholder={
                        categories.length === 0
                          ? t('expenses.form.category_empty')
                          : t('expenses.form.category_placeholder')
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {categories.map((c: ExpenseCategoryRow) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {categories.length === 0 ? (
                  <p className="text-muted-foreground text-xs">
                    {t('expenses.form.category_empty_hint')}{' '}
                    <a
                      href={`/salon/${salonId}/services`}
                      className="text-primary font-semibold hover:underline"
                    >
                      {t('expenses.form.category_empty_link')}
                    </a>
                  </p>
                ) : null}
                {form.formState.errors.category_id ? (
                  <p className="text-destructive text-xs font-medium" role="alert">
                    {t(form.formState.errors.category_id.message ?? '')}
                  </p>
                ) : null}
              </div>
            )}
          />

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="exp-amount">{t('expenses.form.amount_label')}</Label>
            <div className="border-brand-yellow-deep bg-brand-yellow flex h-16 items-center gap-2 rounded-md border-[1.5px] px-4">
              <span className="num text-brand-navy text-3xl font-bold">{currencySymbol}</span>
              <input
                id="exp-amount"
                type="number"
                inputMode="decimal"
                step="any"
                min="0"
                placeholder="0"
                {...form.register('amount')}
                className="num text-brand-navy placeholder:text-brand-navy/30 h-full flex-1 bg-transparent text-3xl font-bold tracking-tight outline-none"
                data-testid="exp-amount"
              />
            </div>
            {form.formState.errors.amount ? (
              <p className="text-destructive text-xs font-medium" role="alert">
                {t(form.formState.errors.amount.message ?? '')}
              </p>
            ) : null}
          </div>

          <Controller
            name="payment_method"
            control={form.control}
            render={({ field }) => (
              <div className="flex gap-2">
                {PAYMENT_OPTIONS.map((p) => {
                  const active = field.value === p
                  return (
                    <button
                      type="button"
                      key={p}
                      onClick={() => field.onChange(active ? '' : p)}
                      className={`flex h-10 flex-1 items-center justify-center rounded-full border-[1.5px] text-sm font-semibold transition-colors ${
                        active
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'border-border bg-card text-foreground hover:bg-accent/50'
                      }`}
                    >
                      {t(`payment_methods.${p}`)}
                    </button>
                  )
                })}
              </div>
            )}
          />

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="exp-comment">{t('expenses.form.comment_label')}</Label>
            <Input
              id="exp-comment"
              placeholder={t('expenses.form.comment_placeholder')}
              {...form.register('comment')}
            />
          </div>

          {/* Фото чека (опционально). Если фото — auto-OCR через Claude Haiku */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="exp-receipt">{t('expenses.form.receipt_label')}</Label>
            {receiptFile ? (
              <div className="border-border bg-muted/30 flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm">
                <span className="flex items-center gap-2 truncate">
                  {ocr.isPending ? (
                    <Loader2 className="text-secondary size-4 animate-spin" strokeWidth={1.7} />
                  ) : (
                    <Paperclip className="text-muted-foreground size-4" strokeWidth={1.7} />
                  )}
                  <span className="truncate">
                    {ocr.isPending ? t('expenses.form.ocr_recognizing') : receiptFile.name}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setReceiptFile(null)
                    setOcrNips({ buyer_nip: null, vendor_nip: null })
                  }}
                  className="text-muted-foreground hover:text-destructive grid size-6 place-items-center rounded-md"
                  aria-label={t('expenses.form.receipt_remove')}
                >
                  <X className="size-4" strokeWidth={1.7} />
                </button>
              </div>
            ) : (
              <label
                htmlFor="exp-receipt"
                className="border-border bg-card hover:bg-muted/30 text-muted-foreground flex h-12 cursor-pointer items-center gap-2.5 rounded-md border-[1.5px] border-dashed px-3.5 text-sm"
              >
                <Camera className="size-4" strokeWidth={1.7} />
                <span>{t('expenses.form.receipt_placeholder_ocr')}</span>
              </label>
            )}
            <input
              id="exp-receipt"
              type="file"
              accept="image/*,application/pdf"
              className="hidden"
              data-testid="exp-receipt"
              onChange={(e) => {
                const file = e.target.files?.[0] ?? null
                if (file && file.size > 10 * 1024 * 1024) {
                  toast.error(t('expenses.form.receipt_too_big'))
                  return
                }
                setReceiptFile(file)
                setOcrNips({ buyer_nip: null, vendor_nip: null })
                // Auto-OCR только для картинок (PDF не парсим — мало кейсов)
                if (file && file.type.startsWith('image/')) {
                  ocr.mutate(file, {
                    onSuccess: (parsed) => {
                      // Предзаполняем поля: только если они пусты или дефолтные.
                      // Юзер редактируемые значения не теряет.
                      if (parsed.amount && !form.getValues('amount')) {
                        form.setValue('amount', String(parsed.amount), { shouldDirty: true })
                      }
                      if (parsed.expense_at) {
                        form.setValue('expense_at', parsed.expense_at, { shouldDirty: true })
                      }
                      const matchedCat = findCategoryByGuess(parsed.category_guess, categories)
                      if (matchedCat && !form.getValues('category_id')) {
                        form.setValue('category_id', matchedCat, { shouldDirty: true })
                      }
                      if (parsed.vendor && !form.getValues('comment')) {
                        form.setValue('comment', parsed.vendor, { shouldDirty: true })
                      }
                      // NIP'ы — для wFirma auto-push (см. ADR-012).
                      // Сами поля юзеру не показываем — это служебная мета.
                      setOcrNips({
                        buyer_nip: parsed.buyer_nip,
                        vendor_nip: parsed.vendor_nip,
                      })
                      toast.success(t('expenses.form.ocr_done'))
                    },
                    onError: () => {
                      // Юзер заполнит сам, фото остаётся прикреплённым
                      toast.error(t('expenses.form.ocr_failed'))
                    },
                  })
                }
              }}
            />
          </div>

          {/* Повторение */}
          <Controller
            name="recurrence"
            control={form.control}
            render={({ field }) => (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="exp-recurrence">{t('expenses.form.recurrence_label')}</Label>
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger id="exp-recurrence" data-testid="exp-recurrence">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">{t('expenses.form.recurrence.none')}</SelectItem>
                    <SelectItem value="weekly">{t('expenses.form.recurrence.weekly')}</SelectItem>
                    <SelectItem value="monthly">{t('expenses.form.recurrence.monthly')}</SelectItem>
                  </SelectContent>
                </Select>
                {field.value !== 'none' ? (
                  <p className="text-muted-foreground text-xs">
                    {t('expenses.form.recurrence_hint')}
                  </p>
                ) : null}
              </div>
            )}
          />
        </form>

        <DialogFooter>
          <Button
            type="button"
            size="lg"
            onClick={form.handleSubmit(onSubmit)}
            disabled={createExpense.isPending || uploading}
            data-testid="exp-submit"
          >
            {createExpense.isPending || uploading ? t('common.loading') : t('expenses.form.submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
