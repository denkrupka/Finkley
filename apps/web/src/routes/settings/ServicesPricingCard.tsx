import { Archive, Loader2, Plus, RotateCcw } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useParams } from 'react-router-dom'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useSalon } from '@/hooks/useSalons'
import {
  useCreateService,
  useServiceCategories,
  useServices,
  useUpdateService,
} from '@/hooks/useServices'
import { supabase } from '@/lib/supabase/client'
import { formatCurrency } from '@/lib/utils/format-currency'

/**
 * ServicesPricingCard — полный CRUD услуг (TASK-12 + маржа TASK-23).
 *
 * Inline edit полей: name, category, price, cost, duration. Архивирование
 * (`is_archived = true`) — soft delete для сохранения истории визитов.
 * Кнопка «+ Услуга» добавляет новую с дефолтами.
 *
 * Архивированные показываются если включён toggle «Показать архив».
 */
export function ServicesPricingCard() {
  const { t } = useTranslation()
  const { salonId } = useParams<{ salonId: string }>()
  const { data: salon } = useSalon(salonId)
  const { data: services } = useServices(salonId)
  const { data: categories } = useServiceCategories(salonId)
  const update = useUpdateService(salonId)
  const create = useCreateService(salonId)

  const [showArchived, setShowArchived] = useState(false)
  const [archived, setArchived] = useState<typeof services>([])

  // Локальные drafts по id — что пользователь набирает до blur.
  const [drafts, setDrafts] = useState<
    Record<string, { name?: string; price?: string; cost?: string; duration?: string }>
  >({})

  useEffect(() => {
    if (!services) return
    setDrafts((prev) => {
      const next = { ...prev }
      for (const s of services) {
        if (next[s.id]) continue
        next[s.id] = {
          name: s.name,
          price: (s.default_price_cents / 100).toString(),
          cost: s.cost_cents == null ? '' : (s.cost_cents / 100).toString(),
          duration: s.default_duration_min == null ? '' : String(s.default_duration_min),
        }
      }
      return next
    })
  }, [services])

  // Загружаем архивированные only on demand
  useEffect(() => {
    if (!showArchived || !salonId) return
    void supabase
      .from('services')
      .select(
        'id, salon_id, category_id, name, default_price_cents, default_duration_min, cost_cents, is_archived',
      )
      .eq('salon_id', salonId)
      .eq('is_archived', true)
      .order('name', { ascending: true })
      .then(({ data }) => setArchived((data as typeof services) ?? []))
  }, [showArchived, salonId])

  const currency = salon?.currency ?? 'PLN'

  const totals = useMemo(() => {
    if (!services) return { withCost: 0, total: 0 }
    return {
      withCost: services.filter((s) => s.cost_cents != null).length,
      total: services.length,
    }
  }, [services])

  if (!salonId) return null

  function commitField(serviceId: string, field: 'name' | 'price' | 'cost' | 'duration') {
    const svc = services?.find((s) => s.id === serviceId)
    if (!svc) return
    const draft = drafts[serviceId]
    if (!draft) return
    if (field === 'name') {
      const raw = (draft.name ?? '').trim()
      if (raw === '' || raw === svc.name) return
      update.mutate({ id: serviceId, name: raw })
    } else if (field === 'price') {
      const raw = (draft.price ?? '').trim()
      if (raw === '') return
      const num = Number(raw.replace(',', '.'))
      if (!isFinite(num) || num < 0) return toast.error(t('settings.services.error_invalid'))
      const cents = Math.round(num * 100)
      if (cents === svc.default_price_cents) return
      update.mutate({ id: serviceId, default_price_cents: cents })
    } else if (field === 'cost') {
      const raw = (draft.cost ?? '').trim()
      const newVal: number | null =
        raw === '' ? null : Math.round(Number(raw.replace(',', '.')) * 100)
      if (newVal !== null && (!isFinite(newVal) || newVal < 0))
        return toast.error(t('settings.services.error_invalid'))
      if (newVal === svc.cost_cents) return
      update.mutate({ id: serviceId, cost_cents: newVal })
    } else if (field === 'duration') {
      const raw = (draft.duration ?? '').trim()
      const newVal: number | null = raw === '' ? null : parseInt(raw, 10)
      if (newVal !== null && (!isFinite(newVal) || newVal < 0))
        return toast.error(t('settings.services.error_invalid'))
      if (newVal === svc.default_duration_min) return
      update.mutate({ id: serviceId, default_duration_min: newVal })
    }
  }

  function commitCategory(serviceId: string, value: string) {
    const newCat = value === '__none__' ? null : value
    const svc = services?.find((s) => s.id === serviceId)
    if (!svc || svc.category_id === newCat) return
    update.mutate({ id: serviceId, category_id: newCat })
  }

  function archive(serviceId: string) {
    if (!confirm(t('settings.services.confirm_archive'))) return
    update.mutate(
      { id: serviceId, is_archived: true },
      { onSuccess: () => toast.success(t('settings.services.toast_archived')) },
    )
  }

  function restore(serviceId: string) {
    update.mutate(
      { id: serviceId, is_archived: false },
      {
        onSuccess: () => {
          toast.success(t('settings.services.toast_restored'))
          setArchived((prev) => (prev ?? []).filter((s) => s.id !== serviceId))
        },
      },
    )
  }

  function addService() {
    create.mutate(
      {
        name: t('settings.services.new_default_name'),
        default_price_cents: 0,
        cost_cents: null,
        default_duration_min: 60,
        category_id: categories?.[0]?.id ?? null,
      },
      {
        onSuccess: () => toast.success(t('settings.services.toast_created')),
        onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
      },
    )
  }

  return (
    <section className="border-border bg-card shadow-finsm rounded-lg border p-5 sm:p-6">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-brand-navy text-base font-bold tracking-tight">
            {t('settings.services.title')}
          </h2>
          <p className="text-muted-foreground mt-1 text-sm">
            {t('settings.services.subtitle', { withCost: totals.withCost, total: totals.total })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {update.isPending || create.isPending ? (
            <Loader2 className="text-muted-foreground size-4 animate-spin" strokeWidth={2} />
          ) : null}
          <Button size="sm" onClick={addService} disabled={create.isPending}>
            <Plus className="size-4" strokeWidth={2} />
            {t('settings.services.add')}
          </Button>
        </div>
      </div>

      {!services || services.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t('settings.services.empty')}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-muted-foreground text-left text-xs">
                <th className="py-2 pr-3 font-medium">{t('settings.services.col_name')}</th>
                <th className="py-2 pr-3 font-medium">{t('settings.services.col_category')}</th>
                <th className="py-2 pr-3 text-right font-medium">
                  {t('settings.services.col_duration')}
                </th>
                <th className="py-2 pr-3 text-right font-medium">
                  {t('settings.services.col_price')}
                </th>
                <th className="py-2 pr-3 text-right font-medium">
                  {t('settings.services.col_cost')}
                </th>
                <th className="py-2 pr-3 text-right font-medium">
                  {t('settings.services.col_margin')}
                </th>
                <th className="py-2 font-medium" />
              </tr>
            </thead>
            <tbody>
              {services.map((s) => {
                const margin =
                  s.cost_cents == null
                    ? null
                    : ((s.default_price_cents - s.cost_cents) / s.default_price_cents) * 100
                const draft = drafts[s.id] ?? { name: '', price: '', cost: '', duration: '' }
                return (
                  <tr key={s.id} className="border-border border-t">
                    <td className="py-2 pr-3">
                      <Input
                        className="h-8 w-44"
                        value={draft.name ?? ''}
                        onChange={(e) =>
                          setDrafts((p) => ({ ...p, [s.id]: { ...p[s.id], name: e.target.value } }))
                        }
                        onBlur={() => commitField(s.id, 'name')}
                      />
                    </td>
                    <td className="py-2 pr-3">
                      <Select
                        value={s.category_id ?? '__none__'}
                        onValueChange={(v) => commitCategory(s.id, v)}
                      >
                        <SelectTrigger className="h-8 w-40">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">
                            {t('settings.services.no_category')}
                          </SelectItem>
                          {(categories ?? []).map((c) => (
                            <SelectItem key={c.id} value={c.id}>
                              {c.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </td>
                    <td className="py-2 pr-3 text-right">
                      <Input
                        type="number"
                        inputMode="numeric"
                        min="0"
                        className="num h-8 w-20 text-right"
                        value={draft.duration ?? ''}
                        onChange={(e) =>
                          setDrafts((p) => ({
                            ...p,
                            [s.id]: { ...p[s.id], duration: e.target.value },
                          }))
                        }
                        onBlur={() => commitField(s.id, 'duration')}
                      />
                    </td>
                    <td className="py-2 pr-3 text-right">
                      <Input
                        type="number"
                        inputMode="decimal"
                        step="0.01"
                        min="0"
                        className="num h-8 w-24 text-right"
                        value={draft.price ?? ''}
                        onChange={(e) =>
                          setDrafts((p) => ({
                            ...p,
                            [s.id]: { ...p[s.id], price: e.target.value },
                          }))
                        }
                        onBlur={() => commitField(s.id, 'price')}
                      />
                    </td>
                    <td className="py-2 pr-3 text-right">
                      <Input
                        type="number"
                        inputMode="decimal"
                        step="0.01"
                        min="0"
                        placeholder={t('settings.services.cost_placeholder')}
                        className="num h-8 w-24 text-right"
                        value={draft.cost ?? ''}
                        onChange={(e) =>
                          setDrafts((p) => ({
                            ...p,
                            [s.id]: { ...p[s.id], cost: e.target.value },
                          }))
                        }
                        onBlur={() => commitField(s.id, 'cost')}
                      />
                    </td>
                    <td className="num py-2 pr-3 text-right">
                      {margin == null ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <span
                          className={
                            margin >= 50
                              ? 'text-brand-sage'
                              : margin >= 35
                                ? 'text-brand-gold-deep'
                                : 'text-brand-red'
                          }
                        >
                          {margin.toFixed(0)}%
                        </span>
                      )}
                      {margin != null && s.cost_cents != null ? (
                        <div className="text-muted-foreground text-xs">
                          {formatCurrency(s.default_price_cents - s.cost_cents, currency)}
                        </div>
                      ) : null}
                    </td>
                    <td className="py-2 text-right">
                      <button
                        type="button"
                        onClick={() => archive(s.id)}
                        className="text-muted-foreground hover:text-destructive grid size-8 place-items-center rounded-md transition-colors"
                        title={t('settings.services.archive')}
                      >
                        <Archive className="size-4" strokeWidth={1.8} />
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Архивированные */}
      <div className="border-border mt-3 border-t pt-3">
        <button
          type="button"
          onClick={() => setShowArchived((v) => !v)}
          className="text-muted-foreground hover:text-foreground text-xs underline-offset-2 hover:underline"
        >
          {showArchived
            ? t('settings.services.hide_archived')
            : t('settings.services.show_archived')}
        </button>
        {showArchived && archived && archived.length > 0 ? (
          <ul className="mt-2 flex flex-col gap-1.5">
            {archived.map((s) => (
              <li
                key={s.id}
                className="text-muted-foreground flex items-center justify-between text-sm"
              >
                <span>{s.name}</span>
                <button
                  type="button"
                  onClick={() => restore(s.id)}
                  className="hover:text-foreground flex items-center gap-1 text-xs"
                  title={t('settings.services.restore')}
                >
                  <RotateCcw className="size-3.5" strokeWidth={1.8} />
                  {t('settings.services.restore')}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        {showArchived && (!archived || archived.length === 0) ? (
          <p className="text-muted-foreground mt-2 text-xs">
            {t('settings.services.archived_empty')}
          </p>
        ) : null}
      </div>

      <p className="text-muted-foreground mt-3 text-xs">{t('settings.services.hint')}</p>
    </section>
  )
}
