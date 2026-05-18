import { zodResolver } from '@hookform/resolvers/zod'
import { addMonths, addWeeks, format } from 'date-fns'
import { CalendarClock, Camera, CheckCircle2, Loader2, Paperclip, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { z } from 'zod'

import { supabase } from '@/lib/supabase/client'
import { useQueryClient } from '@tanstack/react-query'
import type { ScheduledPaymentRow } from '@/hooks/useScheduledPayments'
import { cn } from '@/lib/utils/cn'

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
  useUpdateExpense,
  type ExpenseCategoryRow,
  type ExpenseRecurrence,
  type ExpenseRow,
  type PayrollKind,
} from '@/hooks/useExpenses'
import { useStaff } from '@/hooks/useStaff'
import {
  pickActiveAccountingProvider,
  useAccountingPushExpense,
  useSalonIntegrations,
  useWfirmaPushExpense,
} from '@/hooks/useIntegrations'

const PORTAL_DISPLAY_NAME: Record<string, string> = {
  wfirma: 'wFirma',
  fakturownia: 'Fakturownia',
  infakt: 'inFakt',
}
import { DictateButton } from '@/components/ui/DictateButton'
import { CashGateRequiredDialog } from '@/components/CashGateRequiredDialog'
import { useCashRegisters } from '@/hooks/useCashRegisters'
import { useRequireCashShift } from '@/hooks/useCashShifts'
import { useCounterparties } from '@/hooks/useCounterparties'
import { useDictateExpense } from '@/hooks/useDictateExpense'
import { useOcrReceipt } from '@/hooks/useOcrReceipt'
import type { PaymentMethod } from '@/hooks/useVisits'
import { CounterpartyEditModal } from '@/routes/settings/counterparties/CounterpartyEditModal'

type FormValues = {
  expense_at: string
  /** Image #94: обязательное короткое описание (раньше эту роль играл comment). */
  description: string
  category_id: string
  /** FK на counterparties (image #93). Опциональное. */
  counterparty_id: string
  amount: string
  payment_method: PaymentMethod | ''
  /** ID кассы (image #82) — заменяет payment_method-pills в UI. */
  cash_register_id: string
  /** Номер фактуры/чека (image #93). Опциональное. */
  document_number: string
  comment: string
  recurrence: ExpenseRecurrence
  // Payroll: показываются только если выбранная категория is_payroll=true
  payroll_staff_id: string
  payroll_kind: PayrollKind | ''
  payroll_period_start: string
  payroll_period_end: string
}

const schema = z.object({
  expense_at: z.string().min(1),
  description: z
    .string()
    .min(1, 'expenses.errors.description_required')
    .max(200, 'expenses.errors.description_too_long'),
  category_id: z.string().min(1, 'expenses.errors.category_required'),
  counterparty_id: z.string().optional().default(''),
  amount: z
    .string()
    .min(1, 'expenses.errors.amount_required')
    .refine((v) => Number(v.replace(',', '.')) > 0, 'expenses.errors.amount_positive'),
  payment_method: z
    .enum(['cash', 'card', 'transfer', 'online', 'mixed', ''])
    .optional()
    .default(''),
  cash_register_id: z.string().optional().default(''),
  document_number: z.string().max(60).optional().default(''),
  comment: z.string().max(500).optional().default(''),
  recurrence: z.enum(['none', 'weekly', 'monthly']).default('none'),
  payroll_staff_id: z.string().optional().default(''),
  payroll_kind: z.enum(['advance', 'final', '']).optional().default(''),
  payroll_period_start: z.string().optional().default(''),
  payroll_period_end: z.string().optional().default(''),
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
/**
 * Транслитерация русской кириллицы в латиницу для cross-language matching
 * контрагентов: «Лидл» → «lidl», «Икея» → «ikea». Это не academic translit,
 * а pragmatic mapping чтобы Whisper-вывод на русском совпадал с польским
 * названием в базе.
 */
function translitRuToLat(s: string): string {
  const map: Record<string, string> = {
    а: 'a',
    б: 'b',
    в: 'v',
    г: 'g',
    д: 'd',
    е: 'e',
    ё: 'e',
    ж: 'zh',
    з: 'z',
    и: 'i',
    й: 'i',
    к: 'k',
    л: 'l',
    м: 'm',
    н: 'n',
    о: 'o',
    п: 'p',
    р: 'r',
    с: 's',
    т: 't',
    у: 'u',
    ф: 'f',
    х: 'h',
    ц: 'c',
    ч: 'ch',
    ш: 'sh',
    щ: 'sh',
    ъ: '',
    ы: 'y',
    ь: '',
    э: 'e',
    ю: 'yu',
    я: 'ya',
  }
  return s
    .toLowerCase()
    .split('')
    .map((ch) => (ch in map ? map[ch] : ch))
    .join('')
}

/**
 * Нормализует имя контрагента для fuzzy match: lowercase + транслит +
 * убираем правовые формы (sp. z o.o., ООО, ИП и т.д.) и не-буквенные знаки.
 */
function normalizeCounterpartyName(s: string): string {
  return translitRuToLat(s)
    .replace(/\b(sp\.? z o\.? o\.?|spolka z o ?o ?o|ooo|ип|tov|too|llc|ltd|inc|gmbh)\b/gi, '')
    .replace(/[^a-z0-9]/g, '')
    .trim()
}

/**
 * Cross-language search контрагента по имени. «Лидл» матчится на «Lidl
 * Sp. z o.o.» через транслит. Возвращает первое подходящее значение или null.
 */
function findCounterpartyFuzzy<T extends { name: string }>(vendor: string, list: T[]): T | null {
  const target = normalizeCounterpartyName(vendor)
  if (!target) return null
  for (const cp of list) {
    const norm = normalizeCounterpartyName(cp.name)
    if (!norm) continue
    if (norm === target) return cp
    if (norm.includes(target) || target.includes(norm)) return cp
  }
  return null
}

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

/**
 * Режимы работы модалки:
 *  - `'expense'` — обычный flow из вкладки «Расходы». Переключатель Оплачено/Не
 *    оплачено скрыт, всегда создаём `expenses` (как было до объединения).
 *  - `'planned-new'` — открыто из «Платёжного календаря» как новый платёж.
 *    Переключатель доступен: если выкл → создаём только `scheduled_payments`
 *    (status=pending); если вкл → создаём `expenses` + связанный
 *    `scheduled_payments(status=paid)`.
 *  - `'planned-paying'` — клик «Mark as paid» на pending платеже. Префилл из
 *    переданного `existingPayment`, переключатель скрыт (paid). При submit
 *    создаём `expenses` и UPDATE существующего payment'а (status=paid,
 *    paid_expense_id, paid_at).
 */
export type ExpenseFormMode = 'expense' | 'planned-new' | 'planned-paying'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  salonId: string
  currency: string
  /** Если передано — преселектируем эту категорию */
  defaultCategoryId?: string | null
  /** Image #49: если передано — модалка работает в режиме редактирования
   *  существующего расхода (UPDATE вместо INSERT). Поля префиллятся. */
  expense?: ExpenseRow | null
  /** Режим работы модалки (см. ExpenseFormMode). Default: 'expense'. */
  mode?: ExpenseFormMode
  /** Дата по умолчанию (для prefill due_date/expense_at). Default: сегодня. */
  defaultDate?: string | null
  /** Существующий запланированный платёж — для mode='planned-paying'. */
  existingPayment?: ScheduledPaymentRow | null
}

export function ExpenseFormModal({
  open,
  onOpenChange,
  salonId,
  currency,
  defaultCategoryId,
  expense,
  mode = 'expense',
  defaultDate,
  existingPayment,
}: Props) {
  const { t } = useTranslation()
  const isEdit = !!expense
  const qc = useQueryClient()
  // Toggle Оплачено/Не оплачено — управляет тем, что создаём (expense vs
  // scheduled_payment). Только для mode='planned-new'; в остальных режимах
  // значение зафиксировано: 'expense' → true, 'planned-paying' → true.
  // Дефолт = Оплачено для всех режимов; юзер переключит при необходимости.
  const [paid, setPaid] = useState<boolean>(true)
  // Если paid=false — поля чек/касса/payment_method/recurrence/payroll/dictate
  // не имеют смысла (план, не факт оплаты). Скрываем их и не валидируем.
  const showPaidOnlyFields = paid
  const { data: categories = [] } = useExpenseCategories(salonId)
  const { data: integrations = [] } = useSalonIntegrations(salonId)
  const { data: cashRegisters = [] } = useCashRegisters(salonId)
  const { hasOpenShift } = useRequireCashShift(salonId)
  const { data: staffList = [] } = useStaff(salonId, { activeOnly: false })
  const { data: counterparties = [] } = useCounterparties(salonId)
  const [counterpartyModalOpen, setCounterpartyModalOpen] = useState(false)
  const [gateOpen, setGateOpen] = useState(false)
  const [dictationPrefillForNewCp, setDictationPrefillForNewCp] = useState<{
    name?: string
    nip?: string
    address?: string
  } | null>(null)
  const createExpense = useCreateExpense(salonId)
  const updateExpense = useUpdateExpense(salonId)
  const wfirmaPush = useWfirmaPushExpense(salonId)
  const ocr = useOcrReceipt()
  const dictate = useDictateExpense()

  /**
   * Применяет распарсенный по голосу результат к форме. Поля заполняются
   * только если они пустые — юзер свои значения не теряет.
   *
   * Image #108: владелец сказал «Купил кофе и воду за 1120 zł в Лидле»,
   * ожидал: Описание = «Кофе и вода» (что купили), Контрагент = «Лидл».
   * До правки: «Кофе и вода» попадало в Комментарий, Описание оставалось
   * пустым; контрагент не подставлялся (база на польском «Lidl», голос
   * на русском «Лидл»). Теперь:
   *   - description ← parsed.comment (краткое описание того, что купили);
   *     vendor_guess НЕ пишем в description — это название магазина.
   *   - counterparty matching стал толерантнее (нормализуем оба имени:
   *     lowercase + убираем ООО/Sp. z o.o./пробелы/знаки препинания +
   *     транслитерируем кириллицу в латиницу) → «Лидл» ↔ «Lidl Sp. z o.o.».
   *   - Если matching не нашёл — обязательно открываем CounterpartyEditModal
   *     с префилом name, чтобы юзер создал нового контрагента одним кликом.
   */
  function applyDictation(
    parsed: NonNullable<Awaited<ReturnType<typeof dictate.mutateAsync>>['parsed']>,
  ) {
    if (parsed.amount && !form.getValues('amount')) {
      form.setValue('amount', String(parsed.amount), { shouldDirty: true })
    }
    if (parsed.expense_at) {
      form.setValue('expense_at', parsed.expense_at, { shouldDirty: true })
    }
    if (parsed.category_guess && !form.getValues('category_id')) {
      const matched = findCategoryByGuess(parsed.category_guess, categories)
      if (matched) form.setValue('category_id', matched, { shouldDirty: true })
    }
    if (parsed.document_number && !form.getValues('document_number')) {
      form.setValue('document_number', parsed.document_number, { shouldDirty: true })
    }
    // Описание = что купили (LLM возвращает в comment) — приоритетно,
    // потом fallback на vendor_guess если comment пуст.
    const descCandidate = parsed.comment ?? parsed.vendor_guess ?? null
    if (descCandidate && !form.getValues('description')) {
      form.setValue('description', descCandidate.slice(0, 200), { shouldDirty: true })
    }
    if (parsed.vendor_guess && !form.getValues('counterparty_id')) {
      const matchedCp = findCounterpartyFuzzy(parsed.vendor_guess, counterparties)
      if (matchedCp) {
        form.setValue('counterparty_id', matchedCp.id, { shouldDirty: true })
      } else {
        // Не нашли — открываем модалку создания с префилом name из голоса.
        setDictationPrefillForNewCp({ name: parsed.vendor_guess })
        setCounterpartyModalOpen(true)
      }
    }
  }

  const today = format(new Date(), 'yyyy-MM-dd')

  const [receiptFile, setReceiptFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  // OCR-извлечённые NIP'ы — попадают в expenses.metadata при save и используются
  // edge function wfirma-proxy для решения auto-push (см. ADR-012).
  const [ocrNips, setOcrNips] = useState<{ buyer_nip: string | null; vendor_nip: string | null }>({
    buyer_nip: null,
    vendor_nip: null,
  })

  // Активный accounting-портал (приоритет wFirma > Fakturownia > ... — ADR-013).
  // Он получит auto-push после save если у расхода есть чек.
  const activeAccounting = pickActiveAccountingProvider(integrations)
  const accountingPush = useAccountingPushExpense(
    activeAccounting && activeAccounting !== 'wfirma' ? activeAccounting : null,
    salonId,
  )

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      expense_at: today,
      description: '',
      category_id: defaultCategoryId ?? '',
      counterparty_id: '',
      amount: '',
      payment_method: '',
      cash_register_id: '',
      document_number: '',
      comment: '',
      recurrence: 'none',
      payroll_staff_id: '',
      payroll_kind: '',
      payroll_period_start: '',
      payroll_period_end: '',
    },
  })

  // Активная категория: показываем payroll-блок если is_payroll=true.
  const watchedCategoryId = form.watch('category_id')
  const watchedCategory = categories.find((c) => c.id === watchedCategoryId)
  const isPayrollCategory = !!watchedCategory?.is_payroll

  // При открытии в edit-mode — префиллим форму данными существующего расхода.
  // Для mode='planned-paying' — префиллим из existingPayment (vendor → description,
  // category_id, amount, document_number, comment, expense_at=today). Toggle
  // paid синхронизируем с режимом каждый раз при открытии.
  useEffect(() => {
    if (!open) return
    // Sync toggle paid при открытии: дефолт = «Оплачено» во всех режимах.
    // Юзер сам переключит на «Не оплачено» если хочет добавить план.
    setPaid(true)

    if (expense) {
      form.reset({
        expense_at: expense.expense_at.slice(0, 10),
        description: expense.description ?? '',
        category_id: expense.category_id ?? '',
        counterparty_id: expense.counterparty_id ?? '',
        amount: ((expense.amount_cents ?? 0) / 100).toFixed(2),
        payment_method: (expense.payment_method as PaymentMethod) ?? '',
        cash_register_id: expense.cash_register_id ?? '',
        document_number: expense.document_number ?? '',
        comment: expense.comment ?? '',
        recurrence: (expense.recurrence as ExpenseRecurrence) ?? 'none',
        payroll_staff_id: expense.payroll_staff_id ?? '',
        payroll_kind: (expense.payroll_kind as PayrollKind) ?? '',
        payroll_period_start: expense.payroll_period_start ?? '',
        payroll_period_end: expense.payroll_period_end ?? '',
      })
    } else if (existingPayment) {
      // mode='planned-paying' — оплата существующего pending. vendor_name свободный
      // текст → описание (юзер может потом выбрать counterparty из выпадашки).
      form.reset({
        expense_at: today,
        description: existingPayment.vendor_name ?? '',
        category_id: existingPayment.category_id ?? defaultCategoryId ?? '',
        counterparty_id: '',
        amount: (existingPayment.amount_cents / 100).toFixed(2),
        payment_method: '',
        cash_register_id: '',
        document_number: existingPayment.invoice_number ?? '',
        comment: existingPayment.comment ?? '',
        recurrence: 'none',
        payroll_staff_id: '',
        payroll_kind: '',
        payroll_period_start: '',
        payroll_period_end: '',
      })
    } else {
      form.reset({
        expense_at: defaultDate || today,
        description: '',
        category_id: defaultCategoryId ?? '',
        counterparty_id: '',
        amount: '',
        payment_method: '',
        cash_register_id: '',
        document_number: '',
        comment: '',
        recurrence: 'none',
        payroll_staff_id: '',
        payroll_kind: '',
        payroll_period_start: '',
        payroll_period_end: '',
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- одноразовый ресет
  }, [open, expense?.id, existingPayment?.id, mode, defaultDate])

  /**
   * Выводим payment_method из выбранной кассы (cash_register_id) если юзер
   * не указал его явно. Касса теперь источник истины (image #82), но
   * payment_method остаётся в схеме для модуля Касса и старых отчётов.
   * Хайристика та же что в classifyChannel: «касс/нал/Gotówka» → cash,
   * «карт/Karta/Terminal» → card.
   */
  function derivePaymentMethod(values: FormValues): PaymentMethod | null {
    if (values.payment_method) return values.payment_method as PaymentMethod
    if (!values.cash_register_id) return null
    const reg = cashRegisters.find((r) => r.id === values.cash_register_id)
    if (!reg) return null
    const l = reg.label.toLowerCase()
    if (/(касс|нал|gotówk|gotowk|сейф|seif|safe)/i.test(l)) return 'cash'
    if (/(карт|kart|terminal|терминал)/i.test(l)) return 'card'
    return null
  }

  async function onSubmit(values: FormValues) {
    const amountCents = Math.round(Number(values.amount.replace(',', '.')) * 100)

    // Ветка 1: запланированный платёж (paid=false) — пишем только в
    // scheduled_payments(status=pending). Может прийти как из календаря
    // (mode='planned-new'), так и из вкладки «Расходы» (mode='expense'),
    // если юзер переключил на «Не оплачено». CashGate не нужен (это план,
    // движения денег нет). Поля кассы/recurrence/payroll/чек не вычисляем.
    if ((mode === 'planned-new' || mode === 'expense') && !paid) {
      const { error } = await supabase.from('scheduled_payments').insert({
        salon_id: salonId,
        due_date: values.expense_at,
        amount_cents: amountCents,
        vendor_name: values.description.trim() || null,
        invoice_number: values.document_number.trim() || null,
        category_id: values.category_id || null,
        comment: values.comment || null,
        source: 'manual',
      })
      if (error) {
        toast.error(t('expenses.toast_error'), { description: error.message })
        return
      }
      toast.success(t('finance.payments.toast_added'))
      await qc.invalidateQueries({ queryKey: ['scheduled-payments', salonId] })
      onOpenChange(false)
      return
    }

    // Все остальные ветки (expense / planned-new+paid / planned-paying) создают
    // expense, поэтому требуют открытой смены.
    if (!hasOpenShift) {
      setGateOpen(true)
      return
    }
    const derivedPaymentMethod = derivePaymentMethod(values)

    // Edit-mode: простое UPDATE без OCR/auto-push/upload (этого хватает для
    // правки уже-созданного расхода — поля те же, что при создании).
    // Payroll-поля: записываем только если категория зарплатная.
    const payrollFields = isPayrollCategory
      ? {
          payroll_staff_id: values.payroll_staff_id || null,
          payroll_kind: (values.payroll_kind || null) as PayrollKind | null,
          payroll_period_start: values.payroll_period_start || null,
          payroll_period_end: values.payroll_period_end || null,
        }
      : {
          payroll_staff_id: null,
          payroll_kind: null,
          payroll_period_start: null,
          payroll_period_end: null,
        }

    if (isEdit && expense) {
      updateExpense.mutate(
        {
          id: expense.id,
          expense_at: values.expense_at,
          description: values.description.trim(),
          category_id: values.category_id || null,
          counterparty_id: values.counterparty_id || null,
          amount_cents: amountCents,
          payment_method: derivedPaymentMethod,
          cash_register_id: values.cash_register_id || null,
          document_number: values.document_number.trim() || null,
          comment: values.comment || null,
          recurrence: values.recurrence,
          ...payrollFields,
        },
        {
          onSuccess: () => {
            toast.success(t('expenses.toast_updated'))
            onOpenChange(false)
          },
          onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
        },
      )
      return
    }

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
        description: values.description.trim(),
        category_id: values.category_id || null,
        counterparty_id: values.counterparty_id || null,
        amount_cents: amountCents,
        payment_method: values.payment_method || null,
        document_number: values.document_number.trim() || null,
        comment: values.comment || null,
        receipt_url: receiptUrl,
        recurrence: values.recurrence,
        next_occurrence_at: nextOccurrence(values.expense_at, values.recurrence),
        metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
        ...payrollFields,
      },
      {
        onSuccess: async (created) => {
          // Связывание с scheduled_payments в зависимости от mode:
          //  - 'planned-paying': UPDATE существующего payment'а — status=paid,
          //    paid_expense_id=created.id, paid_at=now.
          //  - 'planned-new'+paid=true: INSERT нового payment'а уже в paid-статусе,
          //    привязанного к свежесозданному expense.
          //  - 'expense': ничего не делаем (текущий путь).
          if (mode === 'planned-paying' && existingPayment && created?.id) {
            const { error: linkErr } = await supabase
              .from('scheduled_payments')
              .update({
                status: 'paid',
                paid_at: new Date().toISOString(),
                paid_expense_id: created.id,
              })
              .eq('id', existingPayment.id)
            if (linkErr) {
              // Расход создан, но линковка упала — лог в toast чтобы юзер заметил.
              toast.error(t('finance.payments.toast_error'), { description: linkErr.message })
            }
            await qc.invalidateQueries({ queryKey: ['scheduled-payments', salonId] })
          } else if (mode === 'planned-new' && paid && created?.id) {
            const { error: insErr } = await supabase.from('scheduled_payments').insert({
              salon_id: salonId,
              due_date: values.expense_at,
              amount_cents: amountCents,
              vendor_name: values.description.trim() || null,
              invoice_number: values.document_number.trim() || null,
              category_id: values.category_id || null,
              comment: values.comment || null,
              source: 'manual',
              status: 'paid',
              paid_at: new Date().toISOString(),
              paid_expense_id: created.id,
            })
            if (insErr) {
              toast.error(t('finance.payments.toast_error'), { description: insErr.message })
            }
            await qc.invalidateQueries({ queryKey: ['scheduled-payments', salonId] })
          }

          toast.success(t('expenses.toast_added'))
          form.reset({
            expense_at: today,
            description: '',
            category_id: defaultCategoryId ?? '',
            counterparty_id: '',
            amount: '',
            payment_method: '',
            document_number: '',
            comment: '',
            recurrence: 'none',
          })
          setReceiptFile(null)
          setOcrNips({ buyer_nip: null, vendor_nip: null })
          onOpenChange(false)

          // Auto-push в активный accounting-портал если подключён и есть чек.
          // wFirma имеет дополнительный фильтр по NIP-match (server-side в edge
          // function); остальные порталы пушат любой расход с чеком (тоже
          // server-side check). См. ADR-013.
          if (activeAccounting && receiptUrl && created?.id) {
            const portalLabel = PORTAL_DISPLAY_NAME[activeAccounting] ?? activeAccounting
            if (activeAccounting === 'wfirma') {
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
                    } else if (res.kind === 'error') {
                      toast.error(t('expenses.wfirma.toast_push_failed'), {
                        description: res.reason,
                      })
                    }
                  },
                  onError: (err) => {
                    toast.error(t('expenses.wfirma.toast_push_failed'), {
                      description: err instanceof Error ? err.message : String(err),
                    })
                  },
                },
              )
            } else {
              accountingPush.mutate(
                { expenseId: created.id, auto: true },
                {
                  onSuccess: (res) => {
                    if (res.kind === 'ok') {
                      toast.success(t('expenses.portal.toast_auto_pushed', { portal: portalLabel }))
                    } else if (res.kind === 'error') {
                      toast.error(t('expenses.portal.toast_push_failed', { portal: portalLabel }), {
                        description: res.reason,
                      })
                    }
                    // skipped/already_pushed для не-wFirma порталов — тихий no-op
                  },
                  onError: (err) => {
                    toast.error(t('expenses.portal.toast_push_failed', { portal: portalLabel }), {
                      description: err instanceof Error ? err.message : String(err),
                    })
                  },
                },
              )
            }
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
      {/* Image #65: расширил модалку до 720px и сократил вертикальные
          паддинги — типичная форма расхода теперь умещается без скролла
          (особенно payroll-кейс, где основное содержимое — поля выплаты).
          Image #133: ещё уплотнил — сократил form gap до 2, paddings до
          pt-2/pb-1, и пакую парные поля в 2-колоночный grid (дата+категория,
          контрагент+номер документа), чтобы вся форма умещалась без скролла. */}
      <DialogContent className="sm:!w-[820px] sm:!max-w-[820px]">
        <DialogHeader>
          <DialogTitle>
            {mode === 'planned-paying'
              ? t('expenses.form.title_pay_planned')
              : !paid
                ? t('expenses.form.title_new_planned')
                : mode === 'planned-new'
                  ? t('expenses.form.title_new_paid_from_calendar')
                  : t('expenses.form.title_new')}
          </DialogTitle>
        </DialogHeader>

        <form
          className="flex min-h-0 flex-col gap-1.5 overflow-y-auto px-5 pb-1 pt-1.5"
          onSubmit={form.handleSubmit(onSubmit)}
          noValidate
        >
          {/* Переключатель «Оплачено / Не оплачено» — для нового расхода (вкладка
              «Расходы») и нового платежа (календарь). Дефолт paid=true для expense
              и false для planned-new. В planned-paying скрыт (фиксирован paid).
              При редактировании существующего расхода (isEdit) скрыт — нельзя
              перевести оплаченный расход в план. */}
          {(mode === 'planned-new' || mode === 'expense') && !isEdit ? (
            <div className="border-border bg-muted/30 grid grid-cols-2 gap-1 rounded-md border p-1">
              <button
                type="button"
                onClick={() => setPaid(true)}
                className={`flex h-8 items-center justify-center gap-1.5 rounded-md text-xs font-semibold transition-colors ${
                  paid
                    ? 'bg-emerald-100 text-emerald-800 shadow-sm'
                    : 'text-muted-foreground hover:bg-muted/60'
                }`}
              >
                <CheckCircle2 className="size-3.5" strokeWidth={2} />
                {t('expenses.form.toggle_paid')}
              </button>
              <button
                type="button"
                onClick={() => setPaid(false)}
                className={`flex h-8 items-center justify-center gap-1.5 rounded-md text-xs font-semibold transition-colors ${
                  !paid
                    ? 'bg-sky-100 text-sky-800 shadow-sm'
                    : 'text-muted-foreground hover:bg-muted/60'
                }`}
              >
                <CalendarClock className="size-3.5" strokeWidth={2} />
                {t('expenses.form.toggle_unpaid')}
              </button>
            </div>
          ) : null}

          {/* Image #93 + #109: два способа быстрого ввода (диктовка + чек/OCR)
              в одной строке на десктопе (2-col), друг под другом на mobile.
              Доступны и для запланированного платежа — поля общие.
              Receipt: для payroll-категорий чека не бывает, скрываем его
              половину (диктовка остаётся на всю ширину). */}
          <div className={cn('grid grid-cols-1 gap-1.5', !isPayrollCategory && 'sm:grid-cols-2')}>
            {/* Голосовая надиктовка: row h-9, compact button (size=sm matches). */}
            <div className="border-brand-teal-soft bg-brand-teal-soft/30 flex h-9 items-center justify-between gap-2 rounded-md border px-2.5">
              <p className="text-brand-teal-deep min-w-0 truncate text-[11px] font-bold uppercase tracking-wider">
                {t('dictate.title')}
              </p>
              <DictateButton
                className="h-7 shrink-0 gap-1.5 px-2 text-xs"
                pending={dictate.isPending}
                onAudio={async (blob) => {
                  const res = await dictate.mutateAsync(blob)
                  if (!res.parsed) {
                    toast.error(t('dictate.parse_failed'))
                    return
                  }
                  applyDictation(res.parsed)
                  toast.success(t('dictate.toast_applied'))
                }}
              />
            </div>

            {/* Чек (фото/PDF) — один-в-один h-9 как у диктовки. Скрываем для
                payroll-категорий. Загруженный файл показываем с иконкой + ×. */}
            {!isPayrollCategory &&
              (receiptFile ? (
                <div className="border-border bg-muted/30 flex h-9 items-center justify-between gap-2 rounded-md border px-2.5 text-xs">
                  <span className="flex min-w-0 items-center gap-2 truncate">
                    {ocr.isPending ? (
                      <Loader2 className="text-secondary size-3.5 animate-spin" strokeWidth={1.7} />
                    ) : (
                      <Paperclip className="text-muted-foreground size-3.5" strokeWidth={1.7} />
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
                    className="text-muted-foreground hover:text-destructive grid size-6 shrink-0 place-items-center rounded-md"
                    aria-label={t('expenses.form.receipt_remove')}
                  >
                    <X className="size-3.5" strokeWidth={1.7} />
                  </button>
                </div>
              ) : (
                <label
                  htmlFor="exp-receipt"
                  className="border-border bg-card hover:bg-muted/30 text-muted-foreground flex h-9 cursor-pointer items-center gap-2 rounded-md border-[1.5px] border-dashed px-2.5 text-xs"
                >
                  <Camera className="size-3.5 shrink-0" strokeWidth={1.7} />
                  <span className="truncate">{t('expenses.form.receipt_placeholder_ocr')}</span>
                </label>
              ))}
          </div>

          {/* Hidden file input: оставляем вне grid'а, т.к. это invisible target
              для <label htmlFor="exp-receipt"> выше. */}
          {!isPayrollCategory && (
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
                      // Описание (image #94) — auto-fill из vendor если пусто.
                      if (parsed.vendor && !form.getValues('description')) {
                        form.setValue('description', parsed.vendor.slice(0, 200), {
                          shouldDirty: true,
                        })
                      }
                      // Image #93: номер документа из чека.
                      if (parsed.document_number && !form.getValues('document_number')) {
                        form.setValue('document_number', parsed.document_number, {
                          shouldDirty: true,
                        })
                      }
                      // Image #93: контрагент. Сначала пытаемся match по NIP
                      // (надёжный ключ), потом по имени. Если не нашли —
                      // открываем CounterpartyEditModal с префилом для
                      // быстрого создания (юзер подтверждает данные).
                      if (!form.getValues('counterparty_id') && parsed.vendor) {
                        const byNip = parsed.vendor_nip
                          ? counterparties.find(
                              (cp) =>
                                cp.nip?.replace(/[^0-9]/g, '') ===
                                parsed.vendor_nip?.replace(/[^0-9]/g, ''),
                            )
                          : null
                        const byName = byNip
                          ? null
                          : counterparties.find(
                              (cp) => cp.name.toLowerCase() === parsed.vendor!.toLowerCase(),
                            )
                        const matched = byNip ?? byName
                        if (matched) {
                          form.setValue('counterparty_id', matched.id, { shouldDirty: true })
                        } else {
                          setDictationPrefillForNewCp({
                            name: parsed.vendor,
                            // CounterpartyEditModal принимает prefill { name, nip, address }
                            // — дополняем доступными полями из OCR.
                            ...(parsed.vendor_nip ? { nip: parsed.vendor_nip } : {}),
                            ...(parsed.vendor_address ? { address: parsed.vendor_address } : {}),
                          } as { name: string; nip?: string; address?: string })
                          setCounterpartyModalOpen(true)
                        }
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
          )}

          {/* Image #133: Дата + Категория в 2-колоночном grid'е — экономим
              вертикаль. На мобиле остаётся одна колонка. */}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="exp-date">
                {paid ? t('expenses.form.date_label') : t('expenses.form.due_date_label')}
              </Label>
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
          </div>

          {/* Image #94: обязательное поле «Описание». */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="exp-description">{t('expenses.form.description_label')} *</Label>
            <Input
              id="exp-description"
              {...form.register('description')}
              placeholder={t('expenses.form.description_placeholder')}
              maxLength={200}
              data-testid="exp-description"
            />
            {form.formState.errors.description ? (
              <p className="text-destructive text-xs font-medium" role="alert">
                {t(form.formState.errors.description.message ?? '')}
              </p>
            ) : null}
          </div>

          {/* Payroll-блок: показываем только если выбранная категория
              is_payroll=true. Поля: мастер / аванс или окончательный / период.
              Для плана (paid=false) — скрываем: план зарплаты пока не делаем. */}
          {isPayrollCategory && showPaidOnlyFields ? (
            <div className="border-brand-teal-soft bg-brand-teal-soft/30 flex flex-col gap-3 rounded-md border p-3">
              <p className="text-brand-teal-deep text-[11px] font-bold uppercase tracking-wider">
                {t('expenses.form.payroll_section')}
              </p>

              <Controller
                name="payroll_staff_id"
                control={form.control}
                render={({ field }) => (
                  <div className="flex flex-col gap-1.5">
                    <Label className="text-xs">{t('expenses.form.payroll_staff')}</Label>
                    <Select
                      value={field.value || '__none__'}
                      onValueChange={(v) => field.onChange(v === '__none__' ? '' : v)}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder={t('expenses.form.payroll_staff_placeholder')} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">
                          {t('expenses.form.payroll_staff_placeholder')}
                        </SelectItem>
                        {staffList.map((s) => (
                          <SelectItem key={s.id} value={s.id}>
                            {s.full_name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              />

              <Controller
                name="payroll_kind"
                control={form.control}
                render={({ field }) => (
                  <div className="flex flex-col gap-1.5">
                    <Label className="text-xs">{t('expenses.form.payroll_kind')}</Label>
                    <div className="grid grid-cols-2 gap-2">
                      {(['advance', 'final'] as const).map((kind) => {
                        const active = field.value === kind
                        return (
                          <button
                            key={kind}
                            type="button"
                            onClick={() => field.onChange(active ? '' : kind)}
                            className={`flex h-10 items-center justify-center rounded-md border-[1.5px] text-sm font-semibold transition-colors ${
                              active
                                ? 'border-primary bg-primary text-primary-foreground'
                                : 'border-border bg-card hover:bg-muted/40'
                            }`}
                          >
                            {t(`expenses.form.payroll_kind_${kind}`)}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )}
              />

              {/* Image #55: владелец просит один селектор месяца вместо
                  даты-с/даты-по. В БД храним полный диапазон (первое и
                  последнее число месяца), а в UI — единый <input type="month">. */}
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs">{t('expenses.form.payroll_month')}</Label>
                <Input
                  type="month"
                  value={(form.watch('payroll_period_start') || '').slice(0, 7)}
                  onChange={(e) => {
                    const v = e.target.value // YYYY-MM
                    if (!v) {
                      form.setValue('payroll_period_start', '', { shouldValidate: false })
                      form.setValue('payroll_period_end', '', { shouldValidate: false })
                      return
                    }
                    const [yStr, mStr] = v.split('-')
                    const y = Number(yStr)
                    const m = Number(mStr)
                    if (!Number.isFinite(y) || !Number.isFinite(m)) return
                    const lastDay = new Date(y, m, 0).getDate() // m=1..12 → последний день
                    const start = `${v}-01`
                    const end = `${v}-${String(lastDay).padStart(2, '0')}`
                    form.setValue('payroll_period_start', start, { shouldValidate: false })
                    form.setValue('payroll_period_end', end, { shouldValidate: false })
                  }}
                />
              </div>
            </div>
          ) : null}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="exp-amount">{t('expenses.form.amount_label')}</Label>
            <div className="border-brand-yellow-deep bg-brand-yellow flex h-12 items-center gap-2 rounded-md border-[1.5px] px-3.5">
              <span className="num text-brand-navy text-2xl font-bold">{currencySymbol}</span>
              <input
                id="exp-amount"
                type="number"
                inputMode="decimal"
                step="any"
                min="0"
                placeholder="0"
                {...form.register('amount')}
                className="num text-brand-navy placeholder:text-brand-navy/30 h-full flex-1 bg-transparent text-2xl font-bold tracking-tight outline-none"
                data-testid="exp-amount"
              />
            </div>
            {form.formState.errors.amount ? (
              <p className="text-destructive text-xs font-medium" role="alert">
                {t(form.formState.errors.amount.message ?? '')}
              </p>
            ) : null}
          </div>

          {/* Image #82: кассы (вместо payment_methods). Pills рендерятся из
              financial_settings.cash_registers.items[] — конкретные кассы
              салона, а не абстрактные cash/card/transfer. Если касс нет —
              показываем подсказку со ссылкой на справочник.
              План платежа (paid=false) — кассы нет, скрываем целиком. */}
          {showPaidOnlyFields ? (
            <Controller
              name="cash_register_id"
              control={form.control}
              render={({ field }) => (
                <div className="flex flex-col gap-1.5">
                  <Label>{t('expenses.form.cash_register_label')}</Label>
                  {cashRegisters.length === 0 ? (
                    <p className="text-muted-foreground text-xs">
                      {t('expenses.form.cash_register_empty')}{' '}
                      <a
                        href={`/${salonId}/settings/cash-registers`}
                        className="text-primary font-semibold hover:underline"
                      >
                        {t('expenses.form.cash_register_empty_link')}
                      </a>
                    </p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {cashRegisters.map((r) => {
                        const active = field.value === r.id
                        return (
                          <button
                            type="button"
                            key={r.id}
                            onClick={() => field.onChange(active ? '' : r.id)}
                            className={`flex h-10 items-center justify-center rounded-full border-[1.5px] px-4 text-sm font-semibold transition-colors ${
                              active
                                ? 'border-primary bg-primary text-primary-foreground'
                                : 'border-border bg-card text-foreground hover:bg-accent/50'
                            }`}
                          >
                            {r.label}
                          </button>
                        )
                      })}
                    </div>
                  )}
                </div>
              )}
            />
          ) : null}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="exp-comment">{t('expenses.form.comment_label')}</Label>
            <Input
              id="exp-comment"
              placeholder={t('expenses.form.comment_placeholder')}
              {...form.register('comment')}
            />
          </div>

          {/* Image #133: Контрагент + Номер документа в 2-колоночном grid'е.
              Image #93: контрагент — выпадающий список + кнопка inline-add.
              Скрываем для payroll-категорий (получатель — мастер из payroll). */}
          {isPayrollCategory ? null : (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <Controller
                name="counterparty_id"
                control={form.control}
                render={({ field }) => (
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="exp-counterparty">
                      {t('expenses.form.counterparty_label')}
                    </Label>
                    <div className="flex gap-2">
                      <Select
                        value={field.value || '__none__'}
                        onValueChange={(v) => field.onChange(v === '__none__' ? '' : v)}
                      >
                        <SelectTrigger id="exp-counterparty" className="flex-1">
                          <SelectValue placeholder={t('expenses.form.counterparty_placeholder')} />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">
                            {t('expenses.form.counterparty_none')}
                          </SelectItem>
                          {counterparties.map((cp) => (
                            <SelectItem key={cp.id} value={cp.id}>
                              {cp.name}
                              {cp.nip ? ` · ${cp.nip}` : ''}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => setCounterpartyModalOpen(true)}
                        title={t('counterparties.add')}
                      >
                        +
                      </Button>
                    </div>
                  </div>
                )}
              />

              {/* Image #93: номер документа (фактура/чек) — рядом с контрагентом. */}
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="exp-document-number">
                  {t('expenses.form.document_number_label')}
                </Label>
                <Input
                  id="exp-document-number"
                  {...form.register('document_number')}
                  placeholder={t('expenses.form.document_number_placeholder')}
                  maxLength={60}
                />
              </div>
            </div>
          )}

          {/* Image #65: блок «Повторение» (weekly/monthly) удалён по запросу
              владельца — почти не использовался, занимал место. Поле
              `recurrence` остаётся в Zod-схеме с дефолтом 'none', чтобы
              существующие записи не сломались; новые расходы создаются
              как одноразовые. */}
        </form>

        <DialogFooter>
          <Button
            type="button"
            size="lg"
            onClick={form.handleSubmit(onSubmit)}
            disabled={createExpense.isPending || uploading}
            data-testid="exp-submit"
          >
            {createExpense.isPending || uploading
              ? t('common.loading')
              : mode === 'planned-paying'
                ? t('expenses.form.submit_pay')
                : !paid
                  ? t('expenses.form.submit_planned')
                  : t('expenses.form.submit')}
          </Button>
        </DialogFooter>
      </DialogContent>

      {/* Inline-добавление контрагента (image #93). При сохранении —
          counterparty_id автоматически выставляется в форме расхода.
          При надиктовке (image #93): открывается с префилом name=vendor_guess. */}
      <CounterpartyEditModal
        open={counterpartyModalOpen}
        onOpenChange={(v) => {
          setCounterpartyModalOpen(v)
          if (!v) setDictationPrefillForNewCp(null)
        }}
        salonId={salonId}
        prefill={dictationPrefillForNewCp}
        onSaved={(cp) =>
          form.setValue('counterparty_id', cp.id, {
            shouldDirty: true,
            shouldValidate: false,
          })
        }
      />
      <CashGateRequiredDialog
        open={gateOpen}
        onClose={() => setGateOpen(false)}
        salonId={salonId}
        action="expense"
        onShiftOpened={() => void form.handleSubmit(onSubmit)()}
      />
    </Dialog>
  )
}
