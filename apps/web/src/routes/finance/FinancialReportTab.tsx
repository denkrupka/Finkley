import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { format, startOfMonth } from 'date-fns'
import {
  BarChart3,
  ChevronDown,
  ChevronRight,
  Download,
  FileSpreadsheet,
  FileText,
  Maximize2,
  Minimize2,
  Wallet,
} from 'lucide-react'
import { Fragment, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import {
  buildMonthCols,
  periodToRange,
  type MonthCol,
  type PeriodValue,
} from '@/components/ui/period-picker-utils'
import { PeriodPickerPopover } from '@/components/ui/PeriodPickerPopover'
import { getDateLocale } from '@/lib/utils/format-date'
import { useExpenseCategories, useExpenses } from '@/hooks/useExpenses'
import {
  DEFAULT_FINANCIAL_SETTINGS,
  monthlyEquivalentCents,
  useFinancialSettings,
  type FinancialSettings,
  type ParameterItem,
} from '@/hooks/useFinancialSettings'
import { useRegisterBalancesAtMonthEnds } from '@/hooks/useCashTransfers'
import { useInventoryItems } from '@/hooks/useInventory'
import {
  effectiveReceivedFromOtherIncome,
  useOtherIncomeCategories,
  useOtherIncomes,
} from '@/hooks/useOtherIncomes'
import { useIsVatPayer } from '@/hooks/useIsVatPayer'
import { useSalon } from '@/hooks/useSalons'
import { computeNet } from '@/lib/utils/vat'
import { useScheduledPayments } from '@/hooks/useScheduledPayments'
import { effectiveReceivedFromVisit, useVisits } from '@/hooks/useVisits'
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
  // Если фирма — плательщик VAT, P&L считается в НЕТТО (по запросу юзера).
  // НДС-баланс месяца (income_vat − expense_vat) идёт отдельной строкой
  // «НДС к оплате» в расходы (positive = долг, negative = переплата для
  // следующего месяца).
  const isVatPayer = useIsVatPayer(salonId)

  // bug 2783fa9e — выбор периода (универсальный PeriodPickerPopover вместо
  // year-select). Таблица адаптируется под набор месяцев в диапазоне: 1 месяц
  // → 1 колонка + Итого; year → 12 колонок; range на 2 года → все месяцы.
  const currentYear = new Date().getFullYear()
  const [period, setPeriod] = useState<PeriodValue>(() => ({ kind: 'year', year: currentYear }))
  const range = useMemo(() => periodToRange(period), [period])
  const monthCols = useMemo(() => buildMonthCols(range.start, range.end), [range.start, range.end])
  const colCount = monthCols.length

  // Индекс в monthCols по (year, monthIdx). Используется для bucket-агрегации
  // визитов/расходов/доходов в колонки таблицы.
  const monthColIndex = useMemo(() => {
    const m = new Map<string, number>()
    monthCols.forEach((c, i) => m.set(`${c.year}-${c.monthIdx}`, i))
    return m
  }, [monthCols])

  const visitsRange = useMemo(
    () => ({ start: range.start.toISOString(), end: range.end.toISOString() }),
    [range.start, range.end],
  )
  const expensesRange = useMemo(
    () => ({
      start: format(range.start, 'yyyy-MM-dd'),
      end: format(range.end, 'yyyy-MM-dd'),
    }),
    [range.start, range.end],
  )

  const { data: visits = [] } = useVisits(salonId, visitsRange, { kind: 'visit' })
  const { data: retailSales = [] } = useVisits(salonId, visitsRange, { kind: 'retail' })
  const { data: otherIncomes = [] } = useOtherIncomes(salonId, {
    start: range.start,
    end: range.end,
  })
  const { data: expenses = [] } = useExpenses(salonId, expensesRange)
  const { data: scheduledPayments = [] } = useScheduledPayments(salonId)
  const { data: expenseCategories = [] } = useExpenseCategories(salonId)
  const { data: inventory = [] } = useInventoryItems(salonId, { includeArchived: true })
  const { data: otherIncomeCats = [] } = useOtherIncomeCategories(salonId, {
    includeArchived: true,
  })
  const { data: monthlyRegBalances } = useRegisterBalancesAtMonthEnds(salonId, monthCols)

  // Семантика двух колонок (запрос юзера 21.05):
  //   План = ВСЕ записи периода (paid + pending визиты, expenses + scheduled).
  //   Факт = только фактически оплаченные (visits.status='paid', expenses
  //          — таблица содержит только paid, scheduled НЕ учитываем).
  const monthly = useMemo(() => {
    const make = () =>
      Array.from({ length: colCount }, () => ({
        visitsRevenue: 0,
        retailRevenue: 0,
        otherIncome: 0,
        expensesTotal: 0,
      }))
    const plan = make()
    const fact = make()
    // VAT tracking: суммы НДС с доходов и расходов отдельно для подсчёта
    // НДС к оплате (computeVatPayable) когда isVatPayer=true.
    const vatIncome = Array.from({ length: colCount }, () => 0)
    const vatExpense = Array.from({ length: colCount }, () => 0)

    /**
     * Возвращает нетто-эквивалент брутто-суммы для конкретной строки.
     * Если строка имеет vat_rate_pct, считаем нетто из брутто по этой
     * ставке. Если rate=null или isVatPayer=false → брутто как есть.
     * Также возвращает vat_cents для накопления в income/expense VAT.
     */
    const toNet = (
      grossCents: number,
      ratePct: number | null | undefined,
      vatSkipped?: boolean | null,
    ): { net: number; vat: number } => {
      if (!isVatPayer || vatSkipped || ratePct == null || ratePct === 0) {
        return { net: grossCents, vat: 0 }
      }
      const net = computeNet(grossCents, ratePct)
      return { net, vat: Math.max(0, grossCents - net) }
    }

    const getIdx = (d: Date): number =>
      monthColIndex.get(`${d.getFullYear()}-${d.getMonth()}`) ?? -1
    for (const v of visits) {
      const m = getIdx(new Date(v.visit_at))
      if (m < 0) continue
      const planAmt = v.amount_cents - v.discount_cents + v.tip_cents
      const { net: planNet, vat: planVat } = toNet(planAmt, v.vat_rate_pct, v.vat_skipped)
      plan[m]!.visitsRevenue += planNet
      if (v.status === 'paid') {
        const factGross = effectiveReceivedFromVisit(v)
        const { net: factNet, vat: factVat } = toNet(factGross, v.vat_rate_pct, v.vat_skipped)
        fact[m]!.visitsRevenue += factNet
        vatIncome[m]! += factVat
        void planVat
      }
    }
    for (const v of retailSales) {
      const m = getIdx(new Date(v.visit_at))
      if (m < 0) continue
      const planAmt = v.amount_cents - v.discount_cents + v.tip_cents
      const { net: planNet } = toNet(planAmt, v.vat_rate_pct, v.vat_skipped)
      plan[m]!.retailRevenue += planNet
      if (v.status === 'paid') {
        const factGross = effectiveReceivedFromVisit(v)
        const { net: factNet, vat: factVat } = toNet(factGross, v.vat_rate_pct, v.vat_skipped)
        fact[m]!.retailRevenue += factNet
        vatIncome[m]! += factVat
      }
    }
    for (const oi of otherIncomes) {
      const m = getIdx(new Date(oi.income_at))
      if (m < 0) continue
      const { net: planNet } = toNet(oi.amount_cents, oi.vat_rate_pct, oi.vat_skipped)
      plan[m]!.otherIncome += planNet
      const factGross = effectiveReceivedFromOtherIncome(oi)
      const { net: factNet, vat: factVat } = toNet(factGross, oi.vat_rate_pct, oi.vat_skipped)
      fact[m]!.otherIncome += factNet
      vatIncome[m]! += factVat
    }
    for (const e of expenses) {
      const m = getIdx(new Date(e.expense_at))
      if (m < 0) continue
      const { net, vat } = toNet(e.amount_cents, e.vat_rate_pct)
      fact[m]!.expensesTotal += net
      vatExpense[m]! += vat
    }
    for (const sp of scheduledPayments) {
      if (sp.status === 'paid') continue
      const m = getIdx(new Date(sp.due_date))
      if (m < 0) continue
      const { net } = toNet(sp.amount_cents, sp.vat_rate_pct)
      plan[m]!.expensesTotal += net
    }
    const monthlyBudgetCents = sumFixedCents(settings) + sumTaxesCents(settings)
    if (monthlyBudgetCents > 0) {
      for (let m = 0; m < colCount; m++) {
        plan[m]!.expensesTotal += monthlyBudgetCents
      }
    }
    return { plan, fact, vatIncome, vatExpense }
  }, [
    visits,
    retailSales,
    otherIncomes,
    expenses,
    scheduledPayments,
    settings,
    colCount,
    monthColIndex,
    isVatPayer,
  ])

  const factByLabel = useMemo<Map<string, number[]>>(() => {
    const catNameById = new Map<string, string>()
    for (const c of expenseCategories) catNameById.set(c.id, normName(c.name))
    const map = new Map<string, number[]>()
    for (const e of expenses) {
      if (!e.category_id) continue
      const name = catNameById.get(e.category_id)
      if (!name) continue
      const d = new Date(e.expense_at)
      const idx = monthColIndex.get(`${d.getFullYear()}-${d.getMonth()}`)
      if (idx == null) continue
      const arr = map.get(name) ?? Array.from({ length: colCount }, () => 0)
      arr[idx]! += e.amount_cents
      map.set(name, arr)
    }
    return map
  }, [expenses, expenseCategories, colCount, monthColIndex])

  function factsForLabel(label: string): number[] {
    return factByLabel.get(normName(label)) ?? Array.from({ length: colCount }, () => 0)
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
      const idx = monthColIndex.get(`${d.getFullYear()}-${d.getMonth()}`)
      if (idx == null) continue
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
      const arr = map.get(key) ?? Array.from({ length: colCount }, () => 0)
      arr[idx]! += effectiveReceivedFromVisit(v)
      map.set(key, arr)
    }
    return map
  }, [retailSales, inventory, colCount, monthColIndex, t])

  const otherIncomesByCategory = useMemo<Map<string, number[]>>(() => {
    const map = new Map<string, number[]>()
    for (const oi of otherIncomes) {
      const d = new Date(oi.income_at)
      const idx = monthColIndex.get(`${d.getFullYear()}-${d.getMonth()}`)
      if (idx == null) continue
      const key = oi.category_id ?? '__none__'
      const arr = map.get(key) ?? Array.from({ length: colCount }, () => 0)
      arr[idx]! += effectiveReceivedFromOtherIncome(oi)
      map.set(key, arr)
    }
    return map
  }, [otherIncomes, colCount, monthColIndex])

  // bug 3a000612 — fullscreen toggle для отчёта (юзеру удобнее смотреть
  // широкую таблицу на весь viewport, без sidebar/header).
  const [fullscreen, setFullscreen] = useState(false)
  // bug c2a57e1b — drill-down модалка с детализацией клика по «итого»
  const [drillDownRow, setDrillDownRow] = useState<CellRow | null>(null)

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

  // Индекс текущего календарного месяца в monthCols (-1 если не входит в период).
  const now = new Date()
  const currentMonthIdx = monthColIndex.get(`${now.getFullYear()}-${now.getMonth()}`) ?? -1

  function constant(value: number) {
    return Array.from({ length: colCount }, () => value)
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
  const expensesTotalByMonth = Array.from(
    { length: colCount },
    (_, i) => (variableByMonth[i] ?? 0) + (fixedByMonth[i] ?? 0) + (taxesByMonth[i] ?? 0),
  )

  const investmentsByMonth = Array.from({ length: colCount }, (_, i) =>
    i === currentMonthIdx ? investmentsTotal : 0,
  )
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
    // settings.fixed/variable/taxes. Bug e007ea97: эти строки рисовались
    // в plan-колонке, fact-колонка оставалась пустой → юзер видел расход
    // на аренду в реестре, но не видел его в «Факт» отчёта. Теперь:
    // values (план) = нули, factValues = реальные расходы.
    ...(otherExpenseCategories.length > 0
      ? [
          {
            label: t('finance.report.expenses_other'),
            values: Array.from({ length: 12 }, () => 0),
            factValues: otherExpenseCategories.reduce(
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
            values: Array.from({ length: 12 }, () => 0),
            factValues: cat.values.map((v) => -v),
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

    // T6 — строка «Корректировки» (баланс системной кассы Корректировки
    // на конец каждого месяца). Не складывается с Сальдо за период —
    // информационная: показывает текущее накопление расхождений.
    ...(() => {
      const adj = settings.cash_registers.items.find((i) => i.preset_key === 'adjustments')
      if (!adj) return []
      const balances = monthlyRegBalances.get(adj.id) ?? Array.from({ length: colCount }, () => 0)
      return [
        {
          label: t('finance.report.adjustments', { defaultValue: 'Корректировки' }) as string,
          values: balances,
          factValues: balances,
          bold: true,
          color: 'navy' as RowColor,
        },
      ]
    })(),

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
    colCount,
  )

  const yearTotal = (vals: number[]) => vals.reduce((s, v) => s + v, 0)

  /** Один источник истины для табличного экспорта. CSV/XLSX используют
   *  одинаковую структуру (delimiter ; — Excel правильно открывает локалью
   *  ru/pl). XLSX-mime говорит Excel'у открыть файл сразу как книгу. */
  function buildTableCsv(): string {
    const headers = [
      t('finance.report.col_row'),
      t('finance.report.col_total'),
      ...monthCols.map((c) =>
        format(startOfMonth(new Date(c.year, c.monthIdx, 1)), 'MM/yy', { locale: getDateLocale() }),
      ),
    ]
    const lines = [headers.join(';')]
    for (const row of [...rows, ...balanceRows]) {
      const cells = [row.label, yearTotal(row.values), ...row.values]
      lines.push(
        cells.map((c) => (typeof c === 'number' ? (c / 100).toFixed(2) : `"${c}"`)).join(';'),
      )
    }
    return '﻿' + lines.join('\n')
  }
  function downloadBlob(data: string, mime: string, ext: string) {
    const blob = new Blob([data], { type: mime })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    const firstCol = monthCols[0]
    const lastCol = monthCols[monthCols.length - 1]
    a.download =
      firstCol && lastCol
        ? `financial-report-${firstCol.key}_${lastCol.key}.${ext}`
        : `financial-report.${ext}`
    a.click()
    URL.revokeObjectURL(url)
  }
  function exportCsv() {
    downloadBlob(buildTableCsv(), 'text/csv;charset=utf-8', 'csv')
  }
  /** Реальный xlsx-совместимый файл через Excel 2003 XML (SpreadsheetML).
   *  Excel/LibreOffice открывают его как полноценную книгу — без warning'а
   *  «file format doesn't match extension», который был при CSV-с-MIME.
   *  Не тащим xlsx-lib (≈800KB) и не пишем ZIP — используем XML, который
   *  Office понимает с 2003. */
  function buildSpreadsheetMlXml(): string {
    const headers = [
      t('finance.report.col_row'),
      t('finance.report.col_total'),
      ...monthCols.map((c) =>
        format(startOfMonth(new Date(c.year, c.monthIdx, 1)), 'MM/yy', { locale: getDateLocale() }),
      ),
    ]
    const esc = (s: string) =>
      s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    const cellStr = (s: string) => `<Cell><Data ss:Type="String">${esc(s)}</Data></Cell>`
    const cellNum = (n: number) =>
      `<Cell><Data ss:Type="Number">${(n / 100).toFixed(2)}</Data></Cell>`
    const rowsXml: string[] = []
    rowsXml.push('<Row>' + headers.map(cellStr).join('') + '</Row>')
    for (const row of [...rows, ...balanceRows]) {
      const cells = [cellStr(row.label), cellNum(yearTotal(row.values)), ...row.values.map(cellNum)]
      rowsXml.push('<Row>' + cells.join('') + '</Row>')
    }
    return `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
  <Worksheet ss:Name="Report">
    <Table>
      ${rowsXml.join('\n      ')}
    </Table>
  </Worksheet>
</Workbook>`
  }
  function exportXlsx() {
    downloadBlob(buildSpreadsheetMlXml(), 'application/vnd.ms-excel', 'xls')
  }
  function exportPdf() {
    // PDF в браузере = «Печать → Сохранить как PDF» (CSS @media print
    // настроен в globals.css так, что app-chrome скрывается).
    window.print()
  }

  const visibleMainRows = rows.filter(
    (row) => !(row.parentGroupKey && collapsed.has(row.parentGroupKey)),
  )
  // bug fec22f39 — visibleBalanceRows был для удалённого блока «Баланс».
  // balanceRows pop'нут в exportCsv ниже, поэтому helper переменную не пишем.

  return (
    <div
      className={
        fullscreen ? 'bg-background fixed inset-0 z-50 space-y-3 overflow-auto p-5' : 'space-y-5'
      }
    >
      {/* ===== TOP TOOLBAR ===== */}
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-brand-navy text-lg font-bold tracking-tight">
            {t('finance.report.title')}
          </h2>
          <p className="text-muted-foreground mt-1 text-sm">{t('finance.report.subtitle')}</p>
        </div>
        <div className="flex flex-nowrap items-center gap-2 print:hidden">
          {/* Скачать ▾ — Excel (xlsx) / CSV / PDF. */}
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <Button variant="outline" size="md">
                <Download className="size-4" strokeWidth={1.8} />
                {t('finance.report.download', { defaultValue: 'Скачать' })}
                <ChevronDown className="size-3.5" strokeWidth={2} />
              </Button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content
                align="start"
                sideOffset={6}
                className="border-border bg-popover text-popover-foreground shadow-finmd z-50 min-w-[180px] overflow-hidden rounded-md border"
              >
                <DropdownMenu.Item
                  onSelect={() => exportXlsx()}
                  className="hover:bg-muted focus:bg-muted flex cursor-pointer items-center gap-2 px-3 py-2 text-sm outline-none"
                >
                  <FileSpreadsheet
                    className="size-4 text-emerald-600 dark:text-emerald-300"
                    strokeWidth={1.8}
                  />
                  {t('finance.report.download_xlsx', { defaultValue: 'Excel' })}
                </DropdownMenu.Item>
                <DropdownMenu.Item
                  onSelect={() => exportCsv()}
                  className="hover:bg-muted focus:bg-muted flex cursor-pointer items-center gap-2 px-3 py-2 text-sm outline-none"
                >
                  <FileText className="size-4 text-sky-600 dark:text-sky-300" strokeWidth={1.8} />
                  {t('finance.report.download_csv', { defaultValue: 'CSV' })}
                </DropdownMenu.Item>
                <DropdownMenu.Item
                  onSelect={() => exportPdf()}
                  className="hover:bg-muted focus:bg-muted flex cursor-pointer items-center gap-2 px-3 py-2 text-sm outline-none"
                >
                  <FileText className="size-4 text-rose-600 dark:text-rose-300" strokeWidth={1.8} />
                  {t('finance.report.download_pdf', { defaultValue: 'PDF' })}
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>

          {/* Период (PeriodPickerPopover) */}
          <PeriodPickerPopover value={period} onChange={setPeriod} />

          {/* На весь экран — самой правой */}
          <Button
            variant="outline"
            size="icon"
            onClick={() => setFullscreen((v) => !v)}
            aria-label={
              fullscreen
                ? t('finance.report.exit_fullscreen', { defaultValue: 'Свернуть' })
                : t('finance.report.fullscreen', { defaultValue: 'На весь экран' })
            }
            title={
              fullscreen
                ? t('finance.report.exit_fullscreen', { defaultValue: 'Свернуть' })
                : t('finance.report.fullscreen', { defaultValue: 'На весь экран' })
            }
          >
            {fullscreen ? (
              <Minimize2 className="size-4" strokeWidth={1.8} />
            ) : (
              <Maximize2 className="size-4" strokeWidth={1.8} />
            )}
          </Button>
        </div>
      </header>

      {/* ===== UNIFIED TABLE CARD =====
          Один контейнер overflow-auto: горизонтальный скролл синхронизируется
          автоматически между блоками, плюс sticky-thead работает относительно
          этого же контейнера. max-h ограничивает высоту чтобы скролл был
          внутри карточки, а не страницы (иначе sticky не работал бы как
          надо). При печати ограничения снимаются. */}
      <div className="border-border bg-card shadow-finmd overflow-hidden rounded-xl border">
        <div
          className={`overflow-auto print:max-h-none print:overflow-visible ${
            fullscreen ? 'max-h-[calc(100vh-130px)]' : 'max-h-[calc(100vh-220px)]'
          }`}
        >
          <BlockSection
            title={t('finance.report.title')}
            icon={<BarChart3 className="size-4" strokeWidth={1.8} />}
          >
            <ReportTable
              monthCols={monthCols}
              currentMonthIdx={currentMonthIdx}
              rows={visibleMainRows}
              currency={currency}
              collapsed={collapsed}
              onToggle={toggleGroup}
              onDrillDown={setDrillDownRow}
              t={t}
            />
          </BlockSection>

          <BlockSection
            title={t('finance.report.end_balance_by_register')}
            icon={<Wallet className="size-4" strokeWidth={1.8} />}
          >
            <CashRegistersTable
              monthCols={monthCols}
              currentMonthIdx={currentMonthIdx}
              registers={settings.cash_registers.items.filter(
                (i) => !i.archived && i.preset_key !== 'adjustments',
              )}
              monthlyRegBalances={monthlyRegBalances}
              currency={currency}
              t={t}
            />
          </BlockSection>

          {/* bug fec22f39 — блок «Баланс» удалён из «Отчёта по прибыли».
              Балансы и Cash-flow остаются в отдельном табе ДДС. */}
        </div>
      </div>

      {/* bug c2a57e1b — drill-down модалка для итогов */}
      <DrillDownDialog
        row={drillDownRow}
        currency={currency}
        monthCols={monthCols}
        onClose={() => setDrillDownRow(null)}
        t={t}
      />
    </div>
  )
}

// ============================ DrillDownDialog ============================

function DrillDownDialog({
  row,
  currency,
  monthCols,
  onClose,
  t,
}: {
  row: CellRow | null
  currency: string
  monthCols: MonthCol[]
  onClose: () => void
  t: (k: string, opts?: Record<string, unknown>) => string
}) {
  if (!row) return null
  const planTotal = row.values.reduce((s, v) => s + v, 0)
  const factTotal = (row.factValues ?? []).reduce((s, v) => s + v, 0)
  const monthNames = monthCols.map((c) =>
    format(new Date(c.year, c.monthIdx, 1), 'LLL yy', { locale: getDateLocale() }),
  )
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="bg-card shadow-finmd w-full max-w-2xl rounded-xl p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h3 className="text-brand-navy text-lg font-bold">{row.label}</h3>
            <p className="text-muted-foreground mt-1 text-xs">
              {t('finance.report.drill_subtitle', {
                defaultValue: 'Разбивка по месяцам — план vs факт',
              })}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground rounded-md p-1 text-xl leading-none"
          >
            ×
          </button>
        </div>
        <div className="bg-muted/30 mb-4 grid grid-cols-2 gap-3 rounded-md p-3 text-sm">
          <div>
            <p className="text-muted-foreground text-[10.5px] uppercase tracking-wider">
              {t('finance.report.drill_plan_total', { defaultValue: 'Итого план' })}
            </p>
            <p className="num text-foreground text-lg font-bold">
              {formatCurrency(Math.abs(planTotal), currency)}
            </p>
          </div>
          <div>
            <p className="text-muted-foreground text-[10.5px] uppercase tracking-wider">
              {t('finance.report.drill_fact_total', { defaultValue: 'Итого факт' })}
            </p>
            <p className="num text-foreground text-lg font-bold">
              {formatCurrency(Math.abs(factTotal), currency)}
            </p>
          </div>
        </div>
        <table className="w-full text-xs">
          <thead>
            <tr className="text-muted-foreground border-border border-b text-left">
              <th className="py-2">{t('finance.report.drill_month', { defaultValue: 'Месяц' })}</th>
              <th className="num py-2 text-right">
                {t('finance.report.drill_plan', { defaultValue: 'План' })}
              </th>
              <th className="num py-2 text-right">
                {t('finance.report.drill_fact', { defaultValue: 'Факт' })}
              </th>
              <th className="num py-2 text-right">
                {t('finance.report.drill_diff', { defaultValue: 'Δ' })}
              </th>
            </tr>
          </thead>
          <tbody>
            {row.values.map((plan, i) => {
              const fact = row.factValues?.[i] ?? 0
              const diff = fact - plan
              return (
                <tr key={i} className="border-border/40 border-b last:border-b-0">
                  <td className="py-1.5">{monthNames[i]}</td>
                  <td className="num py-1.5 text-right">
                    {formatCurrency(Math.abs(plan), currency)}
                  </td>
                  <td className="num py-1.5 text-right">
                    {formatCurrency(Math.abs(fact), currency)}
                  </td>
                  <td
                    className={`num py-1.5 text-right font-semibold ${
                      diff > 0 ? 'text-brand-sage-deep' : diff < 0 ? 'text-destructive' : ''
                    }`}
                  >
                    {diff > 0 ? '+' : ''}
                    {formatCurrency(diff, currency)}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
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
    <section className="border-border min-w-max border-t first:border-t-0">
      <header className="border-border bg-muted/40 sticky top-0 z-40 border-b">
        <div className="sticky left-0 inline-flex items-center gap-2.5 px-4 py-2.5">
          <span className="rounded-md bg-slate-900 p-1.5 text-amber-300 dark:bg-slate-800 dark:text-amber-200">
            {icon}
          </span>
          <h3 className="text-foreground text-sm font-semibold tracking-tight">{title}</h3>
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
function tableMinW(colCount: number) {
  return COL_LABEL_W + COL_SUB_W * 2 + COL_SUB_W * 2 * colCount
}

function SharedColGroup({ monthCols }: { monthCols: MonthCol[] }) {
  return (
    <colgroup>
      <col style={{ width: COL_LABEL_W }} />
      <col style={{ width: COL_SUB_W }} />
      <col style={{ width: COL_SUB_W }} />
      {monthCols.map((c) => (
        <Fragment key={c.key}>
          <col style={{ width: COL_SUB_W }} />
          <col style={{ width: COL_SUB_W }} />
        </Fragment>
      ))}
    </colgroup>
  )
}

// ============================ CashRegistersTable ============================

function CashRegistersTable({
  monthCols,
  currentMonthIdx,
  registers,
  monthlyRegBalances,
  currency,
  t,
}: {
  monthCols: MonthCol[]
  currentMonthIdx: number
  registers: { id: string; label?: string | null; amount_cents?: number | null }[]
  monthlyRegBalances: Map<string, number[]>
  currency: string
  t: (k: string) => string
}) {
  return (
    <table
      className="border-collapse text-xs"
      style={{ tableLayout: 'fixed', width: tableMinW(monthCols.length) }}
    >
      <SharedColGroup monthCols={monthCols} />
      <thead>
        <tr className="bg-muted/60 text-muted-foreground">
          <th className="border-border bg-muted/60 sticky left-0 top-[44px] z-40 border-b border-r px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider">
            {t('finance.report.end_balance_by_register')}
          </th>
          <th
            colSpan={2}
            className="border-border bg-muted/40 sticky top-[44px] z-30 border-b border-l px-2 py-2.5 text-right text-[10px] font-semibold uppercase tracking-wider"
          >
            {t('finance.report.col_start')}
          </th>
          {monthCols.map((c, idx) => (
            <th
              key={c.key}
              colSpan={2}
              className={`border-border sticky top-[44px] z-30 border-b border-l px-2 py-2.5 text-right text-[10px] font-semibold uppercase capitalize tracking-wider ${
                idx === currentMonthIdx
                  ? 'bg-amber-100 text-amber-900 dark:bg-amber-500/20 dark:text-amber-200'
                  : 'bg-muted/60'
              }`}
            >
              {format(startOfMonth(new Date(c.year, c.monthIdx, 1)), 'MM/yy', {
                locale: getDateLocale(),
              })}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {registers.map((reg, idx) => {
          const monthlyBalances = monthlyRegBalances.get(reg.id) ?? []
          const zebraBg = idx % 2 === 1 ? 'bg-muted/20' : 'bg-card'
          return (
            <tr key={reg.id} className={`border-border/60 border-t ${zebraBg}`}>
              <td
                className={`border-border text-foreground sticky left-0 z-20 border-r px-3 py-2 font-medium ${zebraBg}`}
              >
                {reg.label || '—'}
              </td>
              <td
                colSpan={2}
                className="num border-border bg-muted/30 text-muted-foreground border-l px-2 py-2 text-right font-semibold"
              >
                {formatNumberSafe(reg.amount_cents ?? 0, currency)}
              </td>
              {monthCols.map((c, mi) => (
                <td
                  key={c.key}
                  colSpan={2}
                  className={`num border-border/60 text-foreground/80 border-l px-2 py-2 text-right ${
                    mi === currentMonthIdx ? 'bg-amber-50 dark:bg-amber-500/10' : ''
                  }`}
                >
                  {formatNumberSafe(monthlyBalances[mi] ?? 0, currency)}
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
  monthCols,
  currentMonthIdx,
  rows,
  currency,
  collapsed,
  onToggle,
  onDrillDown,
  t,
}: {
  monthCols: MonthCol[]
  currentMonthIdx: number
  rows: CellRow[]
  currency: string
  collapsed: Set<string>
  onToggle: (key: string) => void
  /** bug c2a57e1b — клик по «итого» открывает детализацию. */
  onDrillDown?: (row: CellRow) => void
  t: (k: string) => string
}) {
  const yearTotal = (vals: number[]) => vals.reduce((s, v) => s + v, 0)
  return (
    <table
      className="border-collapse text-xs"
      style={{ tableLayout: 'fixed', width: tableMinW(monthCols.length) }}
    >
      <SharedColGroup monthCols={monthCols} />
      <thead>
        {/* Row 1 — Параметр (rowSpan=2) + месяцы (colSpan=2). Sticky top=44px
            (под title bar блока). Все sticky-ячейки имеют непрозрачный bg,
            чтобы скроллящиеся под них цифры не просвечивали. */}
        <tr className="text-muted-foreground">
          <th
            rowSpan={2}
            className="border-border bg-muted/60 sticky left-0 top-[44px] z-40 border-b border-r px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider"
          >
            {t('finance.report.col_row')}
          </th>
          <th
            colSpan={2}
            className="border-border bg-muted/40 sticky top-[44px] z-30 border-b border-l px-2 py-2 text-center text-[10px] font-semibold uppercase tracking-wider"
          >
            {t('finance.report.col_total')}
          </th>
          {monthCols.map((c, mi) => (
            <th
              key={c.key}
              colSpan={2}
              className={`border-border sticky top-[44px] z-30 border-b border-l px-2 py-2 text-center text-[10px] font-semibold uppercase capitalize tracking-wider ${
                mi === currentMonthIdx
                  ? 'bg-amber-100 text-amber-900 dark:bg-amber-500/20 dark:text-amber-200'
                  : 'bg-muted/60'
              }`}
            >
              {format(startOfMonth(new Date(c.year, c.monthIdx, 1)), 'MM/yy', {
                locale: getDateLocale(),
              })}
            </th>
          ))}
        </tr>
        {/* Row 2 — План|Факт sub-headers. Sticky top=72px (44px + ~28px row1). */}
        <tr className="text-muted-foreground/80">
          <th className="border-border bg-muted/40 sticky top-[72px] z-30 border-b border-l px-2 py-1 text-right text-[9px] font-medium uppercase">
            {t('finance.report.col_plan')}
          </th>
          <th className="border-border bg-muted/40 sticky top-[72px] z-30 border-b px-2 py-1 text-right text-[9px] font-medium uppercase">
            {t('finance.report.col_fact')}
          </th>
          {monthCols.map((c, mi) => (
            <Fragment key={c.key}>
              <th
                className={`border-border sticky top-[72px] z-30 border-b border-l px-2 py-1 text-right text-[9px] font-medium uppercase ${
                  mi === currentMonthIdx
                    ? 'bg-amber-50 text-amber-800 dark:bg-amber-500/10 dark:text-amber-300'
                    : 'bg-muted/30'
                }`}
              >
                {t('finance.report.col_plan')}
              </th>
              <th
                className={`border-border sticky top-[72px] z-30 border-b px-2 py-1 text-right text-[9px] font-medium uppercase ${
                  mi === currentMonthIdx
                    ? 'bg-amber-50 text-amber-800 dark:bg-amber-500/10 dark:text-amber-300'
                    : 'bg-muted/30'
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
          // Чётные строки (не-bold) — лёгкая «зебра» на muted/20. bold-строки
          // секций имеют свой groupBg. Все backgrounds непрозрачные — иначе
          // через sticky-колонку label просвечивают скроллящиеся цифры.
          const zebra = !row.bold && idx % 2 === 1 ? 'bg-muted/20' : 'bg-card'
          const rowBg = groupBg || zebra
          return (
            <tr
              key={`${row.label}-${idx}`}
              className={`border-border/60 hover:bg-muted/40 group border-t transition-colors ${rowBg} ${
                hasGroup ? 'cursor-pointer' : ''
              }`}
              onClick={hasGroup ? () => onToggle(row.groupKey!) : undefined}
            >
              <td
                className={`border-border text-foreground sticky left-0 z-20 border-r px-3 py-2 ${
                  row.bold ? 'font-bold' : 'font-medium'
                } ${rowBg} ${accentBorder}`}
                style={{ paddingLeft: 12 + (row.indent ?? 0) * 16 }}
              >
                <span className="inline-flex items-center gap-1.5">
                  {hasGroup ? (
                    isCollapsed ? (
                      <ChevronRight
                        className="text-muted-foreground group-hover:text-foreground size-3.5 shrink-0 transition-colors"
                        strokeWidth={2.2}
                      />
                    ) : (
                      <ChevronDown
                        className="text-muted-foreground group-hover:text-foreground size-3.5 shrink-0 transition-colors"
                        strokeWidth={2.2}
                      />
                    )
                  ) : null}
                  <span className={row.bold ? 'text-foreground' : 'text-muted-foreground'}>
                    {row.label}
                  </span>
                </span>
              </td>
              {/* Итого План | Факт. bug c2a57e1b — клик по ячейкам открывает
                  drill-down модалку (если row.bold — это группа/parent row). */}
              <td
                className={`num border-border bg-muted/30 border-l px-2 py-2 text-right ${
                  row.bold ? 'font-bold' : 'font-medium'
                } ${colorClass(row.color)} ${
                  onDrillDown ? 'hover:bg-muted/60 cursor-pointer' : ''
                }`}
                onClick={onDrillDown ? () => onDrillDown(row) : undefined}
                title={onDrillDown ? t('finance.report.click_for_details') : undefined}
              >
                {formatPF(yearTotal(row.values), currency)}
              </td>
              <td
                className={`num bg-muted/30 px-2 py-2 text-right ${
                  row.bold ? 'font-bold' : 'font-medium'
                } ${colorClass(row.color)} ${
                  onDrillDown ? 'hover:bg-muted/60 cursor-pointer' : ''
                }`}
                onClick={onDrillDown ? () => onDrillDown(row) : undefined}
                title={onDrillDown ? t('finance.report.click_for_details') : undefined}
              >
                {formatPF(yearTotal(row.factValues ?? []), currency)}
              </td>
              {row.values.map((plan, mi) => {
                const fact = row.factValues?.[mi] ?? 0
                const isCurrent = mi === currentMonthIdx
                return (
                  <Fragment key={mi}>
                    <td
                      className={`num border-border/60 border-l px-2 py-2 text-right ${
                        row.bold ? 'font-semibold' : ''
                      } ${colorClass(row.color, 'plan')} ${isCurrent ? 'bg-amber-50 dark:bg-amber-500/10' : ''}`}
                    >
                      {formatPF(plan, currency)}
                    </td>
                    <td
                      className={`num px-2 py-2 text-right ${row.bold ? 'font-semibold' : ''} ${colorClass(
                        row.color,
                        'fact',
                      )} ${isCurrent ? 'bg-amber-50 dark:bg-amber-500/10' : ''}`}
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
    if (color === 'destructive') return 'text-rose-500/80 dark:text-rose-300/80'
    if (color === 'sage') return 'text-emerald-600/80 dark:text-emerald-300/80'
    if (color === 'teal') return 'text-amber-600/80 dark:text-amber-300/80'
    if (color === 'navy') return 'text-foreground/70'
    return 'text-muted-foreground/80'
  }
  if (color === 'destructive') return 'text-rose-600 dark:text-rose-300'
  if (color === 'sage') return 'text-emerald-700 dark:text-emerald-300'
  if (color === 'teal') return 'text-amber-700 dark:text-amber-300'
  if (color === 'navy') return 'text-foreground'
  return 'text-foreground/90'
}

/**
 * Фон строки-секции. Все секции на одинаковом мягком `slate-50` — различаются
 * только цветной полоской слева (см. accentLeftBorder). Это держит вид
 * спокойным, без пёстрых пастельных полос на каждом разделе.
 */
function groupRowBg(_color: RowColor | undefined, bold: boolean | undefined): string {
  if (!bold) return ''
  return 'bg-muted/40'
}

/** Цветной акцент слева у bold-строк (как «полоска категории»). */
function accentLeftBorder(color: RowColor | undefined): string {
  if (color === 'sage') return 'border-l-[3px] border-l-emerald-500'
  if (color === 'destructive') return 'border-l-[3px] border-l-rose-400'
  if (color === 'teal') return 'border-l-[3px] border-l-amber-400'
  if (color === 'navy') return 'border-l-[3px] border-l-slate-700 dark:border-l-slate-300'
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
  colCount: number,
): CellRow[] {
  const indices = Array.from({ length: colCount }, (_, i) => i)
  const moneyByMonth = indices.map((m) => {
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
    ['balance_assets_stock', indices.map(() => stockCents)],
  ])
  const byParent = new Map<string | null, ParameterItem[]>()
  for (const it of items) {
    const k = it.parent_id ?? null
    const arr = byParent.get(k) ?? []
    arr.push(it)
    byParent.set(k, arr)
  }
  const zeros = Array.from({ length: colCount }, () => 0)
  const rows: CellRow[] = []
  function pushNode(node: ParameterItem, indent: number, rootKey: string | null) {
    const isRoot = indent === 0
    const myKey = isRoot ? `balance_root_${node.preset_key || node.id}` : rootKey
    const planConst = node.amount_cents ?? 0
    const planArr = indices.map(() => planConst)
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
