import { endOfMonth, format, startOfMonth, startOfYear } from 'date-fns'
import { ru } from 'date-fns/locale'
import {
  BarChart3,
  ChevronDown,
  ChevronRight,
  FileSpreadsheet,
  Landmark,
  Printer,
  Wallet,
} from 'lucide-react'
import { Fragment, useMemo, useState } from 'react'
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
import { useScheduledPayments } from '@/hooks/useScheduledPayments'
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
  const { data: scheduledPayments = [] } = useScheduledPayments(salonId)
  const { data: expenseCategories = [] } = useExpenseCategories(salonId)
  const { data: inventory = [] } = useInventoryItems(salonId, { includeArchived: true })
  const { data: otherIncomeCats = [] } = useOtherIncomeCategories(salonId, {
    includeArchived: true,
  })
  const { data: monthlyRegBalances } = useMonthlyRegisterBalances(salonId, year)

  // Семантика двух колонок (запрос юзера 21.05):
  //   План = ВСЕ записи периода (paid + pending визиты, expenses + scheduled).
  //   Факт = только фактически оплаченные (visits.status='paid', expenses
  //          — таблица содержит только paid, scheduled НЕ учитываем).
  const monthly = useMemo(() => {
    const make = () =>
      Array.from({ length: 12 }, () => ({
        visitsRevenue: 0,
        retailRevenue: 0,
        otherIncome: 0,
        expensesTotal: 0,
      }))
    const plan = make()
    const fact = make()
    for (const v of visits) {
      const d = new Date(v.visit_at)
      if (d.getFullYear() !== year) continue
      const m = d.getMonth()
      const amt = v.amount_cents - v.discount_cents + v.tip_cents
      plan[m]!.visitsRevenue += amt
      if (v.status === 'paid') fact[m]!.visitsRevenue += amt
    }
    for (const v of retailSales) {
      const d = new Date(v.visit_at)
      if (d.getFullYear() !== year) continue
      const m = d.getMonth()
      const amt = v.amount_cents - v.discount_cents + v.tip_cents
      plan[m]!.retailRevenue += amt
      if (v.status === 'paid') fact[m]!.retailRevenue += amt
    }
    for (const oi of otherIncomes) {
      const d = new Date(oi.income_at)
      if (d.getFullYear() !== year) continue
      plan[d.getMonth()]!.otherIncome += oi.amount_cents
      fact[d.getMonth()]!.otherIncome += oi.amount_cents
    }
    for (const e of expenses) {
      const d = new Date(e.expense_at)
      if (d.getFullYear() !== year) continue
      plan[d.getMonth()]!.expensesTotal += e.amount_cents
      fact[d.getMonth()]!.expensesTotal += e.amount_cents
    }
    for (const sp of scheduledPayments) {
      if (sp.status === 'paid') continue // уже учтено через paid_expense_id
      const d = new Date(sp.due_date)
      if (d.getFullYear() !== year) continue
      plan[d.getMonth()]!.expensesTotal += sp.amount_cents
    }
    return { plan, fact }
  }, [visits, retailSales, otherIncomes, expenses, scheduledPayments, year])

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

  // Категории расходов которые НЕ matched в settings.fixed/variable/taxes —
  // их юзер ввёл сам в /settings/expenses-catalog или через ExpenseFormModal.
  // Без этого блока такие расходы появлялись только в общей сумме «Расходы»,
  // без разбивки. Group key `expenses_other`.
  const otherExpenseCategories = useMemo<Array<{ label: string; values: number[] }>>(() => {
    const presetLabels = new Set<string>()
    for (const it of settings.fixed.items) if (!it.archived) presetLabels.add(normName(it.label))
    for (const it of settings.variable.items) if (!it.archived) presetLabels.add(normName(it.label))
    for (const it of settings.taxes.items) if (!it.archived) presetLabels.add(normName(it.label))
    const result: Array<{ label: string; values: number[] }> = []
    for (const cat of expenseCategories) {
      const key = normName(cat.name)
      if (presetLabels.has(key)) continue
      const arr = factByLabel.get(key)
      if (!arr || arr.every((v) => v === 0)) continue
      result.push({ label: cat.name, values: arr })
    }
    return result.sort(
      (a, b) => b.values.reduce((s, v) => s + v, 0) - a.values.reduce((s, v) => s + v, 0),
    )
  }, [expenseCategories, factByLabel, settings])

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
    // % от выручки считаем от ПЛАНОВОЙ (все визиты), а fact = от реальной paid.
    return monthly.plan.map((m) => Math.round(((m.visitsRevenue + m.otherIncome) * pct) / 100))
  }

  // Plan: все визиты (paid + pending) + расходы + scheduled.
  // Fact: только paid визиты + actual expenses (= таблица expenses).
  const visitsByMonthPlan = monthly.plan.map((m) => m.visitsRevenue)
  const visitsByMonth = monthly.fact.map((m) => m.visitsRevenue)
  const retailByMonthPlan = monthly.plan.map((m) => m.retailRevenue)
  const retailByMonth = monthly.fact.map((m) => m.retailRevenue)
  const otherIncomeMonthly = settings.other_income.items
    .filter((i) => !i.archived)
    .reduce((acc, i) => acc + monthlyEquivalentCents(i), 0)
  const otherIncomeByMonthPlan = monthly.plan.map((m) => m.otherIncome + otherIncomeMonthly)
  const otherIncomeByMonth = monthly.fact.map((m) => m.otherIncome + otherIncomeMonthly)
  const revenueByMonthPlan = visitsByMonthPlan.map(
    (v, i) => v + (retailByMonthPlan[i] ?? 0) + (otherIncomeByMonthPlan[i] ?? 0),
  )
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
  // Plan-колонка теперь = РЕАЛЬНЫЕ данные периода (все визиты, paid+pending).
  // Fact-колонка = только paid визиты. Просьба юзера (21.05): «если есть
  // визит — показывай его в плане независимо от статуса».
  const rows: CellRow[] = [
    {
      label: t('finance.report.revenue'),
      values: revenueByMonthPlan,
      factValues: revenueByMonth,
      bold: true,
      color: 'sage',
      groupKey: 'revenue',
    },
    {
      label: t('finance.report.revenue_services'),
      values: visitsByMonthPlan,
      factValues: visitsByMonth,
      indent: 1,
      parentGroupKey: 'revenue',
    },
    {
      label: t('finance.report.revenue_retail'),
      values: retailByMonthPlan,
      factValues: retailByMonth,
      indent: 1,
      parentGroupKey: 'revenue',
      groupKey: 'retail',
    },
    ...Array.from(retailByCategory.entries()).map(([cat, factArr]) => ({
      label: cat,
      values: factArr, // план = факт для retail категорий (нет pending retail визитов обычно)
      factValues: factArr,
      indent: 2,
      parentGroupKey: 'retail',
    })),
    {
      label: t('finance.report.revenue_other'),
      values: otherIncomeByMonthPlan,
      factValues: monthly.fact.map((m) => m.otherIncome),
      indent: 1,
      parentGroupKey: 'revenue',
      groupKey: 'revenue_other',
    },
    ...buildOtherIncomeCategoryRows(otherIncomeCats, otherIncomesByCategory, t),

    {
      label: t('finance.report.expenses_total'),
      // План: ожидаемые (settings.variable% + fixed + taxes) + scheduled
      // из БД. Факт: реальные expenses из БД.
      values: expensesTotalByMonth.map((v, i) => -(v + (monthly.plan[i]?.expensesTotal ?? 0))),
      factValues: monthly.fact.map((m) => -m.expensesTotal),
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

    // «Прочие категории» — expense_categories из БД, которых нет в
    // settings.fixed/variable/taxes. Без них custom-категории были не
    // видны в раскрытии расходов (фикс по запросу image #57).
    ...(otherExpenseCategories.length > 0
      ? [
          {
            label: t('finance.report.expenses_other', { defaultValue: 'Прочие категории' }),
            values: otherExpenseCategories.reduce(
              (acc: number[], cat) => acc.map((v, i) => v - (cat.values[i] ?? 0)),
              Array.from({ length: 12 }, () => 0),
            ),
            indent: 1,
            bold: true,
            color: 'destructive' as RowColor,
            groupKey: 'expenses_other',
            parentGroupKey: 'expenses',
          },
          ...otherExpenseCategories.map((cat) => ({
            label: cat.label,
            values: cat.values.map((v) => -v),
            indent: 2,
            parentGroupKey: 'expenses_other',
          })),
        ]
      : []),

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

      {/* ===== UNIFIED TABLE CARD =====
          Один контейнер overflow-auto: горизонтальный скролл синхронизируется
          автоматически между блоками, плюс sticky-thead работает относительно
          этого же контейнера. max-h ограничивает высоту чтобы скролл был
          внутри карточки, а не страницы (иначе sticky не работал бы как
          надо). При печати ограничения снимаются. */}
      <div className="shadow-finmd overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="max-h-[calc(100vh-220px)] overflow-auto print:max-h-none print:overflow-visible">
          <BlockSection
            title={t('finance.report.title')}
            icon={<BarChart3 className="size-4" strokeWidth={1.8} />}
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
          </BlockSection>

          <BlockSection
            title={t('finance.report.end_balance_by_register')}
            icon={<Wallet className="size-4" strokeWidth={1.8} />}
          >
            <CashRegistersTable
              year={year}
              months={months}
              currentMonthIdx={currentMonthIdx}
              registers={settings.cash_registers.items.filter((i) => !i.archived)}
              monthlyRegBalances={monthlyRegBalances}
              currency={currency}
              t={t}
            />
          </BlockSection>

          <BlockSection
            title={t('finance.report.section_balance')}
            icon={<Landmark className="size-4" strokeWidth={1.8} />}
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
          </BlockSection>
        </div>
      </div>
    </div>
  )
}

// ============================ BlockSection ============================

/**
 * Блок внутри единой финансовой карточки. Title-bar и `<thead>` обоих
 * вложенных компонентов (ReportTable / CashRegistersTable) — sticky-top.
 *
 * Sticky-handoff между блоками работает за счёт того, что title-bar и
 * thead — sticky **внутри своего `<section>`** (containing block). Когда
 * контейнер пролистывается до низа section'а, sticky-элементы упираются в
 * нижнюю границу своего section'а и уходят вверх вместе с ним; в то же
 * время следующий section появляется со своим sticky title bar.
 *
 * `min-w-max` нужен, чтобы header strip растягивался на всю ширину
 * вложенной таблицы (когда таблица шире контейнера).
 */
function BlockSection({
  title,
  icon,
  children,
}: {
  title: string
  icon: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="min-w-max border-t border-slate-200 first:border-t-0">
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-slate-50">
        <div className="sticky left-0 inline-flex items-center gap-2.5 px-4 py-2.5">
          <span className="rounded-md bg-slate-900 p-1.5 text-amber-300">{icon}</span>
          <h3 className="text-sm font-semibold tracking-tight text-slate-800">{title}</h3>
        </div>
      </header>
      {children}
    </section>
  )
}

/**
 * Общий colgroup для всех трёх таблиц — 27 колонок одинаковой ширины:
 *   1 (Label, 220px) + 2 (Итого План|Факт, 110px × 2) + 12*2 (Month P|F, 110px × 2)
 *
 * Ширина 110px рассчитана так, чтобы «144 794,73 PLN» (~12 символов с пробелами
 * через формат полировки чисел) помещалась в ячейку с небольшим padding.
 * Меньше — контент будет шире `<col>` и таблица растянет колонку под контент,
 * сломав alignment между блоками (в Балансе пустые «—», в Финотчёте длинные
 * числа → колонки 05/26 не совпадают по X-позиции).
 *
 * В кассе каждый месяц занимает `colSpan={2}` чтобы попасть в обе подколонки.
 */
const COL_LABEL_W = 220
const COL_SUB_W = 130
const TABLE_MIN_W = COL_LABEL_W + COL_SUB_W * 2 + COL_SUB_W * 2 * 12 // = 3600

function SharedColGroup({ months }: { months: number[] }) {
  return (
    <colgroup>
      <col style={{ width: COL_LABEL_W }} />
      <col style={{ width: COL_SUB_W }} />
      <col style={{ width: COL_SUB_W }} />
      {months.map((m) => (
        <Fragment key={m}>
          <col style={{ width: COL_SUB_W }} />
          <col style={{ width: COL_SUB_W }} />
        </Fragment>
      ))}
    </colgroup>
  )
}

// ============================ CashRegistersTable ============================

function CashRegistersTable({
  year,
  months,
  currentMonthIdx,
  registers,
  monthlyRegBalances,
  currency,
  t,
}: {
  year: number
  months: number[]
  currentMonthIdx: number
  registers: { id: string; label?: string | null; amount_cents?: number | null }[]
  monthlyRegBalances: Map<string, number[]>
  currency: string
  t: (k: string) => string
}) {
  return (
    <table className="border-collapse text-xs" style={{ tableLayout: 'fixed', width: TABLE_MIN_W }}>
      <SharedColGroup months={months} />
      <thead>
        <tr className="bg-slate-100 text-slate-600">
          <th className="sticky left-0 top-[44px] z-40 border-b border-r border-slate-200 bg-slate-100 px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider">
            {t('finance.report.end_balance_by_register')}
          </th>
          <th
            colSpan={2}
            className="sticky top-[44px] z-30 border-b border-l border-slate-200 bg-slate-200 px-2 py-2.5 text-right text-[10px] font-semibold uppercase tracking-wider"
          >
            {t('finance.report.col_start')}
          </th>
          {months.map((m) => (
            <th
              key={m}
              colSpan={2}
              className={`sticky top-[44px] z-30 border-b border-l border-slate-200 px-2 py-2.5 text-right text-[10px] font-semibold uppercase capitalize tracking-wider ${
                m === currentMonthIdx ? 'bg-amber-100 text-amber-900' : 'bg-slate-100'
              }`}
            >
              {format(startOfMonth(new Date(year, m, 1)), 'MM/yy', { locale: ru })}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {registers.map((reg, idx) => {
          const monthlyBalances = monthlyRegBalances.get(reg.id) ?? []
          const zebraBg = idx % 2 === 1 ? 'bg-slate-50' : 'bg-white'
          return (
            <tr key={reg.id} className={`border-t border-slate-100 ${zebraBg}`}>
              <td
                className={`sticky left-0 z-20 border-r border-slate-200 px-3 py-2 font-medium text-slate-800 ${zebraBg}`}
              >
                {reg.label || '—'}
              </td>
              <td
                colSpan={2}
                className="num border-l border-slate-200 bg-slate-50 px-2 py-2 text-right font-semibold text-slate-600"
              >
                {formatNumberSafe(reg.amount_cents ?? 0, currency)}
              </td>
              {months.map((m) => (
                <td
                  key={m}
                  colSpan={2}
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
    <table className="border-collapse text-xs" style={{ tableLayout: 'fixed', width: TABLE_MIN_W }}>
      <SharedColGroup months={months} />
      <thead>
        {/* Row 1 — Параметр (rowSpan=2) + месяцы (colSpan=2). Sticky top=44px
            (под title bar блока). Все sticky-ячейки имеют непрозрачный bg,
            чтобы скроллящиеся под них цифры не просвечивали. */}
        <tr className="text-slate-600">
          <th
            rowSpan={2}
            className="sticky left-0 top-[44px] z-40 border-b border-r border-slate-200 bg-slate-100 px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider"
          >
            {t('finance.report.col_row')}
          </th>
          <th
            colSpan={2}
            className="sticky top-[44px] z-30 border-b border-l border-slate-200 bg-slate-200 px-2 py-2 text-center text-[10px] font-semibold uppercase tracking-wider"
          >
            {t('finance.report.col_total')}
          </th>
          {months.map((m) => (
            <th
              key={m}
              colSpan={2}
              className={`sticky top-[44px] z-30 border-b border-l border-slate-200 px-2 py-2 text-center text-[10px] font-semibold uppercase capitalize tracking-wider ${
                m === currentMonthIdx ? 'bg-amber-100 text-amber-900' : 'bg-slate-100'
              }`}
            >
              {format(startOfMonth(new Date(year, m, 1)), 'MM/yy', { locale: ru })}
            </th>
          ))}
        </tr>
        {/* Row 2 — План|Факт sub-headers. Sticky top=72px (44px + ~28px row1). */}
        <tr className="text-slate-500">
          <th className="sticky top-[72px] z-30 border-b border-l border-slate-200 bg-slate-200 px-2 py-1 text-right text-[9px] font-medium uppercase">
            {t('finance.report.col_plan')}
          </th>
          <th className="sticky top-[72px] z-30 border-b border-slate-200 bg-slate-200 px-2 py-1 text-right text-[9px] font-medium uppercase">
            {t('finance.report.col_fact')}
          </th>
          {months.map((m) => (
            <Fragment key={m}>
              <th
                className={`sticky top-[72px] z-30 border-b border-l border-slate-200 px-2 py-1 text-right text-[9px] font-medium uppercase ${
                  m === currentMonthIdx ? 'bg-amber-50 text-amber-800' : 'bg-slate-50'
                }`}
              >
                {t('finance.report.col_plan')}
              </th>
              <th
                className={`sticky top-[72px] z-30 border-b border-slate-200 px-2 py-1 text-right text-[9px] font-medium uppercase ${
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
          // секций имеют свой groupBg. Все backgrounds непрозрачные — иначе
          // через sticky-колонку label просвечивают скроллящиеся цифры.
          const zebra = !row.bold && idx % 2 === 1 ? 'bg-slate-50' : 'bg-white'
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
