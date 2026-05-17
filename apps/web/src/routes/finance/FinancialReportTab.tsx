import { endOfMonth, format, startOfMonth, startOfYear } from 'date-fns'
import { ru } from 'date-fns/locale'
import {
  BarChart3,
  ChevronDown,
  ChevronRight,
  FileSpreadsheet,
  Landmark,
  Printer,
  Sparkles,
  TrendingDown,
  TrendingUp,
  Wallet,
} from 'lucide-react'
import { Fragment, useMemo, useRef, useState, type RefObject } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { useExpenseCategories, useExpenses } from '@/hooks/useExpenses'
import {
  DEFAULT_FINANCIAL_SETTINGS,
  monthlyEquivalentCents,
  useFinancialSettings,
  type FinancialSettings,
  type ParameterItem,
} from '@/hooks/useFinancialSettings'
import { useMonthlyRegisterBalances } from '@/hooks/useCashTransfers'
import { useInventoryItems } from '@/hooks/useInventory'
import { useOtherIncomeCategories, useOtherIncomes } from '@/hooks/useOtherIncomes'
import { useSalon } from '@/hooks/useSalons'
import { useVisits } from '@/hooks/useVisits'
import { formatCurrency } from '@/lib/utils/format-currency'

type RowColor = 'navy' | 'sage' | 'destructive' | 'muted' | 'teal'

type CellRow = {
  label: string
  values: number[]
  factValues?: number[]
  bold?: boolean
  indent?: number
  color?: RowColor
  groupKey?: string
  parentGroupKey?: string
}

export function FinancialReportTab({ salonId }: { salonId: string }) {
  const { t } = useTranslation()
  const { data: salon } = useSalon(salonId)
  const currency = salon?.currency ?? 'PLN'
  const { data: settings = DEFAULT_FINANCIAL_SETTINGS } = useFinancialSettings(salonId)

  const year = new Date().getFullYear()
  const yearStart = startOfYear(new Date(year, 0, 1))
  const yearEnd = endOfMonth(new Date(year, 11, 31))
  const visitsRange = { start: yearStart.toISOString(), end: yearEnd.toISOString() }
  const expensesRange = {
    start: format(yearStart, 'yyyy-MM-dd'),
    end: format(yearEnd, 'yyyy-MM-dd'),
  }

  const { data: visits = [] } = useVisits(salonId, visitsRange, { kind: 'visit' })
  const { data: retailSales = [] } = useVisits(salonId, visitsRange, { kind: 'retail' })
  const { data: otherIncomes = [] } = useOtherIncomes(salonId, { start: yearStart, end: yearEnd })
  const { data: expenses = [] } = useExpenses(salonId, expensesRange)
  const { data: expenseCategories = [] } = useExpenseCategories(salonId)
  const { data: inventory = [] } = useInventoryItems(salonId, { includeArchived: true })
  const { data: otherIncomeCats = [] } = useOtherIncomeCategories(salonId, {
    includeArchived: true,
  })
  const { data: monthlyRegBalances } = useMonthlyRegisterBalances(salonId, year)

  const monthly = useMemo(() => {
    const buckets = Array.from({ length: 12 }, () => ({
      visitsRevenue: 0,
      retailRevenue: 0,
      otherIncome: 0,
      expensesTotal: 0,
    }))
    for (const v of visits) {
      const d = new Date(v.visit_at)
      if (d.getFullYear() !== year) continue
      const m = d.getMonth()
      buckets[m]!.visitsRevenue += v.amount_cents - v.discount_cents + v.tip_cents
    }
    for (const v of retailSales) {
      const d = new Date(v.visit_at)
      if (d.getFullYear() !== year) continue
      const m = d.getMonth()
      buckets[m]!.retailRevenue += v.amount_cents - v.discount_cents + v.tip_cents
    }
    for (const oi of otherIncomes) {
      const d = new Date(oi.income_at)
      if (d.getFullYear() !== year) continue
      buckets[d.getMonth()]!.otherIncome += oi.amount_cents
    }
    for (const e of expenses) {
      const d = new Date(e.expense_at)
      if (d.getFullYear() !== year) continue
      buckets[d.getMonth()]!.expensesTotal += e.amount_cents
    }
    return buckets
  }, [visits, retailSales, otherIncomes, expenses, year])

  const factByLabel = useMemo<Map<string, number[]>>(() => {
    const catNameById = new Map<string, string>()
    for (const c of expenseCategories) catNameById.set(c.id, normName(c.name))
    const map = new Map<string, number[]>()
    for (const e of expenses) {
      if (!e.category_id) continue
      const name = catNameById.get(e.category_id)
      if (!name) continue
      const d = new Date(e.expense_at)
      if (d.getFullYear() !== year) continue
      const arr = map.get(name) ?? Array.from({ length: 12 }, () => 0)
      arr[d.getMonth()]! += e.amount_cents
      map.set(name, arr)
    }
    return map
  }, [expenses, expenseCategories, year])

  function factsForLabel(label: string): number[] {
    return factByLabel.get(normName(label)) ?? Array.from({ length: 12 }, () => 0)
  }

  const retailByCategory = useMemo<Map<string, number[]>>(() => {
    const invCatById = new Map<string, string>()
    const invCatByName = new Map<string, string>()
    for (const i of inventory) {
      invCatById.set(i.id, i.category || '')
      if (i.name) invCatByName.set(normName(i.name), i.category || '')
    }
    const map = new Map<string, number[]>()
    for (const v of retailSales) {
      const d = new Date(v.visit_at)
      if (d.getFullYear() !== year) continue
      // 1. Сначала по inventory_item_id (новые продажи после миграции).
      // 2. Fallback — по service_name_snapshot (старые продажи или «ручные
      //    позиции», где пользователь ввёл название вручную, не выбирая со
      //    склада). Снимаем суффикс «×N» (количество).
      let cat = ''
      if (v.inventory_item_id) {
        cat = invCatById.get(v.inventory_item_id) ?? ''
      }
      if (!cat && v.service_name_snapshot) {
        const base = v.service_name_snapshot.replace(/\s*×\s*\d+\s*$/, '').trim()
        cat = invCatByName.get(normName(base)) ?? ''
      }
      const key = cat.trim() || t('finance.report.uncategorized')
      const arr = map.get(key) ?? Array.from({ length: 12 }, () => 0)
      arr[d.getMonth()]! += v.amount_cents - v.discount_cents + v.tip_cents
      map.set(key, arr)
    }
    return map
  }, [retailSales, inventory, year, t])

  const otherIncomesByCategory = useMemo<Map<string, number[]>>(() => {
    const map = new Map<string, number[]>()
    for (const oi of otherIncomes) {
      const d = new Date(oi.income_at)
      if (d.getFullYear() !== year) continue
      const key = oi.category_id ?? '__none__'
      const arr = map.get(key) ?? Array.from({ length: 12 }, () => 0)
      arr[d.getMonth()]! += oi.amount_cents
      map.set(key, arr)
    }
    return map
  }, [otherIncomes, year])

  // Все группы свёрнуты по умолчанию — пользователь раскрывает только то, что
  // его интересует. Балансовые корневые группы тоже здесь.
  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    const set = new Set([
      'revenue',
      'retail',
      'revenue_other',
      'expenses',
      'variable',
      'fixed',
      'taxes',
      'investing',
      'financing',
    ])
    for (const item of DEFAULT_FINANCIAL_SETTINGS.balance.items) {
      if (!item.parent_id && !item.archived) {
        set.add(`balance_root_${item.preset_key || item.id}`)
      }
    }
    return set
  })
  function toggleGroup(key: string) {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const fixedTotalMonthly = sumFixedCents(settings)
  const taxesTotalMonthly = sumTaxesCents(settings)
  const investmentsTotal = sumInvestmentsCents(settings)
  const flowsTotalMonthly = sumFlowsCents(settings)

  const months = Array.from({ length: 12 }, (_, i) => i)
  const currentMonthIdx = new Date().getMonth()

  function constant(value: number) {
    return months.map(() => value)
  }
  function variablePctOfRevenue(pct: number) {
    return monthly.map((m) => Math.round(((m.visitsRevenue + m.otherIncome) * pct) / 100))
  }

  const visitsByMonth = monthly.map((m) => m.visitsRevenue)
  const retailByMonth = monthly.map((m) => m.retailRevenue)
  const otherIncomeMonthly = settings.other_income.items
    .filter((i) => !i.archived)
    .reduce((acc, i) => acc + monthlyEquivalentCents(i), 0)
  const otherIncomeByMonth = monthly.map((m) => m.otherIncome + otherIncomeMonthly)
  const revenueByMonth = visitsByMonth.map(
    (v, i) => v + (retailByMonth[i] ?? 0) + (otherIncomeByMonth[i] ?? 0),
  )

  const variableTotalPct = settings.variable.items
    .filter((i) => !i.archived)
    .reduce((acc, i) => acc + (i.pct ?? 0), 0)
  const variableByMonth = variablePctOfRevenue(variableTotalPct)

  const fixedByMonth = constant(fixedTotalMonthly)
  const taxesByMonth = constant(taxesTotalMonthly)
  const expensesTotalByMonth = months.map(
    (i) => (variableByMonth[i] ?? 0) + (fixedByMonth[i] ?? 0) + (taxesByMonth[i] ?? 0),
  )

  const investmentsByMonth = months.map((m) => (m === currentMonthIdx ? investmentsTotal : 0))
  const flowsByMonth = constant(flowsTotalMonthly)

  const periodSaldoByMonth = revenueByMonth.map(
    (rev, i) =>
      rev - (expensesTotalByMonth[i] ?? 0) - (investmentsByMonth[i] ?? 0) - (flowsByMonth[i] ?? 0),
  )

  const openingBalance = sumCashRegistersCents(settings)
  const runningEndOfMonth = periodSaldoByMonth.reduce<number[]>((acc, s, i) => {
    const prev = i === 0 ? openingBalance : (acc[i - 1] ?? 0)
    acc.push(prev + s)
    return acc
  }, [])

  // Aggregate KPIs за год (для верхней панели)
  const totalRevenueYear = revenueByMonth.reduce((s, v) => s + v, 0)
  const totalExpensesYear = expensesTotalByMonth.reduce((s, v) => s + v, 0)
  const totalSaldoYear = periodSaldoByMonth.reduce((s, v) => s + v, 0)
  const endOfYearBalance = runningEndOfMonth[11] ?? openingBalance

  const rows: CellRow[] = [
    {
      label: t('finance.report.revenue'),
      values: constant(0),
      factValues: revenueByMonth,
      bold: true,
      color: 'sage',
      groupKey: 'revenue',
    },
    {
      label: t('finance.report.revenue_services'),
      values: constant(0),
      factValues: visitsByMonth,
      indent: 1,
      parentGroupKey: 'revenue',
    },
    {
      label: t('finance.report.revenue_retail'),
      values: constant(0),
      factValues: retailByMonth,
      indent: 1,
      parentGroupKey: 'revenue',
      groupKey: 'retail',
    },
    ...Array.from(retailByCategory.entries()).map(([cat, factArr]) => ({
      label: cat,
      values: constant(0),
      factValues: factArr,
      indent: 2,
      parentGroupKey: 'retail',
    })),
    {
      label: t('finance.report.revenue_other'),
      values: constant(otherIncomeMonthly),
      factValues: monthly.map((m) => m.otherIncome),
      indent: 1,
      parentGroupKey: 'revenue',
      groupKey: 'revenue_other',
    },
    ...buildOtherIncomeCategoryRows(otherIncomeCats, otherIncomesByCategory, t),

    {
      label: t('finance.report.expenses_total'),
      values: expensesTotalByMonth.map((v) => -v),
      bold: true,
      color: 'destructive',
      groupKey: 'expenses',
    },
    {
      label: t('finance.report.variable'),
      values: variableByMonth.map((v) => -v),
      indent: 1,
      bold: true,
      color: 'destructive',
      groupKey: 'variable',
      parentGroupKey: 'expenses',
    },
    ...settings.variable.items
      .filter((i) => !i.archived)
      .map((it) => ({
        label: it.label || '—',
        values: variablePctOfRevenue(it.pct ?? 0).map((v) => -v),
        indent: 2,
        parentGroupKey: 'variable',
      })),
    {
      label: t('finance.report.fixed'),
      values: fixedByMonth.map((v) => -v),
      indent: 1,
      bold: true,
      color: 'destructive',
      groupKey: 'fixed',
      parentGroupKey: 'expenses',
    },
    ...buildFixedRows(settings, factsForLabel).map((r) => ({
      ...r,
      parentGroupKey: 'fixed',
    })),
    {
      label: t('finance.report.taxes'),
      values: taxesByMonth.map((v) => -v),
      indent: 1,
      bold: true,
      color: 'destructive',
      groupKey: 'taxes',
      parentGroupKey: 'expenses',
    },
    ...buildItemsRows(settings.taxes.items, 2, -1, null, factsForLabel).map((r) => ({
      ...r,
      parentGroupKey: 'taxes',
    })),

    {
      label: t('finance.report.section_investing'),
      values: investmentsByMonth.map((v) => -v),
      bold: true,
      color: 'teal',
      groupKey: 'investing',
    },
    ...buildInvestmentRows(settings, currentMonthIdx, factsForLabel).map((r) => ({
      ...r,
      parentGroupKey: 'investing',
    })),

    {
      label: t('finance.report.section_financing'),
      values: flowsByMonth.map((v) => -v),
      bold: true,
      color: 'navy',
      groupKey: 'financing',
    },
    ...buildFlowRows(settings, factsForLabel).map((r) => ({
      ...r,
      parentGroupKey: 'financing',
    })),

    {
      label: t('finance.report.period_saldo'),
      values: periodSaldoByMonth,
      bold: true,
      color: 'sage',
    },
    {
      label: t('finance.report.end_balance'),
      values: runningEndOfMonth,
      bold: true,
      color: 'navy',
    },
  ]

  // Балансовая таблица — отдельно. Используем общий `collapsed` Set.
  const balanceRows = buildBalanceRows(
    settings.balance.items,
    monthlyRegBalances,
    runningEndOfMonth,
    periodSaldoByMonth,
    inventory,
  )

  const yearTotal = (vals: number[]) => vals.reduce((s, v) => s + v, 0)

  function exportCsv() {
    const headers = [
      t('finance.report.col_row'),
      t('finance.report.col_total'),
      ...months.map((m) => format(startOfMonth(new Date(year, m, 1)), 'MM/yy', { locale: ru })),
    ]
    const lines = [headers.join(';')]
    for (const row of [...rows, ...balanceRows]) {
      const cells = [row.label, yearTotal(row.values), ...row.values]
      lines.push(
        cells.map((c) => (typeof c === 'number' ? (c / 100).toFixed(2) : `"${c}"`)).join(';'),
      )
    }
    const csv = '﻿' + lines.join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `financial-report-${year}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const visibleMainRows = rows.filter(
    (row) => !(row.parentGroupKey && collapsed.has(row.parentGroupKey)),
  )
  const visibleBalanceRows = balanceRows.filter(
    (row) => !(row.parentGroupKey && collapsed.has(row.parentGroupKey)),
  )

  // ===== Синхронизация горизонтального скролла трёх таблиц =====
  // Скроллим по ratio (scrollLeft/scrollMax) — таблицы имеют разную ширину
  // (касса без «План/Факт»), так что абсолютные пиксели не совпадают.
  const mainScrollRef = useRef<HTMLDivElement>(null)
  const cashScrollRef = useRef<HTMLDivElement>(null)
  const balanceScrollRef = useRef<HTMLDivElement>(null)
  const isSyncingScrollRef = useRef(false)
  function makeSyncScroll(self: RefObject<HTMLDivElement>) {
    return (e: React.UIEvent<HTMLDivElement>) => {
      if (isSyncingScrollRef.current) return
      isSyncingScrollRef.current = true
      const src = e.currentTarget
      const srcMax = src.scrollWidth - src.clientWidth
      const ratio = srcMax > 0 ? src.scrollLeft / srcMax : 0
      for (const ref of [mainScrollRef, cashScrollRef, balanceScrollRef]) {
        if (ref === self) continue
        const el = ref.current
        if (!el) continue
        const dstMax = el.scrollWidth - el.clientWidth
        const target = Math.round(ratio * dstMax)
        if (Math.abs(el.scrollLeft - target) > 1) el.scrollLeft = target
      }
      requestAnimationFrame(() => {
        isSyncingScrollRef.current = false
      })
    }
  }

  return (
    <div className="space-y-5">
      {/* ===== TOP TOOLBAR ===== */}
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-lg font-bold tracking-tight text-slate-900">
            {t('finance.report.title')}
          </h2>
          <p className="mt-1 text-sm text-slate-500">{t('finance.report.subtitle')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 print:hidden">
          <Button variant="outline" size="md" onClick={exportCsv}>
            <FileSpreadsheet className="size-4" strokeWidth={1.8} />
            {t('finance.report.export_csv')}
          </Button>
          <Button variant="outline" size="md" onClick={() => window.print()}>
            <Printer className="size-4" strokeWidth={1.8} />
            {t('finance.report.print')}
          </Button>
        </div>
      </header>

      {/* ===== KPI STRIP ===== */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard
          icon={<TrendingUp className="size-4" strokeWidth={1.8} />}
          label={t('finance.report.revenue')}
          value={formatCurrency(totalRevenueYear, currency)}
          tone="sage"
        />
        <KpiCard
          icon={<TrendingDown className="size-4" strokeWidth={1.8} />}
          label={t('finance.report.expenses_total')}
          value={formatCurrency(totalExpensesYear, currency)}
          tone="red"
        />
        <KpiCard
          icon={<Sparkles className="size-4" strokeWidth={1.8} />}
          label={t('finance.report.period_saldo')}
          value={formatCurrency(totalSaldoYear, currency)}
          tone={totalSaldoYear >= 0 ? 'sage' : 'red'}
        />
        <KpiCard
          icon={<Wallet className="size-4" strokeWidth={1.8} />}
          label={t('finance.report.current_balance')}
          value={formatCurrency(openingBalance, currency)}
          tone="navy"
          hint={t('finance.report.end_balance') + ': ' + formatCurrency(endOfYearBalance, currency)}
        />
      </div>

      {/* ===== MAIN REPORT TABLE ===== */}
      <ReportCard
        title={t('finance.report.title')}
        icon={<BarChart3 className="size-4" strokeWidth={1.8} />}
        scrollRef={mainScrollRef}
        onScroll={makeSyncScroll(mainScrollRef)}
      >
        <ReportTable
          year={year}
          months={months}
          currentMonthIdx={currentMonthIdx}
          rows={visibleMainRows}
          currency={currency}
          collapsed={collapsed}
          onToggle={toggleGroup}
          t={t}
        />
      </ReportCard>

      {/* ===== ОСТАТОК ПО КАССАМ ===== */}
      <ReportCard
        title={t('finance.report.end_balance_by_register')}
        icon={<Wallet className="size-4" strokeWidth={1.8} />}
        scrollRef={cashScrollRef}
        onScroll={makeSyncScroll(cashScrollRef)}
      >
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-100 text-slate-600">
              <th className="sticky left-0 z-30 min-w-[220px] bg-slate-100 px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider">
                {t('finance.report.end_balance_by_register')}
              </th>
              <th className="border-l border-slate-200 bg-slate-200/60 px-2 py-2.5 text-right text-[10px] font-semibold uppercase tracking-wider">
                {t('finance.report.col_start')}
              </th>
              {months.map((m) => (
                <th
                  key={m}
                  className={`min-w-[140px] border-l border-slate-200 px-2 py-2.5 text-right text-[10px] font-semibold uppercase capitalize tracking-wider ${
                    m === currentMonthIdx ? 'bg-amber-100 text-amber-900' : 'bg-slate-100'
                  }`}
                >
                  {format(startOfMonth(new Date(year, m, 1)), 'MM/yy', { locale: ru })}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {settings.cash_registers.items
              .filter((i) => !i.archived)
              .map((reg, idx) => {
                const monthlyBalances = monthlyRegBalances.get(reg.id) ?? []
                const zebra = idx % 2 === 1 ? 'bg-slate-50/60' : 'bg-white'
                return (
                  <tr
                    key={reg.id}
                    className={`border-t border-slate-100 transition-colors hover:bg-slate-50 ${zebra}`}
                  >
                    <td
                      className={`sticky left-0 z-20 border-r border-slate-200 px-3 py-2 font-medium text-slate-800 ${zebra}`}
                    >
                      {reg.label || '—'}
                    </td>
                    <td className="num border-l border-slate-200 bg-slate-50 px-2 py-2 text-right font-semibold text-slate-600">
                      {formatNumberSafe(reg.amount_cents ?? 0, currency)}
                    </td>
                    {months.map((m) => (
                      <td
                        key={m}
                        className={`num border-l border-slate-100 px-2 py-2 text-right text-slate-700 ${
                          m === currentMonthIdx ? 'bg-amber-50' : ''
                        }`}
                      >
                        {formatNumberSafe(monthlyBalances[m] ?? 0, currency)}
                      </td>
                    ))}
                  </tr>
                )
              })}
          </tbody>
        </table>
      </ReportCard>

      {/* ===== БАЛАНС (отдельная таблица) ===== */}
      <ReportCard
        title={t('finance.report.section_balance')}
        icon={<Landmark className="size-4" strokeWidth={1.8} />}
        scrollRef={balanceScrollRef}
        onScroll={makeSyncScroll(balanceScrollRef)}
      >
        <ReportTable
          year={year}
          months={months}
          currentMonthIdx={currentMonthIdx}
          rows={visibleBalanceRows}
          currency={currency}
          collapsed={collapsed}
          onToggle={toggleGroup}
          t={t}
        />
      </ReportCard>
    </div>
  )
}

// ============================ KPI Card ============================

function KpiCard({
  icon,
  label,
  value,
  tone,
  hint,
}: {
  icon: React.ReactNode
  label: string
  value: string
  tone: 'sage' | 'red' | 'navy' | 'teal'
  hint?: string
}) {
  // Минималистичная карточка: белый фон, узкая цветная полоска слева как
  // акцент. Палитра — приглушённая (Nord-like): emerald / rose / amber /
  // slate. Без тёмных navy-фонов.
  const accent: Record<typeof tone, { stripe: string; text: string; iconBg: string }> = {
    sage: {
      stripe: 'bg-emerald-500',
      text: 'text-emerald-700',
      iconBg: 'bg-emerald-50 text-emerald-600',
    },
    red: {
      stripe: 'bg-rose-400',
      text: 'text-rose-600',
      iconBg: 'bg-rose-50 text-rose-500',
    },
    navy: {
      stripe: 'bg-slate-700',
      text: 'text-slate-800',
      iconBg: 'bg-slate-100 text-slate-700',
    },
    teal: {
      stripe: 'bg-amber-400',
      text: 'text-amber-700',
      iconBg: 'bg-amber-50 text-amber-600',
    },
  }
  const a = accent[tone]
  return (
    <div className="shadow-finsm hover:shadow-finmd flex overflow-hidden rounded-xl border border-slate-200 bg-white transition-shadow">
      <div className={`w-1 shrink-0 ${a.stripe}`} />
      <div className="flex-1 p-3">
        <div className="flex items-center gap-2">
          <span className={`rounded-md p-1.5 ${a.iconBg}`}>{icon}</span>
          <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            {label}
          </span>
        </div>
        <div className={`num mt-2 text-lg font-bold leading-tight ${a.text}`}>{value}</div>
        {hint ? <p className="mt-1 text-[10px] text-slate-500">{hint}</p> : null}
      </div>
    </div>
  )
}

// ============================ ReportCard ============================

function ReportCard({
  title,
  icon,
  scrollRef,
  onScroll,
  children,
}: {
  title: string
  icon: React.ReactNode
  scrollRef?: RefObject<HTMLDivElement>
  onScroll?: (e: React.UIEvent<HTMLDivElement>) => void
  children: React.ReactNode
}) {
  return (
    <section className="shadow-finmd overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div className="flex items-center gap-2.5 border-b border-slate-200 bg-slate-50/80 px-4 py-2.5">
        <span className="rounded-md bg-slate-900 p-1.5 text-amber-300">{icon}</span>
        <h3 className="text-sm font-semibold tracking-tight text-slate-800">{title}</h3>
      </div>
      <div ref={scrollRef} onScroll={onScroll} className="overflow-x-auto">
        {children}
      </div>
    </section>
  )
}

// ============================ ReportTable ============================

function ReportTable({
  year,
  months,
  currentMonthIdx,
  rows,
  currency,
  collapsed,
  onToggle,
  t,
}: {
  year: number
  months: number[]
  currentMonthIdx: number
  rows: CellRow[]
  currency: string
  collapsed: Set<string>
  onToggle: (key: string) => void
  t: (k: string) => string
}) {
  const yearTotal = (vals: number[]) => vals.reduce((s, v) => s + v, 0)
  return (
    <table className="w-full border-collapse text-xs">
      <thead>
        <tr className="border-b border-slate-200 bg-slate-100 text-slate-600">
          <th
            rowSpan={2}
            className="sticky left-0 z-30 min-w-[220px] bg-slate-100 px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider"
          >
            {t('finance.report.col_row')}
          </th>
          <th
            colSpan={2}
            className="border-l border-slate-200 bg-slate-200/60 px-2 py-2 text-center text-[10px] font-semibold uppercase tracking-wider"
          >
            {t('finance.report.col_total')}
          </th>
          {months.map((m) => (
            <th
              key={m}
              colSpan={2}
              className={`min-w-[140px] border-l border-slate-200 px-2 py-2 text-center text-[10px] font-semibold uppercase capitalize tracking-wider ${
                m === currentMonthIdx ? 'bg-amber-100 text-amber-900' : 'bg-slate-100'
              }`}
            >
              {format(startOfMonth(new Date(year, m, 1)), 'MM/yy', { locale: ru })}
            </th>
          ))}
        </tr>
        <tr className="border-b border-slate-200 bg-slate-50 text-slate-500">
          <th className="border-l border-slate-200 bg-slate-100/70 px-2 py-1 text-right text-[9px] font-medium uppercase">
            {t('finance.report.col_plan')}
          </th>
          <th className="bg-slate-100/70 px-2 py-1 text-right text-[9px] font-medium uppercase">
            {t('finance.report.col_fact')}
          </th>
          {months.map((m) => (
            <Fragment key={m}>
              <th
                className={`border-l border-slate-200 px-2 py-1 text-right text-[9px] font-medium uppercase ${
                  m === currentMonthIdx ? 'bg-amber-50 text-amber-800' : 'bg-slate-50'
                }`}
              >
                {t('finance.report.col_plan')}
              </th>
              <th
                className={`px-2 py-1 text-right text-[9px] font-medium uppercase ${
                  m === currentMonthIdx ? 'bg-amber-50 text-amber-800' : 'bg-slate-50'
                }`}
              >
                {t('finance.report.col_fact')}
              </th>
            </Fragment>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, idx) => {
          const hasGroup = !!row.groupKey
          const isCollapsed = hasGroup && collapsed.has(row.groupKey!)
          const groupBg = groupRowBg(row.color, row.bold)
          const accentBorder = row.bold ? accentLeftBorder(row.color) : ''
          // Чётные строки (не-bold) — slate-50 как лёгкая «зебра». bold-строки
          // секций имеют свой groupBg.
          const zebra = !row.bold && idx % 2 === 1 ? 'bg-slate-50/60' : 'bg-white'
          const rowBg = groupBg || zebra
          return (
            <tr
              key={`${row.label}-${idx}`}
              className={`group border-t border-slate-100 transition-colors hover:bg-slate-50 ${rowBg} ${
                hasGroup ? 'cursor-pointer' : ''
              }`}
              onClick={hasGroup ? () => onToggle(row.groupKey!) : undefined}
            >
              <td
                className={`sticky left-0 z-20 border-r border-slate-200 px-3 py-2 text-slate-800 ${
                  row.bold ? 'font-bold' : 'font-medium'
                } ${rowBg} ${accentBorder}`}
                style={{ paddingLeft: 12 + (row.indent ?? 0) * 16 }}
              >
                <span className="inline-flex items-center gap-1.5">
                  {hasGroup ? (
                    isCollapsed ? (
                      <ChevronRight
                        className="size-3.5 shrink-0 text-slate-400 transition-colors group-hover:text-slate-700"
                        strokeWidth={2.2}
                      />
                    ) : (
                      <ChevronDown
                        className="size-3.5 shrink-0 text-slate-400 transition-colors group-hover:text-slate-700"
                        strokeWidth={2.2}
                      />
                    )
                  ) : null}
                  <span className={row.bold ? 'text-slate-800' : 'text-slate-600'}>
                    {row.label}
                  </span>
                </span>
              </td>
              {/* Итого План | Факт */}
              <td
                className={`num border-l border-slate-200 bg-slate-50 px-2 py-2 text-right ${
                  row.bold ? 'font-bold' : 'font-medium'
                } ${colorClass(row.color)}`}
              >
                {formatPF(yearTotal(row.values), currency)}
              </td>
              <td
                className={`num bg-slate-50 px-2 py-2 text-right ${
                  row.bold ? 'font-bold' : 'font-medium'
                } ${colorClass(row.color)}`}
              >
                {formatPF(yearTotal(row.factValues ?? []), currency)}
              </td>
              {row.values.map((plan, mi) => {
                const fact = row.factValues?.[mi] ?? 0
                const isCurrent = mi === currentMonthIdx
                return (
                  <Fragment key={mi}>
                    <td
                      className={`num border-l border-slate-100 px-2 py-2 text-right ${
                        row.bold ? 'font-semibold' : ''
                      } ${colorClass(row.color, 'plan')} ${isCurrent ? 'bg-amber-50' : ''}`}
                    >
                      {formatPF(plan, currency)}
                    </td>
                    <td
                      className={`num px-2 py-2 text-right ${row.bold ? 'font-semibold' : ''} ${colorClass(
                        row.color,
                        'fact',
                      )} ${isCurrent ? 'bg-amber-50' : ''}`}
                    >
                      {formatPF(fact, currency)}
                    </td>
                  </Fragment>
                )
              })}
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

// ============================ helpers ============================

function sumFixedCents(s: FinancialSettings): number {
  return sumSectionMonthly(s.fixed.items)
}

function sumTaxesCents(s: FinancialSettings): number {
  return sumSectionMonthly(s.taxes.items)
}

function sumInvestmentsCents(s: FinancialSettings): number {
  return s.investments.items
    .filter((i) => !i.archived)
    .reduce((acc, i) => acc + (i.amount_cents ?? 0), 0)
}

function sumFlowsCents(s: FinancialSettings): number {
  return sumSectionMonthly(s.flows.items)
}

function sumCashRegistersCents(s: FinancialSettings): number {
  return s.cash_registers.items
    .filter((i) => !i.archived)
    .reduce((acc, i) => acc + (i.amount_cents ?? 0), 0)
}

function sumSectionMonthly(items: ParameterItem[]): number {
  return items.filter((i) => !i.archived).reduce((acc, i) => acc + monthlyEquivalentCents(i), 0)
}

function formatNumberSafe(v: number, currency: string): string {
  return formatCurrency(v, currency)
}

function formatPF(v: number, currency: string): string {
  return v === 0 ? '—' : formatCurrency(v, currency)
}

/**
 * Палитра текста (Nord-like — приглушённая, не ядовитая):
 * - sage (доходы, положительное сальдо) → emerald
 * - destructive (расходы, отрицательное) → rose
 * - teal (инвестиции — нейтрально-предупреждающее) → amber
 * - navy (финансовая, остаток, баланс) → slate-dark
 */
function colorClass(color: RowColor | undefined, kind?: 'plan' | 'fact'): string {
  if (kind === 'plan') {
    if (color === 'destructive') return 'text-rose-500/80'
    if (color === 'sage') return 'text-emerald-600/80'
    if (color === 'teal') return 'text-amber-600/80'
    if (color === 'navy') return 'text-slate-600/80'
    return 'text-slate-400'
  }
  if (color === 'destructive') return 'text-rose-600'
  if (color === 'sage') return 'text-emerald-700'
  if (color === 'teal') return 'text-amber-700'
  if (color === 'navy') return 'text-slate-800'
  return 'text-slate-700'
}

/**
 * Фон строки-секции. Все секции на одинаковом мягком `slate-50` — различаются
 * только цветной полоской слева (см. accentLeftBorder). Это держит вид
 * спокойным, без пёстрых пастельных полос на каждом разделе.
 */
function groupRowBg(_color: RowColor | undefined, bold: boolean | undefined): string {
  if (!bold) return ''
  return 'bg-slate-50'
}

/** Цветной акцент слева у bold-строк (как «полоска категории»). */
function accentLeftBorder(color: RowColor | undefined): string {
  if (color === 'sage') return 'border-l-[3px] border-l-emerald-500'
  if (color === 'destructive') return 'border-l-[3px] border-l-rose-400'
  if (color === 'teal') return 'border-l-[3px] border-l-amber-400'
  if (color === 'navy') return 'border-l-[3px] border-l-slate-700'
  return ''
}

function normName(s: string | null | undefined): string {
  return (s ?? '').trim().toLowerCase()
}

/**
 * Строит строки отчёта из items[] секции с учётом иерархии (parent_id).
 * Корневые позиции рендерятся на уровне `baseIndent`, дочерние — +1.
 */
function buildItemsRows(
  items: ParameterItem[],
  baseIndent: number,
  sign: 1 | -1,
  onlyInMonth: number | null = null,
  factsForLabel?: (label: string) => number[],
) {
  const byParent = new Map<string | null, ParameterItem[]>()
  for (const it of items) {
    const key = it.parent_id ?? null
    const arr = byParent.get(key) ?? []
    arr.push(it)
    byParent.set(key, arr)
  }
  const rows: Array<{
    label: string
    values: number[]
    factValues?: number[]
    indent: number
  }> = []
  function pushNode(node: ParameterItem, indent: number) {
    const monthly = node.archived ? 0 : monthlyEquivalentCents(node)
    const values = Array.from({ length: 12 }, (_, m) => {
      if (onlyInMonth !== null) {
        return m === onlyInMonth && !node.archived ? sign * (node.amount_cents ?? 0) : 0
      }
      return sign * monthly
    })
    const baseLabel = node.label || '—'
    const fact = factsForLabel ? factsForLabel(baseLabel).map((v) => sign * v) : undefined
    // Архивные позиции без фактических показателей не показываем вовсе.
    const allZero = values.every((v) => v === 0) && (!fact || fact.every((v) => v === 0))
    if (!(node.archived && allZero)) {
      rows.push({ label: baseLabel, values, factValues: fact, indent })
    }
    const children = byParent.get(node.id) ?? []
    for (const c of children) pushNode(c, indent + 1)
  }
  const roots = byParent.get(null) ?? []
  for (const r of roots) pushNode(r, baseIndent)
  return rows
}

function buildFixedRows(settings: FinancialSettings, factsForLabel?: (label: string) => number[]) {
  return buildItemsRows(settings.fixed.items, 2, -1, null, factsForLabel)
}

function buildInvestmentRows(
  settings: FinancialSettings,
  currentMonthIdx: number,
  factsForLabel?: (label: string) => number[],
) {
  return buildItemsRows(settings.investments.items, 1, -1, currentMonthIdx, factsForLabel)
}

function buildFlowRows(settings: FinancialSettings, factsForLabel?: (label: string) => number[]) {
  return buildItemsRows(settings.flows.items, 1, -1, null, factsForLabel)
}

function buildOtherIncomeCategoryRows(
  categories: { id: string; name: string; parent_id: string | null; is_archived: boolean }[],
  factMap: Map<string, number[]>,
  t: (k: string) => string,
): CellRow[] {
  const byParent = new Map<string | null, typeof categories>()
  for (const c of categories) {
    const k = c.parent_id ?? null
    const arr = byParent.get(k) ?? []
    arr.push(c)
    byParent.set(k, arr)
  }
  const zeros = Array.from({ length: 12 }, () => 0)
  const rows: CellRow[] = []
  function pushNode(node: (typeof categories)[number], indent: number) {
    const fact = factMap.get(node.id) ?? zeros.slice()
    const allZero = fact.every((v) => v === 0)
    // Архивные категории без фактов не показываем; без пометки «(архив)».
    if (!(node.is_archived && allZero)) {
      rows.push({
        label: node.name,
        values: zeros.slice(),
        factValues: fact,
        indent,
        parentGroupKey: 'revenue_other',
      })
    }
    const children = byParent.get(node.id) ?? []
    for (const c of children) pushNode(c, indent + 1)
  }
  const roots = byParent.get(null) ?? []
  for (const r of roots) pushNode(r, 2)
  const noneFact = factMap.get('__none__')
  if (noneFact && noneFact.some((v) => v !== 0)) {
    rows.push({
      label: t('finance.report.uncategorized'),
      values: zeros.slice(),
      factValues: noneFact,
      indent: 2,
      parentGroupKey: 'revenue_other',
    })
  }
  return rows
}

/**
 * Баланс per-month: реальные значения для preset_key (Деньги / Накопленная
 * прибыль / Запасы), остальные позиции = константа amount_cents.
 *
 * Каждый корневой узел (Активы / Пассивы) делается сворачиваемой группой:
 * groupKey = `balance_root_${preset_key || id}`, потомки получают
 * parentGroupKey = тот же ключ.
 */
function buildBalanceRows(
  items: ParameterItem[],
  monthlyRegBalances: Map<string, number[]>,
  _runningEndOfMonth: number[],
  periodSaldoByMonth: number[],
  inventory: Array<{ current_stock?: number; cost_per_unit_cents?: number | null }>,
): CellRow[] {
  const months = Array.from({ length: 12 }, (_, i) => i)
  const moneyByMonth = months.map((m) => {
    let sum = 0
    for (const arr of monthlyRegBalances.values()) sum += arr[m] ?? 0
    return sum
  })
  const accumulatedProfit = periodSaldoByMonth.reduce<number[]>((acc, s, i) => {
    const prev = i === 0 ? 0 : (acc[i - 1] ?? 0)
    acc.push(prev + s)
    return acc
  }, [])
  const stockCents = inventory.reduce((acc, i) => {
    const stock = i.current_stock ?? 0
    const cost = i.cost_per_unit_cents ?? 0
    return acc + Math.round(stock * cost)
  }, 0)
  const computedByKey = new Map<string, number[]>([
    ['balance_assets_money', moneyByMonth],
    ['balance_liabilities_profit', accumulatedProfit],
    ['balance_assets_stock', months.map(() => stockCents)],
  ])
  const byParent = new Map<string | null, ParameterItem[]>()
  for (const it of items) {
    const k = it.parent_id ?? null
    const arr = byParent.get(k) ?? []
    arr.push(it)
    byParent.set(k, arr)
  }
  const zeros = Array.from({ length: 12 }, () => 0)
  const rows: CellRow[] = []
  function pushNode(node: ParameterItem, indent: number, rootKey: string | null) {
    const isRoot = indent === 0
    const myKey = isRoot ? `balance_root_${node.preset_key || node.id}` : rootKey
    const planConst = node.amount_cents ?? 0
    const planArr = months.map(() => planConst)
    const computed = node.preset_key ? computedByKey.get(node.preset_key) : undefined
    const baseLabel = node.label || '—'
    const factArr = computed ?? zeros.slice()
    const color: RowColor | undefined = isRoot
      ? node.preset_key === 'balance_liabilities'
        ? 'destructive'
        : 'navy'
      : undefined
    const allZero = planArr.every((v) => v === 0) && factArr.every((v) => v === 0)
    // Архив с нулями не показываем; без пометки «(архив)».
    if (!(node.archived && allZero)) {
      rows.push({
        label: baseLabel,
        values: planArr,
        factValues: factArr,
        indent,
        bold: isRoot,
        color,
        groupKey: isRoot ? (myKey ?? undefined) : undefined,
        parentGroupKey: !isRoot ? (rootKey ?? undefined) : undefined,
      })
    }
    const children = byParent.get(node.id) ?? []
    for (const c of children) pushNode(c, indent + 1, myKey)
  }
  const roots = byParent.get(null) ?? []
  for (const r of roots) pushNode(r, 0, null)
  return rows
}
