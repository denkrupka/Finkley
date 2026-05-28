import {
  ArrowRight,
  Banknote,
  Building2,
  Layers,
  Plus,
  Receipt,
  Sparkles,
  TrendingUp,
  Trash2,
  Wallet,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Input } from '@/components/ui/input'
import {
  DEFAULT_FINANCIAL_SETTINGS,
  type FinancialSettings,
  type ParamPeriod,
  type ParameterItem,
  type ParameterSection,
} from '@/hooks/useFinancialSettings'
import { cn } from '@/lib/utils/cn'

type CategoryId =
  | 'cash_registers'
  | 'fixed'
  | 'variable'
  | 'taxes'
  | 'investments'
  | 'flows'
  | 'other_income'
  | 'balance'

const CATEGORIES: Array<{
  id: CategoryId
  icon: LucideIcon
  title: string
  description: string
}> = [
  {
    id: 'cash_registers',
    icon: Wallet,
    title: 'Кассы и счета',
    description: 'Где у тебя физически лежат деньги — наличные кассы и безналичные счета.',
  },
  {
    id: 'fixed',
    icon: Receipt,
    title: 'Фиксированные расходы',
    description: 'Аренда, ЗП администратора, ZUS, абонементы — то что платишь каждый месяц.',
  },
  {
    id: 'variable',
    icon: TrendingUp,
    title: 'Переменные расходы',
    description: 'Процент от выручки: комиссия банка, премии, реклама от продаж.',
  },
  {
    id: 'taxes',
    icon: Building2,
    title: 'Налоги и взносы',
    description: 'PIT, CIT, VAT, ZUS — отдельная строка в P&L после операционной прибыли.',
  },
  {
    id: 'other_income',
    icon: Banknote,
    title: 'Прочие доходы',
    description: 'Аренда субаренды, кэшбэк, продажа продуктов на витрине.',
  },
  {
    id: 'investments',
    icon: Layers,
    title: 'Инвестиционная деятельность',
    description: 'Покупка оборудования, ремонт, мебель. В P&L не идёт, только в cashflow.',
  },
  {
    id: 'flows',
    icon: Sparkles,
    title: 'Финансовая деятельность',
    description: 'Кредиты, дивиденды, взносы учредителей — критично для cashflow.',
  },
  {
    id: 'balance',
    icon: Layers,
    title: 'Баланс',
    description: 'Активы (что у тебя есть) и Пассивы (что должен). Снимок состояния компании.',
  },
]

const PERIOD_LABEL: Record<ParamPeriod, string> = {
  day: 'день',
  month: 'мес',
  '2months': '2 мес',
  quarter: 'квартал',
  year: 'год',
}

/**
 * T154 — отдаёт items в иерархическом порядке: сначала parent (без parent_id),
 * сразу за ним — все его дети. Для категорий investments/flows/balance это
 * группы Поступления/Выбытия и Активы/Пассивы.
 *
 * Помечает groupHeader=true для родительских группировок (рендерится
 * заголовком, не редактируется как обычный item).
 */
type HierarchicalItem = ParameterItem & { isGroupHeader?: boolean; depth?: number }

function renderHierarchy(items: ParameterItem[], category: CategoryId): HierarchicalItem[] {
  const hasGroups = category === 'investments' || category === 'flows' || category === 'balance'
  if (!hasGroups) return items.map((it) => ({ ...it }))
  // Headers (без parent_id) идут первыми с подсветкой, дети — после под ним.
  const parents = items.filter((it) => !it.parent_id)
  const childrenByParent = new Map<string, ParameterItem[]>()
  for (const it of items) {
    if (it.parent_id) {
      const arr = childrenByParent.get(it.parent_id) ?? []
      arr.push(it)
      childrenByParent.set(it.parent_id, arr)
    }
  }
  const out: HierarchicalItem[] = []
  for (const p of parents) {
    out.push({ ...p, isGroupHeader: true, depth: 0 })
    for (const child of childrenByParent.get(p.id) ?? []) {
      out.push({ ...child, depth: 1 })
    }
  }
  return out
}

export type ExpensesDraft = FinancialSettings

type Props = {
  /** Legacy: плоский список для create_salon_with_setup RPC. */
  value: string[]
  onChange: (v: string[]) => void
  /** T106 — полная structured версия. Если задана — Step4Expenses
   *  переходит в продвинутый режим с 7 подшагами. */
  financial?: ExpensesDraft
  onFinancialChange?: (v: ExpensesDraft) => void
}

/**
 * T106 — расходы по 7 подшагам из financial_settings.
 *
 * Каждый подшаг — отдельная секция:
 *   - Кассы и счета
 *   - Фиксированные расходы
 *   - Переменные расходы (% от выручки)
 *   - Налоги
 *   - Прочие доходы
 *   - Инвестиционная деятельность
 *   - Финансовая деятельность
 *
 * Юзер навигирует мини-табами наверху. На каждом — описание за что
 * категория отвечает + CRUD списка элементов с дефолтными пресетами.
 *
 * Если financial/onFinancialChange не переданы — используется legacy
 * режим (один плоский список из value[]).
 */
export function Step4Expenses({ value, onChange, financial, onFinancialChange }: Props) {
  const { t } = useTranslation()
  const [activeCategory, setActiveCategory] = useState<CategoryId>('cash_registers')

  // ───── Legacy fallback (когда financial не передан): один плоский список
  if (!financial || !onFinancialChange) {
    return <LegacyFlat value={value} onChange={onChange} />
  }

  function getSection(cat: CategoryId): ParameterSection {
    return (
      financial?.[cat] ?? {
        items: [...(DEFAULT_FINANCIAL_SETTINGS[cat]?.items ?? [])],
      }
    )
  }

  function patchSection(cat: CategoryId, items: ParameterItem[]) {
    onFinancialChange?.({
      ...(financial as FinancialSettings),
      [cat]: { items },
    })
  }

  function addItem(cat: CategoryId) {
    const section = getSection(cat)
    patchSection(cat, [
      ...section.items,
      {
        id: `new-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        label: '',
        amount_cents: 0,
        archived: false,
      },
    ])
  }

  function updateItem(cat: CategoryId, id: string, patch: Partial<ParameterItem>) {
    const section = getSection(cat)
    patchSection(
      cat,
      section.items.map((it) => (it.id === id ? { ...it, ...patch } : it)),
    )
  }

  function removeItem(cat: CategoryId, id: string) {
    const section = getSection(cat)
    patchSection(
      cat,
      section.items.filter((it) => it.id !== id),
    )
  }

  const activeIndex = CATEGORIES.findIndex((c) => c.id === activeCategory)
  const activeMeta = CATEGORIES[activeIndex]!
  const ActiveIcon = activeMeta.icon
  const activeSection = getSection(activeCategory)
  const visibleItems = activeSection.items.filter((it) => !it.archived)
  const isPercent = activeCategory === 'variable'
  const hasPeriod = activeCategory === 'fixed' || activeCategory === 'taxes'
  const hasCashKind = activeCategory === 'cash_registers'

  function nextCategory() {
    if (activeIndex < CATEGORIES.length - 1) {
      setActiveCategory(CATEGORIES[activeIndex + 1]!.id)
    }
  }

  return (
    <div>
      <h1 className="text-brand-navy text-2xl font-bold tracking-tight">
        {t('onboarding.step4.title_v2', { defaultValue: 'Финансовая структура' })}
      </h1>

      {/* Sub-stepper: горизонтальная навигация по 7 категориям */}
      <div className="mt-3 flex gap-1.5 overflow-x-auto pb-2">
        {CATEGORIES.map((cat, i) => {
          const done = i < activeIndex
          const active = i === activeIndex
          const Icon = cat.icon
          return (
            <button
              key={cat.id}
              type="button"
              onClick={() => setActiveCategory(cat.id)}
              className={cn(
                'flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold transition-colors',
                active
                  ? 'border-brand-teal-deep bg-brand-teal-deep text-white'
                  : done
                    ? 'border-brand-sage bg-brand-sage-soft/40 text-brand-sage-deep'
                    : 'border-border bg-card text-muted-foreground hover:bg-muted/40',
              )}
            >
              <Icon className="size-3.5" strokeWidth={2} />
              <span>{cat.title}</span>
            </button>
          )
        })}
      </div>

      {/* Описание активной категории — компактно */}
      <div className="border-brand-teal-deep/30 bg-brand-teal-soft/10 mt-3 rounded-lg border-2 border-dashed px-3 py-2">
        <p className="text-foreground inline-flex items-center gap-1.5 text-sm font-bold">
          <ActiveIcon className="size-3.5" strokeWidth={2} />
          {activeMeta.title}
        </p>
        <p className="text-muted-foreground mt-0.5 line-clamp-2 text-xs leading-snug">
          {activeMeta.description}
        </p>
      </div>

      {/* Список items с CRUD */}
      <div className="mt-3 flex flex-col gap-1.5">
        {visibleItems.length === 0 ? (
          <p className="text-muted-foreground py-4 text-center text-sm italic">
            Пока пусто — нажми «Добавить» ниже.
          </p>
        ) : (
          renderHierarchy(visibleItems, activeCategory).map((it) => {
            // T154 — group header (Поступления / Выбытия) рендерится
            // отдельным заголовком без полей суммы.
            if (it.isGroupHeader) {
              return (
                <div
                  key={it.id}
                  className="text-brand-navy mt-2 text-xs font-bold uppercase tracking-wider"
                >
                  {it.label}
                </div>
              )
            }
            // T142 — per-category колонки. fixed/taxes — добавляем селектор
            // period (мес/квартал/год). cash_registers — селектор cash/non-cash.
            const cols = hasPeriod
              ? '1fr 140px 100px 44px'
              : hasCashKind
                ? '1fr 140px 130px 44px'
                : '1fr 140px 44px'
            return (
              <div
                key={it.id}
                className="grid grid-cols-1 gap-2 sm:gap-2.5"
                style={{ paddingLeft: it.depth ? 16 : 0 }}
              >
                <div
                  className="grid grid-cols-1 gap-2 sm:gap-2.5"
                  style={{ gridTemplateColumns: cols }}
                >
                  <Input
                    value={it.label}
                    onChange={(e) => updateItem(activeCategory, it.id, { label: e.target.value })}
                    placeholder={t('onboarding.step4.label_placeholder', {
                      defaultValue: 'Название позиции',
                    })}
                    className="h-9 text-sm"
                  />
                  {/* Сумма / процент */}
                  <div className="border-input bg-card flex h-9 items-center gap-1.5 rounded-md border px-2.5">
                    {isPercent ? (
                      <>
                        <input
                          type="number"
                          min="0"
                          max="100"
                          step="0.1"
                          value={it.pct ?? 0}
                          onChange={(e) =>
                            updateItem(activeCategory, it.id, {
                              pct: Math.max(0, Math.min(100, Number(e.target.value))),
                            })
                          }
                          className="num text-foreground w-full bg-transparent text-right text-sm font-semibold outline-none"
                        />
                        <span className="text-muted-foreground text-xs">%</span>
                      </>
                    ) : (
                      <>
                        <input
                          type="number"
                          min="0"
                          value={Math.round((it.amount_cents ?? 0) / 100)}
                          onChange={(e) =>
                            updateItem(activeCategory, it.id, {
                              amount_cents: Math.max(0, Number(e.target.value)) * 100,
                            })
                          }
                          className="num text-foreground w-full bg-transparent text-right text-sm font-semibold outline-none"
                        />
                        <span className="text-muted-foreground text-xs">PLN</span>
                      </>
                    )}
                  </div>
                  {/* Period — только fixed/taxes */}
                  {hasPeriod ? (
                    <select
                      value={it.period ?? 'month'}
                      onChange={(e) =>
                        updateItem(activeCategory, it.id, {
                          period: e.target.value as ParamPeriod,
                        })
                      }
                      className="border-input bg-card text-foreground h-9 rounded-md border px-2.5 text-xs font-semibold"
                    >
                      {Object.entries(PERIOD_LABEL).map(([k, v]) => (
                        <option key={k} value={k}>
                          {v}
                        </option>
                      ))}
                    </select>
                  ) : null}
                  {/* Cash kind — только cash_registers. Системные пресеты
                      (director/safe/gotowka/bank_karta/karta_terminal) disabled
                      чтобы юзер не сломал cash-shift discipline. */}
                  {hasCashKind ? (
                    <select
                      value={it.cash_kind ?? 'cash'}
                      onChange={(e) =>
                        updateItem(activeCategory, it.id, {
                          cash_kind: e.target.value as 'cash' | 'non_cash',
                        })
                      }
                      disabled={!!it.preset_key}
                      title={it.preset_key ? 'Тип системной кассы изменить нельзя' : undefined}
                      className="border-input bg-card text-foreground h-9 rounded-md border px-2.5 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <option value="cash">наличные</option>
                      <option value="non_cash">безналичные</option>
                    </select>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => removeItem(activeCategory, it.id)}
                    className="border-border text-muted-foreground hover:text-destructive grid size-9 place-items-center rounded-md border"
                    aria-label="remove"
                  >
                    <Trash2 className="size-4" strokeWidth={1.7} />
                  </button>
                </div>
              </div>
            )
          })
        )}

        <button
          type="button"
          onClick={() => addItem(activeCategory)}
          className="border-brand-border-strong text-muted-foreground hover:border-secondary hover:text-secondary mt-2 inline-flex items-center justify-center gap-2 self-start rounded-md border border-dashed px-4 py-2 text-sm font-semibold"
        >
          <Plus className="size-4" strokeWidth={1.7} />
          {t('onboarding.step4.add_in_section', { defaultValue: 'Добавить позицию' })}
        </button>
      </div>

      {/* Sub-navigation: следующая категория */}
      {activeIndex < CATEGORIES.length - 1 ? (
        <button
          type="button"
          onClick={nextCategory}
          className="text-brand-teal-deep hover:bg-brand-teal-soft/40 mt-3 inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-bold"
        >
          {t('onboarding.step4.next_section', {
            defaultValue: 'Дальше: {{name}} →',
            name: CATEGORIES[activeIndex + 1]!.title,
          })}
          <ArrowRight className="size-3" strokeWidth={2.4} />
        </button>
      ) : null}
    </div>
  )
}

// ─── Legacy fallback (плоский список) ─────────────────────────────────────

function LegacyFlat({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const { t } = useTranslation()
  function update(i: number, name: string) {
    const next = [...value]
    next[i] = name
    onChange(next)
  }
  function remove(i: number) {
    onChange(value.filter((_, idx) => idx !== i))
  }
  function add() {
    onChange([...value, ''])
  }
  return (
    <div>
      <h1 className="text-brand-navy text-3xl font-extrabold tracking-tight">
        {t('onboarding.step4.title', { defaultValue: 'Расходы салона' })}
      </h1>
      <p className="text-muted-foreground mt-2 text-[15px] leading-relaxed">
        {t('onboarding.step4.subtitle', {
          defaultValue:
            'Категории расходов. Точные суммы укажешь позже в Настройках → Справочники → Финансы.',
        })}
      </p>
      <div className="mt-7 flex flex-col gap-2">
        {value.map((cat, i) => (
          <div key={i} className="flex items-center gap-2">
            <Input
              value={cat}
              onChange={(e) => update(i, e.target.value)}
              placeholder={t('onboarding.step4.placeholder', {
                defaultValue: 'Название категории',
              })}
            />
            <button
              type="button"
              onClick={() => remove(i)}
              className="border-border text-muted-foreground hover:text-destructive grid size-9 shrink-0 place-items-center rounded-md border"
            >
              <Trash2 className="size-4" strokeWidth={1.7} />
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={add}
          className="border-brand-border-strong text-muted-foreground hover:border-secondary hover:text-secondary mt-2 inline-flex items-center justify-center gap-2 self-start rounded-md border border-dashed px-4 py-2 text-sm font-semibold"
        >
          <Plus className="size-4" strokeWidth={1.7} />
          {t('onboarding.step4.add', { defaultValue: 'Добавить' })}
        </button>
      </div>
    </div>
  )
}
