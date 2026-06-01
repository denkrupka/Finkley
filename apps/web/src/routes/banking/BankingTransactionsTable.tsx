import { AlertTriangle, Edit3, Landmark, Link2, Link2Off, Loader2, RefreshCcw } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  useBankConnections,
  useBankInflows,
  useBankLinkedIncomeIds,
  useBankOutflows,
  useBankSyncNow,
  type BankInflowRow,
  type BankOutflowRow,
} from '@/hooks/useBanking'
import { cn } from '@/lib/utils/cn'
import { formatCurrency } from '@/lib/utils/format-currency'
import { formatExpenseDate } from '@/lib/utils/format-date'

import { useExpenseCategories, useExpenses } from '@/hooks/useExpenses'
import { useOtherIncomeCategories, useOtherIncomes } from '@/hooks/useOtherIncomes'
import { ExpenseFormModal } from '@/routes/expenses/ExpenseFormModal'

import { supabase } from '@/lib/supabase/client'
import { useQueryClient } from '@tanstack/react-query'

import { LinkTransactionDialog } from './LinkTransactionDialog'

type Direction = 'debit' | 'credit'

type Props = {
  salonId: string
  /** debit — расходы (списания), credit — доходы (поступления) */
  direction: Direction
  period: { start: string; end: string }
  currency: string
  /** Picker-mode для обратных модалок (LinkExpense/Visit/OtherIncomeToBankDialog).
   *  Если задан onPickTransaction — клик по строке вызывает callback вместо
   *  открытия LinkTransactionDialog. Также скрывается колонка действий. */
  onPickTransaction?: (tx: BankInflowRow | BankOutflowRow) => void
  /** Жёсткий фильтр: показывать ТОЛЬКО неpривязанные tx (без переключателя).
   *  Используется в picker-модалках — связывать уже-привязанные не имеет смысла. */
  unlinkedOnly?: boolean
}

/**
 * Универсальная таблица банковских транзакций для вкладки «Банкинг».
 * Для debit используется на странице Расходы, для credit — Доходы.
 *
 * Поля строки: Дата | Контрагент | Сумма | Назначение | Связано с | Действия.
 * Действия: «Связать» (если ещё нет), «Редактировать» (если есть), значок
 * предупреждения «требует перепроверки» (needs_review). Связывание открывает
 * LinkTransactionDialog — модалка с поиском по расходам или по доходам.
 */
export function BankingTransactionsTable({
  salonId,
  direction,
  period,
  currency,
  onPickTransaction,
  unlinkedOnly = false,
}: Props) {
  const isPickerMode = !!onPickTransaction
  // Toggle «Показать связанные»: default false (юзеру важнее видеть
  // необработанные). В picker-режиме toggle скрыт (там жёсткий unlinkedOnly).
  const [showLinked, setShowLinked] = useState<boolean>(false)
  const { t } = useTranslation()
  const { data: connections = [] } = useBankConnections(salonId)
  const inflowsQ = useBankInflows(direction === 'credit' ? salonId : undefined, period)
  const outflowsQ = useBankOutflows(direction === 'debit' ? salonId : undefined, period)
  // linkedTxIds — для фильтра «Показать связанные» (учитываем splits, не
  // только legacy FK). См. image #55 — без этого split-tx считались unlinked.
  const { data: bankLinkedAll } = useBankLinkedIncomeIds(salonId)
  // Резолв категории для linked tx — без сервер-side join, на клиенте через
  // уже кешируемые hooks. Период expenses/other_incomes расширяем ±90 дней
  // (auto-match window) чтобы попасть в связь даже если tx и расход в разные
  // месяцы. Период bank-tx уже у нас задан в `period`.
  const expandedRange = useMemo(() => {
    const start = new Date(period.start)
    start.setDate(start.getDate() - 90)
    const end = new Date(period.end)
    end.setDate(end.getDate() + 90)
    return {
      start: start.toISOString().slice(0, 10),
      end: end.toISOString().slice(0, 10),
    }
  }, [period.start, period.end])
  const { data: expenses = [] } = useExpenses(
    direction === 'debit' ? salonId : undefined,
    expandedRange,
  )
  const { data: expenseCategories = [] } = useExpenseCategories(
    direction === 'debit' ? salonId : undefined,
  )
  const { data: otherIncomes = [] } = useOtherIncomes(
    direction === 'credit' ? salonId : undefined,
    { start: new Date(expandedRange.start), end: new Date(expandedRange.end) },
  )
  const { data: otherIncomeCategories = [] } = useOtherIncomeCategories(
    direction === 'credit' ? salonId : undefined,
  )
  const categoryNameByTxId = useMemo(() => {
    const m = new Map<string, string>()
    if (direction === 'debit') {
      const catNameById = new Map(expenseCategories.map((c) => [c.id, c.name]))
      const expById = new Map(expenses.map((e) => [e.id, e]))
      for (const tx of outflowsQ.data ?? []) {
        if (!tx.expense_id) continue
        const exp = expById.get(tx.expense_id)
        if (!exp?.category_id) continue
        const name = catNameById.get(exp.category_id)
        if (name) m.set(tx.id, name)
      }
    } else {
      const catNameById = new Map(otherIncomeCategories.map((c) => [c.id, c.name]))
      const oiById = new Map(otherIncomes.map((o) => [o.id, o]))
      for (const tx of inflowsQ.data ?? []) {
        if (tx.linked_other_income_id) {
          const oi = oiById.get(tx.linked_other_income_id)
          if (oi?.category_id) {
            const name = catNameById.get(oi.category_id)
            if (name) m.set(tx.id, name)
            continue
          }
        }
        if (tx.linked_visit_id) {
          // Визит — это услуга, у неё нет «категории», подписываем как тип.
          m.set(tx.id, t('income.tabs.visits'))
        }
      }
    }
    return m
  }, [
    direction,
    expenseCategories,
    expenses,
    outflowsQ.data,
    otherIncomeCategories,
    otherIncomes,
    inflowsQ.data,
    t,
  ])
  const sync = useBankSyncNow(salonId)
  const qcRoot = useQueryClient()
  const [linkOpen, setLinkOpen] = useState(false)
  const [linkTx, setLinkTx] = useState<BankInflowRow | BankOutflowRow | null>(null)
  // Создание расхода из транзакции — открывает ExpenseFormModal с prefill.
  const [createOpen, setCreateOpen] = useState(false)
  const [createPrefill, setCreatePrefill] = useState<{
    bank_transaction_id: string
    amount_cents: number
    date: string
    description: string
    counterparty_hint: string | null
  } | null>(null)

  const isLoading = inflowsQ.isLoading || outflowsQ.isLoading
  const allRows: Array<BankInflowRow | BankOutflowRow> =
    direction === 'debit' ? (outflowsQ.data ?? []) : (inflowsQ.data ?? [])
  // unlinkedOnly (picker-mode) — жёсткий фильтр. Иначе — soft toggle
  // showLinked (default false: только unlinked, юзеру важнее необработанные).
  // Учитываем и legacy FK, и splits (bank_tx_splits — multi-link). Без splits
  // tx считалась бы unlinked даже если она связана через splits.
  const rows =
    unlinkedOnly || !showLinked
      ? allRows.filter(
          (tx) =>
            !tx.expense_id &&
            !tx.linked_visit_id &&
            !tx.linked_other_income_id &&
            !bankLinkedAll?.linkedTxIds.has(tx.id),
        )
      : allRows

  const hasActiveConnection = connections.some((c) => c.status === 'connected')

  async function handleExtractCounterparties(opts: { silent?: boolean } = {}) {
    const silent = !!opts.silent
    try {
      // Шаг 1: regex-эвристика (быстро, дёшево)
      const { data, error } = await supabase.rpc('extract_bank_tx_counterparty', {
        p_salon_id: salonId,
      })
      if (error) throw new Error(error.message)
      const row = Array.isArray(data) ? data[0] : data
      const regexUpdated = (row as { updated_count?: number })?.updated_count ?? 0
      const totalWithNull = (row as { total_with_null?: number })?.total_with_null ?? 0
      // Шаг 2: Groq AI fallback для оставшихся (где regex не нашёл)
      // вызывается итеративно по 50 tx пока есть что обрабатывать или
      // пока не упрётся в 5 итераций (защита от бесконечного цикла).
      let aiUpdated = 0
      let aiProcessed = 0
      let aiError: string | null = null // 'not_configured' | 'http_xxx' | 'network'
      try {
        const { data: sessData } = await supabase.auth.getSession()
        const token = sessData.session?.access_token
        if (token) {
          const fnUrl =
            (import.meta.env.VITE_SUPABASE_URL as string).replace(/\/$/, '') +
            '/functions/v1/extract-counterparty-ai'
          for (let i = 0; i < 5; i++) {
            const res = await fetch(fnUrl, {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${token}`,
                'content-type': 'application/json',
              },
              body: JSON.stringify({ salon_id: salonId }),
            })
            if (!res.ok) {
              // 500 + function_not_configured = нет GROQ_API_KEY в secrets
              const errJson = await res.json().catch(() => ({}))
              aiError =
                (errJson as { error?: string }).error === 'function_not_configured'
                  ? 'not_configured'
                  : `http_${res.status}`
              break
            }
            const json = (await res.json()) as {
              processed?: number
              updated?: number
              total_remaining?: number
            }
            aiProcessed += json.processed ?? 0
            aiUpdated += json.updated ?? 0
            // Если ничего не осталось или ничего не обновили — стоп
            if (!json.processed || json.processed === 0) break
            if ((json.total_remaining ?? 0) === 0) break
          }
        }
      } catch {
        aiError = 'network'
      }

      const updated = regexUpdated + aiUpdated
      if (!silent && updated > 0) {
        toast.success(
          t('banking.transactions.extract_done_with_ai', {
            defaultValue: 'Извлечено {{updated}} из {{total}} (regex: {{regex}}, AI: {{ai}})',
            updated,
            total: totalWithNull,
            regex: regexUpdated,
            ai: aiUpdated,
          }),
        )
      }
      // Subtle warning если AI-фаза не отработала, а regex остался с
      // непокрытыми tx (totalWithNull - regexUpdated > 0). Юзер должен знать
      // что часть tx осталась без counterparty.
      const stillEmpty = totalWithNull - regexUpdated
      if (!silent && aiError && stillEmpty > 0) {
        const reason =
          aiError === 'not_configured'
            ? t('banking.transactions.extract_ai_not_configured', {
                defaultValue: 'AI не подключён (GROQ_API_KEY не задан в secrets)',
              })
            : aiError === 'network'
              ? t('banking.transactions.extract_ai_network', {
                  defaultValue: 'AI недоступен (сетевая ошибка)',
                })
              : t('banking.transactions.extract_ai_http', {
                  defaultValue: 'AI вернул ошибку',
                })
        toast.warning(
          t('banking.transactions.extract_ai_failed', {
            defaultValue: '{{reason}}. {{n}} транзакций остались без контрагента.',
            reason,
            n: stillEmpty,
          }),
        )
      }
      void aiProcessed
      await qcRoot.invalidateQueries({ queryKey: ['bank-inflows', salonId] })
      await qcRoot.invalidateQueries({ queryKey: ['bank-outflows', salonId] })
    } catch (e) {
      if (!silent) toast.error(e instanceof Error ? e.message : String(e))
    }
  }

  function handleSyncAll() {
    const active = connections.filter((c) => c.status === 'connected')
    if (active.length === 0) {
      toast.error(t('banking.transactions.no_connections'))
      return
    }
    let done = 0
    for (const c of active) {
      sync.mutate(c.id, {
        onSuccess: () => {
          done += 1
          if (done === active.length) {
            toast.success(t('banking.transactions.sync_done'))
            // T20 — извлекаем контрагентов из новых транзакций автоматически
            // после успешной синхронизации. Без UI-кнопки: запускается тихо в
            // фоне; ошибки логируются, но юзеру не мешают.
            void handleExtractCounterparties({ silent: true }).catch(() => {})
          }
        },
        onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
      })
    }
  }

  // Сумма по строкам периода — для шапки (см. owner-feedback 2026-05-26):
  // на debit-табе показываем «общая сумма списаний», на credit-табе —
  // «общая сумма поступлений». Считаем по rows (с учётом unlinkedOnly).
  const periodSum = rows.reduce((s, r) => s + r.amount_cents, 0)

  return (
    <div className="border-border bg-card shadow-finsm rounded-lg border">
      {/* Header */}
      <div className="border-border flex items-center justify-between gap-3 border-b px-5 py-3">
        <div className="flex items-center gap-2">
          <Landmark className="text-brand-teal-deep size-4" strokeWidth={1.7} />
          <p className="text-brand-navy text-sm font-bold tracking-tight">
            {t('banking.transactions.title')}
          </p>
          <span className="text-muted-foreground/80 text-xs">
            {rows.length} {t('banking.transactions.count_suffix')}
          </span>
          {rows.length > 0 ? (
            <span
              className={cn(
                'num ml-2 text-xs font-bold tabular-nums',
                direction === 'debit' ? 'text-destructive' : 'text-emerald-700',
              )}
            >
              {direction === 'debit' ? '−' : '+'}
              {formatCurrency(periodSum, currency)}
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          {unlinkedOnly ? null : (
            <label className="text-muted-foreground flex cursor-pointer items-center gap-1.5 text-xs font-semibold">
              <input
                type="checkbox"
                checked={showLinked}
                onChange={(e) => setShowLinked(e.target.checked)}
                className="size-3.5 cursor-pointer"
              />
              {t('banking.transactions.show_linked', { defaultValue: 'Показать связанные' })}
            </label>
          )}
          {/* T20 — кнопка «Извлечь контрагентов» удалена; извлечение
              запускается автоматически после успешной синхронизации
              (handleSyncAll → handleExtractCounterparties({ silent: true })). */}
          <Button
            variant="outline"
            size="sm"
            onClick={handleSyncAll}
            disabled={!hasActiveConnection || sync.isPending}
          >
            {sync.isPending ? (
              <Loader2 className="size-3.5 animate-spin" strokeWidth={2} />
            ) : (
              <RefreshCcw className="size-3.5" strokeWidth={1.8} />
            )}
            {t('banking.transactions.sync_now')}
          </Button>
        </div>
      </div>

      {/* Empty / no connections */}
      {!hasActiveConnection ? (
        <div className="px-5 py-10 text-center">
          <Landmark className="text-muted-foreground/60 mx-auto size-8" strokeWidth={1.4} />
          <p className="text-foreground mt-3 text-sm font-semibold">
            {t('banking.transactions.no_connections_title')}
          </p>
          <p className="text-muted-foreground mx-auto mt-1 max-w-md text-xs">
            {t('banking.transactions.no_connections_hint')}
          </p>
          <Button asChild variant="primary" size="sm" className="mt-3">
            <a href={`/${salonId}/settings/integrations?tab=banking`}>
              {t('banking.transactions.go_connect')}
            </a>
          </Button>
        </div>
      ) : isLoading ? (
        <div className="flex items-center justify-center py-10">
          <Loader2 className="text-muted-foreground size-5 animate-spin" strokeWidth={2} />
        </div>
      ) : rows.length === 0 ? (
        <div className="px-5 py-10 text-center">
          <p className="text-muted-foreground text-sm">{t('banking.transactions.empty_period')}</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          {/* Mobile audit (2026-05-30): min-w на таблице — чтобы 7 колонок
              не сжимались в кашу. Sticky первая колонка (Дата) + bg-card —
              при горизонтальном скролле на iPhone (375-414px) дата
              остаётся видна слева как ориентир. */}
          <table className="w-full min-w-[860px] text-sm">
            <thead>
              <tr className="border-border text-muted-foreground border-b text-xs font-semibold uppercase tracking-wider">
                <th className="bg-card sticky left-0 z-10 px-4 py-2 text-left">
                  {t('banking.transactions.col_date')}
                </th>
                <th className="px-4 py-2 text-left">
                  {t('banking.transactions.col_counterparty')}
                </th>
                <th className="px-4 py-2 text-right">{t('banking.transactions.col_amount')}</th>
                <th className="px-4 py-2 text-left">{t('banking.transactions.col_purpose')}</th>
                <th className="px-4 py-2 text-left">{t('banking.transactions.col_category')}</th>
                <th className="px-4 py-2 text-left">{t('banking.transactions.col_linked')}</th>
                <th className="px-4 py-2 text-right">{t('banking.transactions.col_actions')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((tx) => (
                <TransactionRow
                  key={tx.id}
                  tx={tx}
                  direction={direction}
                  currency={currency}
                  categoryName={categoryNameByTxId.get(tx.id) ?? null}
                  isPickerMode={isPickerMode}
                  onLink={() => {
                    if (isPickerMode) {
                      onPickTransaction?.(tx)
                      return
                    }
                    setLinkTx(tx)
                    setLinkOpen(true)
                  }}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {linkTx ? (
        <LinkTransactionDialog
          open={linkOpen}
          onOpenChange={(v) => {
            setLinkOpen(v)
            if (!v) setLinkTx(null)
          }}
          salonId={salonId}
          transaction={linkTx}
          direction={direction}
          onCreateExpenseFromTx={
            direction === 'debit'
              ? () => {
                  setCreatePrefill({
                    bank_transaction_id: linkTx.id,
                    amount_cents: linkTx.amount_cents,
                    date: linkTx.executed_at.slice(0, 10),
                    description: linkTx.description ?? '',
                    counterparty_hint: linkTx.counterparty,
                  })
                  setLinkOpen(false)
                  setCreateOpen(true)
                }
              : undefined
          }
        />
      ) : null}

      {createPrefill ? (
        <ExpenseFormModal
          open={createOpen}
          onOpenChange={(v) => {
            setCreateOpen(v)
            if (!v) {
              setCreatePrefill(null)
              setLinkTx(null)
            }
          }}
          salonId={salonId}
          currency={currency}
          prefillFromBankTx={createPrefill}
        />
      ) : null}
    </div>
  )
}

function TransactionRow({
  tx,
  direction,
  currency,
  categoryName,
  isPickerMode,
  onLink,
}: {
  tx: BankInflowRow | BankOutflowRow
  direction: Direction
  currency: string
  categoryName: string | null
  isPickerMode: boolean
  onLink: () => void
}) {
  const { t } = useTranslation()
  const linked =
    direction === 'debit' ? !!tx.expense_id : !!(tx.linked_visit_id || tx.linked_other_income_id)
  const counterparty = tx.counterparty || t('banking.transactions.no_counterparty')
  const purpose = tx.description || '—'

  return (
    <tr
      onClick={isPickerMode ? onLink : undefined}
      className={cn(
        'border-border hover:bg-muted/30 group border-b last:border-b-0',
        tx.needs_review && 'bg-amber-50/40',
        isPickerMode && 'cursor-pointer',
      )}
    >
      {/* Mobile audit (2026-05-30): sticky первая колонка + bg-card
          (needs_review кейс наследуем явный amber через ternary, иначе
          в Safari sticky-ячейке цвет ряда теряется). z-[5] меньше
          z-10 header'a — заголовок остаётся поверх. */}
      <td
        className={cn(
          'text-foreground sticky left-0 z-[5] whitespace-nowrap px-4 py-2.5 text-xs',
          tx.needs_review ? 'bg-amber-50' : 'bg-card group-hover:bg-muted/30',
        )}
      >
        {formatExpenseDate(tx.executed_at)}
      </td>
      <td className="text-foreground px-4 py-2.5 text-sm font-medium">
        <div className="flex items-center gap-1.5">
          <span className="truncate">{counterparty}</span>
          {tx.status === 'pending' ? (
            <span
              className="inline-flex items-center gap-0.5 rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-amber-800 dark:bg-amber-500/20 dark:text-amber-200"
              title={t('banking.transactions.pending_tooltip', {
                defaultValue:
                  'В ожидании банка (PDNG). Сумма может ещё измениться; попадёт в Расходы/Доходы после фиксации.',
              })}
            >
              {t('banking.transactions.pending_badge', { defaultValue: 'В ожидании' })}
            </span>
          ) : null}
          {tx.needs_review ? (
            <span title={t('banking.transactions.needs_review_tooltip')}>
              <AlertTriangle className="size-3.5 shrink-0 text-amber-600" strokeWidth={2} />
            </span>
          ) : null}
        </div>
      </td>
      <td
        className={cn(
          'num whitespace-nowrap px-4 py-2.5 text-right text-sm font-bold tabular-nums',
          direction === 'debit' ? 'text-destructive' : 'text-emerald-700',
        )}
      >
        {direction === 'debit' ? '−' : '+'}
        {formatCurrency(tx.amount_cents, currency)}
      </td>
      <td className="text-muted-foreground max-w-[280px] truncate px-4 py-2.5 text-xs">
        {purpose}
      </td>
      <td className="px-4 py-2.5 text-xs">
        {categoryName ? (
          <span className="bg-muted text-foreground inline-flex max-w-[180px] truncate rounded px-2 py-0.5 font-semibold">
            {categoryName}
          </span>
        ) : (
          <span className="text-muted-foreground/60">—</span>
        )}
      </td>
      <td className="px-4 py-2.5">
        {linked ? (
          <span className="text-brand-teal-deep inline-flex items-center gap-1 text-xs font-semibold">
            <Link2 className="size-3" strokeWidth={2} />
            {t('banking.transactions.linked')}
          </span>
        ) : (
          <span className="text-muted-foreground/80 inline-flex items-center gap-1 text-xs">
            <Link2Off className="size-3" strokeWidth={1.7} />
            {t('banking.transactions.not_linked')}
          </span>
        )}
      </td>
      <td className="px-4 py-2.5 text-right">
        {isPickerMode ? (
          <span className="text-brand-teal-deep inline-flex items-center gap-1 text-xs font-semibold">
            <Link2 className="size-3" strokeWidth={2} />
            {t('banking.transactions.link_action')}
          </span>
        ) : (
          <button
            type="button"
            onClick={onLink}
            className={cn(
              'inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold transition-colors',
              linked
                ? 'text-foreground hover:bg-muted/60'
                : 'bg-brand-teal-soft text-brand-teal-deep hover:bg-brand-teal-soft/80',
            )}
          >
            {linked ? (
              <Edit3 className="size-3" strokeWidth={2} />
            ) : (
              <Link2 className="size-3" strokeWidth={2} />
            )}
            {linked ? t('banking.transactions.edit_link') : t('banking.transactions.link_action')}
          </button>
        )}
      </td>
    </tr>
  )
}
