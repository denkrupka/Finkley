import { ArrowRight, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Input } from '@/components/ui/input'
import {
  DEFAULT_FINANCIAL_SETTINGS,
  type FinancialSettings,
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

const CATEGORIES: Array<{
  id: CategoryId
  emoji: string
  title: string
  description: string
}> = [
  {
    id: 'cash_registers',
    emoji: '💵',
    title: 'Кассы и счета',
    description:
      'Где у тебя физически лежат деньги. Наличные кассы (Касса директора, Сейф, Готовка) и безналичные (Карта, Терминал эквайринга). К каждой безналичной — позже привяжешь конкретный банк-счёт.',
  },
  {
    id: 'fixed',
    emoji: '📌',
    title: 'Фиксированные расходы',
    description:
      'Те, что платишь каждый месяц независимо от выручки: аренда, ЗП администратора, ZUS, реклама-абонемент, лизинг. Из них AI строит точку безубыточности — «сколько надо заработать чтобы выйти в ноль».',
  },
  {
    id: 'variable',
    emoji: '📈',
    title: 'Переменные расходы',
    description:
      '% от выручки: ЗП администратора по проценту, банковская комиссия эквайринга, премии, реклама по % от продаж. AI автоматически вычитает их при расчёте прибыли на каждый визит.',
  },
  {
    id: 'taxes',
    emoji: '🏛',
    title: 'Налоги и взносы',
    description:
      'ZUS, PIT, CIT, VAT, налог на прибыль. В P&L они идут отдельной строкой после операционной прибыли — так видна реальная чистая прибыль владельца.',
  },
  {
    id: 'other_income',
    emoji: '💰',
    title: 'Прочие доходы',
    description:
      'Помимо услуг — аренда субаренды, кэшбэк, % с продажи продуктов на витрине. Если ничего такого нет — оставь пустым.',
  },
  {
    id: 'investments',
    emoji: '🏗',
    title: 'Инвестиционная деятельность',
    description:
      'Большие покупки (оборудование, ремонт, мебель) и продажа активов. Это НЕ операционные расходы — AI учитывает их в Cashflow Statement, но не в P&L.',
  },
  {
    id: 'flows',
    emoji: '🔄',
    title: 'Финансовая деятельность',
    description:
      'Кредиты полученные/погашенные, выплата дивидендов владельцу, взносы учредителей. Тоже отдельно от операционных расходов — важно для cashflow.',
  },
]

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
  const activeSection = getSection(activeCategory)
  const visibleItems = activeSection.items.filter((it) => !it.archived)
  const isPercent = activeCategory === 'variable'

  function nextCategory() {
    if (activeIndex < CATEGORIES.length - 1) {
      setActiveCategory(CATEGORIES[activeIndex + 1]!.id)
    }
  }

  return (
    <div>
      <h1 className="text-brand-navy text-3xl font-extrabold tracking-tight">
        {t('onboarding.step4.title_v2', { defaultValue: 'Финансовая структура' })}
      </h1>
      <p className="text-muted-foreground mt-2 text-[15px] leading-relaxed">
        {t('onboarding.step4.subtitle_v3', {
          defaultValue:
            'Разделим финансы на 7 блоков — каждый помогает AI правильно строить отчёты. Без правильной структуры P&L не покажет реальную прибыль.',
        })}
      </p>

      {/* Sub-stepper: горизонтальная навигация по 7 категориям */}
      <div className="mt-6 flex gap-1.5 overflow-x-auto pb-2">
        {CATEGORIES.map((cat, i) => {
          const done = i < activeIndex
          const active = i === activeIndex
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
              <span aria-hidden>{cat.emoji}</span>
              <span>{cat.title}</span>
            </button>
          )
        })}
      </div>

      {/* Описание активной категории */}
      <div className="border-brand-teal-deep/30 bg-brand-teal-soft/10 mt-4 rounded-lg border-2 border-dashed p-3.5">
        <p className="text-foreground inline-flex items-center gap-1.5 text-sm font-bold">
          <span aria-hidden>{activeMeta.emoji}</span>
          {activeMeta.title}
        </p>
        <p className="text-muted-foreground mt-1.5 text-xs leading-snug">
          {activeMeta.description}
        </p>
      </div>

      {/* Список items с CRUD */}
      <div className="mt-4 flex flex-col gap-2">
        {visibleItems.length === 0 ? (
          <p className="text-muted-foreground py-4 text-center text-sm italic">
            Пока пусто — нажми «Добавить» ниже.
          </p>
        ) : (
          visibleItems.map((it) => (
            <div
              key={it.id}
              className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_140px_44px] sm:gap-2.5"
            >
              <Input
                value={it.label}
                onChange={(e) => updateItem(activeCategory, it.id, { label: e.target.value })}
                placeholder={t('onboarding.step4.label_placeholder', {
                  defaultValue: 'Название позиции',
                })}
                className="h-9 text-sm"
              />
              {/* Сумма (либо amount_cents в основной валюте, либо pct% для variable) */}
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
                    <span className="text-muted-foreground text-xs">€/мес</span>
                  </>
                )}
              </div>
              <button
                type="button"
                onClick={() => removeItem(activeCategory, it.id)}
                className="border-border text-muted-foreground hover:text-destructive grid size-9 place-items-center rounded-md border"
                aria-label="remove"
              >
                <Trash2 className="size-4" strokeWidth={1.7} />
              </button>
            </div>
          ))
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
          className="text-brand-teal-deep hover:bg-brand-teal-soft/40 mt-6 inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-bold"
        >
          {t('onboarding.step4.next_section', {
            defaultValue: 'Дальше: {{name}} →',
            name: CATEGORIES[activeIndex + 1]!.title,
          })}
          <ArrowRight className="size-3" strokeWidth={2.4} />
        </button>
      ) : null}

      <p className="text-muted-foreground mt-4 text-xs">
        {t('onboarding.step4.hint_settings_v2', {
          defaultValue:
            'После создания салона всё это будет в Настройки → Справочники → Финансы — там удобнее добавлять, переименовывать, архивировать.',
        })}
      </p>
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
