import { Archive, FlaskConical, Loader2, Percent, Plus, RotateCcw, Trash2, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useParams } from 'react-router-dom'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useSalon } from '@/hooks/useSalons'
import {
  useBulkSetServiceCost,
  useCreateService,
  useCreateServiceCategory,
  useServiceCategories,
  useServices,
  useUpdateService,
  type ServiceCategoryRow,
  type ServiceRow,
} from '@/hooks/useServices'
import { supabase } from '@/lib/supabase/client'
import { cn } from '@/lib/utils/cn'
import { formatCurrency } from '@/lib/utils/format-currency'

import { ServiceRecipeDialog } from './ServiceRecipeDialog'

/**
 * /{salonId}/services — каталог услуг.
 *
 * Image #39 refactor: единая красивая таблица всех услуг с подписанными
 * колонками. Клик по строке открывает ServiceDetailModal с полным edit
 * (включая раньше отдельный блок «Параметры услуг» — теперь они в
 * колонках/модалке услуги). Кнопка «+ Услуга» открывает компактную
 * модалку с именем + категорией (dropdown с опцией создания новой).
 *
 * Удалены 3 секции, которые раньше были на этой странице:
 *  - «Категории услуг и расходов» — категории создаются inline в +Услуга
 *  - «По категориям» — read-only сводка, дублировала колонку Категория
 *  - «Параметры услуг» — глобальные дефолты больше не редактируются
 *    отдельно; per-service в модалке.
 */
export function ServicesPage() {
  const { t } = useTranslation()
  const { salonId } = useParams<{ salonId: string }>()
  const { data: salon } = useSalon(salonId)
  const { data: services = [] } = useServices(salonId)
  const { data: categories = [] } = useServiceCategories(salonId)

  const [openDetail, setOpenDetail] = useState<ServiceRow | null>(null)
  const [openNew, setOpenNew] = useState(false)
  const [openBulkCost, setOpenBulkCost] = useState(false)
  const [showArchived, setShowArchived] = useState(false)
  const [archived, setArchived] = useState<ServiceRow[]>([])

  useEffect(() => {
    if (!showArchived || !salonId) return
    void supabase
      .from('services')
      .select(
        'id, salon_id, category_id, name, default_price_cents, default_duration_min, cost_cents, is_archived, staff_count_required, avg_service_hours, staff_work_hours_per_day, staff_work_days_per_month, utilization_pct, avg_check_cents, staff_payout_pct, materials_pct',
      )
      .eq('salon_id', salonId)
      .eq('is_archived', true)
      .order('name', { ascending: true })
      .then(({ data }) => setArchived((data as ServiceRow[]) ?? []))
  }, [showArchived, salonId])

  const currency = salon?.currency ?? 'PLN'
  const categoryById = useMemo(() => {
    const m = new Map<string, ServiceCategoryRow>()
    for (const c of categories) m.set(c.id, c)
    return m
  }, [categories])

  if (!salonId) return null

  return (
    <div className="flex flex-1 flex-col px-5 py-7 sm:px-8 lg:pb-12">
      <header className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-brand-navy text-2xl font-bold tracking-tight">
            {t('services_page.title')}
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">{t('services_page.subtitle')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {services.length > 0 ? (
            <Button variant="outline" onClick={() => setOpenBulkCost(true)}>
              <Percent className="size-4" strokeWidth={2} />
              {t('services_page.bulk_cost.button')}
            </Button>
          ) : null}
          <Button onClick={() => setOpenNew(true)}>
            <Plus className="size-4" strokeWidth={2} />
            {t('services_page.add')}
          </Button>
        </div>
      </header>

      <section className="border-border bg-card shadow-finsm overflow-hidden rounded-lg border">
        {services.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <p className="text-muted-foreground text-sm">{t('services_page.empty')}</p>
            <Button variant="outline" size="md" className="mt-3" onClick={() => setOpenNew(true)}>
              <Plus className="size-4" strokeWidth={2} />
              {t('services_page.add')}
            </Button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-border bg-muted/10 border-b">
                <tr className="text-muted-foreground text-left text-[11px] font-semibold uppercase tracking-wider">
                  <th className="px-4 py-3">{t('services_page.cols.name')}</th>
                  <th className="px-4 py-3">{t('services_page.cols.category')}</th>
                  <th className="px-4 py-3 text-right">{t('services_page.cols.duration')}</th>
                  <th className="px-4 py-3 text-right">{t('services_page.cols.price')}</th>
                  <th className="px-4 py-3 text-right">{t('services_page.cols.cost')}</th>
                  <th className="px-4 py-3 text-right">{t('services_page.cols.margin')}</th>
                  <th className="px-4 py-3 text-right">{t('services_page.cols.workstations')}</th>
                  <th className="px-4 py-3 text-right">{t('services_page.cols.materials_pct')}</th>
                  <th className="px-4 py-3 text-right">{t('services_page.cols.staff_pct')}</th>
                </tr>
              </thead>
              <tbody className="divide-border divide-y">
                {services.map((s) => {
                  const cat = s.category_id ? categoryById.get(s.category_id) : null
                  const margin =
                    s.cost_cents == null
                      ? null
                      : ((s.default_price_cents - s.cost_cents) / s.default_price_cents) * 100
                  return (
                    <tr
                      key={s.id}
                      onClick={() => setOpenDetail(s)}
                      className="hover:bg-muted/30 cursor-pointer transition-colors"
                    >
                      <td className="text-foreground px-4 py-3 font-semibold">{s.name}</td>
                      <td className="text-muted-foreground px-4 py-3 text-xs">
                        {cat ? (
                          <span className="bg-muted text-foreground rounded-full px-2 py-0.5 text-[11px] font-semibold">
                            {cat.name}
                          </span>
                        ) : (
                          <span className="text-muted-foreground/70">—</span>
                        )}
                      </td>
                      <td className="num text-muted-foreground px-4 py-3 text-right">
                        {s.default_duration_min
                          ? `${s.default_duration_min} ${t('common.min')}`
                          : '—'}
                      </td>
                      <td className="num text-foreground px-4 py-3 text-right font-bold">
                        {formatCurrency(s.default_price_cents, currency)}
                      </td>
                      <td className="num text-muted-foreground px-4 py-3 text-right">
                        {s.cost_cents == null ? '—' : formatCurrency(s.cost_cents, currency)}
                      </td>
                      <td className="num px-4 py-3 text-right">
                        {margin == null ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          <span
                            className={cn(
                              margin >= 50
                                ? 'text-brand-sage font-semibold'
                                : margin >= 35
                                  ? 'text-brand-gold-deep font-semibold'
                                  : 'text-brand-red font-semibold',
                            )}
                          >
                            {margin.toFixed(0)}%
                          </span>
                        )}
                      </td>
                      <td className="num text-muted-foreground px-4 py-3 text-right">
                        {s.staff_count_required > 0 ? s.staff_count_required : '—'}
                      </td>
                      <td className="num text-muted-foreground px-4 py-3 text-right">
                        {s.materials_pct > 0 ? `${s.materials_pct.toFixed(0)}%` : '—'}
                      </td>
                      <td className="num text-muted-foreground px-4 py-3 text-right">
                        {s.staff_payout_pct > 0 ? `${s.staff_payout_pct.toFixed(0)}%` : '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Архивные — collapsible */}
      <div className="mt-4">
        <button
          type="button"
          onClick={() => setShowArchived((v) => !v)}
          className="text-muted-foreground hover:text-foreground text-xs underline-offset-2 hover:underline"
        >
          {showArchived ? t('services_page.hide_archived') : t('services_page.show_archived')}
        </button>
        {showArchived && archived.length > 0 ? (
          <ul className="border-border bg-card shadow-finsm mt-2 divide-y rounded-lg border">
            {archived.map((s) => (
              <li
                key={s.id}
                className="text-muted-foreground flex items-center justify-between px-4 py-2.5 text-sm"
              >
                <span>{s.name}</span>
                <RestoreButton
                  serviceId={s.id}
                  salonId={salonId}
                  onRestored={() => setArchived((prev) => prev.filter((a) => a.id !== s.id))}
                />
              </li>
            ))}
          </ul>
        ) : null}
        {showArchived && archived.length === 0 ? (
          <p className="text-muted-foreground mt-2 text-xs">{t('services_page.archived_empty')}</p>
        ) : null}
      </div>

      <ServiceDetailModal
        service={openDetail}
        categories={categories}
        currency={currency}
        salonId={salonId}
        onClose={() => setOpenDetail(null)}
      />

      <NewServiceModal
        open={openNew}
        categories={categories}
        salonId={salonId}
        onClose={() => setOpenNew(false)}
      />

      <BulkCostDialog
        open={openBulkCost}
        salonId={salonId}
        onClose={() => setOpenBulkCost(false)}
      />
    </div>
  )
}

function BulkCostDialog({
  open,
  salonId,
  onClose,
}: {
  open: boolean
  salonId: string
  onClose: () => void
}) {
  const { t } = useTranslation()
  const bulk = useBulkSetServiceCost(salonId)
  const [percent, setPercent] = useState(30)
  const [overwrite, setOverwrite] = useState(false)

  if (!open) return null

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:!max-w-[440px]">
        <DialogHeader>
          <DialogTitle>{t('services_page.bulk_cost.title')}</DialogTitle>
          <DialogDescription>{t('services_page.bulk_cost.subtitle')}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4 py-2">
          <div>
            <Label htmlFor="bulk-cost-pct">{t('services_page.bulk_cost.percent_label')}</Label>
            <div className="mt-1.5 flex items-center gap-2">
              <Input
                id="bulk-cost-pct"
                type="number"
                inputMode="decimal"
                min={0}
                max={100}
                value={percent}
                onChange={(e) => {
                  const v = Number(e.target.value)
                  if (Number.isFinite(v)) setPercent(Math.max(0, Math.min(100, v)))
                }}
                className="w-24 text-right"
              />
              <span className="text-muted-foreground text-sm">%</span>
            </div>
            <p className="text-muted-foreground mt-1 text-[11px]">
              {t('services_page.bulk_cost.percent_hint')}
            </p>
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={overwrite}
              onChange={(e) => setOverwrite(e.target.checked)}
              className="size-4"
            />
            <span>{t('services_page.bulk_cost.overwrite_label')}</span>
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={bulk.isPending}>
            {t('common.cancel')}
          </Button>
          <Button
            onClick={() => {
              bulk.mutate(
                { percent, overwrite },
                {
                  onSuccess: (n) => {
                    toast.success(t('services_page.bulk_cost.toast_done', { count: n }))
                    onClose()
                  },
                  onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
                },
              )
            }}
            disabled={bulk.isPending}
          >
            {bulk.isPending ? t('common.loading') : t('services_page.bulk_cost.submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function RestoreButton({
  serviceId,
  salonId,
  onRestored,
}: {
  serviceId: string
  salonId: string
  onRestored: () => void
}) {
  const { t } = useTranslation()
  const update = useUpdateService(salonId)
  return (
    <button
      type="button"
      onClick={() =>
        update.mutate(
          { id: serviceId, is_archived: false },
          {
            onSuccess: () => {
              toast.success(t('services_page.toast_restored'))
              onRestored()
            },
            onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
          },
        )
      }
      className="hover:text-foreground flex items-center gap-1 text-xs"
    >
      <RotateCcw className="size-3.5" strokeWidth={1.8} />
      {t('services_page.restore')}
    </button>
  )
}

function ServiceDetailModal({
  service,
  categories,
  currency,
  salonId,
  onClose,
}: {
  service: ServiceRow | null
  categories: ServiceCategoryRow[]
  currency: string
  salonId: string
  onClose: () => void
}) {
  const { t } = useTranslation()
  const update = useUpdateService(salonId)
  const createCategory = useCreateServiceCategory(salonId)

  const [name, setName] = useState('')
  const [categoryId, setCategoryId] = useState<string>('')
  const [priceStr, setPriceStr] = useState('')
  const [costStr, setCostStr] = useState('')
  const [durationStr, setDurationStr] = useState('')
  const [workstations, setWorkstations] = useState(1)
  const [materialsStr, setMaterialsStr] = useState('')
  const [staffPctStr, setStaffPctStr] = useState('')
  /** Image #47: inline-создание новой категории (как в NewServiceModal). */
  const [addingCategory, setAddingCategory] = useState(false)
  const [newCategoryName, setNewCategoryName] = useState('')
  /** Image #47: открыть рецепт материалов для услуги. */
  const [recipeOpen, setRecipeOpen] = useState(false)

  useEffect(() => {
    if (!service) return
    setName(service.name)
    setCategoryId(service.category_id ?? '__none__')
    setPriceStr((service.default_price_cents / 100).toString())
    setCostStr(service.cost_cents == null ? '' : (service.cost_cents / 100).toString())
    setDurationStr(service.default_duration_min == null ? '' : String(service.default_duration_min))
    setWorkstations(service.staff_count_required ?? 1)
    setMaterialsStr(service.materials_pct > 0 ? String(service.materials_pct) : '')
    setStaffPctStr(service.staff_payout_pct > 0 ? String(service.staff_payout_pct) : '')
    setAddingCategory(false)
    setNewCategoryName('')
  }, [service])

  function submitNewCategory() {
    const trimmed = newCategoryName.trim()
    if (trimmed.length < 1) return
    createCategory.mutate(
      { name: trimmed },
      {
        onSuccess: (id) => {
          setCategoryId(id)
          setAddingCategory(false)
          setNewCategoryName('')
          toast.success(t('services_page.toast_category_created'))
        },
        onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
      },
    )
  }

  if (!service) return null

  function save() {
    if (!service) return
    const trimmed = name.trim()
    if (trimmed.length < 1) return toast.error(t('services_page.error_name'))
    const price = Math.round(Number(priceStr.replace(',', '.')) * 100)
    if (!isFinite(price) || price < 0) return toast.error(t('services_page.error_price'))
    const cost = costStr.trim() === '' ? null : Math.round(Number(costStr.replace(',', '.')) * 100)
    if (cost !== null && (!isFinite(cost) || cost < 0))
      return toast.error(t('services_page.error_cost'))
    const duration = durationStr.trim() === '' ? null : parseInt(durationStr, 10)
    if (duration !== null && (!isFinite(duration) || duration < 0))
      return toast.error(t('services_page.error_duration'))
    const materials = materialsStr.trim() === '' ? 0 : Number(materialsStr.replace(',', '.'))
    if (!isFinite(materials) || materials < 0 || materials > 100)
      return toast.error(t('services_page.error_pct'))
    const staffPct = staffPctStr.trim() === '' ? 0 : Number(staffPctStr.replace(',', '.'))
    if (!isFinite(staffPct) || staffPct < 0 || staffPct > 100)
      return toast.error(t('services_page.error_pct'))

    update.mutate(
      {
        id: service.id,
        name: trimmed,
        category_id: categoryId === '__none__' ? null : categoryId,
        default_price_cents: price,
        cost_cents: cost,
        default_duration_min: duration,
        staff_count_required: Math.max(1, Math.round(workstations)),
        materials_pct: materials,
        staff_payout_pct: staffPct,
      },
      {
        onSuccess: () => {
          toast.success(t('services_page.toast_updated'))
          onClose()
        },
        onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
      },
    )
  }

  function archive() {
    if (!service) return
    if (!confirm(t('services_page.confirm_archive'))) return
    update.mutate(
      { id: service.id, is_archived: true },
      {
        onSuccess: () => {
          toast.success(t('services_page.toast_archived'))
          onClose()
        },
        onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
      },
    )
  }

  return (
    <Dialog open={!!service} onOpenChange={(v) => !v && onClose()}>
      {/* Image #117: расширили модалку до 720px и навесили min-w-0 на 3-col
          гриды — теперь длинные ru-лейблы («Себестоимость (PLN)», «% мастера
          (%)») умещаются без обрезки правой колонки и кнопки Сохранить. */}
      <DialogContent className="sm:!w-[720px] sm:!max-w-[720px]">
        <DialogHeader>
          <DialogTitle>{t('services_page.detail.title')}</DialogTitle>
          <DialogDescription>
            {t('services_page.detail.subtitle', { name: service.name })}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4 px-5 py-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="svc-name">{t('services_page.cols.name')}</Label>
            <Input id="svc-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="svc-cat">{t('services_page.cols.category')}</Label>
            {addingCategory ? (
              <div className="flex items-center gap-2">
                <Input
                  value={newCategoryName}
                  onChange={(e) => setNewCategoryName(e.target.value)}
                  placeholder={t('services_page.new.category_placeholder')}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      submitNewCategory()
                    }
                  }}
                  autoFocus
                />
                <Button
                  type="button"
                  size="sm"
                  onClick={submitNewCategory}
                  disabled={createCategory.isPending}
                >
                  {createCategory.isPending ? (
                    <Loader2 className="size-4 animate-spin" strokeWidth={2} />
                  ) : (
                    <Plus className="size-4" strokeWidth={2} />
                  )}
                </Button>
                <button
                  type="button"
                  onClick={() => {
                    setAddingCategory(false)
                    setNewCategoryName('')
                  }}
                  className="text-muted-foreground hover:text-destructive grid size-8 place-items-center rounded-md"
                  aria-label={t('common.cancel')}
                >
                  <X className="size-4" strokeWidth={1.8} />
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <Select value={categoryId} onValueChange={setCategoryId}>
                  <SelectTrigger id="svc-cat" className="flex-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">{t('services_page.no_category')}</SelectItem>
                    {categories.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setAddingCategory(true)}
                  title={t('services_page.new.add_category')}
                >
                  <Plus className="size-4" strokeWidth={2} />
                </Button>
              </div>
            )}
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="svc-price">
                {t('services_page.cols.price')} ({currency})
              </Label>
              <Input
                id="svc-price"
                inputMode="decimal"
                value={priceStr}
                onChange={(e) => setPriceStr(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="svc-cost">
                {t('services_page.cols.cost')} ({currency})
              </Label>
              <Input
                id="svc-cost"
                inputMode="decimal"
                value={costStr}
                onChange={(e) => setCostStr(e.target.value)}
                placeholder="—"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="svc-dur">{t('services_page.cols.duration')}</Label>
              <Input
                id="svc-dur"
                inputMode="numeric"
                value={durationStr}
                onChange={(e) => setDurationStr(e.target.value)}
                placeholder={t('common.min')}
              />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="svc-ws">{t('services_page.cols.workstations')}</Label>
              <Input
                id="svc-ws"
                type="number"
                min="1"
                value={workstations}
                onChange={(e) => setWorkstations(Number(e.target.value))}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="svc-mat">{t('services_page.cols.materials_pct')} (%)</Label>
              <Input
                id="svc-mat"
                inputMode="decimal"
                value={materialsStr}
                onChange={(e) => setMaterialsStr(e.target.value)}
                placeholder="0"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="svc-pct">{t('services_page.cols.staff_pct')} (%)</Label>
              <Input
                id="svc-pct"
                inputMode="decimal"
                value={staffPctStr}
                onChange={(e) => setStaffPctStr(e.target.value)}
                placeholder={t('services_page.detail.staff_pct_placeholder')}
              />
            </div>
          </div>
          {/* Image #47: блок управления составом материалов услуги.
              Кнопка открывает ServiceRecipeDialog где владелец выбирает
              позиции из inventory + указывает количество расхода на одну
              услугу. При следующей оплате визита материалы списываются
              автоматически через trg_visits_consume_materials. */}
          <div className="border-border/60 bg-muted/10 flex items-center justify-between gap-3 rounded-md border px-3 py-2.5">
            <div className="flex min-w-0 items-center gap-2">
              <FlaskConical className="text-brand-teal size-4 shrink-0" strokeWidth={1.8} />
              <div className="min-w-0">
                <p className="text-foreground truncate text-sm font-semibold">
                  {t('services_page.recipe.section_title')}
                </p>
                <p className="text-muted-foreground truncate text-[11px]">
                  {t('services_page.recipe.section_hint')}
                </p>
              </div>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={() => setRecipeOpen(true)}>
              {t('services_page.recipe.open_button')}
            </Button>
          </div>
          <p className="text-muted-foreground text-xs">{t('services_page.detail.hint')}</p>
        </div>
        <DialogFooter className="flex-row justify-between gap-2 px-5">
          <Button
            variant="outline"
            type="button"
            onClick={archive}
            disabled={update.isPending}
            className="text-destructive hover:text-destructive"
          >
            <Archive className="size-4" strokeWidth={1.8} />
            {t('services_page.archive')}
          </Button>
          <div className="flex items-center gap-2">
            <Button variant="outline" type="button" onClick={onClose} disabled={update.isPending}>
              <X className="size-4" strokeWidth={1.8} />
              {t('common.cancel')}
            </Button>
            <Button type="button" onClick={save} disabled={update.isPending}>
              {update.isPending ? (
                <Loader2 className="size-4 animate-spin" strokeWidth={2} />
              ) : null}
              {t('common.save')}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
      <ServiceRecipeDialog
        open={recipeOpen}
        onClose={() => setRecipeOpen(false)}
        salonId={salonId}
        service={{ id: service.id, name: service.name }}
      />
    </Dialog>
  )
}

function NewServiceModal({
  open,
  categories,
  salonId,
  onClose,
}: {
  open: boolean
  categories: ServiceCategoryRow[]
  salonId: string
  onClose: () => void
}) {
  const { t } = useTranslation()
  const create = useCreateService(salonId)
  const createCategory = useCreateServiceCategory(salonId)

  const [name, setName] = useState('')
  const [categoryId, setCategoryId] = useState<string>('__none__')
  const [addingCategory, setAddingCategory] = useState(false)
  const [newCategoryName, setNewCategoryName] = useState('')

  useEffect(() => {
    if (open) {
      setName('')
      setCategoryId('__none__')
      setAddingCategory(false)
      setNewCategoryName('')
    }
  }, [open])

  function submit() {
    const trimmed = name.trim()
    if (trimmed.length < 1) return toast.error(t('services_page.error_name'))
    create.mutate(
      {
        name: trimmed,
        category_id: categoryId === '__none__' ? null : categoryId,
        default_price_cents: 0,
        cost_cents: null,
        default_duration_min: 60,
      },
      {
        onSuccess: () => {
          toast.success(t('services_page.toast_created'))
          onClose()
        },
        onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
      },
    )
  }

  function submitNewCategory() {
    const trimmed = newCategoryName.trim()
    if (trimmed.length < 1) return
    createCategory.mutate(
      { name: trimmed },
      {
        onSuccess: (id) => {
          setCategoryId(id)
          setAddingCategory(false)
          setNewCategoryName('')
          toast.success(t('services_page.toast_category_created'))
        },
        onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
      },
    )
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('services_page.new.title')}</DialogTitle>
          <DialogDescription>{t('services_page.new.subtitle')}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4 px-5 py-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="new-svc-name">{t('services_page.cols.name')}</Label>
            <Input
              id="new-svc-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('services_page.new.name_placeholder')}
              autoFocus
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="new-svc-cat">{t('services_page.cols.category')}</Label>
            {addingCategory ? (
              <div className="flex items-center gap-2">
                <Input
                  value={newCategoryName}
                  onChange={(e) => setNewCategoryName(e.target.value)}
                  placeholder={t('services_page.new.category_placeholder')}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      submitNewCategory()
                    }
                  }}
                />
                <Button
                  type="button"
                  size="sm"
                  onClick={submitNewCategory}
                  disabled={createCategory.isPending}
                >
                  {createCategory.isPending ? (
                    <Loader2 className="size-4 animate-spin" strokeWidth={2} />
                  ) : (
                    <Plus className="size-4" strokeWidth={2} />
                  )}
                </Button>
                <button
                  type="button"
                  onClick={() => {
                    setAddingCategory(false)
                    setNewCategoryName('')
                  }}
                  className="text-muted-foreground hover:text-destructive grid size-8 place-items-center rounded-md"
                  aria-label={t('common.cancel')}
                >
                  <Trash2 className="size-4" strokeWidth={1.8} />
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <Select value={categoryId} onValueChange={setCategoryId}>
                  <SelectTrigger id="new-svc-cat" className="flex-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">{t('services_page.no_category')}</SelectItem>
                    {categories.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setAddingCategory(true)}
                  title={t('services_page.new.add_category')}
                >
                  <Plus className="size-4" strokeWidth={2} />
                </Button>
              </div>
            )}
          </div>
          <p className="text-muted-foreground text-xs">{t('services_page.new.hint')}</p>
        </div>
        <DialogFooter className="px-5">
          <Button variant="outline" type="button" onClick={onClose} disabled={create.isPending}>
            {t('common.cancel')}
          </Button>
          <Button type="button" onClick={submit} disabled={create.isPending}>
            {create.isPending ? <Loader2 className="size-4 animate-spin" strokeWidth={2} /> : null}
            {t('services_page.new.submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
