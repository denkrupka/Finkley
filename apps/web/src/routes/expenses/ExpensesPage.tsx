import { CheckCircle2, FileText, Loader2, Paperclip, Plus, Repeat, Trash2 } from 'lucide-react'
import { useState } from 'react'
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
  getReceiptSignedUrl,
  useDeleteExpense,
  useExpenseCategories,
  useExpenses,
  type ExpenseRow,
} from '@/hooks/useExpenses'
import { usePaymentMethods } from '@/hooks/usePaymentMethods'
import type { PaymentMethod } from '@/hooks/useVisits'
import {
  pickActiveAccountingProvider,
  useAccountingPushExpense,
  useSalonIntegrations,
  useWfirmaPushExpense,
} from '@/hooks/useIntegrations'
import { useSalon } from '@/hooks/useSalons'
import { formatCurrency } from '@/lib/utils/format-currency'
import { formatExpenseDate } from '@/lib/utils/format-date'
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

export function ExpensesPage() {
  const { t } = useTranslation()
  const { salonId } = useParams<{ salonId: string }>()
  const [params, setParams] = useSearchParams()
  const categoryFilter = params.get('cat') || ''
  const payFilter = (params.get('pay') || '') as PaymentMethod | ''
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
    const next = new URLSearchParams(params)
    if (value && value !== 'all') next.set(key, value)
    else next.delete(key)
    setParams(next, { replace: true })
  }

  const { data: salon } = useSalon(salonId)
  const { data: categories = [] } = useExpenseCategories(salonId)
  const { data: paymentMethods = [] } = usePaymentMethods(salonId)
  const { data: expenses = [], isLoading } = useExpenses(salonId, range, {
    categoryId: categoryFilter || null,
    paymentMethod: payFilter || null,
  })
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

  // Сортируем категории как в прототипе (по sort_order), берём первые 4 для summary
  const categoryById = new Map(categories.map((c) => [c.id, c]))
  const totalsByCategory = new Map<string, number>()
  for (const e of expenses) {
    if (!e.category_id) continue
    totalsByCategory.set(e.category_id, (totalsByCategory.get(e.category_id) ?? 0) + e.amount_cents)
  }
  const total = expenses.reduce((acc, e) => acc + e.amount_cents, 0)

  const structureCategories = categories
    .map((c, i) => ({
      ...c,
      color: CATEGORY_COLORS[i % CATEGORY_COLORS.length] ?? '#9A9A9A',
      total_cents: totalsByCategory.get(c.id) ?? 0,
    }))
    .filter((c) => c.total_cents > 0)
    .sort((a, b) => b.total_cents - a.total_cents)

  return (
    <div className="flex flex-1 flex-col px-5 py-7 sm:px-8 lg:pb-12">
      {/* Header */}
      <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
        <div>
          <h1 className="text-brand-navy text-2xl font-bold tracking-tight">
            {t('expenses.title')}
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {t('expenses.subtitle_total')}{' '}
            <span className="num text-destructive font-bold">
              {formatCurrency(total, currency)}
            </span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <PeriodPickerPopover value={period} onChange={setPeriod} />
          <Button
            variant="secondary"
            size="md"
            onClick={() => setFormOpen(true)}
            data-testid="add-expense"
          >
            <Plus className="size-4" strokeWidth={2.4} />
            {t('expenses.add')}
          </Button>
        </div>
      </div>

      {/* Подвкладки «Расходы / Поступления» убраны по запросу owner 2026-05-12.
          На странице остаётся только список расходов. Поступления из банка
          (если подключён) видны в разделе Финансы → ДДС. */}
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

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[2fr_1fr]">
        {/* List */}
        <div className="border-border bg-card shadow-finsm rounded-lg border">
          <div className="border-border flex items-baseline justify-between border-b px-5 py-4">
            <h2 className="text-brand-navy text-base font-bold tracking-tight">
              {t('expenses.list_title')}
            </h2>
            <span className="text-muted-foreground text-xs">
              {expenses.length} {t('expenses.records')}
            </span>
          </div>
          {isLoading ? (
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
              {expenses.map((e: ExpenseRow) => {
                const cat = e.category_id ? categoryById.get(e.category_id) : null
                const idx = cat ? categories.findIndex((c) => c.id === cat.id) : -1
                const color =
                  idx >= 0
                    ? (CATEGORY_COLORS[idx % CATEGORY_COLORS.length] ?? '#9A9A9A')
                    : '#9A9A9A'
                return (
                  <li
                    key={e.id}
                    onClick={() => setEditingExpense(e)}
                    className="border-border hover:bg-muted/30 grid cursor-pointer grid-cols-[60px_1fr_auto_auto] items-center gap-3 border-t px-5 py-3 transition-colors first:border-t-0"
                    style={{ borderLeftWidth: 3, borderLeftColor: color }}
                    data-testid="expense-row"
                  >
                    <span className="num text-muted-foreground text-xs">
                      {formatExpenseDate(e.expense_at)}
                    </span>
                    <span className="min-w-0">
                      <span className="text-foreground flex items-center gap-1.5 text-sm font-semibold">
                        <span className="truncate">
                          {e.comment || cat?.name || t('expenses.no_category')}
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
                      </span>
                      {cat ? (
                        <span className="text-brand-text-faint block text-[11px]">{cat.name}</span>
                      ) : null}
                    </span>
                    <span className="num text-destructive text-right text-sm font-bold">
                      −{formatCurrency(e.amount_cents, currency)}
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
        </div>

        {/* Structure (BudgetsCard перенесена в /finance → Бюджеты) */}
        <div className="flex flex-col gap-4">
          <div className="border-border bg-card shadow-finsm rounded-lg border p-5">
            <h2 className="text-brand-navy mb-4 text-base font-bold tracking-tight">
              {t('expenses.structure_title')}
            </h2>
            {structureCategories.length === 0 ? (
              <p className="text-muted-foreground text-sm">{t('expenses.structure_empty')}</p>
            ) : (
              <div className="flex flex-col gap-3.5">
                {structureCategories.map((c) => {
                  const pct = total > 0 ? (c.total_cents / total) * 100 : 0
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
