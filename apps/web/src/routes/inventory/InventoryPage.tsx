import { AlertTriangle, BarChart3, Package, Plus, Search, Tags, Upload } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useParams, useSearchParams } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useInventoryItems, type InventoryItemRow } from '@/hooks/useInventory'
import { useSalon, useSalonMembership } from '@/hooks/useSalons'
import { cn } from '@/lib/utils/cn'
import { formatCurrency } from '@/lib/utils/format-currency'

import { InventoryAnalyticsTab } from './InventoryAnalyticsTab'
import { InventoryCategoriesDialog } from './InventoryCategoriesDialog'
import { InventoryImportDialog } from './InventoryImportDialog'
import { InventoryItemDrawer } from './InventoryItemDrawer'
import { InventoryItemFormDialog } from './InventoryItemFormDialog'
import { StocktakeDialog } from './StocktakeDialog'

export function InventoryPage() {
  const { t } = useTranslation()
  const { salonId } = useParams<{ salonId: string }>()
  const { data: salon } = useSalon(salonId)
  const { data: membership } = useSalonMembership(salonId)
  const canEdit = membership?.role === 'owner' || membership?.role === 'admin'
  const { data: items = [], isLoading } = useInventoryItems(salonId, { includeArchived: false })

  const [params, setParams] = useSearchParams()
  const tab = (params.get('view') === 'analytics' ? 'analytics' : 'list') as 'list' | 'analytics'
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState<string>('all')
  const [createOpen, setCreateOpen] = useState(false)
  const [stocktakeOpen, setStocktakeOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [categoriesOpen, setCategoriesOpen] = useState(false)
  const [drawerItem, setDrawerItem] = useState<InventoryItemRow | null>(null)

  function setTab(v: 'list' | 'analytics') {
    const next = new URLSearchParams(params)
    if (v === 'list') next.delete('view')
    else next.set('view', v)
    setParams(next, { replace: true })
  }

  const currency = salon?.currency ?? 'PLN'

  const categories = useMemo(() => {
    const set = new Set<string>()
    for (const it of items) if (it.category) set.add(it.category)
    return Array.from(set).sort()
  }, [items])

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase()
    return items.filter((it) => {
      if (categoryFilter !== 'all' && it.category !== categoryFilter) return false
      if (s && !it.name.toLowerCase().includes(s) && !(it.sku ?? '').toLowerCase().includes(s))
        return false
      return true
    })
  }, [items, search, categoryFilter])

  const summary = useMemo(() => {
    let totalValue = 0
    let lowStockCount = 0
    let outOfStockCount = 0
    for (const it of items) {
      totalValue += it.current_stock * it.cost_per_unit_cents
      if (it.current_stock <= 0) outOfStockCount++
      else if (it.current_stock <= it.min_stock) lowStockCount++
    }
    return { totalValue, lowStockCount, outOfStockCount, totalCount: items.length }
  }, [items])

  if (!salonId) return null

  return (
    <div className="flex flex-1 flex-col px-5 py-7 sm:px-8 lg:pb-12">
      {/* Header */}
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-brand-navy text-2xl font-bold tracking-tight">
            {t('inventory.title_v2')}
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">{t('inventory.subtitle_v2')}</p>
        </div>
        {canEdit ? (
          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" size="md" onClick={() => setCategoriesOpen(true)}>
              <Tags className="size-4" strokeWidth={1.8} />
              {t('inventory.categories_button')}
            </Button>
            <Button variant="ghost" size="md" onClick={() => setImportOpen(true)}>
              <Upload className="size-4" strokeWidth={1.8} />
              {t('inventory.import_button')}
            </Button>
            <Button variant="outline" size="md" onClick={() => setStocktakeOpen(true)}>
              {t('inventory.stocktake_button')}
            </Button>
            <Button variant="primary" size="md" onClick={() => setCreateOpen(true)}>
              <Plus className="size-4" strokeWidth={2.4} />
              {t('inventory.add_button')}
            </Button>
          </div>
        ) : null}
      </div>

      {/* Tabs: Список / Аналитика */}
      <div className="border-border bg-card shadow-finsm mb-5 rounded-lg border p-1.5">
        <nav className="-mx-1.5 flex gap-1 overflow-x-auto px-1.5">
          {(
            [
              { id: 'list', label: 'inventory.tabs.list', icon: Package },
              { id: 'analytics', label: 'inventory.tabs.analytics', icon: BarChart3 },
            ] as const
          ).map((nav) => {
            const isActive = tab === nav.id
            const Icon = nav.icon
            return (
              <button
                key={nav.id}
                type="button"
                onClick={() => setTab(nav.id)}
                className={cn(
                  'flex shrink-0 items-center gap-2 rounded-md px-3 py-2 text-sm font-semibold transition-colors',
                  isActive
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'text-muted-foreground hover:bg-muted/40 hover:text-foreground',
                )}
              >
                <Icon className="size-4" strokeWidth={1.8} />
                {t(nav.label)}
              </button>
            )
          })}
        </nav>
      </div>

      {tab === 'analytics' ? (
        <InventoryAnalyticsTab salonId={salonId} currency={currency} />
      ) : (
        <>
          {/* Summary KPIs */}
          <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <KpiCard
              label={t('inventory.kpi.total')}
              value={String(summary.totalCount)}
              tone="navy"
            />
            <KpiCard
              label={t('inventory.kpi.value')}
              value={formatCurrency(summary.totalValue, currency)}
              tone="sage"
            />
            <KpiCard
              label={t('inventory.kpi.low_stock')}
              value={String(summary.lowStockCount)}
              tone={summary.lowStockCount > 0 ? 'amber' : 'navy'}
            />
            <KpiCard
              label={t('inventory.kpi.out_of_stock')}
              value={String(summary.outOfStockCount)}
              tone={summary.outOfStockCount > 0 ? 'red' : 'navy'}
            />
          </div>

          {/* Toolbar */}
          <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
            <div className="relative flex-1">
              <Search
                className="text-muted-foreground pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2"
                strokeWidth={1.7}
              />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t('inventory.search_placeholder')}
                className="pl-10"
              />
            </div>
            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger className="sm:w-56">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('inventory.all_categories')}</SelectItem>
                {categories.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Items list */}
          <div className="border-border bg-card shadow-finsm rounded-lg border">
            <div className="border-border flex items-baseline justify-between border-b px-5 py-4">
              <h2 className="text-brand-navy text-base font-bold tracking-tight">
                {t('inventory.list_title')}
              </h2>
              <span className="text-muted-foreground text-xs">
                {filtered.length} {t('inventory.records')}
              </span>
            </div>

            {isLoading ? (
              <div className="space-y-2 p-3">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="bg-muted/60 h-14 animate-pulse rounded-md" />
                ))}
              </div>
            ) : filtered.length === 0 ? (
              <div className="px-6 py-12 text-center">
                <div className="bg-brand-teal-soft text-brand-teal-deep mx-auto grid size-12 place-items-center rounded-xl">
                  <Package className="size-5" strokeWidth={1.7} />
                </div>
                <p className="text-muted-foreground mt-3 text-sm">
                  {search || categoryFilter !== 'all'
                    ? t('inventory.empty_search')
                    : t('inventory.empty')}
                </p>
                {canEdit && !search && categoryFilter === 'all' ? (
                  <Button className="mt-3" size="sm" onClick={() => setCreateOpen(true)}>
                    <Plus className="size-4" strokeWidth={2} />
                    {t('inventory.add_button')}
                  </Button>
                ) : null}
              </div>
            ) : (
              <ul>
                {filtered.map((it) => {
                  const isLow = it.current_stock <= it.min_stock && it.current_stock > 0
                  const isOut = it.current_stock <= 0
                  const value = it.current_stock * it.cost_per_unit_cents
                  return (
                    <li
                      key={it.id}
                      className="border-border hover:bg-muted/40 grid cursor-pointer grid-cols-[1fr_auto_auto] items-center gap-3 border-t px-5 py-3 first:border-t-0"
                      onClick={() => setDrawerItem(it)}
                    >
                      <div className="min-w-0">
                        <p className="text-foreground flex items-center gap-2 truncate text-sm font-semibold">
                          <span className="truncate">{it.name}</span>
                          {isOut ? (
                            <span className="bg-destructive/10 text-destructive shrink-0 rounded-full px-1.5 py-0.5 text-[9.5px] font-bold uppercase">
                              {t('inventory.badge_out')}
                            </span>
                          ) : isLow ? (
                            <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-amber-100 px-1.5 py-0.5 text-[9.5px] font-bold uppercase text-amber-800">
                              <AlertTriangle className="size-2.5" strokeWidth={2.4} />
                              {t('inventory.badge_low')}
                            </span>
                          ) : null}
                          {it.category ? (
                            <span className="bg-muted text-muted-foreground hidden shrink-0 rounded-full px-1.5 py-0.5 text-[9.5px] font-medium md:inline">
                              {it.category}
                            </span>
                          ) : null}
                        </p>
                        {it.sku || it.supplier ? (
                          <p className="text-brand-text-faint text-[12px]">
                            {it.sku ? `${it.sku}` : ''}
                            {it.sku && it.supplier ? ' · ' : ''}
                            {it.supplier ?? ''}
                          </p>
                        ) : null}
                      </div>
                      <div className="text-right">
                        <p
                          className={cn(
                            'num text-sm font-bold',
                            isOut
                              ? 'text-destructive'
                              : isLow
                                ? 'text-amber-700'
                                : 'text-foreground',
                          )}
                        >
                          {it.current_stock} {it.unit}
                        </p>
                        {it.min_stock > 0 ? (
                          <p className="text-muted-foreground text-[11px]">
                            {t('inventory.min_label')}: {it.min_stock}
                          </p>
                        ) : null}
                      </div>
                      <span className="num text-muted-foreground hidden w-[100px] text-right text-[12px] sm:block">
                        {value > 0 ? formatCurrency(value, currency) : '—'}
                      </span>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>

          <p className="text-muted-foreground mt-3 text-xs">{t('inventory.note')}</p>
        </>
      )}

      <InventoryItemFormDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        salonId={salonId}
        currency={currency}
      />

      <InventoryItemDrawer
        open={!!drawerItem}
        item={drawerItem}
        onClose={() => setDrawerItem(null)}
        salonId={salonId}
        currency={currency}
        canEdit={canEdit}
      />

      <StocktakeDialog
        open={stocktakeOpen}
        onClose={() => setStocktakeOpen(false)}
        salonId={salonId}
        items={items}
      />

      <InventoryImportDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        salonId={salonId}
      />

      <InventoryCategoriesDialog
        open={categoriesOpen}
        onClose={() => setCategoriesOpen(false)}
        salonId={salonId}
      />
    </div>
  )
}

type Tone = 'navy' | 'sage' | 'amber' | 'red'

function KpiCard({ label, value, tone }: { label: string; value: string; tone: Tone }) {
  const colorClass: Record<Tone, string> = {
    navy: 'border-l-brand-navy',
    sage: 'border-l-brand-sage',
    amber: 'border-l-brand-yellow-deep',
    red: 'border-l-destructive',
  }
  return (
    <div
      className={`border-border bg-card shadow-finsm rounded-lg border border-l-4 p-4 ${colorClass[tone]}`}
    >
      <div className="text-muted-foreground text-xs font-semibold">{label}</div>
      <div className="num text-foreground mt-2 text-xl font-bold tracking-tight">{value}</div>
    </div>
  )
}
