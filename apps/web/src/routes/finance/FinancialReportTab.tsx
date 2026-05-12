import { endOfMonth, format, startOfMonth, startOfYear } from 'date-fns'
import { ru } from 'date-fns/locale'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { useExpenses } from '@/hooks/useExpenses'
import {
  DEFAULT_FINANCIAL_SETTINGS,
  useFinancialSettings,
  type FinancialSettings,
} from '@/hooks/useFinancialSettings'
import { useOtherIncomes } from '@/hooks/useOtherIncomes'
import { useSalon } from '@/hooks/useSalons'
import { useServices } from '@/hooks/useServices'
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
  const { data: otherIncomes = [] } = useOtherIncomes(salonId, { start: yearStart, end: yearEnd })
  const { data: expenses = [] } = useExpenses(salonId, expensesRange)
  const { data: services = [] } = useServices(salonId)

  // Aggregate by month (12 buckets, index 0=Jan)
  const monthly = useMemo(() => {
    const buckets = Array.from({ length: 12 }, () => ({
      visitsRevenue: 0, // сервис-выручка из visits (минус скидки)
      otherIncome: 0,
      expensesTotal: 0,
    }))
    for (const v of visits) {
      const d = new Date(v.visit_at)
      if (d.getFullYear() !== year) continue
      const m = d.getMonth()
      buckets[m]!.visitsRevenue += v.amount_cents - v.discount_cents + v.tip_cents
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
  }, [visits, otherIncomes, expenses, year])

  // ===== Сборка отчёта =====
  type CellRow = {
    label: string
    values: number[] // 12 чисел в копейках/центах (положительные = inflow, отрицательные = outflow)
    bold?: boolean
    indent?: number
    color?: 'navy' | 'sage' | 'destructive' | 'muted'
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
  const otherIncomeByMonth = monthly.map((m) => m.otherIncome + settings.other_income.monthly_cents)
  const revenueByMonth = visitsByMonth.map((v, i) => v + (otherIncomeByMonth[i] ?? 0))

  // Производственные = ЗП мастера + расходные материалы (план через %, средний
  // по всем активным услугам — см. ServicePlanningCard).
  const masterPayout = revenueByMonth.map((rev) =>
    Math.round((rev * averagePct(services, 'staff_payout', 40)) / 100),
  )
  const materials = revenueByMonth.map((rev) =>
    Math.round((rev * averagePct(services, 'materials', 3)) / 100),
  )
  const productionByMonth = masterPayout.map((p, i) => p + (materials[i] ?? 0))

  // Переменные (% выручки)
  const varAdminPayroll = variablePctOfRevenue(settings.variable.admin_payroll_pct)
  const varBankComm = variablePctOfRevenue(settings.variable.bank_commission_pct)
  const varAdBudget = variablePctOfRevenue(settings.variable.ad_budget_pct)
  const varBonuses = variablePctOfRevenue(settings.variable.bonuses_pct)
  const variableByMonth = varAdminPayroll.map(
    (a, i) => a + (varBankComm[i] ?? 0) + (varAdBudget[i] ?? 0) + (varBonuses[i] ?? 0),
  )

  const fixedByMonth = constant(fixedTotalMonthly)
  const taxesByMonth = constant(taxesTotalMonthly)
  const expensesTotalByMonth = productionByMonth.map(
    (p, i) => p + (variableByMonth[i] ?? 0) + (fixedByMonth[i] ?? 0) + (taxesByMonth[i] ?? 0),
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
    {
      label: t('finance.report.section_operating'),
      values: revenueByMonth.map((r, i) => r - (expensesTotalByMonth[i] ?? 0)),
      bold: true,
    },
    { label: t('finance.report.revenue'), values: revenueByMonth, bold: true, color: 'navy' },
    { label: t('finance.report.revenue_services'), values: visitsByMonth, indent: 1 },
    { label: t('finance.report.revenue_other'), values: otherIncomeByMonth, indent: 1 },

    {
      label: t('finance.report.expenses_total'),
      values: expensesTotalByMonth.map((v) => -v),
      bold: true,
      color: 'destructive',
    },
    {
      label: t('finance.report.production'),
      values: productionByMonth.map((v) => -v),
      indent: 1,
      bold: true,
      color: 'destructive',
    },
    {
      label: t('finance.report.production_master_payout'),
      values: masterPayout.map((v) => -v),
      indent: 2,
    },
    {
      label: t('finance.report.production_materials'),
      values: materials.map((v) => -v),
      indent: 2,
    },

    {
      label: t('finance.report.variable'),
      values: variableByMonth.map((v) => -v),
      indent: 1,
      bold: true,
      color: 'destructive',
    },
    {
      label: t('settings.parameters.variable.admin_payroll'),
      values: varAdminPayroll.map((v) => -v),
      indent: 2,
    },
    {
      label: t('settings.parameters.variable.bank_commission'),
      values: varBankComm.map((v) => -v),
      indent: 2,
    },
    {
      label: t('settings.parameters.variable.ad_budget'),
      values: varAdBudget.map((v) => -v),
      indent: 2,
    },
    {
      label: t('settings.parameters.variable.bonuses'),
      values: varBonuses.map((v) => -v),
      indent: 2,
    },

    {
      label: t('finance.report.fixed'),
      values: fixedByMonth.map((v) => -v),
      indent: 1,
      bold: true,
      color: 'destructive',
    },
    ...buildFixedRows(settings, t),

    {
      label: t('finance.report.taxes'),
      values: taxesByMonth.map((v) => -v),
      indent: 1,
      bold: true,
      color: 'destructive',
    },
    {
      label: t('settings.parameters.taxes.pit36'),
      values: constant(settings.taxes.pit36_cents).map((v) => -v),
      indent: 2,
    },
    {
      label: t('settings.parameters.taxes.vat'),
      values: constant(settings.taxes.vat_cents).map((v) => -v),
      indent: 2,
    },
    {
      label: t('settings.parameters.taxes.cit'),
      values: constant(settings.taxes.cit_cents).map((v) => -v),
      indent: 2,
    },
    {
      label: t('settings.parameters.taxes.pit3'),
      values: constant(settings.taxes.pit3_cents).map((v) => -v),
      indent: 2,
    },

    {
      label: t('finance.report.section_investing'),
      values: investmentsByMonth.map((v) => -v),
      bold: true,
      color: 'destructive',
    },
    ...buildInvestmentRows(settings, t, currentMonthIdx),

    {
      label: t('finance.report.section_financing'),
      values: flowsByMonth.map((v) => -v),
      bold: true,
      color: 'destructive',
    },
    ...buildFlowRows(settings, t),

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

  const yearTotal = (vals: number[]) => vals.reduce((s, v) => s + v, 0)

  return (
    <div>
      <header className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-brand-navy text-lg font-bold tracking-tight">
            {t('finance.report.title')}
          </h2>
          <p className="text-muted-foreground mt-1 text-sm">{t('finance.report.subtitle')}</p>
        </div>
        <div className="border-border bg-card rounded-md border px-3 py-2 text-right">
          <p className="text-muted-foreground text-xs uppercase tracking-wider">
            {t('finance.report.current_balance')}
          </p>
          <p className="num text-foreground text-lg font-bold">
            {formatCurrency(openingBalance, currency)}
          </p>
        </div>
      </header>

      <div className="border-border bg-card shadow-finsm overflow-x-auto rounded-lg border">
        <table className="w-full border-collapse text-xs">
          <thead className="bg-muted/40 text-muted-foreground text-[10px] uppercase tracking-wider">
            <tr>
              <th className="bg-muted/40 sticky left-0 z-10 px-3 py-2 text-left font-semibold">
                {t('finance.report.col_row')}
              </th>
              <th className="px-2 py-2 text-right font-semibold">
                {t('finance.report.col_total')}
              </th>
              {months.map((m) => (
                <th key={m} className="min-w-[70px] px-2 py-2 text-right font-semibold capitalize">
                  {format(startOfMonth(new Date(year, m, 1)), 'MM/yy', { locale: ru })}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => (
              <tr
                key={idx}
                className={`border-border/60 border-t ${row.bold ? 'bg-muted/10' : ''}`}
              >
                <td
                  className={`bg-card sticky left-0 z-10 px-3 py-1.5 ${row.bold ? 'text-foreground font-bold' : 'text-foreground'}`}
                  style={{ paddingLeft: 12 + (row.indent ?? 0) * 16 }}
                >
                  {row.label}
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
            ))}
          </tbody>
        </table>
      </div>

      {/* Остаток по кассам на конец каждого месяца — упрощённо: всё на одной
          кассе (Bank/Karta) пока что. Полная разбивка по счетам — следующая
          итерация когда добавим account_id на транзакции. */}
      <div className="border-border bg-card shadow-finsm mt-4 overflow-x-auto rounded-lg border">
        <table className="w-full border-collapse text-xs">
          <thead className="bg-muted/40 text-muted-foreground text-[10px] uppercase tracking-wider">
            <tr>
              <th className="bg-muted/40 sticky left-0 z-10 px-3 py-2 text-left font-semibold">
                {t('finance.report.end_balance_by_register')}
              </th>
              <th className="px-2 py-2 text-right font-semibold">
                {t('finance.report.col_start')}
              </th>
              {months.map((m) => (
                <th key={m} className="px-2 py-2 text-right font-semibold capitalize">
                  {format(startOfMonth(new Date(year, m, 1)), 'MM/yy', { locale: ru })}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(
              [
                ['director_cents', t('settings.parameters.cash.director')],
                ['safe_cents', t('settings.parameters.cash.safe')],
                ['gotowka_cents', t('settings.parameters.cash.gotowka')],
                ['bank_karta_cents', t('settings.parameters.cash.bank_karta')],
                ['karta_terminal_cents', t('settings.parameters.cash.karta_terminal')],
              ] as const
            ).map(([key, label]) => (
              <tr key={key} className="border-border/60 border-t">
                <td className="bg-card text-foreground sticky left-0 z-10 px-3 py-1.5">{label}</td>
                <td className="num text-muted-foreground px-2 py-1.5 text-right">
                  {formatNumberSafe(settings.cash_registers[key], currency)}
                </td>
                {months.map((m) => (
                  <td key={m} className="num text-muted-foreground px-2 py-1.5 text-right">
                    {formatNumberSafe(settings.cash_registers[key], currency)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ============================ helpers ============================

function sumFixedCents(s: FinancialSettings): number {
  const f = s.fixed
  return (
    f.payroll_management_cents +
    f.payroll_admin_cents +
    f.zus_cents +
    f.rent_cents +
    f.electricity_cents +
    f.ad_budget_cents +
    f.smm_cents +
    f.internet_cents +
    f.services_subscription_cents +
    f.cleaning_cents +
    f.household_cents +
    f.leasing_cents +
    f.repair_equipment_cents +
    f.bank_services_cents +
    f.accounting_cents +
    f.fuel_cents +
    f.other_cents
  )
}

function sumTaxesCents(s: FinancialSettings): number {
  const t = s.taxes
  return t.pit36_cents + t.vat_cents + t.cit_cents + t.pit3_cents
}

function sumInvestmentsCents(s: FinancialSettings): number {
  const i = s.investments
  return (
    i.franchise_fee_cents +
    i.first_rent_cents +
    i.renovation_cents +
    i.equipment_cents +
    i.inventory_cents +
    i.furniture_cents +
    i.other_cents
  )
}

function sumFlowsCents(s: FinancialSettings): number {
  const f = s.flows
  return f.dividends_cents + f.owner_contributions_cents + f.owner_loans_cents + f.other_loans_cents
}

function sumCashRegistersCents(s: FinancialSettings): number {
  const c = s.cash_registers
  return (
    c.director_cents + c.safe_cents + c.gotowka_cents + c.bank_karta_cents + c.karta_terminal_cents
  )
}

/** Средневзвешенный % из услуг (для plan-vs-fact на ЗП мастера / расходные материалы). */
function averagePct<T extends { staff_payout_pct?: number; materials_pct?: number }>(
  services: T[],
  kind: 'staff_payout' | 'materials',
  fallback: number,
): number {
  if (services.length === 0) return fallback
  const sum = services.reduce(
    (s, sv) => s + ((kind === 'staff_payout' ? sv.staff_payout_pct : sv.materials_pct) ?? fallback),
    0,
  )
  return sum / services.length
}

function formatNumberSafe(v: number, currency: string): string {
  return formatCurrency(v, currency)
}

function buildFixedRows(settings: FinancialSettings, t: (k: string) => string) {
  const FIXED = [
    ['payroll_management_cents', 'settings.parameters.fixed.payroll_management'],
    ['payroll_admin_cents', 'settings.parameters.fixed.payroll_admin'],
    ['zus_cents', 'settings.parameters.fixed.zus'],
    ['rent_cents', 'settings.parameters.fixed.rent'],
    ['electricity_cents', 'settings.parameters.fixed.electricity'],
    ['ad_budget_cents', 'settings.parameters.fixed.ad_budget'],
    ['smm_cents', 'settings.parameters.fixed.smm'],
    ['internet_cents', 'settings.parameters.fixed.internet'],
    ['services_subscription_cents', 'settings.parameters.fixed.services_subscription'],
    ['cleaning_cents', 'settings.parameters.fixed.cleaning'],
    ['household_cents', 'settings.parameters.fixed.household'],
    ['leasing_cents', 'settings.parameters.fixed.leasing'],
    ['repair_equipment_cents', 'settings.parameters.fixed.repair_equipment'],
    ['bank_services_cents', 'settings.parameters.fixed.bank_services'],
    ['accounting_cents', 'settings.parameters.fixed.accounting'],
    ['fuel_cents', 'settings.parameters.fixed.fuel'],
    ['other_cents', 'settings.parameters.fixed.other'],
  ] as const
  return FIXED.map(([key, labelKey]) => ({
    label: t(labelKey),
    values: Array.from({ length: 12 }, () => -settings.fixed[key as keyof typeof settings.fixed]),
    indent: 2,
  }))
}

function buildInvestmentRows(
  settings: FinancialSettings,
  t: (k: string) => string,
  currentMonthIdx: number,
) {
  const INV = [
    ['franchise_fee_cents', 'settings.parameters.investments.franchise_fee'],
    ['first_rent_cents', 'settings.parameters.investments.first_rent'],
    ['renovation_cents', 'settings.parameters.investments.renovation'],
    ['equipment_cents', 'settings.parameters.investments.equipment'],
    ['inventory_cents', 'settings.parameters.investments.inventory'],
    ['furniture_cents', 'settings.parameters.investments.furniture'],
    ['other_cents', 'settings.parameters.investments.other'],
  ] as const
  return INV.map(([key, labelKey]) => ({
    label: t(labelKey),
    values: Array.from({ length: 12 }, (_, m) =>
      m === currentMonthIdx ? -settings.investments[key as keyof typeof settings.investments] : 0,
    ),
    indent: 1,
  }))
}

function buildFlowRows(settings: FinancialSettings, t: (k: string) => string) {
  const FLOW = [
    ['dividends_cents', 'settings.parameters.flows.dividends'],
    ['owner_contributions_cents', 'settings.parameters.flows.owner_contributions'],
    ['owner_loans_cents', 'settings.parameters.flows.owner_loans'],
    ['other_loans_cents', 'settings.parameters.flows.other_loans'],
  ] as const
  return FLOW.map(([key, labelKey]) => ({
    label: t(labelKey),
    values: Array.from({ length: 12 }, () => -settings.flows[key as keyof typeof settings.flows]),
    indent: 1,
  }))
}
