import { format } from 'date-fns'
import { ru } from 'date-fns/locale'
import { Banknote, ChevronRight, CreditCard, Globe, Send, User2, Wallet } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import {
  currentMonthPeriod,
  periodToRange,
  type PeriodValue,
} from '@/components/ui/period-picker-utils'
import { PeriodPickerPopover } from '@/components/ui/PeriodPickerPopover'
import { useCashFlowDaily } from '@/hooks/useCashFlow'
import { useClients } from '@/hooks/useClients'
import { useExpenseCategories, useExpenses } from '@/hooks/useExpenses'
import { useOtherIncomeCategories, useOtherIncomes } from '@/hooks/useOtherIncomes'
import { useSalon } from '@/hooks/useSalons'
import { useStaff } from '@/hooks/useStaff'
import { useVisits, type VisitRow } from '@/hooks/useVisits'
import { formatCurrency } from '@/lib/utils/format-currency'
import { QuickEntryModal } from '@/routes/visits/QuickEntryModal'
import { VisitDetailModal } from '@/routes/visits/VisitDetailModal'

type PaymentMethod = 'cash' | 'card' | 'transfer' | 'online' | 'mixed' | null

function accountFromPaymentMethod(method: PaymentMethod): {
  label: string
  icon: typeof Banknote
} {
  switch (method) {
    case 'cash':
      return { label: 'Gotówka', icon: Banknote }
    case 'card':
      return { label: 'Karta', icon: CreditCard }
    case 'transfer':
      return { label: 'Przelew', icon: Send }
    case 'online':
      return { label: 'Online', icon: Globe }
    case 'mixed':
      return { label: 'Mixed', icon: Wallet }
    default:
      return { label: '—', icon: Wallet }
  }
}

/**
 * Унифицированная транзакция для разворачивающейся строки ДДС.
 * Источник определяет таргет навигации при клике на строку.
 */
type Tx = {
  id: string
  day: string
  kind: 'inflow' | 'outflow'
  source: 'visit' | 'retail' | 'other_income' | 'expense'
  amountCents: number
  /** Иерархическая статья: «Категория · Под-статья». */
  article: string
  /** Контрагент: клиент для дохода / поставщик для расхода. */
  counterparty: string | null
  /** Способ оплаты (касса) для drill-down аналитики. */
  paymentMethod: PaymentMethod
  /** Дополнительный комментарий (если есть). */
  comment: string | null
}

/**
 * Контент таба «ДДС» страницы /finance. Показывает приход/расход/нетто по
 * дням за выбранный месяц + накопительный остаток.
 *
 * MVP: только таблица. Графики (line chart) — следующий спринт.
 */
export function CashFlowTab({ salonId }: { salonId: string }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { data: salon } = useSalon(salonId)
  const currency = salon?.currency ?? 'PLN'

  const [period, setPeriod] = useState<PeriodValue>(() => currentMonthPeriod())
  const [expandedDay, setExpandedDay] = useState<string | null>(null)
  const [editingVisit, setEditingVisit] = useState<VisitRow | null>(null)
  const [openSaleDetail, setOpenSaleDetail] = useState<VisitRow | null>(null)
  const range = periodToRange(period)
  const from = format(range.start, 'yyyy-MM-dd')
  const to = format(range.end, 'yyyy-MM-dd')

  const { data: rows = [], isLoading } = useCashFlowDaily(salonId, from, to)

  const visitsRange = { start: range.start.toISOString(), end: range.end.toISOString() }
  const { data: visits = [] } = useVisits(salonId, visitsRange)
  const { data: otherIncomes = [] } = useOtherIncomes(salonId, range)
  const { data: expenses = [] } = useExpenses(salonId, { start: from, end: to })
  const { data: staff = [] } = useStaff(salonId)
  const { data: clients = [] } = useClients(salonId)
  const { data: expenseCategories = [] } = useExpenseCategories(salonId)
  const { data: incomeCategories = [] } = useOtherIncomeCategories(salonId)

  const txByDay = useMemo<Record<string, Tx[]>>(() => {
    const grouped: Record<string, Tx[]> = {}
    const pushTx = (day: string, tx: Tx) => {
      if (!grouped[day]) grouped[day] = []
      grouped[day].push(tx)
    }

    for (const v of visits) {
      const day = v.visit_at.slice(0, 10)
      const amt = v.amount_cents - v.discount_cents + v.tip_cents
      if (amt === 0) continue
      const staffName = staff.find((s) => s.id === v.staff_id)?.full_name ?? null
      const client = clients.find((c) => c.id === v.client_id)
      const article =
        v.kind === 'retail'
          ? `Продажа · ${v.service_name_snapshot ?? '—'}`
          : `Услуга · ${v.service_name_snapshot ?? '—'}`
      pushTx(day, {
        id: v.id,
        day,
        kind: 'inflow',
        source: v.kind === 'retail' ? 'retail' : 'visit',
        amountCents: amt,
        article,
        counterparty: client?.name ?? null,
        paymentMethod: (v.payment_method as PaymentMethod) ?? null,
        comment: staffName,
      })
    }
    for (const oi of otherIncomes) {
      const day = oi.income_at.slice(0, 10)
      const cat = incomeCategories.find((c) => c.id === oi.category_id)?.name ?? '—'
      const sub = oi.sub_article ? ` · ${oi.sub_article}` : ''
      pushTx(day, {
        id: oi.id,
        day,
        kind: 'inflow',
        source: 'other_income',
        amountCents: oi.amount_cents,
        article: `Прочий доход · ${cat}${sub}`,
        counterparty: oi.payer_name ?? null,
        paymentMethod: (oi.payment_method as PaymentMethod) ?? null,
        comment: oi.comment ?? null,
      })
    }
    for (const e of expenses) {
      const day = e.expense_at.slice(0, 10)
      const cat = expenseCategories.find((c) => c.id === e.category_id)?.name ?? '—'
      const sub = e.sub_article ? ` · ${e.sub_article}` : ''
      pushTx(day, {
        id: e.id,
        day,
        kind: 'outflow',
        source: 'expense',
        amountCents: e.amount_cents,
        article: `Расход · ${cat}${sub}`,
        counterparty: e.contractor_name ?? null,
        paymentMethod: (e.payment_method as PaymentMethod) ?? null,
        comment: e.comment ?? null,
      })
    }
    return grouped
  }, [visits, otherIncomes, expenses, staff, clients, expenseCategories, incomeCategories])

  function navigateToEntity(tx: Tx) {
    // Клик по строке ДДС → открыть карточку конкретной записи, а не список.
    if (tx.source === 'visit') {
      const v = visits.find((x) => x.id === tx.id)
      if (v) {
        setEditingVisit(v)
        return
      }
      navigate(`/${salonId}/income?tab=visits`)
    } else if (tx.source === 'retail') {
      const v = visits.find((x) => x.id === tx.id)
      if (v) {
        setOpenSaleDetail(v)
        return
      }
      navigate(`/${salonId}/income?tab=sales`)
    } else if (tx.source === 'other_income') {
      navigate(`/${salonId}/income?tab=other`)
    } else {
      navigate(`/${salonId}/expenses`)
    }
  }

  const { totalIn, totalOut, totalNet, withRunning } = useMemo(() => {
    let running = 0
    let tIn = 0
    let tOut = 0
    const wr = rows.map((r) => {
      running += r.net_cents
      tIn += r.inflow_cents
      tOut += r.outflow_cents
      return { ...r, running_cents: running }
    })
    return { totalIn: tIn, totalOut: tOut, totalNet: tIn - tOut, withRunning: wr }
  }, [rows])

  return (
    <div>
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-brand-navy text-lg font-bold tracking-tight">
          {t('finance.cashflow.title')}
        </h2>
        <PeriodPickerPopover value={period} onChange={setPeriod} />
      </div>

      {/* Период — виден только на печати, чтобы в распечатке было ясно за что */}
      <p className="text-muted-foreground mb-3 hidden text-sm print:block">
        {t('common.print_period', { start: from, end: to })}
      </p>

      {/* Totals */}
      <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="border-border bg-card shadow-finsm rounded-lg border p-4">
          <p className="text-muted-foreground text-xs uppercase tracking-wider">
            {t('finance.cashflow.total_inflow')}
          </p>
          <p className="num text-brand-sage-deep mt-1 text-2xl font-bold">
            +{formatCurrency(totalIn, currency)}
          </p>
        </div>
        <div className="border-border bg-card shadow-finsm rounded-lg border p-4">
          <p className="text-muted-foreground text-xs uppercase tracking-wider">
            {t('finance.cashflow.total_outflow')}
          </p>
          <p className="num text-destructive mt-1 text-2xl font-bold">
            −{formatCurrency(totalOut, currency)}
          </p>
        </div>
        <div className="border-border bg-card shadow-finsm rounded-lg border p-4">
          <p className="text-muted-foreground text-xs uppercase tracking-wider">
            {t('finance.cashflow.total_net')}
          </p>
          <p
            className={`num mt-1 text-2xl font-bold ${
              totalNet >= 0 ? 'text-brand-sage-deep' : 'text-destructive'
            }`}
          >
            {totalNet >= 0 ? '+' : '−'}
            {formatCurrency(Math.abs(totalNet), currency)}
          </p>
        </div>
      </div>

      {/* Chart */}
      {withRunning.some((r) => r.inflow_cents !== 0 || r.outflow_cents !== 0) ? (
        <div className="border-border bg-card shadow-finsm mb-5 rounded-lg border p-4">
          <ResponsiveContainer width="100%" height={260}>
            <ComposedChart
              data={withRunning.map((r) => ({
                day: format(new Date(r.day), 'd MMM', { locale: ru }),
                inflow: r.inflow_cents / 100,
                outflow: -(r.outflow_cents / 100),
                running: r.running_cents / 100,
              }))}
              margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#E7E5DE" vertical={false} />
              <XAxis dataKey="day" tickLine={false} fontSize={11} stroke="#9A9A9A" />
              <YAxis
                tickLine={false}
                fontSize={11}
                stroke="#9A9A9A"
                width={64}
                tickFormatter={(v: number) => {
                  // Компактный формат для оси: 12345 → "12.3k", 1500000 → "1.5m".
                  // Полное значение остаётся в tooltip + в таблице ниже.
                  const abs = Math.abs(v)
                  if (abs >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}m`
                  if (abs >= 1000) return `${(v / 1000).toFixed(abs >= 10_000 ? 0 : 1)}k`
                  return String(Math.round(v))
                }}
              />
              <Tooltip
                formatter={(v: number) => formatCurrency(Math.abs(v) * 100, currency)}
                contentStyle={{
                  borderRadius: 8,
                  border: '1px solid hsl(var(--border))',
                  fontSize: 12,
                }}
              />
              <Legend
                wrapperStyle={{ fontSize: 11 }}
                formatter={(value: string) => t(`finance.cashflow.legend_${value}`)}
              />
              <Bar
                dataKey="inflow"
                name="inflow"
                fill="hsl(var(--brand-sage))"
                radius={[3, 3, 0, 0]}
              />
              <Bar
                dataKey="outflow"
                name="outflow"
                fill="hsl(var(--destructive))"
                radius={[0, 0, 3, 3]}
              />
              <Line
                type="monotone"
                dataKey="running"
                name="running"
                stroke="hsl(var(--brand-navy))"
                strokeWidth={2}
                dot={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      ) : null}

      {/* Daily table */}
      <div className="border-border bg-card shadow-finsm overflow-x-auto rounded-lg border">
        {isLoading ? (
          <div className="text-muted-foreground p-6 text-sm">{t('common.loading')}</div>
        ) : withRunning.length === 0 ? (
          <div className="text-muted-foreground p-6 text-sm">{t('finance.cashflow.empty')}</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-muted-foreground text-xs uppercase tracking-wider">
              <tr>
                <th className="px-4 py-2 text-left font-semibold">
                  {t('finance.cashflow.col_date')}
                </th>
                <th className="px-4 py-2 text-right font-semibold">
                  {t('finance.cashflow.col_inflow')}
                </th>
                <th className="px-4 py-2 text-right font-semibold">
                  {t('finance.cashflow.col_outflow')}
                </th>
                <th className="px-4 py-2 text-right font-semibold">
                  {t('finance.cashflow.col_net')}
                </th>
                <th className="px-4 py-2 text-right font-semibold">
                  {t('finance.cashflow.col_running')}
                </th>
              </tr>
            </thead>
            <tbody>
              {withRunning
                .filter((r) => r.inflow_cents !== 0 || r.outflow_cents !== 0)
                .flatMap((r) => {
                  const isOpen = expandedDay === r.day
                  const dayTxs = txByDay[r.day] ?? []
                  const headerRow = (
                    <tr
                      key={r.day}
                      onClick={() => setExpandedDay(isOpen ? null : r.day)}
                      className="border-border/60 hover:bg-muted/30 cursor-pointer border-t transition-colors"
                    >
                      <td className="text-muted-foreground px-4 py-2 text-xs">
                        <span className="inline-flex items-center gap-1.5">
                          <ChevronRight
                            className={`size-3.5 transition-transform ${isOpen ? 'rotate-90' : ''}`}
                            strokeWidth={2.2}
                          />
                          {format(new Date(r.day), 'd MMM, EEEEEE', { locale: ru })}
                        </span>
                      </td>
                      <td className="num text-brand-sage-deep px-4 py-2 text-right font-semibold">
                        {r.inflow_cents > 0 ? `+${formatCurrency(r.inflow_cents, currency)}` : '—'}
                      </td>
                      <td className="num text-destructive px-4 py-2 text-right font-semibold">
                        {r.outflow_cents > 0
                          ? `−${formatCurrency(r.outflow_cents, currency)}`
                          : '—'}
                      </td>
                      <td
                        className={`num px-4 py-2 text-right font-semibold ${
                          r.net_cents > 0
                            ? 'text-brand-sage-deep'
                            : r.net_cents < 0
                              ? 'text-destructive'
                              : 'text-muted-foreground'
                        }`}
                      >
                        {r.net_cents > 0 ? '+' : r.net_cents < 0 ? '−' : ''}
                        {formatCurrency(Math.abs(r.net_cents), currency)}
                      </td>
                      <td
                        className={`num px-4 py-2 text-right font-semibold ${
                          r.running_cents >= 0 ? 'text-foreground' : 'text-destructive'
                        }`}
                      >
                        {r.running_cents >= 0 ? '' : '−'}
                        {formatCurrency(Math.abs(r.running_cents), currency)}
                      </td>
                    </tr>
                  )

                  if (!isOpen) return [headerRow]

                  const txRows = dayTxs.map((tx) => {
                    const account = accountFromPaymentMethod(tx.paymentMethod)
                    const AccountIcon = account.icon
                    return (
                      <tr
                        key={`${tx.source}-${tx.id}`}
                        onClick={(e) => {
                          e.stopPropagation()
                          navigateToEntity(tx)
                        }}
                        className="bg-muted/10 hover:bg-muted/30 border-border/40 cursor-pointer border-t border-dashed transition-colors"
                        title={t(`finance.cashflow.source.${tx.source}`)}
                      >
                        <td className="px-4 py-2 pl-10 text-xs">
                          <span className="text-foreground block max-w-[320px] truncate font-medium">
                            {tx.article}
                          </span>
                          <span className="text-muted-foreground mt-0.5 flex flex-wrap items-center gap-2 text-[11px]">
                            {tx.counterparty ? (
                              <span className="inline-flex items-center gap-1">
                                <User2 className="size-3" strokeWidth={1.8} />
                                <span className="max-w-[160px] truncate">{tx.counterparty}</span>
                              </span>
                            ) : null}
                            <span className="inline-flex items-center gap-1">
                              <AccountIcon className="size-3" strokeWidth={1.8} />
                              {account.label}
                            </span>
                            {tx.comment ? (
                              <span className="max-w-[200px] truncate italic">{tx.comment}</span>
                            ) : null}
                          </span>
                        </td>
                        <td className="num text-brand-sage-deep px-4 py-2 text-right">
                          {tx.kind === 'inflow'
                            ? `+${formatCurrency(tx.amountCents, currency)}`
                            : ''}
                        </td>
                        <td className="num text-destructive px-4 py-2 text-right">
                          {tx.kind === 'outflow'
                            ? `−${formatCurrency(tx.amountCents, currency)}`
                            : ''}
                        </td>
                        <td
                          colSpan={2}
                          className="text-muted-foreground px-4 py-2 text-right text-[11px] uppercase tracking-wider"
                        >
                          {t(`finance.cashflow.source.${tx.source}`)}
                        </td>
                      </tr>
                    )
                  })

                  if (txRows.length === 0) {
                    txRows.push(
                      <tr
                        key={`${r.day}-empty`}
                        className="bg-muted/10 border-border/40 border-t border-dashed"
                      >
                        <td
                          colSpan={5}
                          className="text-muted-foreground px-4 py-2 pl-10 text-xs italic"
                        >
                          {t('finance.cashflow.no_tx_for_day')}
                        </td>
                      </tr>,
                    )
                  }

                  return [headerRow, ...txRows]
                })}
            </tbody>
          </table>
        )}
      </div>

      <QuickEntryModal
        open={editingVisit !== null}
        onOpenChange={(v) => !v && setEditingVisit(null)}
        salonId={salonId}
        currency={currency}
        editVisit={editingVisit}
        onChargeRequest={(visitId) => {
          const v = visits.find((x) => x.id === visitId)
          if (v) {
            setEditingVisit(null)
            setOpenSaleDetail(v)
          }
        }}
      />

      <VisitDetailModal
        visit={openSaleDetail}
        onClose={() => setOpenSaleDetail(null)}
        salonId={salonId}
        currency={currency}
        initialView="charge"
        onBackFromCharge={(v) => setEditingVisit(v)}
      />
    </div>
  )
}
