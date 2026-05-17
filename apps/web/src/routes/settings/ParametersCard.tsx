import {
  ArrowLeftRight,
  ChevronDown,
  ChevronRight,
  CreditCard,
  Home,
  Landmark,
  PiggyBank,
  Plus,
  Sprout,
  Trash2,
  TrendingDown,
  Undo2,
  type LucideIcon,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useParams, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { PageTabsNav, type PageTab } from '@/components/ui/PageTabsNav'
import {
  DEFAULT_FINANCIAL_SETTINGS,
  monthlyEquivalentCents,
  useFinancialSettings,
  useUpdateFinancialSettings,
  type FinancialSettings,
  type ParamPeriod,
  type ParameterItem,
} from '@/hooks/useFinancialSettings'
import { useSalon } from '@/hooks/useSalons'
import { cn } from '@/lib/utils/cn'
import { formatCurrency } from '@/lib/utils/format-currency'

/**
 * Параметры финансов — единая иерархическая таблица по каждой секции.
 *
 * Любая позиция (включая preset-«стандартные»):
 *   - переименовывается
 *   - редактируется (сумма / процент / период)
 *   - получает подкатегорию (parent_id)
 *   - архивируется (soft-delete, история отчётов не теряется)
 *   - восстанавливается
 *
 * Эта структура — источник истины для Финансового отчёта: он строит строки
 * напрямую из items[].
 */

type SectionKey = keyof FinancialSettings

type SectionDef = {
  key: SectionKey
  titleKey: string
  subtitleKey?: string
  /** Тип значений в секции. */
  kind: 'money' | 'percent'
  /** Показывать колонку «Период» (для постоянных расходов). */
  showPeriod: boolean
  /** Иконка для sub-tab navigation. */
  icon: LucideIcon
}

const SECTIONS: SectionDef[] = [
  {
    key: 'cash_registers',
    titleKey: 'settings.parameters.cash.title',
    subtitleKey: 'settings.parameters.cash.subtitle',
    kind: 'money',
    showPeriod: false,
    icon: CreditCard,
  },
  {
    key: 'fixed',
    titleKey: 'settings.parameters.fixed.title_v2',
    subtitleKey: 'settings.parameters.fixed.subtitle_v2',
    kind: 'money',
    showPeriod: true,
    icon: Home,
  },
  {
    key: 'other_income',
    titleKey: 'settings.parameters.other_income.title',
    subtitleKey: 'settings.parameters.other_income.subtitle',
    kind: 'money',
    showPeriod: false,
    icon: PiggyBank,
  },
  {
    key: 'variable',
    titleKey: 'settings.parameters.variable.title',
    subtitleKey: 'settings.parameters.variable.subtitle',
    kind: 'percent',
    showPeriod: false,
    icon: TrendingDown,
  },
  {
    key: 'taxes',
    titleKey: 'settings.parameters.taxes.title',
    subtitleKey: 'settings.parameters.taxes.subtitle',
    kind: 'money',
    showPeriod: true,
    icon: Landmark,
  },
  {
    key: 'investments',
    titleKey: 'settings.parameters.investments.title',
    subtitleKey: 'settings.parameters.investments.subtitle',
    kind: 'money',
    showPeriod: false,
    icon: Sprout,
  },
  {
    key: 'flows',
    titleKey: 'settings.parameters.flows.title',
    subtitleKey: 'settings.parameters.flows.subtitle',
    kind: 'money',
    showPeriod: true,
    icon: ArrowLeftRight,
  },
  {
    key: 'balance',
    titleKey: 'settings.parameters.balance.title',
    subtitleKey: 'settings.parameters.balance.subtitle',
    kind: 'money',
    showPeriod: false,
    icon: Landmark,
  },
]

const SUB_TABS: PageTab<SectionKey>[] = SECTIONS.map((s) => ({
  id: s.key,
  labelKey: s.titleKey,
  icon: s.icon,
}))

function isSectionKey(v: string | null): v is SectionKey {
  return !!v && SECTIONS.some((s) => s.key === v)
}

const PERIOD_OPTIONS: ParamPeriod[] = ['day', 'month', '2months', 'quarter', 'year']

/**
 * Универсальный редактор финансовых параметров. Раньше показывал все 7
 * секций как sub-tabs. После рефактора Image #45 разнесён по справочникам:
 *   - /settings/expenses-catalog → fixed + variable + taxes
 *   - /settings/cash-registers → cash_registers
 *   - /settings/investments-catalog → investments
 *   - /finance ?tab=income_plans → other_income
 *   - flows (распределение денег) — удалено
 *
 * Если передан `sectionKeys` — рендерятся только эти секции (+ sub-tabs
 * только если их больше одного). Если не передан — поведение как раньше
 * (все секции), используется в legacy-страницах.
 */
type ParametersCardProps = {
  /** Подмножество секций для рендера. Если не передано — все 7. */
  sectionKeys?: SectionKey[]
  /** URL search-param для запоминания активной sub-секции. Default: 'param'. */
  urlKey?: string
}

export function ParametersCard({ sectionKeys, urlKey = 'param' }: ParametersCardProps = {}) {
  const { t } = useTranslation()
  const { salonId } = useParams<{ salonId: string }>()
  const { data: salon } = useSalon(salonId)
  const currency = salon?.currency ?? 'PLN'
  const { data: settings = DEFAULT_FINANCIAL_SETTINGS, isLoading } = useFinancialSettings(salonId)
  const save = useUpdateFinancialSettings(salonId)

  const visibleSections = useMemo(
    () =>
      sectionKeys && sectionKeys.length > 0
        ? SECTIONS.filter((s) => sectionKeys.includes(s.key))
        : SECTIONS,
    [sectionKeys],
  )
  const visibleSubTabs = useMemo(
    () => SUB_TABS.filter((t) => visibleSections.some((s) => s.key === t.id)),
    [visibleSections],
  )

  const [draft, setDraft] = useState<FinancialSettings>(settings)
  const [showArchived, setShowArchived] = useState(false)
  const [params, setParams] = useSearchParams()
  const subParam = params.get(urlKey)
  const firstSectionKey = visibleSections[0]?.key ?? 'cash_registers'
  const activeSection: SectionKey =
    isSectionKey(subParam) && visibleSections.some((s) => s.key === subParam)
      ? subParam
      : firstSectionKey
  const sectionDef = SECTIONS.find((s) => s.key === activeSection)!

  function setActiveSection(id: SectionKey) {
    const next = new URLSearchParams(params)
    next.set(urlKey, id)
    setParams(next, { replace: true })
  }

  useEffect(() => {
    setDraft(settings)
  }, [settings])

  function updateSection(key: SectionKey, update: (items: ParameterItem[]) => ParameterItem[]) {
    setDraft((prev) => ({
      ...prev,
      [key]: { items: update(prev[key].items) },
    }))
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    save.mutate(draft, {
      onSuccess: () => toast.success(t('settings.parameters.toast_saved')),
      onError: (err) =>
        toast.error(t('settings.parameters.toast_error'), {
          description: err instanceof Error ? err.message : String(err),
        }),
    })
  }

  if (isLoading) {
    return (
      <section className="border-border bg-card shadow-finsm rounded-lg border p-5">
        <p className="text-muted-foreground text-sm">{t('common.loading')}</p>
      </section>
    )
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6">
      {/* Sub-tabs рендерим только если секций больше одной. */}
      {visibleSubTabs.length > 1 ? (
        <PageTabsNav
          tabs={visibleSubTabs}
          active={activeSection}
          onChange={setActiveSection}
          t={t}
          wrap
          size="sm"
        />
      ) : null}

      <SectionTable
        key={sectionDef.key}
        def={sectionDef}
        items={draft[sectionDef.key].items}
        currency={currency}
        showArchived={showArchived}
        onShowArchivedChange={setShowArchived}
        onChange={(updater) => updateSection(sectionDef.key, updater)}
      />

      <div className="border-border bg-card shadow-finsm sticky bottom-3 z-10 flex items-center justify-between gap-3 rounded-lg border p-3">
        <p className="text-muted-foreground text-xs">{t('settings.parameters.save_hint')}</p>
        <Button type="submit" variant="primary" size="md" disabled={save.isPending}>
          {save.isPending ? t('common.loading') : t('common.save')}
        </Button>
      </div>
    </form>
  )
}

type SectionTableProps = {
  def: SectionDef
  items: ParameterItem[]
  currency: string
  showArchived: boolean
  onShowArchivedChange: (value: boolean) => void
  onChange: (updater: (items: ParameterItem[]) => ParameterItem[]) => void
}

function SectionTable({
  def,
  items,
  currency,
  showArchived,
  onShowArchivedChange,
  onChange,
}: SectionTableProps) {
  const { t } = useTranslation()

  const visibleItems = useMemo(() => {
    return showArchived ? items : items.filter((i) => !i.archived)
  }, [items, showArchived])

  // Группируем по родителю — для рендера дерева
  const rootItems = visibleItems.filter((i) => !i.parent_id)
  const childrenByParent = useMemo(() => {
    const map = new Map<string, ParameterItem[]>()
    for (const it of visibleItems) {
      if (!it.parent_id) continue
      const arr = map.get(it.parent_id) ?? []
      arr.push(it)
      map.set(it.parent_id, arr)
    }
    return map
  }, [visibleItems])

  function addRoot() {
    onChange((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        label: '',
        amount_cents: def.kind === 'money' ? 0 : undefined,
        pct: def.kind === 'percent' ? 0 : undefined,
        period: def.showPeriod ? 'month' : undefined,
        parent_id: null,
        archived: false,
      },
    ])
  }

  function addChild(parentId: string) {
    onChange((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        label: '',
        amount_cents: def.kind === 'money' ? 0 : undefined,
        pct: def.kind === 'percent' ? 0 : undefined,
        period: def.showPeriod ? 'month' : undefined,
        parent_id: parentId,
        archived: false,
      },
    ])
  }

  function patchItem(id: string, patch: Partial<ParameterItem>) {
    onChange((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)))
  }

  function archiveItem(id: string) {
    onChange((prev) => prev.map((it) => (it.id === id ? { ...it, archived: true } : it)))
  }

  function restoreItem(id: string) {
    onChange((prev) => prev.map((it) => (it.id === id ? { ...it, archived: false } : it)))
  }

  function deleteItem(id: string) {
    // При полном удалении также удаляем детей
    onChange((prev) => prev.filter((it) => it.id !== id && it.parent_id !== id))
  }

  const sectionTotal = visibleItems
    .filter((i) => !i.archived)
    .reduce((acc, i) => acc + (def.kind === 'money' ? monthlyEquivalentCents(i) : 0), 0)

  return (
    <section className="border-border bg-card shadow-finsm overflow-hidden rounded-lg border">
      <header className="border-border bg-muted/20 flex items-start justify-between gap-3 border-b px-5 py-3">
        <div>
          <h3 className="text-brand-navy text-base font-bold tracking-tight">{t(def.titleKey)}</h3>
          {def.subtitleKey ? (
            <p className="text-muted-foreground mt-0.5 text-xs">{t(def.subtitleKey)}</p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {def.kind === 'money' && def.showPeriod ? (
            <span className="text-muted-foreground text-xs">
              {t('settings.parameters.section_monthly_total')}:{' '}
              <span className="num text-foreground font-semibold">
                {formatCurrency(sectionTotal, currency)}
              </span>
            </span>
          ) : null}
          {/* Image #60: чекбокс архива — на уровне каждой секции. */}
          <label className="text-muted-foreground inline-flex items-center gap-1.5 whitespace-nowrap text-xs">
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(e) => onShowArchivedChange(e.target.checked)}
              className="size-3.5"
            />
            {t('settings.parameters.show_archived')}
          </label>
          <Button type="button" variant="outline" size="sm" onClick={addRoot}>
            <Plus className="size-3.5" strokeWidth={2} />
            {t('settings.parameters.add_item')}
          </Button>
        </div>
      </header>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/10 text-muted-foreground border-border text-xs uppercase tracking-wider">
            <tr>
              <th className="px-4 py-2 text-left font-semibold">
                {t('settings.parameters.col_label')}
              </th>
              <th className="w-44 px-4 py-2 text-right font-semibold">
                {def.kind === 'money'
                  ? t('settings.parameters.col_amount')
                  : t('settings.parameters.col_pct')}
              </th>
              {def.showPeriod ? (
                <th className="w-40 px-4 py-2 text-left font-semibold">
                  {t('settings.parameters.col_period')}
                </th>
              ) : null}
              <th className="w-28 px-4 py-2 text-right font-semibold" />
            </tr>
          </thead>
          <tbody>
            {rootItems.length === 0 ? (
              <tr>
                <td
                  colSpan={def.showPeriod ? 4 : 3}
                  className="text-muted-foreground px-4 py-6 text-center text-xs italic"
                >
                  {t('settings.parameters.empty_section')}
                </td>
              </tr>
            ) : (
              rootItems.map((item) =>
                renderRowsForItem(
                  item,
                  childrenByParent,
                  0,
                  def,
                  currency,
                  patchItem,
                  archiveItem,
                  restoreItem,
                  deleteItem,
                  addChild,
                  t,
                ),
              )
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function renderRowsForItem(
  item: ParameterItem,
  childrenByParent: Map<string, ParameterItem[]>,
  depth: number,
  def: SectionDef,
  currency: string,
  patchItem: (id: string, patch: Partial<ParameterItem>) => void,
  archiveItem: (id: string) => void,
  restoreItem: (id: string) => void,
  deleteItem: (id: string) => void,
  addChild: (parentId: string) => void,
  t: (k: string, opts?: Record<string, unknown>) => string,
): React.ReactNode {
  const children = childrenByParent.get(item.id) ?? []
  const row = (
    <ParameterRow
      key={item.id}
      item={item}
      depth={depth}
      def={def}
      currency={currency}
      hasChildren={children.length > 0}
      onPatch={(patch) => patchItem(item.id, patch)}
      onArchive={() => archiveItem(item.id)}
      onRestore={() => restoreItem(item.id)}
      onDelete={() => {
        if (
          !confirm(
            t('settings.parameters.confirm_delete', {
              label: item.label || t('settings.parameters.unnamed'),
            }),
          )
        )
          return
        deleteItem(item.id)
      }}
      onAddChild={() => addChild(item.id)}
      t={t}
    />
  )
  const childRows = children.map((c) =>
    renderRowsForItem(
      c,
      childrenByParent,
      depth + 1,
      def,
      currency,
      patchItem,
      archiveItem,
      restoreItem,
      deleteItem,
      addChild,
      t,
    ),
  )
  return [row, ...childRows]
}

function ParameterRow({
  item,
  depth,
  def,
  currency,
  hasChildren,
  onPatch,
  onArchive,
  onRestore,
  onDelete,
  onAddChild,
  t,
}: {
  item: ParameterItem
  depth: number
  def: SectionDef
  currency: string
  hasChildren: boolean
  onPatch: (patch: Partial<ParameterItem>) => void
  onArchive: () => void
  onRestore: () => void
  onDelete: () => void
  onAddChild: () => void
  t: (k: string, opts?: Record<string, unknown>) => string
}) {
  const currencySymbol = currency === 'EUR' ? '€' : currency === 'USD' ? '$' : currency

  return (
    <tr
      className={cn(
        'border-border/40 hover:bg-muted/20 border-t transition-colors',
        item.archived && 'opacity-60',
      )}
    >
      <td className="px-4 py-1.5 align-middle">
        <div className="flex min-w-0 items-center gap-1.5" style={{ paddingLeft: depth * 18 }}>
          {hasChildren ? (
            <ChevronDown className="text-muted-foreground size-3.5 shrink-0" strokeWidth={2} />
          ) : depth > 0 ? (
            <ChevronRight className="text-muted-foreground/50 size-3.5 shrink-0" strokeWidth={2} />
          ) : (
            <span className="w-3.5 shrink-0" />
          )}
          <Input
            value={item.label}
            onChange={(e) => onPatch({ label: e.target.value })}
            placeholder={t('settings.parameters.label_placeholder')}
            disabled={item.archived}
            className="h-8 min-w-0 flex-1 text-sm"
          />
        </div>
      </td>

      <td className="px-4 py-1.5 align-middle">
        <div className="border-border bg-card flex h-8 items-center gap-1.5 rounded-md border px-2">
          <Input
            type="number"
            inputMode="decimal"
            step="any"
            min="0"
            value={
              def.kind === 'money' ? String((item.amount_cents ?? 0) / 100) : String(item.pct ?? 0)
            }
            onChange={(e) => {
              const n = Number(e.target.value.replace(',', '.'))
              if (!Number.isFinite(n) || n < 0) return
              if (def.kind === 'percent') {
                if (n > 100) return
                onPatch({ pct: n })
              } else {
                onPatch({ amount_cents: Math.round(n * 100) })
              }
            }}
            disabled={item.archived}
            className="num h-full border-0 bg-transparent px-0 text-right text-sm shadow-none focus-visible:ring-0"
          />
          <span className="text-muted-foreground text-xs font-semibold">
            {def.kind === 'money' ? currencySymbol : '%'}
          </span>
        </div>
      </td>

      {def.showPeriod ? (
        <td className="px-4 py-1.5 align-middle">
          <select
            value={item.period ?? 'month'}
            onChange={(e) => onPatch({ period: e.target.value as ParamPeriod })}
            disabled={item.archived}
            className="border-border bg-card h-8 w-full rounded-md border px-2 text-sm disabled:opacity-50"
          >
            {PERIOD_OPTIONS.map((p) => (
              <option key={p} value={p}>
                {t(`settings.parameters.period.${p}`)}
              </option>
            ))}
          </select>
        </td>
      ) : null}

      <td className="px-4 py-1.5 text-right align-middle">
        <div className="inline-flex items-center gap-1">
          {!item.archived ? (
            <>
              <button
                type="button"
                onClick={onAddChild}
                title={t('settings.parameters.add_subcategory')}
                aria-label={t('settings.parameters.add_subcategory')}
                className="text-muted-foreground hover:text-foreground grid size-7 place-items-center rounded-md"
              >
                <Plus className="size-3.5" strokeWidth={2} />
              </button>
              <button
                type="button"
                onClick={onArchive}
                title={t('settings.parameters.archive')}
                aria-label={t('settings.parameters.archive')}
                className="text-muted-foreground hover:text-destructive grid size-7 place-items-center rounded-md"
              >
                <Trash2 className="size-3.5" strokeWidth={1.8} />
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={onRestore}
                title={t('settings.parameters.restore')}
                aria-label={t('settings.parameters.restore')}
                className="text-secondary hover:text-secondary/80 grid size-7 place-items-center rounded-md"
              >
                <Undo2 className="size-3.5" strokeWidth={2} />
              </button>
              <button
                type="button"
                onClick={onDelete}
                title={t('settings.parameters.delete_permanent')}
                aria-label={t('settings.parameters.delete_permanent')}
                className="text-muted-foreground hover:text-destructive grid size-7 place-items-center rounded-md font-semibold"
              >
                ✕
              </button>
            </>
          )}
        </div>
      </td>
    </tr>
  )
}
