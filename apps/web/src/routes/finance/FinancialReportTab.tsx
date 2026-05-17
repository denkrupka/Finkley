import { endOfMonth, format, startOfMonth, startOfYear } from 'date-fns'
import { ru } from 'date-fns/locale'
import { ChevronDown, ChevronRight, FileSpreadsheet, Printer } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { useExpenses } from '@/hooks/useExpenses'
import {
  DEFAULT_FINANCIAL_SETTINGS,
  monthlyEquivalentCents,
  useFinancialSettings,
  type FinancialSettings,
  type ParameterItem,
} from '@/hooks/useFinancialSettings'
import { useMonthlyRegisterBalances } from '@/hooks/useCashTransfers'
import { useOtherIncomes } from '@/hooks/useOtherIncomes'
import { useSalon } from '@/hooks/useSalons'
import { useVisits } from '@/hooks/useVisits'
import { formatCurrency } from '@/lib/utils/format-currency'

/**
 * Финансовый отчёт — annual cash-flow table в стиле excel-таблицы owner'а.
 *
 * Строки сгруппированы:
 *   Текущая деятельность
 *     Выручка (Услуги, Прочие доходы)
 *     Расходы:
 *       Производственные (ЗП мастера, Расходные материалы)
 *       Переменные (% от выручки) — admin payroll, банк комиссия, реклама, бонусы
 *       Постоянные — все 17 fixed-расходов из financial_settings
 *       Налоги — PIT-36 / VAT / CIT / PIT-3
 *   Инвестиционная деятельность
 *   Финансовая деятельность (Дивиденды / Вклады / Займы)
 *   Сальдо за период
 *   Остаток на конец месяца (по кассам)
 *
 * Колонки — 12 месяцев текущего года + «Итого тек. год».
 *
 * Данные:
 *  - Выручка / Услуги  — из visits.amount (kind='visit') по месяцу.
 *  - Прочие доходы (факт) — sum other_incomes по месяцу.
 *  - Расходные материалы (факт)  — TODO: подсчёт через service_materials → пока 0,
 *    т.к. требует ещё одного RPC. На скрине у owner'а это % от выручки в settings;
 *    мы тоже берём materials_pct из ServicePlanningParams (avg) либо 0.
 *  - ЗП мастера (факт) — sum payouts.amount_cents за месяц (если есть закрытые
 *    периоды), либо staff_payout_pct × выручка как прогноз.
 *  - Постоянные (план) — financial_settings.fixed (× 1 каждый месяц).
 *  - Переменные  — settings.variable.* × (visits + other_incomes) выручка.
 *  - Налоги — settings.taxes.* (× 1 каждый месяц).
 *  - Инвестиции — settings.investments.* (план — показываем в текущем месяце).
 *  - Финансовая — settings.flows.* (× 1 каждый месяц, для прогноза).
 *  - Остаток на тек. момент — sum of cash_registers.
 */

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
  // Retail-продажи учитываются отдельной подкатегорией в «Выручка».
  const { data: retailSales = [] } = useVisits(salonId, visitsRange, { kind: 'retail' })
  const { data: otherIncomes = [] } = useOtherIncomes(salonId, { start: yearStart, end: yearEnd })
  const { data: expenses = [] } = useExpenses(salonId, expensesRange)
  // Per-register monthly running balances (на конец каждого месяца).
  const { data: monthlyRegBalances } = useMonthlyRegisterBalances(salonId, year)

  // Aggregate by month (12 buckets, index 0=Jan)
  const monthly = useMemo(() => {
    const buckets = Array.from({ length: 12 }, () => ({
      visitsRevenue: 0, // сервис-выручка из visits (минус скидки)
      retailRevenue: 0, // выручка от продаж товаров (kind='retail')
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

  // ===== Сборка отчёта =====
  type CellRow = {
    label: string
    values: number[] // 12 чисел в копейках/центах (положительные = inflow, отрицательные = outflow)
    bold?: boolean
    indent?: number
    color?: 'navy' | 'sage' | 'destructive' | 'muted'
    /** Уникальный ключ для collapse-логики (если эта строка — header группы). */
    groupKey?: string
    /** Если задан — строка является дочерней для groupKey и скрывается при свёртывании. */
    parentGroupKey?: string
  }

  // Свёрнутые группы — Set с groupKey
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
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

  // Plan-vs-fact: postoyannye/налоги/flows/прочие доходы умножены на каждый месяц
  // года (план), invest — только в текущем месяце (как факт).
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

  // Переменные (% выручки) — сумма всех items[].pct
  const variableTotalPct = settings.variable.items
    .filter((i) => !i.archived)
    .reduce((acc, i) => acc + (i.pct ?? 0), 0)
  const variableByMonth = variablePctOfRevenue(variableTotalPct)

  const fixedByMonth = constant(fixedTotalMonthly)
  const taxesByMonth = constant(taxesTotalMonthly)
  const expensesTotalByMonth = months.map(
    (i) => (variableByMonth[i] ?? 0) + (fixedByMonth[i] ?? 0) + (taxesByMonth[i] ?? 0),
  )

  const currentMonthIdx = new Date().getMonth()
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

  const rows: CellRow[] = [
    // ===== Доходы (статика) =====
    {
      label: t('finance.report.revenue'),
      values: revenueByMonth,
      bold: true,
      color: 'navy',
      groupKey: 'revenue',
    },
    {
      label: t('finance.report.revenue_services'),
      values: visitsByMonth,
      indent: 1,
      parentGroupKey: 'revenue',
    },
    {
      label: t('finance.report.revenue_retail'),
      values: retailByMonth,
      indent: 1,
      parentGroupKey: 'revenue',
    },
    {
      label: t('finance.report.revenue_other'),
      values: otherIncomeByMonth,
      indent: 1,
      parentGroupKey: 'revenue',
    },

    // ===== Расходы (из вкладки «Расходы» справочника) =====
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
    ...buildFixedRows(settings).map((r) => ({ ...r, parentGroupKey: 'fixed' })),
    {
      label: t('finance.report.taxes'),
      values: taxesByMonth.map((v) => -v),
      indent: 1,
      bold: true,
      color: 'destructive',
      groupKey: 'taxes',
      parentGroupKey: 'expenses',
    },
    ...buildItemsRows(settings.taxes.items, 2, -1).map((r) => ({
      ...r,
      parentGroupKey: 'taxes',
    })),

    // ===== Инвестиционная деятельность (Поступления/Выбытия из подгрупп) =====
    {
      label: t('finance.report.section_investing'),
      values: investmentsByMonth.map((v) => -v),
      bold: true,
      color: 'destructive',
      groupKey: 'investing',
    },
    ...buildInvestmentRows(settings, currentMonthIdx).map((r) => ({
      ...r,
      parentGroupKey: 'investing',
    })),

    // ===== Финансовая деятельность (Поступления/Выбытия из подгрупп) =====
    {
      label: t('finance.report.section_financing'),
      values: flowsByMonth.map((v) => -v),
      bold: true,
      color: 'destructive',
      groupKey: 'financing',
    },
    ...buildFlowRows(settings).map((r) => ({ ...r, parentGroupKey: 'financing' })),

    // ===== Сальдо и остаток =====
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

    // ===== Баланс (из новой вкладки справочника) =====
    {
      label: t('finance.report.section_balance'),
      values: constant(0),
      bold: true,
      color: 'navy',
      groupKey: 'balance',
    },
    ...buildItemsRows(settings.balance.items, 1, 1).map((r) => ({
      ...r,
      parentGroupKey: 'balance',
    })),
  ]

  const yearTotal = (vals: number[]) => vals.reduce((s, v) => s + v, 0)

  function exportCsv() {
    const headers = [
      t('finance.report.col_row'),
      t('finance.report.col_total'),
      ...months.map((m) => format(startOfMonth(new Date(year, m, 1)), 'MM/yy', { locale: ru })),
    ]
    const lines = [headers.join(';')]
    for (const row of rows) {
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

  return (
    <div>
      <header className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-brand-navy text-lg font-bold tracking-tight">
            {t('finance.report.title')}
          </h2>
          <p className="text-muted-foreground mt-1 text-sm">{t('finance.report.subtitle')}</p>
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
          <div className="border-border bg-card rounded-md border px-3 py-2 text-right">
            <p className="text-muted-foreground text-[10px] uppercase tracking-wider">
              {t('finance.report.current_balance')}
            </p>
            <p className="num text-foreground text-sm font-bold">
              {formatCurrency(openingBalance, currency)}
            </p>
          </div>
        </div>
      </header>

      <div className="border-border bg-card shadow-finsm overflow-x-auto rounded-lg border">
        <table className="w-full border-collapse text-xs">
          <thead className="text-muted-foreground text-[10px] uppercase tracking-wider">
            <tr className="bg-muted">
              {/* Sticky left header — нужен opaque bg (без /40) и z-30, чтобы
                  при горизонтальном скролле остальные ячейки шапки уезжали
                  ПОД него, а не торчали поверх (баг image #20). */}
              <th className="bg-muted border-border/60 sticky left-0 z-30 min-w-[200px] border-r px-3 py-2 text-left font-semibold">
                {t('finance.report.col_row')}
              </th>
              <th className="bg-muted px-2 py-2 text-right font-semibold">
                {t('finance.report.col_total')}
              </th>
              {months.map((m) => (
                <th
                  key={m}
                  className="bg-muted min-w-[70px] px-2 py-2 text-right font-semibold capitalize"
                >
                  {format(startOfMonth(new Date(year, m, 1)), 'MM/yy', { locale: ru })}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows
              // Скрываем дочерние строки если родительская группа свёрнута
              .filter((row) => !(row.parentGroupKey && collapsed.has(row.parentGroupKey)))
              .map((row, idx) => {
                const hasGroup = !!row.groupKey
                const isCollapsed = hasGroup && collapsed.has(row.groupKey!)
                return (
                  <tr
                    key={`${row.label}-${idx}`}
                    className={`border-border/60 border-t ${row.bold ? 'bg-muted/10' : ''} ${hasGroup ? 'hover:bg-muted/30 cursor-pointer' : ''}`}
                    onClick={hasGroup ? () => toggleGroup(row.groupKey!) : undefined}
                  >
                    <td
                      className={`bg-card border-border/60 sticky left-0 z-10 border-r px-3 py-1.5 ${row.bold ? 'text-foreground font-bold' : 'text-foreground'}`}
                      style={{ paddingLeft: 12 + (row.indent ?? 0) * 16 }}
                    >
                      <span className="inline-flex items-center gap-1.5">
                        {hasGroup ? (
                          isCollapsed ? (
                            <ChevronRight className="size-3.5 shrink-0" strokeWidth={2} />
                          ) : (
                            <ChevronDown className="size-3.5 shrink-0" strokeWidth={2} />
                          )
                        ) : null}
                        <span>{row.label}</span>
                      </span>
                    </td>
                    <td
                      className={`num px-2 py-1.5 text-right ${row.bold ? 'font-bold' : ''} ${
                        row.color === 'navy'
                          ? 'text-foreground'
                          : row.color === 'sage'
                            ? 'text-brand-sage-deep'
                            : row.color === 'destructive'
                              ? 'text-destructive'
                              : 'text-foreground'
                      }`}
                    >
                      {formatNumberSafe(yearTotal(row.values), currency)}
                    </td>
                    {row.values.map((v, mi) => (
                      <td
                        key={mi}
                        className={`num px-2 py-1.5 text-right ${row.bold ? 'font-bold' : ''} ${
                          row.color === 'navy'
                            ? 'text-foreground'
                            : row.color === 'sage'
                              ? 'text-brand-sage-deep'
                              : row.color === 'destructive'
                                ? 'text-destructive'
                                : 'text-muted-foreground'
                        }`}
                      >
                        {v === 0 ? '—' : formatNumberSafe(v, currency)}
                      </td>
                    ))}
                  </tr>
                )
              })}
          </tbody>
        </table>
      </div>

      {/* Остаток по кассам на конец каждого месяца — упрощённо: всё на одной
          кассе (Bank/Karta) пока что. Полная разбивка по счетам — следующая
          итерация когда добавим account_id на транзакции. */}
      <div className="border-border bg-card shadow-finsm mt-4 overflow-x-auto rounded-lg border">
        <table className="w-full border-collapse text-xs">
          <thead className="text-muted-foreground text-[10px] uppercase tracking-wider">
            <tr className="bg-muted">
              <th className="bg-muted border-border/60 sticky left-0 z-30 border-r px-3 py-2 text-left font-semibold">
                {t('finance.report.end_balance_by_register')}
              </th>
              <th className="bg-muted px-2 py-2 text-right font-semibold">
                {t('finance.report.col_start')}
              </th>
              {months.map((m) => (
                <th key={m} className="bg-muted px-2 py-2 text-right font-semibold capitalize">
                  {format(startOfMonth(new Date(year, m, 1)), 'MM/yy', { locale: ru })}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {settings.cash_registers.items
              .filter((i) => !i.archived)
              .map((reg) => {
                const monthlyBalances = monthlyRegBalances.get(reg.id) ?? []
                return (
                  <tr key={reg.id} className="border-border/60 border-t">
                    <td className="bg-card text-foreground border-border/60 sticky left-0 z-10 border-r px-3 py-1.5">
                      {reg.label || '—'}
                    </td>
                    <td className="num text-muted-foreground px-2 py-1.5 text-right">
                      {formatNumberSafe(reg.amount_cents ?? 0, currency)}
                    </td>
                    {months.map((m) => (
                      <td key={m} className="num text-muted-foreground px-2 py-1.5 text-right">
                        {formatNumberSafe(monthlyBalances[m] ?? 0, currency)}
                      </td>
                    ))}
                  </tr>
                )
              })}
          </tbody>
        </table>
      </div>
    </div>
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
  // Инвестиции — единоразовые. Используем amount как есть (не делим на period).
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

/**
 * Строит строки отчёта из items[] секции с учётом иерархии (parent_id).
 * Корневые позиции рендерятся на уровне `baseIndent`, дочерние — +1.
 *
 * @param sign      Знак значения (+1 для доходов, -1 для расходов).
 * @param onlyInMonth Если задан — позиция показывается только в этом месяце
 *                    (для investments — единоразовые расходы).
 */
function buildItemsRows(
  items: ParameterItem[],
  baseIndent: number,
  sign: 1 | -1,
  onlyInMonth: number | null = null,
) {
  // Архивные параметры тоже рендерим, чтобы их не пропадало в отчёте если в
  // каком-то месяце по ним был факт (т.е. их удалили из справочника, но они
  // были в истории). Помечаем (архив) в лейбле, значения у архивных = 0
  // (план не считается, факт пока не привязан per-параметр в expenses).
  const byParent = new Map<string | null, ParameterItem[]>()
  for (const it of items) {
    const key = it.parent_id ?? null
    const arr = byParent.get(key) ?? []
    arr.push(it)
    byParent.set(key, arr)
  }
  const rows: Array<{ label: string; values: number[]; indent: number }> = []
  function pushNode(node: ParameterItem, indent: number) {
    const monthly = node.archived ? 0 : monthlyEquivalentCents(node)
    const values = Array.from({ length: 12 }, (_, m) => {
      if (onlyInMonth !== null) {
        return m === onlyInMonth && !node.archived ? sign * (node.amount_cents ?? 0) : 0
      }
      return sign * monthly
    })
    const baseLabel = node.label || '—'
    const label = node.archived ? `${baseLabel} (архив)` : baseLabel
    rows.push({ label, values, indent })
    const children = byParent.get(node.id) ?? []
    for (const c of children) pushNode(c, indent + 1)
  }
  const roots = byParent.get(null) ?? []
  for (const r of roots) pushNode(r, baseIndent)
  return rows
}

function buildFixedRows(settings: FinancialSettings) {
  return buildItemsRows(settings.fixed.items, 2, -1)
}

function buildInvestmentRows(settings: FinancialSettings, currentMonthIdx: number) {
  return buildItemsRows(settings.investments.items, 1, -1, currentMonthIdx)
}

function buildFlowRows(settings: FinancialSettings) {
  return buildItemsRows(settings.flows.items, 1, -1)
}
