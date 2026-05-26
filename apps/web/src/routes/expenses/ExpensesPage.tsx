import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  FileText,
  Landmark,
  Loader2,
  Paperclip,
  Plus,
  Repeat,
  Trash2,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useParams, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  currentMonthPeriod,
  periodToRange,
  type PeriodValue,
} from '@/components/ui/period-picker-utils'
import { PeriodPickerPopover } from '@/components/ui/PeriodPickerPopover'
import {
  effectivePaidCents,
  getReceiptSignedUrl,
  useDeleteExpense,
  useExpenseCategories,
  useExpenses,
  type ExpenseRow,
} from '@/hooks/useExpenses'
import {
  useDeleteScheduledPayment,
  useScheduledPayments,
  type ScheduledPaymentRow,
} from '@/hooks/useScheduledPayments'
import { cn } from '@/lib/utils/cn'
import { usePaymentMethods } from '@/hooks/usePaymentMethods'
import type { PaymentMethod } from '@/hooks/useVisits'
import {
  pickActiveAccountingProvider,
  useAccountingPushExpense,
  useSalonIntegrations,
  useWfirmaPushExpense,
} from '@/hooks/useIntegrations'
import { useCashRegisters } from '@/hooks/useCashRegisters'
import { useCounterparties } from '@/hooks/useCounterparties'
import { useRequireCashShift } from '@/hooks/useCashShifts'
import { useSalon } from '@/hooks/useSalons'
import { useTeamMembers } from '@/hooks/useTeam'
import { formatCurrency } from '@/lib/utils/format-currency'
import { formatExpenseDate } from '@/lib/utils/format-date'
import { CashGateRequiredDialog } from '@/components/CashGateRequiredDialog'
import { useBankLinkedIncomeIds } from '@/hooks/useBanking'
import { BankingTransactionsTable } from '@/routes/banking/BankingTransactionsTable'
import { BankExportDialog } from './BankExportDialog'
import { ExpenseFormModal } from './ExpenseFormModal'

// Display-имена бухгалтерских порталов для toast/aria-label
const PORTAL_DISPLAY_NAME: Record<string, string> = {
  wfirma: 'wFirma',
  fakturownia: 'Fakturownia',
  infakt: 'inFakt',
}

// Цвета 4-х основных summary-карточек (как в прототипе)
const CATEGORY_COLORS = [
  '#A678D9', // Аренда
  '#1E6B8A', // Зарплата
  '#D97757', // Материалы
  '#2E9E6B', // Реклама
  '#C9A24B',
  '#9A9A9A',
  '#C0392B',
]

type ExpensesPageProps = {
  /** Embedded режим — без header'a, picker callbacks вместо edit modal.
   *  Используется в LinkTransactionDialog для выбора расхода (см. Раунд 5). */
  embedded?: boolean
  /** Override salonId если не из URL (нужен в embed-моде). */
  pickerSalonId?: string
  /** Callback при клике на строку расхода в picker-mode. Если задан —
   *  открытие edit-modal отключено, юзер выбирает расход для связи. */
  onPickExpense?: (expense: ExpenseRow) => void
  /** Скрыть таб «Банкинг» — нужно когда страница embedded в LinkTransactionDialog
   *  (показывать банкинг внутри банкинга = recursive UX). */
  hideBankingTab?: boolean
}

export function ExpensesPage({
  embedded = false,
  pickerSalonId,
  onPickExpense,
  hideBankingTab = false,
}: ExpensesPageProps = {}) {
  const { t } = useTranslation()
  const params_ = useParams<{ salonId: string }>()
  const salonId = pickerSalonId ?? params_.salonId
  const [params, setParams] = useSearchParams()
  // Embedded: используем локальный state вместо URL params чтобы не дёргать
  // history родительской страницы. Фильтры/таб живут только пока открыта модалка.
  const [localTab, setLocalTab] = useState<'paid' | 'pending'>('paid')
  const [localCatFilter, setLocalCatFilter] = useState<string>('')
  const [localPayFilter, setLocalPayFilter] = useState<PaymentMethod | ''>('')
  const categoryFilter = embedded ? localCatFilter : params.get('cat') || ''
  const payFilter = embedded ? localPayFilter : ((params.get('pay') || '') as PaymentMethod | '')
  // Таб: paid (текущие расходы) | pending (запланированные scheduled_payments)
  // | banking (банковские транзакции для ручной/авто привязки к расходам).
  type ExpenseTab = 'paid' | 'pending' | 'banking'
  const tabParam = params.get('tab')
  const urlTab: ExpenseTab =
    tabParam === 'pending' ? 'pending' : tabParam === 'banking' ? 'banking' : 'paid'
  const tab: ExpenseTab = embedded ? localTab : urlTab
  function setTab(value: ExpenseTab) {
    if (embedded) {
      if (value === 'banking') return // в embed нет банкинга
      setLocalTab(value)
      return
    }
    const next = new URLSearchParams(params)
    if (value === 'paid') next.delete('tab')
    else next.set('tab', value)
    setParams(next, { replace: true })
  }
  const isPickerMode = !!onPickExpense
  // PeriodPickerPopover как в отчётах — выбор пресета/диапазона дат.
  // useExpenses ждёт диапазон дат в формате 'YYYY-MM-DD' (без времени),
  // потому что у expenses.expense_at колонка типа date, не timestamp.
  const [period, setPeriod] = useState<PeriodValue>(() => currentMonthPeriod())
  const r = periodToRange(period)
  const range = {
    start: r.start.toISOString().slice(0, 10),
    end: r.end.toISOString().slice(0, 10),
  }

  function setFilter(key: string, value: string | null) {
    if (embedded) {
      const v = value && value !== 'all' ? value : ''
      if (key === 'cat') setLocalCatFilter(v)
      if (key === 'pay') setLocalPayFilter(v as PaymentMethod | '')
      return
    }
    const next = new URLSearchParams(params)
    if (value && value !== 'all') next.set(key, value)
    else next.delete(key)
    setParams(next, { replace: true })
  }

  const { data: salon } = useSalon(salonId)
  const { data: categories = [] } = useExpenseCategories(salonId)
  // Контрагенты для колонки «Контрагент» в списке расходов (image #93/#59).
  const { data: counterparties = [] } = useCounterparties(salonId, { includeArchived: true })
  const counterpartyById = useMemo(
    () => new Map(counterparties.map((c) => [c.id, c])),
    [counterparties],
  )
  // Кассы — для отображения «чем оплачено» (image #82). Заменяет payment_method-пилюлю.
  const { data: cashRegisters = [] } = useCashRegisters(salonId)
  const cashRegisterById = useMemo(
    () => new Map(cashRegisters.map((r) => [r.id, r.label])),
    [cashRegisters],
  )
  // Image #110: для отображения «кто внёс расход» в строке списка — резолвим
  // created_by (auth.users.id) → ФИО/email через salon_members + RPC.
  const { data: teamMembers = [] } = useTeamMembers(salonId)
  const userNameById = useMemo(() => {
    const map = new Map<string, string>()
    for (const m of teamMembers) {
      if (!m.user_id) continue
      map.set(m.user_id, m.full_name || m.email || '—')
    }
    return map
  }, [teamMembers])
  const { data: paymentMethods = [] } = usePaymentMethods(salonId)
  const { data: expenses = [], isLoading } = useExpenses(salonId, range, {
    categoryId: categoryFilter || null,
    paymentMethod: payFilter || null,
  })
  const { data: bankLinked } = useBankLinkedIncomeIds(salonId)
  const needsReviewExpenseIds = bankLinked?.needsReviewExpenseIds ?? null
  // Запланированные платежи (для таба «Не оплачено»). Фильтрация по периоду и
  // категории — на клиенте, чтобы не плодить варианты хука.
  const { data: allScheduled = [], isLoading: scheduledLoading } = useScheduledPayments(salonId)
  const deleteScheduled = useDeleteScheduledPayment(salonId)
  const pendingPayments = useMemo(
    () =>
      allScheduled
        .filter((p) => p.status === 'pending')
        .filter((p) => p.due_date >= range.start && p.due_date <= range.end)
        .filter((p) => !categoryFilter || p.category_id === categoryFilter)
        .sort((a, b) => a.due_date.localeCompare(b.due_date)),
    [allScheduled, range.start, range.end, categoryFilter],
  )
  const pendingTotal = pendingPayments.reduce((s, p) => s + p.amount_cents, 0)
  // Частично-оплаченные расходы за период — показываются и в «Оплачено»
  // (с пометкой "оплачено X"), и в «Не оплачено» (с суммой остатка).
  const partiallyPaidExpenses = useMemo(
    () =>
      expenses.filter((e) => e.paid_amount_cents != null && e.paid_amount_cents < e.amount_cents),
    [expenses],
  )
  const partialRemainingTotal = partiallyPaidExpenses.reduce(
    (s, e) => s + (e.amount_cents - (e.paid_amount_cents ?? 0)),
    0,
  )
  const todayStr = new Date().toISOString().slice(0, 10)
  const [editingPayment, setEditingPayment] = useState<ScheduledPaymentRow | null>(null)
  // Bulk-export: режим выбора с чекбоксами и модалка экспорта.
  const [exportMode, setExportMode] = useState(false)
  const [exportSelectedIds, setExportSelectedIds] = useState<Set<string>>(new Set())
  const [exportDialogOpen, setExportDialogOpen] = useState(false)
  const exportSelectedPayments = useMemo(
    () => pendingPayments.filter((p) => exportSelectedIds.has(p.id)),
    [pendingPayments, exportSelectedIds],
  )
  function toggleExportSelection(id: string) {
    setExportSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  function toggleAllExport() {
    setExportSelectedIds((prev) =>
      prev.size === pendingPayments.length ? new Set() : new Set(pendingPayments.map((p) => p.id)),
    )
  }
  const { data: integrations = [] } = useSalonIntegrations(salonId)
  const deleteExpense = useDeleteExpense(salonId)
  const wfirmaPush = useWfirmaPushExpense(salonId)
  // Активный accounting-портал (приоритет wFirma > Fakturownia > ... — см.
  // ADR-013). Один портал на UI-кнопку: если у юзера подключено несколько,
  // выбираем первый по приоритету. Можно потом добавить выбор куда пушить
  // в подменю, если будет реальный спрос.
  const activeAccounting = pickActiveAccountingProvider(integrations)
  const accountingPush = useAccountingPushExpense(
    activeAccounting && activeAccounting !== 'wfirma' ? activeAccounting : null,
    salonId,
  )

  const [formOpen, setFormOpen] = useState(false)
  const [gateOpen, setGateOpen] = useState(false)
  const { hasOpenShift } = useRequireCashShift(salonId)
  // Пагинация по 25 — как на /clients. Сброс на 1-ю страницу при смене
  // периода / фильтра.
  const [page, setPage] = useState(1)
  const PAGE_SIZE = 25
  useEffect(() => {
    setPage(1)
  }, [period, categoryFilter, payFilter])
  // Edit-режим: клик по строке расхода → ExpenseFormModal в edit mode
  // (Image #49). null = создание нового. ExpenseFormModal сам различает.
  const [editingExpense, setEditingExpense] = useState<ExpenseRow | null>(null)
  const [receiptUrl, setReceiptUrl] = useState<string | null>(null)
  const [receiptError, setReceiptError] = useState<string | null>(null)

  async function openReceipt(path: string) {
    setReceiptError(null)
    try {
      const url = await getReceiptSignedUrl(path)
      setReceiptUrl(url)
    } catch (err) {
      setReceiptError(err instanceof Error ? err.message : String(err))
      setReceiptUrl('error')
    }
  }

  if (!salon || !salonId) return null
  const currency = salon.currency

  // Сортируем категории как в прототипе (по sort_order), берём первые 4 для summary.
  // Для частично оплаченных расходов учитываем только фактически оплаченную часть
  // (см. effectivePaidCents) — остаток вернётся в total после доплаты.
  const categoryById = new Map(categories.map((c) => [c.id, c]))
  const totalsByCategory = new Map<string, number>()
  for (const e of expenses) {
    if (!e.category_id) continue
    totalsByCategory.set(
      e.category_id,
      (totalsByCategory.get(e.category_id) ?? 0) + effectivePaidCents(e),
    )
  }
  const total = expenses.reduce((acc, e) => acc + effectivePaidCents(e), 0)

  const totalPages = Math.max(1, Math.ceil(expenses.length / PAGE_SIZE))
  const pagedExpenses = expenses.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  const structureCategories = categories
    .map((c, i) => ({
      ...c,
      color: CATEGORY_COLORS[i % CATEGORY_COLORS.length] ?? '#9A9A9A',
      total_cents: totalsByCategory.get(c.id) ?? 0,
    }))
    .filter((c) => c.total_cents > 0)
    .sort((a, b) => b.total_cents - a.total_cents)

  // То же самое но по запланированным платежам — для таба «Не оплачено».
  const pendingTotalsByCategory = new Map<string, number>()
  for (const p of pendingPayments) {
    if (!p.category_id) continue
    pendingTotalsByCategory.set(
      p.category_id,
      (pendingTotalsByCategory.get(p.category_id) ?? 0) + p.amount_cents,
    )
  }
  const pendingStructureCategories = categories
    .map((c, i) => ({
      ...c,
      color: CATEGORY_COLORS[i % CATEGORY_COLORS.length] ?? '#9A9A9A',
      total_cents: pendingTotalsByCategory.get(c.id) ?? 0,
    }))
    .filter((c) => c.total_cents > 0)
    .sort((a, b) => b.total_cents - a.total_cents)

  // Текущий набор для отображения справа — зависит от таба.
  const sideStructure = tab === 'pending' ? pendingStructureCategories : structureCategories
  const sideTotal = tab === 'pending' ? pendingTotal : total

  return (
    <div className={cn('flex flex-1 flex-col', embedded ? 'p-0' : 'px-5 py-7 sm:px-8 lg:pb-12')}>
      {/* Header — скрыт в embedded (его место занимает DialogTitle родителя). */}
      {embedded ? (
        <div className="mb-3 flex items-center justify-between gap-2">
          <p className="text-muted-foreground text-xs">
            {isPickerMode
              ? t('expenses.picker_hint', {
                  defaultValue: 'Кликни по расходу чтобы связать с банковской транзакцией',
                })
              : null}
          </p>
          <PeriodPickerPopover value={period} onChange={setPeriod} />
        </div>
      ) : (
        <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
          <div>
            <h1 className="text-brand-navy text-2xl font-bold tracking-tight">
              {t('expenses.title')}
            </h1>
            <p className="text-muted-foreground mt-1 text-sm">
              {tab === 'pending'
                ? t('expenses.tabs.subtitle_pending', { defaultValue: 'Запланировано к оплате:' })
                : t('expenses.subtitle_total')}{' '}
              <span
                className={cn(
                  'num font-bold',
                  tab === 'pending' ? 'text-sky-700' : 'text-destructive',
                )}
              >
                {formatCurrency(tab === 'pending' ? pendingTotal : total, currency)}
              </span>
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <PeriodPickerPopover value={period} onChange={setPeriod} />
            <Button
              variant="secondary"
              size="md"
              onClick={() => {
                if (!hasOpenShift) {
                  setGateOpen(true)
                  return
                }
                setFormOpen(true)
              }}
              data-testid="add-expense"
            >
              <Plus className="size-4" strokeWidth={2.4} />
              {t('expenses.add')}
            </Button>
          </div>
        </div>
      )}

      {/* Табы Оплачено / Не оплачено */}
      <div className="border-border bg-card shadow-finsm mb-4 inline-flex rounded-lg border p-1">
        <button
          type="button"
          onClick={() => setTab('paid')}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-semibold transition-colors',
            tab === 'paid'
              ? 'bg-brand-teal-soft text-brand-teal-deep'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          <CheckCircle2 className="size-4" strokeWidth={1.8} />
          {t('expenses.tabs.paid', { defaultValue: 'Оплачено' })}
          <span className="num text-muted-foreground/70 ml-1 text-[11px] font-bold tabular-nums">
            {expenses.length}
          </span>
        </button>
        <button
          type="button"
          onClick={() => setTab('pending')}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-semibold transition-colors',
            tab === 'pending'
              ? 'bg-amber-100 text-amber-900'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          <CalendarClock className="size-4" strokeWidth={1.8} />
          {t('expenses.tabs.pending', { defaultValue: 'Не оплачено' })}
          <span className="num text-muted-foreground/70 ml-1 text-[11px] font-bold tabular-nums">
            {pendingPayments.length}
          </span>
        </button>
        {hideBankingTab ? null : (
          <button
            type="button"
            onClick={() => setTab('banking')}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-semibold transition-colors',
              tab === 'banking'
                ? 'bg-brand-teal-soft text-brand-teal-deep'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <Landmark className="size-4" strokeWidth={1.8} />
            {t('expenses.tabs.banking', { defaultValue: 'Банкинг' })}
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Select
          value={categoryFilter || 'all'}
          onValueChange={(v) => setFilter('cat', v === 'all' ? null : v)}
        >
          <SelectTrigger className="h-10 w-[200px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('expenses.filters.all_categories')}</SelectItem>
            {categories.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={payFilter || 'all'}
          onValueChange={(v) => setFilter('pay', v === 'all' ? null : v)}
        >
          <SelectTrigger className="h-10 w-[180px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('expenses.filters.all_accounts')}</SelectItem>
            {paymentMethods.map((m) => (
              <SelectItem key={m.id} value={m.code}>
                {m.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Image #47: KPI-плитки (Аренда/Зарплата/Материалы/Реклама) и
          BudgetsCard перенесены в /finance → Бюджеты → Плановые расходы.
          На странице расходов остался только список + структура. */}

      {tab === 'banking' ? (
        <BankingTransactionsTable
          salonId={salonId!}
          direction="debit"
          period={range}
          currency={currency}
        />
      ) : (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[2fr_1fr]">
          {/* List */}
          <div className="border-border bg-card shadow-finsm rounded-lg border">
            <div className="border-border flex items-baseline justify-between gap-2 border-b px-5 py-4">
              <h2 className="text-brand-navy text-base font-bold tracking-tight">
                {tab === 'pending'
                  ? t('expenses.tabs.list_title_pending', {
                      defaultValue: 'Запланированные платежи',
                    })
                  : t('expenses.list_title')}
              </h2>
              <div className="flex items-center gap-2">
                {tab === 'pending' && pendingPayments.length > 0 ? (
                  <>
                    {exportMode && exportSelectedIds.size > 0 ? (
                      <Button variant="primary" size="sm" onClick={() => setExportDialogOpen(true)}>
                        <Landmark className="size-3.5" strokeWidth={2} />
                        {t('banking.export.action_export', {
                          defaultValue: 'Экспорт ({{n}})',
                          n: exportSelectedIds.size,
                        })}
                      </Button>
                    ) : null}
                    <Button
                      variant={exportMode ? 'outline' : 'secondary'}
                      size="sm"
                      onClick={() => {
                        setExportMode((v) => !v)
                        setExportSelectedIds(new Set())
                      }}
                    >
                      <Landmark className="size-3.5" strokeWidth={2} />
                      {exportMode
                        ? t('banking.export.cancel_select', { defaultValue: 'Отмена' })
                        : t('banking.export.start_select', { defaultValue: 'Экспорт в банк' })}
                    </Button>
                  </>
                ) : null}
                <span className="text-muted-foreground text-xs">
                  {tab === 'pending' ? pendingPayments.length : expenses.length}{' '}
                  {t('expenses.records')}
                </span>
              </div>
            </div>
            {tab === 'pending' ? (
              scheduledLoading ? (
                <div className="space-y-2 p-3">
                  {[0, 1, 2].map((i) => (
                    <div key={i} className="bg-muted/60 h-12 animate-pulse rounded-md" />
                  ))}
                </div>
              ) : pendingPayments.length === 0 && partiallyPaidExpenses.length === 0 ? (
                <div className="px-6 py-12 text-center">
                  <p className="text-muted-foreground text-sm">
                    {t('expenses.tabs.empty_pending', {
                      defaultValue: 'В этом периоде нет запланированных платежей',
                    })}
                  </p>
                </div>
              ) : (
                <>
                  {partiallyPaidExpenses.length > 0 ? (
                    <div className="border-border border-b">
                      <div className="bg-amber-50/60 px-5 py-2 text-[11px] font-bold uppercase tracking-wider text-amber-900">
                        {t('expenses.partial_section_title', {
                          defaultValue: 'Частично оплаченные · осталось',
                        })}{' '}
                        <span className="num tabular-nums">
                          {formatCurrency(partialRemainingTotal, currency)}
                        </span>
                      </div>
                      <ul>
                        {partiallyPaidExpenses.map((e) => {
                          const remaining = e.amount_cents - (e.paid_amount_cents ?? 0)
                          const cat = e.category_id ? categoryById.get(e.category_id) : null
                          return (
                            <li
                              key={`partial-${e.id}`}
                              onClick={() => {
                                if (isPickerMode) {
                                  onPickExpense?.(e)
                                  return
                                }
                                if (!hasOpenShift) {
                                  setGateOpen(true)
                                  return
                                }
                                setEditingExpense(e)
                              }}
                              className="border-border hover:bg-muted/30 grid cursor-pointer grid-cols-[60px_1fr_auto] items-center gap-3 border-b px-5 py-2.5 last:border-b-0"
                            >
                              <span className="num text-muted-foreground text-xs">
                                {formatExpenseDate(e.expense_at)}
                              </span>
                              <span className="min-w-0">
                                <span className="text-foreground block truncate text-sm font-semibold">
                                  {e.description || cat?.name || t('expenses.no_category')}
                                </span>
                                <span className="text-muted-foreground/80 text-[11px]">
                                  {t('expenses.partial_subtitle', {
                                    paid: formatCurrency(e.paid_amount_cents ?? 0, currency),
                                    total: formatCurrency(e.amount_cents, currency),
                                    defaultValue: 'Оплачено {{paid}} из {{total}}',
                                  })}
                                </span>
                              </span>
                              <span className="num text-right text-sm font-bold text-amber-700">
                                {formatCurrency(remaining, currency)}
                              </span>
                            </li>
                          )
                        })}
                      </ul>
                    </div>
                  ) : null}
                  {pendingPayments.length === 0 ? null : (
                    <ul>
                      {exportMode ? (
                        <li className="border-border bg-muted/30 flex items-center gap-3 border-t px-5 py-2 text-xs">
                          <input
                            type="checkbox"
                            checked={
                              exportSelectedIds.size === pendingPayments.length &&
                              pendingPayments.length > 0
                            }
                            onChange={toggleAllExport}
                            className="size-4 cursor-pointer"
                          />
                          <span className="text-muted-foreground font-semibold">
                            {t('banking.export.select_all', {
                              defaultValue: 'Выбрать все ({{n}})',
                              n: pendingPayments.length,
                            })}
                          </span>
                        </li>
                      ) : null}
                      {pendingPayments.map((p) => {
                        const cat = p.category_id ? categoryById.get(p.category_id) : null
                        const idx = cat ? categories.findIndex((c) => c.id === cat.id) : -1
                        const color =
                          idx >= 0
                            ? (CATEGORY_COLORS[idx % CATEGORY_COLORS.length] ?? '#9A9A9A')
                            : '#9A9A9A'
                        const overdue = p.due_date < todayStr
                        const today = p.due_date === todayStr
                        const isChecked = exportSelectedIds.has(p.id)
                        return (
                          <li
                            key={p.id}
                            onClick={() => {
                              if (exportMode) {
                                toggleExportSelection(p.id)
                                return
                              }
                              if (!hasOpenShift) {
                                setGateOpen(true)
                                return
                              }
                              setEditingPayment(p)
                            }}
                            className={cn(
                              'border-border hover:bg-muted/30 grid cursor-pointer items-center gap-3 border-t px-5 py-3 transition-colors first:border-t-0',
                              exportMode
                                ? 'grid-cols-[24px_60px_1fr_auto]'
                                : 'grid-cols-[60px_1fr_auto_auto]',
                            )}
                            style={{ borderLeftWidth: 3, borderLeftColor: color }}
                          >
                            {exportMode ? (
                              <input
                                type="checkbox"
                                checked={isChecked}
                                onChange={() => toggleExportSelection(p.id)}
                                onClick={(e) => e.stopPropagation()}
                                className="size-4 cursor-pointer"
                              />
                            ) : null}
                            <span className="num text-muted-foreground text-xs">
                              {p.due_date.slice(5).replace('-', '.')}
                            </span>
                            <span className="min-w-0">
                              <span className="text-foreground flex items-center gap-1.5 text-sm font-semibold">
                                <span className="truncate">
                                  {p.vendor_name || cat?.name || t('expenses.no_category')}
                                </span>
                                <span
                                  className={cn(
                                    'shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider',
                                    overdue
                                      ? 'bg-rose-100 text-rose-700'
                                      : today
                                        ? 'bg-amber-100 text-amber-800'
                                        : 'bg-sky-100 text-sky-700',
                                  )}
                                >
                                  {overdue
                                    ? t('expenses.tabs.badge_overdue', {
                                        defaultValue: 'просрочен',
                                      })
                                    : today
                                      ? t('expenses.tabs.badge_today', { defaultValue: 'сегодня' })
                                      : t('expenses.tabs.badge_pending', {
                                          defaultValue: 'запланирован',
                                        })}
                                </span>
                              </span>
                              <span className="text-brand-text-faint mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px]">
                                {cat ? <span>{cat.name}</span> : null}
                                {p.invoice_number ? (
                                  <>
                                    {cat ? <span aria-hidden>·</span> : null}
                                    <span className="num">№ {p.invoice_number}</span>
                                  </>
                                ) : null}
                                {p.comment ? (
                                  <>
                                    {cat || p.invoice_number ? <span aria-hidden>·</span> : null}
                                    <span className="truncate">{p.comment}</span>
                                  </>
                                ) : null}
                              </span>
                            </span>
                            <span className="num text-foreground text-right text-sm font-bold">
                              −{formatCurrency(p.amount_cents, currency)}
                            </span>
                            {exportMode ? null : (
                              <div className="flex items-center gap-0.5">
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    if (!hasOpenShift) {
                                      setGateOpen(true)
                                      return
                                    }
                                    setEditingPayment(p)
                                  }}
                                  className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-700 transition-colors hover:bg-emerald-100"
                                >
                                  <CheckCircle2 className="size-3.5" strokeWidth={2} />
                                  {t('expenses.tabs.btn_pay', { defaultValue: 'Оплатить' })}
                                </button>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    if (!confirm(t('finance.payments.confirm_delete'))) return
                                    deleteScheduled.mutate(p.id, {
                                      onSuccess: () =>
                                        toast.success(t('finance.payments.toast_deleted')),
                                    })
                                  }}
                                  className="text-muted-foreground hover:text-destructive grid size-9 place-items-center rounded-md"
                                  aria-label="delete"
                                >
                                  <Trash2 className="size-4" strokeWidth={1.7} />
                                </button>
                              </div>
                            )}
                          </li>
                        )
                      })}
                    </ul>
                  )}
                </>
              )
            ) : isLoading ? (
              <div className="space-y-2 p-3">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="bg-muted/60 h-12 animate-pulse rounded-md" />
                ))}
              </div>
            ) : expenses.length === 0 ? (
              <div className="px-6 py-12 text-center">
                <p className="text-muted-foreground text-sm">{t('expenses.empty')}</p>
              </div>
            ) : (
              <ul>
                {pagedExpenses.map((e: ExpenseRow) => {
                  const cat = e.category_id ? categoryById.get(e.category_id) : null
                  const idx = cat ? categories.findIndex((c) => c.id === cat.id) : -1
                  const color =
                    idx >= 0
                      ? (CATEGORY_COLORS[idx % CATEGORY_COLORS.length] ?? '#9A9A9A')
                      : '#9A9A9A'
                  return (
                    <li
                      key={e.id}
                      onClick={() => {
                        if (isPickerMode) {
                          onPickExpense?.(e)
                          return
                        }
                        if (!hasOpenShift) {
                          setGateOpen(true)
                          return
                        }
                        setEditingExpense(e)
                      }}
                      className="border-border hover:bg-muted/30 grid cursor-pointer grid-cols-[60px_1fr_auto_auto] items-center gap-3 border-t px-5 py-3 transition-colors first:border-t-0"
                      style={{ borderLeftWidth: 3, borderLeftColor: color }}
                      data-testid="expense-row"
                    >
                      <span className="num text-muted-foreground text-xs">
                        {formatExpenseDate(e.expense_at)}
                      </span>
                      <span className="min-w-0">
                        {/* Описание (image #94) — приоритетно. Если не задано —
                          fallback на comment, потом на имя категории. */}
                        <span className="text-foreground flex items-center gap-1.5 text-sm font-semibold">
                          <span className="truncate">
                            {e.description || e.comment || cat?.name || t('expenses.no_category')}
                          </span>
                          {e.recurrence && e.recurrence !== 'none' ? (
                            <Repeat
                              className="text-brand-teal size-3 shrink-0"
                              strokeWidth={2}
                              aria-label={t(`expenses.form.recurrence.${e.recurrence}`)}
                            />
                          ) : null}
                          {e.receipt_url ? (
                            <button
                              type="button"
                              onClick={() => openReceipt(e.receipt_url!)}
                              className="text-brand-teal hover:bg-muted/40 grid size-5 shrink-0 place-items-center rounded-md"
                              aria-label={t('expenses.receipt_open')}
                              data-testid="expense-receipt"
                            >
                              <Paperclip className="size-3.5" strokeWidth={1.7} />
                            </button>
                          ) : null}
                          {e.bank_transaction_id ? (
                            <span
                              className="text-brand-teal-deep bg-brand-teal-soft inline-flex shrink-0 items-center gap-0.5 rounded px-1 py-0.5 text-[10px] font-bold uppercase"
                              title={t('expenses.linked_to_bank_tooltip', {
                                defaultValue: 'Привязан к банковской транзакции',
                              })}
                            >
                              <Landmark className="size-2.5" strokeWidth={2.4} />
                              {t('expenses.bank_badge', { defaultValue: 'Банк' })}
                            </span>
                          ) : null}
                          {needsReviewExpenseIds?.has(e.id) ? (
                            <span title={t('expenses.needs_review_tooltip')}>
                              <AlertTriangle
                                className="size-3.5 shrink-0 text-amber-600"
                                strokeWidth={2}
                              />
                            </span>
                          ) : null}
                        </span>
                        {/* Sub-line: Категория · Контрагент · № документа · Касса · Кто внёс.
                          Image #93/#59: категория/контрагент в строке списка.
                          Image #110: + номер документа (фактуры/чека) и кто
                          именно внёс расход (видно сразу, без открытия карточки). */}
                        <span className="text-brand-text-faint mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px]">
                          {cat ? <span>{cat.name}</span> : null}
                          {e.counterparty_id ? (
                            <>
                              {cat ? <span aria-hidden>·</span> : null}
                              <span>{counterpartyById.get(e.counterparty_id)?.name ?? '—'}</span>
                            </>
                          ) : null}
                          {/* Image #110: номер документа — рядом с контрагентом. */}
                          {e.document_number ? (
                            <>
                              {cat || e.counterparty_id ? <span aria-hidden>·</span> : null}
                              <span className="num">№ {e.document_number}</span>
                            </>
                          ) : null}
                          {/* Image #82: касса вместо payment_method-пилюли.
                            Fallback на старый payment_method если cash_register_id
                            ещё не проставлен (исторические строки). */}
                          {e.cash_register_id || e.payment_method ? (
                            <>
                              {cat || e.counterparty_id || e.document_number ? (
                                <span aria-hidden>·</span>
                              ) : null}
                              <span className="bg-muted text-muted-foreground rounded-full px-1.5 py-0.5 text-[10px]">
                                {e.cash_register_id
                                  ? (cashRegisterById.get(e.cash_register_id) ?? '—')
                                  : t(`payment_methods.${e.payment_method}`, {
                                      defaultValue: e.payment_method as string,
                                    })}
                              </span>
                            </>
                          ) : null}
                          {/* Image #110: кто внёс расход. ФИО/email из salon_members. */}
                          {e.created_by && userNameById.get(e.created_by) ? (
                            <>
                              <span aria-hidden>·</span>
                              <span className="text-muted-foreground">
                                {t('expenses.created_by_short', {
                                  name: userNameById.get(e.created_by),
                                  defaultValue: `внёс ${userNameById.get(e.created_by)}`,
                                })}
                              </span>
                            </>
                          ) : null}
                        </span>
                      </span>
                      <span className="text-right">
                        <span className="num text-destructive block text-sm font-bold">
                          −{formatCurrency(e.amount_cents, currency)}
                        </span>
                        {e.paid_amount_cents != null && e.paid_amount_cents < e.amount_cents ? (
                          <span className="num text-muted-foreground/80 mt-0.5 block text-[10px]">
                            {t('expenses.partial_paid', {
                              paid: formatCurrency(e.paid_amount_cents, currency),
                              defaultValue: 'Оплачено {{paid}}',
                            })}
                          </span>
                        ) : null}
                      </span>
                      <div className="flex items-center gap-0.5">
                        {activeAccounting && e.source !== activeAccounting
                          ? (() => {
                              const meta = (e.metadata ?? {}) as Record<string, unknown>
                              const idKey =
                                activeAccounting === 'wfirma'
                                  ? 'wfirma_expense_id'
                                  : `${activeAccounting}_id`
                              const pushedId =
                                typeof meta[idKey] === 'string' ? (meta[idKey] as string) : null
                              const portalLabel =
                                PORTAL_DISPLAY_NAME[activeAccounting] ?? activeAccounting
                              const isPushing =
                                activeAccounting === 'wfirma'
                                  ? wfirmaPush.isPending && wfirmaPush.variables?.expenseId === e.id
                                  : accountingPush.isPending &&
                                    accountingPush.variables?.expenseId === e.id
                              if (pushedId) {
                                return (
                                  <span
                                    className="grid size-7 place-items-center rounded-md text-emerald-600"
                                    title={t('expenses.portal.tooltip_pushed', {
                                      portal: portalLabel,
                                      id: pushedId,
                                    })}
                                  >
                                    <CheckCircle2 className="size-4" strokeWidth={1.8} />
                                  </span>
                                )
                              }
                              return (
                                <button
                                  type="button"
                                  onClick={() => {
                                    const onCommonResult = (
                                      kind: 'ok' | 'already_pushed' | 'error',
                                      reason?: string,
                                    ) => {
                                      if (kind === 'ok') {
                                        toast.success(
                                          t('expenses.portal.toast_manual_pushed', {
                                            portal: portalLabel,
                                          }),
                                        )
                                      } else if (kind === 'already_pushed') {
                                        toast.info(
                                          t('expenses.portal.toast_already_pushed', {
                                            portal: portalLabel,
                                          }),
                                        )
                                      } else {
                                        toast.error(
                                          t('expenses.portal.toast_push_failed', {
                                            portal: portalLabel,
                                          }),
                                          { description: reason },
                                        )
                                      }
                                    }
                                    const onErr = (err: unknown) =>
                                      toast.error(
                                        t('expenses.portal.toast_push_failed', {
                                          portal: portalLabel,
                                        }),
                                        {
                                          description:
                                            err instanceof Error ? err.message : String(err),
                                        },
                                      )
                                    if (activeAccounting === 'wfirma') {
                                      wfirmaPush.mutate(
                                        { expenseId: e.id, auto: false },
                                        {
                                          onSuccess: (res) =>
                                            onCommonResult(
                                              res.kind === 'ok'
                                                ? 'ok'
                                                : res.kind === 'already_pushed'
                                                  ? 'already_pushed'
                                                  : 'error',
                                              'reason' in res ? res.reason : undefined,
                                            ),
                                          onError: onErr,
                                        },
                                      )
                                    } else {
                                      accountingPush.mutate(
                                        { expenseId: e.id, auto: false },
                                        {
                                          onSuccess: (res) =>
                                            onCommonResult(
                                              res.kind === 'ok'
                                                ? 'ok'
                                                : res.kind === 'already_pushed'
                                                  ? 'already_pushed'
                                                  : 'error',
                                              'reason' in res ? res.reason : undefined,
                                            ),
                                          onError: onErr,
                                        },
                                      )
                                    }
                                  }}
                                  disabled={isPushing}
                                  className="text-muted-foreground hover:text-secondary grid size-7 place-items-center rounded-md disabled:opacity-50"
                                  aria-label={t('expenses.portal.push_button', {
                                    portal: portalLabel,
                                  })}
                                  title={t('expenses.portal.push_button', {
                                    portal: portalLabel,
                                  })}
                                >
                                  {isPushing ? (
                                    <Loader2 className="size-4 animate-spin" strokeWidth={1.8} />
                                  ) : (
                                    <FileText className="size-4" strokeWidth={1.7} />
                                  )}
                                </button>
                              )
                            })()
                          : null}
                        <button
                          type="button"
                          onClick={() => {
                            if (!confirm(t('expenses.confirm_delete'))) return
                            deleteExpense.mutate(e.id, {
                              onSuccess: () => toast.success(t('expenses.toast_deleted')),
                            })
                          }}
                          className="text-muted-foreground hover:text-destructive grid size-9 place-items-center rounded-md"
                          aria-label="delete"
                        >
                          <Trash2 className="size-4" strokeWidth={1.7} />
                        </button>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
            {/* Пагинация по 25 (#9). Скрываем когда страница одна. */}
            {tab === 'paid' && !isLoading && totalPages > 1 ? (
              <div className="border-border flex items-center justify-between gap-2 border-t px-5 py-3">
                <p className="text-muted-foreground text-xs">
                  {(page - 1) * PAGE_SIZE + 1}—{Math.min(page * PAGE_SIZE, expenses.length)}{' '}
                  {t('common.of')} {expenses.length}
                </p>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setPage(Math.max(1, page - 1))}
                    disabled={page === 1}
                    className="border-border text-muted-foreground hover:bg-muted/40 hover:text-foreground inline-flex h-8 items-center rounded-md border px-2 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-30"
                  >
                    ‹
                  </button>
                  <span className="text-muted-foreground px-2 text-xs">
                    {page} / {totalPages}
                  </span>
                  <button
                    type="button"
                    onClick={() => setPage(Math.min(totalPages, page + 1))}
                    disabled={page === totalPages}
                    className="border-border text-muted-foreground hover:bg-muted/40 hover:text-foreground inline-flex h-8 items-center rounded-md border px-2 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-30"
                  >
                    ›
                  </button>
                </div>
              </div>
            ) : null}
          </div>

          {/* Structure — одинаковый блок для обоих табов, источник зависит от tab */}
          <div className="flex flex-col gap-4">
            <div className="border-border bg-card shadow-finsm rounded-lg border p-5">
              <h2 className="text-brand-navy mb-4 text-base font-bold tracking-tight">
                {tab === 'pending'
                  ? t('expenses.tabs.structure_title_pending', {
                      defaultValue: 'Структура запланированных',
                    })
                  : t('expenses.structure_title')}
              </h2>
              {sideStructure.length === 0 ? (
                <p className="text-muted-foreground text-sm">
                  {tab === 'pending'
                    ? t('expenses.tabs.structure_empty_pending', {
                        defaultValue: 'Нет запланированных платежей в этом периоде',
                      })
                    : t('expenses.structure_empty')}
                </p>
              ) : (
                <div className="flex flex-col gap-3.5">
                  {sideStructure.map((c) => {
                    const pct = sideTotal > 0 ? (c.total_cents / sideTotal) * 100 : 0
                    return (
                      <div key={c.id}>
                        <div className="mb-1.5 flex items-baseline justify-between gap-2">
                          <span className="text-foreground text-sm font-medium">{c.name}</span>
                          <span className="num text-brand-navy text-sm font-bold">
                            {formatCurrency(c.total_cents, currency)}{' '}
                            <span className="text-brand-text-faint font-medium">
                              · {Math.round(pct)}%
                            </span>
                          </span>
                        </div>
                        <div className="bg-background h-2.5 overflow-hidden rounded-full">
                          <div
                            className="h-full rounded-full"
                            style={{ width: `${pct}%`, background: c.color }}
                          />
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <ExpenseFormModal
        open={formOpen}
        onOpenChange={setFormOpen}
        salonId={salonId}
        currency={currency}
      />

      <ExpenseFormModal
        open={!!editingExpense}
        onOpenChange={(o) => !o && setEditingExpense(null)}
        salonId={salonId}
        currency={currency}
        expense={editingExpense}
      />

      {/* Оплата запланированного платежа из таба «Не оплачено» */}
      <ExpenseFormModal
        open={!!editingPayment}
        onOpenChange={(o) => !o && setEditingPayment(null)}
        salonId={salonId}
        currency={currency}
        mode="planned-paying"
        existingPayment={editingPayment}
      />

      <CashGateRequiredDialog
        open={gateOpen}
        onClose={() => setGateOpen(false)}
        salonId={salonId}
        action="expense"
      />

      <BankExportDialog
        open={exportDialogOpen}
        onOpenChange={(v) => {
          setExportDialogOpen(v)
          if (!v) {
            // После закрытия — сбросить выбор (любой исход: success/cancel)
            setExportSelectedIds(new Set())
            setExportMode(false)
          }
        }}
        salonId={salonId}
        payments={exportSelectedPayments}
      />

      {/* Просмотр чека */}
      <Dialog
        open={!!receiptUrl}
        onOpenChange={(open) => {
          if (!open) {
            setReceiptUrl(null)
            setReceiptError(null)
          }
        }}
      >
        <DialogContent className="w-[640px] max-w-[calc(100vw-2rem)]">
          <DialogHeader>
            <DialogTitle>{t('expenses.receipt_title')}</DialogTitle>
            <DialogDescription>{t('expenses.receipt_subtitle')}</DialogDescription>
          </DialogHeader>
          <div className="bg-muted/30 flex max-h-[70vh] items-center justify-center overflow-auto p-3">
            {receiptError ? (
              <p className="text-destructive p-6 text-sm">{receiptError}</p>
            ) : receiptUrl && receiptUrl !== 'error' ? (
              receiptUrl.toLowerCase().endsWith('.pdf') ? (
                <iframe
                  src={receiptUrl}
                  title={t('expenses.receipt_title')}
                  className="h-[70vh] w-full"
                />
              ) : (
                <img
                  src={receiptUrl}
                  alt={t('expenses.receipt_title')}
                  className="max-h-[70vh] max-w-full object-contain"
                  data-testid="receipt-image"
                />
              )
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
