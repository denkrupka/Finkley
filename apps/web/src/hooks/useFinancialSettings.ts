import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { supabase } from '@/lib/supabase/client'

/**
 * Финансовые параметры салона. Хранятся в jsonb `salons.financial_settings`.
 *
 * Унифицированная модель: каждая секция — список `ParameterItem` (включая
 * preset-позиции, которые раньше были «вшиты» отдельными ключами).
 * Любую позицию можно переименовать или удалить (soft-delete). Иерархия
 * поддерживается через `parent_id`. Поле `period` (только в fixed) задаёт
 * частоту платежа.
 *
 * Денежные значения — bigint в центах. Проценты — 0..100.
 */

export type ParamPeriod = 'day' | 'month' | '2months' | 'quarter' | 'year'

/** Сколько месяцев в одном периоде. month=1, year=12. day=1/30 (~ месячный эквивалент). */
export const PERIOD_TO_MONTHS: Record<ParamPeriod, number> = {
  day: 1 / 30,
  month: 1,
  '2months': 2,
  quarter: 3,
  year: 12,
}

export type ParameterItem = {
  id: string
  label: string
  /** Для денежных позиций (всё кроме variable %). */
  amount_cents?: number
  /** Для процентных позиций (variable %). */
  pct?: number
  /** Для постоянных расходов: частота платежа. По умолчанию — month. */
  period?: ParamPeriod
  /** Родительская позиция в иерархии (для подкатегорий). */
  parent_id?: string | null
  /** Soft-delete — позиция скрыта из новых отчётов, но название сохраняется. */
  archived?: boolean
  /**
   * Только для cash_registers: тип средств в кассе. cash = физические
   * деньги (наличные/конверт/сейф); non_cash = безналичные (счёт, карта,
   * терминал). Используется в P&L для разбивки cash vs cashless и в
   * cash-shift discipline (наличные нуждаются в смене, безнал — нет).
   */
  cash_kind?: 'cash' | 'non_cash'
  /**
   * Только для cash_registers: маппинг payment_method → касса. Когда
   * visit/expense приходит с этим payment_method (включая импорт из
   * Booksy) — деньги зачисляются на эту кассу автоматически. На каждый
   * тип оплаты может быть прицеплена только одна касса (уникальность
   * проверяется на клиенте в UI). Пример: «Конверт» = cash → все визиты
   * оплаченные наличными попадают на баланс «Конверт».
   */
  payment_method_mapping?: 'cash' | 'card' | 'transfer' | 'online' | null
  /**
   * Маркер preset-позиции (системной). Только для миграции — не показывается
   * юзеру и не влияет на UI. После рефакторинга все позиции редактируются
   * одинаково.
   */
  preset_key?: string
}

export type ParameterSection = {
  items: ParameterItem[]
}

export type FinancialSettings = {
  cash_registers: ParameterSection
  fixed: ParameterSection
  variable: ParameterSection
  other_income: ParameterSection
  taxes: ParameterSection
  /** Инвестиционная деятельность. Дети группируются под root-items
   *  с preset_key='investments_in' (Поступления) и 'investments_out' (Выбытия). */
  investments: ParameterSection
  /** Финансовая деятельность (было `flows`). Группы — 'flows_in' / 'flows_out'. */
  flows: ParameterSection
  /** Баланс предприятия. Группы — 'balance_assets' (АКТИВЫ) / 'balance_liabilities' (ПАССИВЫ). */
  balance: ParameterSection
}

// ---------------------------------------------------------------------------
// Default preset items (используются при первом запуске или если поле в БД пустое)
// ---------------------------------------------------------------------------

function preset(id: string, label: string, extra: Partial<ParameterItem> = {}): ParameterItem {
  return { id, label, preset_key: id, archived: false, ...extra }
}

export const DEFAULT_FINANCIAL_SETTINGS: FinancialSettings = {
  cash_registers: {
    items: [
      preset('director', 'Касса директора', { amount_cents: 0, cash_kind: 'cash' }),
      preset('safe', 'Сейф', { amount_cents: 0, cash_kind: 'cash' }),
      preset('gotowka', 'Gotówka', { amount_cents: 0, cash_kind: 'cash' }),
      preset('bank_karta', 'Bank/Karta', { amount_cents: 0, cash_kind: 'non_cash' }),
      preset('karta_terminal', 'Karta / Terminal', { amount_cents: 0, cash_kind: 'non_cash' }),
    ],
  },
  fixed: {
    items: [
      preset('payroll_management', 'ФОТ Управляющий персонал — оклад', {
        amount_cents: 0,
        period: 'month',
      }),
      preset('payroll_admin', 'ФОТ Администраторы — оклад', {
        amount_cents: 0,
        period: 'month',
      }),
      preset('zus', 'Взносы на работников (ZUS)', { amount_cents: 0, period: 'month' }),
      preset('rent', 'Аренда помещения', { amount_cents: 0, period: 'month' }),
      preset('electricity', 'Электричество', { amount_cents: 0, period: 'month' }),
      preset('ad_budget', 'Реклама', { amount_cents: 0, period: 'month' }),
      preset('smm', 'SMM', { amount_cents: 0, period: 'month' }),
      preset('internet', 'Интернет / телефон', { amount_cents: 0, period: 'month' }),
      preset('services_subscription', 'Подписки на сервисы', {
        amount_cents: 0,
        period: 'month',
      }),
      preset('cleaning', 'Клининг', { amount_cents: 0, period: 'month' }),
      preset('household', 'Хозтовары', { amount_cents: 0, period: 'month' }),
      preset('leasing', 'Лизинг', { amount_cents: 0, period: 'month' }),
      preset('repair_equipment', 'Ремонт оборудования', { amount_cents: 0, period: 'month' }),
      preset('bank_services', 'Банковские услуги', { amount_cents: 0, period: 'month' }),
      preset('accounting', 'Бухгалтерия', { amount_cents: 0, period: 'month' }),
      preset('fuel', 'Топливо', { amount_cents: 0, period: 'month' }),
      preset('other', 'Прочее', { amount_cents: 0, period: 'month' }),
    ],
  },
  variable: {
    items: [
      preset('admin_payroll', 'ЗП администратора (% от выручки)', { pct: 0 }),
      preset('bank_commission', 'Банковская комиссия', { pct: 0 }),
      preset('ad_budget', 'Реклама (% от выручки)', { pct: 0 }),
      preset('bonuses', 'Бонусы / премии', { pct: 0 }),
    ],
  },
  other_income: {
    items: [preset('monthly', 'Прочие плановые доходы (в месяц)', { amount_cents: 0 })],
  },
  taxes: {
    items: [
      preset('pit36', 'PIT-36 (НДФЛ)', { amount_cents: 0, period: 'month' }),
      preset('vat', 'VAT (НДС)', { amount_cents: 0, period: 'month' }),
      preset('cit', 'CIT (налог на прибыль)', { amount_cents: 0, period: 'month' }),
      preset('pit3', 'PIT-3', { amount_cents: 0, period: 'month' }),
    ],
  },
  investments: {
    items: [
      // Группа Поступления
      preset('investments_in', 'Поступления'),
      preset('investments_in_os_sale', 'Поступления от продажи ОС', {
        amount_cents: 0,
        parent_id: 'investments_in',
      }),
      preset('investments_in_other', 'Прочие поступления по ИД', {
        amount_cents: 0,
        parent_id: 'investments_in',
      }),
      // Группа Выбытия
      preset('investments_out', 'Выбытия'),
      preset('investments_out_os_buy', 'Покупка ОС', {
        amount_cents: 0,
        parent_id: 'investments_out',
      }),
      preset('investments_out_leasing', 'Лизинг', {
        amount_cents: 0,
        parent_id: 'investments_out',
      }),
      preset('investments_out_other_biz', 'Вложения в другие бизнесы', {
        amount_cents: 0,
        parent_id: 'investments_out',
      }),
    ],
  },
  flows: {
    items: [
      // Поступления — приходы от собственника / займы
      preset('flows_in', 'Поступления'),
      preset('flows_in_owner_contrib', 'Вклад собственника', {
        amount_cents: 0,
        period: 'month',
        parent_id: 'flows_in',
      }),
      preset('flows_in_owner_loan', 'Займ собственника', {
        amount_cents: 0,
        period: 'month',
        parent_id: 'flows_in',
      }),
      preset('flows_in_other_loans', 'Прочие займы', {
        amount_cents: 0,
        period: 'month',
        parent_id: 'flows_in',
      }),
      // Выбытия — дивиденды и обслуживание долга
      preset('flows_out', 'Выбытия'),
      preset('flows_out_dividends', 'Дивиденды', {
        amount_cents: 0,
        period: 'month',
        parent_id: 'flows_out',
      }),
      preset('flows_out_credit_body', 'Тело кредита', {
        amount_cents: 0,
        period: 'month',
        parent_id: 'flows_out',
      }),
      preset('flows_out_credit_interest', 'Проценты по кредиту', {
        amount_cents: 0,
        period: 'month',
        parent_id: 'flows_out',
      }),
    ],
  },
  balance: {
    items: [
      // АКТИВЫ
      preset('balance_assets', 'АКТИВЫ'),
      preset('balance_assets_os', 'ОС, НМА', { amount_cents: 0, parent_id: 'balance_assets' }),
      preset('balance_assets_stock', 'Запасы', { amount_cents: 0, parent_id: 'balance_assets' }),
      preset('balance_assets_money', 'Деньги', { amount_cents: 0, parent_id: 'balance_assets' }),
      preset('balance_assets_debt', 'Дебиторская задолженность', {
        amount_cents: 0,
        parent_id: 'balance_assets',
      }),
      // ПАССИВЫ
      preset('balance_liabilities', 'ПАССИВЫ'),
      preset('balance_liabilities_capital', 'Уставной капитал', {
        amount_cents: 0,
        parent_id: 'balance_liabilities',
      }),
      preset('balance_liabilities_profit', 'Накопленная прибыль', {
        amount_cents: 0,
        parent_id: 'balance_liabilities',
      }),
      preset('balance_liabilities_loans', 'Кредиты и займы', {
        amount_cents: 0,
        parent_id: 'balance_liabilities',
      }),
      preset('balance_liabilities_leasing', 'Лизинг', {
        amount_cents: 0,
        parent_id: 'balance_liabilities',
      }),
      preset('balance_liabilities_creditor', 'Кредиторская задолженность', {
        amount_cents: 0,
        parent_id: 'balance_liabilities',
      }),
    ],
  },
}

// ---------------------------------------------------------------------------
// Legacy → new shape migration
// ---------------------------------------------------------------------------

/**
 * Старые записи хранили preset-поля отдельными ключами + опциональный
 * `custom: []`. Конвертим в единый items[] чтобы новый UI и расчёты работали
 * единообразно. Юзеру переход прозрачен.
 */
type LegacySection = Record<string, unknown> & {
  custom?: Array<Record<string, unknown>>
}

function migrateLegacySection(defaults: ParameterItem[], stored: unknown): ParameterItem[] {
  if (!stored) return [...defaults]

  // Новый формат — items[] напрямую
  if (
    typeof stored === 'object' &&
    stored !== null &&
    Array.isArray((stored as { items?: unknown }).items)
  ) {
    return ((stored as { items: ParameterItem[] }).items ?? []).map((it) => {
      // Авто-эвристика cash_kind для существующих касс без типа: матчим
      // на «наличные/gotówka/готівка/cash/сейф/конверт/касс» → cash, иначе
      // non_cash. Юзер может переопределить руками в Settings.
      if (it.cash_kind === undefined && typeof it.label === 'string') {
        const lbl = it.label.toLowerCase()
        const isCash =
          /налич|got[óo]wk|готівк|cash|сейф|конверт|касс/i.test(lbl) &&
          !/(карт|karta|terminal|счёт|счет|bank|безнал|транс|przelew)/i.test(lbl)
        return { ...it, cash_kind: isCash ? ('cash' as const) : ('non_cash' as const) }
      }
      return { ...it }
    })
  }

  // Legacy: preset-поля + опц. custom[]
  const s = (stored ?? {}) as LegacySection
  const result: ParameterItem[] = []

  for (const def of defaults) {
    if (!def.preset_key) continue
    // Маппинг: preset_key='rent' → возможные legacy ключи 'rent_cents', 'rent_pct'
    const moneyKey = `${def.preset_key}_cents`
    const pctKey = `${def.preset_key}_pct`
    let amount_cents: number | undefined = undefined
    let pct: number | undefined = undefined
    if (typeof s[moneyKey] === 'number') amount_cents = s[moneyKey] as number
    if (typeof s[pctKey] === 'number') pct = s[pctKey] as number
    // Для cash_registers/investments/flows preset-поля без _cents suffix не используются.
    if (amount_cents === undefined && pct === undefined) {
      // Берём дефолт
      amount_cents = def.amount_cents
      pct = def.pct
    }
    result.push({
      ...def,
      amount_cents: amount_cents ?? def.amount_cents,
      pct: pct ?? def.pct,
    })
  }

  // Legacy custom[] — добавляем как обычные items без preset_key
  const customArr = Array.isArray(s.custom) ? s.custom : []
  for (const raw of customArr) {
    const obj = raw as Record<string, unknown>
    result.push({
      id: typeof obj.id === 'string' ? obj.id : crypto.randomUUID(),
      label: typeof obj.label === 'string' ? obj.label : '',
      amount_cents:
        typeof obj.amount_cents === 'number'
          ? (obj.amount_cents as number)
          : typeof obj.monthly_cents === 'number'
            ? (obj.monthly_cents as number)
            : undefined,
      pct: typeof obj.pct === 'number' ? (obj.pct as number) : undefined,
      period: defaults[0]?.period ? 'month' : undefined,
      archived: obj.active === false,
      parent_id: typeof obj.parent_id === 'string' ? obj.parent_id : null,
    })
  }

  return result
}

function mergeWithDefaults(stored: unknown): FinancialSettings {
  const s = (stored ?? {}) as Partial<Record<keyof FinancialSettings, unknown>>
  return {
    cash_registers: {
      items: migrateLegacySection(
        DEFAULT_FINANCIAL_SETTINGS.cash_registers.items,
        s.cash_registers,
      ),
    },
    fixed: {
      items: migrateLegacySection(DEFAULT_FINANCIAL_SETTINGS.fixed.items, s.fixed),
    },
    variable: {
      items: migrateLegacySection(DEFAULT_FINANCIAL_SETTINGS.variable.items, s.variable),
    },
    other_income: {
      items: migrateLegacySection(DEFAULT_FINANCIAL_SETTINGS.other_income.items, s.other_income),
    },
    taxes: {
      items: migrateLegacySection(DEFAULT_FINANCIAL_SETTINGS.taxes.items, s.taxes),
    },
    investments: {
      items: migrateLegacySection(DEFAULT_FINANCIAL_SETTINGS.investments.items, s.investments),
    },
    flows: {
      items: migrateLegacySection(DEFAULT_FINANCIAL_SETTINGS.flows.items, s.flows),
    },
    balance: {
      items: migrateLegacySection(DEFAULT_FINANCIAL_SETTINGS.balance.items, s.balance),
    },
  }
}

// ---------------------------------------------------------------------------
// Helpers — расчёт месячного эквивалента
// ---------------------------------------------------------------------------

/** Сумма всех неархивированных items секции в месячном эквиваленте (cents). */
export function sumSectionMonthlyCents(section: ParameterSection): number {
  return section.items
    .filter((i) => !i.archived)
    .reduce((acc, i) => acc + monthlyEquivalentCents(i), 0)
}

/** Месячный эквивалент позиции. Учитывает period (month/year/...). */
export function monthlyEquivalentCents(item: ParameterItem): number {
  const amount = item.amount_cents ?? 0
  if (amount === 0) return 0
  const period = item.period ?? 'month'
  const months = PERIOD_TO_MONTHS[period]
  // amount за period == amount/months за месяц
  return Math.round(amount / months)
}

// ---------------------------------------------------------------------------
// Queries / mutations
// ---------------------------------------------------------------------------

export function useFinancialSettings(salonId: string | undefined) {
  return useQuery<FinancialSettings>({
    queryKey: ['financial-settings', salonId],
    queryFn: async () => {
      if (!salonId) return DEFAULT_FINANCIAL_SETTINGS
      const { data, error } = await supabase
        .from('salons')
        .select('financial_settings')
        .eq('id', salonId)
        .single()
      if (error) throw error
      return mergeWithDefaults(data?.financial_settings)
    },
    enabled: !!salonId,
    staleTime: 30_000,
  })
}

export function useUpdateFinancialSettings(salonId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (next: FinancialSettings) => {
      if (!salonId) throw new Error('no_salon')
      const { error } = await supabase
        .from('salons')
        .update({ financial_settings: next })
        .eq('id', salonId)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['financial-settings', salonId] })
      qc.invalidateQueries({ queryKey: ['salon', salonId] })
    },
  })
}
