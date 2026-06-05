import { Check, ChevronDown, ChevronRight, Loader2, Plus, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
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
import { useServiceCategories, useServices, type ServiceRow } from '@/hooks/useServices'
import { formatError } from '@/lib/format-error'
import { supabase } from '@/lib/supabase/client'
import { cn } from '@/lib/utils/cn'
import { useQueryClient } from '@tanstack/react-query'

/**
 * Live-режим Step3Services: услуги уже импортированы из Booksy после
 * подключения (background sync). Юзер может отредактировать цены/
 * длительность, удалить ненужные, добавить новые.
 *
 * Используется в OnboardingPage когда state.created_salon_id есть.
 */
export function Step3ServicesLive({ salonId }: { salonId: string }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const { data: services = [], isLoading } = useServices(salonId)
  const { data: categories = [] } = useServiceCategories(salonId)

  const visibleServices = services.filter((s) => !s.is_archived)
  const visibleCategories = categories.filter((c) => !c.is_archived)

  // Bug 39eba1d1 (Елена 05.06): новые добавленные категории без услуг не
  // показывались — карта строилась только по реальным услугам. Теперь
  // сначала зачерпываем ВСЕ visibleCategories, потом раскладываем услуги
  // — пустые категории остаются с items=[] и отображаются с кнопкой
  // «Добавить услугу».
  const groups = useMemo(() => {
    const map = new Map<string, ServiceRow[]>()
    for (const c of visibleCategories) {
      map.set(c.id, [])
    }
    for (const s of visibleServices) {
      const key = s.category_id ?? 'uncat'
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(s)
    }
    return Array.from(map.entries()).map(([catId, items]) => {
      const cat = visibleCategories.find((c) => c.id === catId)
      return {
        catId,
        name: cat?.name ?? t('onboarding.step3.no_category'),
        items,
      }
    })
  }, [visibleServices, visibleCategories, t])

  const [openCats, setOpenCats] = useState<Set<string>>(() => new Set(groups.map((g) => g.catId)))
  const [adding, setAdding] = useState<string | null>(null)
  const [newName, setNewName] = useState('')
  const [newPrice, setNewPrice] = useState(0)
  const [newDuration, setNewDuration] = useState(60)

  function toggleCat(catId: string) {
    setOpenCats((prev) => {
      const next = new Set(prev)
      if (next.has(catId)) next.delete(catId)
      else next.add(catId)
      return next
    })
  }

  async function updateService(id: string, patch: Partial<ServiceRow>) {
    try {
      const { error } = await supabase.from('services').update(patch).eq('id', id)
      if (error) throw error
      qc.invalidateQueries({ queryKey: ['services', salonId] })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }

  async function removeService(id: string) {
    try {
      const { error } = await supabase.from('services').update({ is_archived: true }).eq('id', id)
      if (error) throw error
      qc.invalidateQueries({ queryKey: ['services', salonId] })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }

  async function addService(catId: string) {
    if (!newName.trim()) return
    try {
      const { error } = await supabase.from('services').insert({
        salon_id: salonId,
        category_id: catId === 'uncat' ? null : catId,
        name: newName.trim(),
        default_price_cents: Math.round(newPrice * 100),
        default_duration_min: newDuration,
      })
      if (error) throw error
      setNewName('')
      setNewPrice(0)
      setNewDuration(60)
      setAdding(null)
      qc.invalidateQueries({ queryKey: ['services', salonId] })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }

  // Bug 42798bfa (Елена 05.06): заменили browser prompt() на нормальную
  // модалку. Раньше при добавлении категории появлялось «Подтвердите
  // действие на finkley.app» — выглядит как ошибка.
  const [addCatOpen, setAddCatOpen] = useState(false)
  const [addCatName, setAddCatName] = useState('')
  const [addCatPending, setAddCatPending] = useState(false)

  function openAddCategory() {
    setAddCatName('')
    setAddCatOpen(true)
  }

  async function addCategory() {
    const name = addCatName.trim()
    if (!name) return
    setAddCatPending(true)
    try {
      const { error } = await supabase.from('service_categories').insert({
        salon_id: salonId,
        name,
        sort_order: categories.length,
      })
      if (error) throw error
      qc.invalidateQueries({ queryKey: ['service_categories', salonId] })
      setAddCatOpen(false)
      setAddCatName('')
    } catch (err) {
      toast.error(formatError(err))
    } finally {
      setAddCatPending(false)
    }
  }

  if (isLoading) {
    return (
      <div>
        <div className="bg-muted/50 mb-3 h-8 w-1/3 animate-pulse rounded-md" />
        {[0, 1, 2].map((g) => (
          <div
            key={g}
            className="border-border mb-2 animate-pulse overflow-hidden rounded-md border"
            style={{ animationDelay: `${g * 80}ms` }}
          >
            <div className="bg-muted/30 h-10" />
            <div className="bg-muted mx-2 my-2 h-9 rounded" />
            <div className="bg-muted mx-2 my-2 h-9 rounded" />
          </div>
        ))}
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-end justify-between gap-4">
        <h1 className="text-brand-navy text-2xl font-bold tracking-tight">
          {t('onboarding.step3.title')}
        </h1>
        <button
          type="button"
          onClick={openAddCategory}
          className="text-secondary text-sm font-semibold hover:underline"
        >
          + {t('onboarding.step3.add_category')}
        </button>
      </div>

      {groups.length === 0 ? (
        <p className="text-muted-foreground mt-3 text-sm">{t('onboarding.step3.empty_hint')}</p>
      ) : null}

      <div className="mt-3 flex flex-col gap-2">
        {groups.map((group) => {
          const open = openCats.has(group.catId)
          return (
            <section key={group.catId} className="border-border overflow-hidden rounded-md border">
              <button
                type="button"
                onClick={() => toggleCat(group.catId)}
                className="bg-muted/30 hover:bg-muted/50 flex w-full items-center gap-2 px-3 py-2.5 text-left"
              >
                {open ? (
                  <ChevronDown className="text-muted-foreground size-4" strokeWidth={2} />
                ) : (
                  <ChevronRight className="text-muted-foreground size-4" strokeWidth={2} />
                )}
                <span className="text-foreground flex-1 text-sm font-bold">{group.name}</span>
                <span className="text-muted-foreground text-xs">{group.items.length}</span>
              </button>

              {open ? (
                <div className="flex flex-col gap-1 p-2">
                  {group.items.map((s) => (
                    <ServiceRowDebounced
                      key={s.id}
                      service={s}
                      onUpdate={updateService}
                      onRemove={removeService}
                    />
                  ))}

                  {adding === group.catId ? (
                    <div className="border-brand-teal-deep mt-2 grid grid-cols-1 gap-2 rounded-md border-2 p-2 sm:grid-cols-[1fr_120px_120px_auto]">
                      <Input
                        value={newName}
                        onChange={(e) => setNewName(e.target.value)}
                        placeholder={t('onboarding.step3.service_placeholder')}
                        autoFocus
                      />
                      <Input
                        type="number"
                        value={newPrice}
                        onChange={(e) => setNewPrice(Number(e.target.value))}
                        placeholder="PLN"
                        className="num"
                      />
                      <Input
                        type="number"
                        value={newDuration}
                        onChange={(e) => setNewDuration(Number(e.target.value))}
                        placeholder={t('onboarding.services.duration_unit')}
                        className="num"
                      />
                      <button
                        type="button"
                        onClick={() => addService(group.catId)}
                        disabled={!newName.trim()}
                        className="bg-primary text-primary-foreground inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-sm font-bold disabled:opacity-50"
                      >
                        OK
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setAdding(group.catId)}
                      className="border-brand-border-strong text-muted-foreground hover:border-secondary hover:text-secondary mt-1 inline-flex items-center justify-center gap-1.5 rounded-md border border-dashed px-3 py-1.5 text-xs font-semibold"
                    >
                      <Plus className="size-3.5" strokeWidth={2} />
                      {t('onboarding.step3.add_in_category')}
                    </button>
                  )}
                </div>
              ) : null}
            </section>
          )
        })}
      </div>

      {/* Bug 42798bfa: модалка добавления категории вместо browser prompt() */}
      <Dialog open={addCatOpen} onOpenChange={setAddCatOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('onboarding.step3.add_category')}</DialogTitle>
            <DialogDescription>
              {t('onboarding.step3.add_category_subtitle', {
                defaultValue: 'Например: «Окрашивание» или «Маникюр».',
              })}
            </DialogDescription>
          </DialogHeader>
          <div className="px-5 py-4">
            <Label htmlFor="add-cat-name" className="text-xs">
              {t('onboarding.step3.add_category_label', { defaultValue: 'Название категории' })}
            </Label>
            <Input
              id="add-cat-name"
              autoFocus
              value={addCatName}
              onChange={(e) => setAddCatName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && addCatName.trim() && !addCatPending) {
                  e.preventDefault()
                  void addCategory()
                }
              }}
              placeholder={t('onboarding.step3.add_category_placeholder', {
                defaultValue: 'Например: Окрашивание',
              })}
              maxLength={60}
              className="mt-1.5"
            />
          </div>
          <DialogFooter>
            <Button onClick={addCategory} disabled={!addCatName.trim() || addCatPending} size="lg">
              {addCatPending ? t('common.loading') : t('common.add', { defaultValue: 'Добавить' })}
            </Button>
            <button
              type="button"
              onClick={() => setAddCatOpen(false)}
              className="text-muted-foreground hover:text-foreground text-center text-sm font-semibold"
            >
              {t('common.cancel')}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

/**
 * T31 — Debounced auto-save вместо onBlur. Раньше юзер должен был кликнуть
 * вне поля чтобы сохранить — на мобиле и при tabIndex это часто терялось.
 * Сейчас: меняешь поле → через 800ms idle → save + visual feedback (спиннер
 * → галочка). Сравнение идёт с серверным значением чтобы не дёргать БД
 * на «возврат к исходному» (юзер набрал и стёр).
 */
function ServiceRowDebounced({
  service,
  onUpdate,
  onRemove,
}: {
  service: ServiceRow
  onUpdate: (id: string, patch: Partial<ServiceRow>) => Promise<void>
  onRemove: (id: string) => void
}) {
  const { t } = useTranslation()
  const [name, setName] = useState(service.name)
  const [priceStr, setPriceStr] = useState(String(Math.round(service.default_price_cents / 100)))
  const [durationStr, setDurationStr] = useState(String(service.default_duration_min ?? 60))
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  // Серверное значение — то, что в БД сейчас. Обновляется при успешном save
  // и при внешнем обновлении props (после invalidate). Сравнение с ним —
  // источник истины для debounce-эффекта.
  const lastSyncedRef = useRef({
    name: service.name,
    priceCents: service.default_price_cents,
    durationMin: service.default_duration_min ?? 60,
  })

  // Если props пришли свежие (например, после Booksy sync), и юзер не успел
  // ввести что-то своё — обновляем локальное значение.
  useEffect(() => {
    if (name === lastSyncedRef.current.name && service.name !== lastSyncedRef.current.name) {
      setName(service.name)
    }
    lastSyncedRef.current = {
      name: service.name,
      priceCents: service.default_price_cents,
      durationMin: service.default_duration_min ?? 60,
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [service.id, service.name, service.default_price_cents, service.default_duration_min])

  // Debounced save 800ms после последнего keystroke. Мерж в один patch для
  // одного PATCH-запроса. Если ничего не изменилось vs сервер — пропускаем.
  useEffect(() => {
    const cleanName = name.trim()
    const priceCents = Math.max(0, Number(priceStr.replace(',', '.')) || 0) * 100
    const durationMin = Math.max(0, Number(durationStr) || 0) || null

    const synced = lastSyncedRef.current
    const dirty =
      cleanName !== synced.name ||
      Math.round(priceCents) !== synced.priceCents ||
      durationMin !== synced.durationMin
    if (!dirty) return
    if (!cleanName) return // не сохраняем пустое имя

    const handle = window.setTimeout(async () => {
      setSaving(true)
      try {
        await onUpdate(service.id, {
          name: cleanName,
          default_price_cents: Math.round(priceCents),
          default_duration_min: durationMin,
        })
        lastSyncedRef.current = {
          name: cleanName,
          priceCents: Math.round(priceCents),
          durationMin: durationMin ?? 60,
        }
        setSavedAt(Date.now())
      } finally {
        setSaving(false)
      }
    }, 800)
    return () => window.clearTimeout(handle)
  }, [name, priceStr, durationStr, service.id, onUpdate])

  // Прячем галочку через 1.5s после сохранения.
  useEffect(() => {
    if (!savedAt) return
    const handle = window.setTimeout(() => setSavedAt(null), 1500)
    return () => window.clearTimeout(handle)
  }, [savedAt])

  return (
    <div
      className={cn('grid grid-cols-1 gap-2 sm:grid-cols-[1fr_120px_120px_44px] sm:items-center')}
    >
      <div className="relative flex items-center">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="h-9 pr-16 text-sm"
        />
        <div className="pointer-events-none absolute right-2 flex items-center gap-1">
          {saving ? (
            <Loader2 className="text-muted-foreground size-3.5 animate-spin" strokeWidth={2} />
          ) : savedAt ? (
            <Check className="size-3.5 text-emerald-600" strokeWidth={2.4} />
          ) : null}
          {service.external_source === 'booksy' ? (
            <span
              className="bg-brand-teal-soft text-brand-teal-deep rounded px-1.5 py-0.5 text-[9px] font-bold uppercase"
              title={t('onboarding.step3.imported_from_booksy')}
            >
              Booksy
            </span>
          ) : null}
        </div>
      </div>
      <div className="border-input bg-card flex h-9 items-center gap-1.5 rounded-md border px-2.5">
        <input
          type="number"
          min="0"
          value={priceStr}
          onChange={(e) => setPriceStr(e.target.value)}
          className="num text-foreground w-full bg-transparent text-right text-sm font-semibold outline-none"
        />
        <span className="text-muted-foreground text-xs">PLN</span>
      </div>
      <div className="border-input bg-card flex h-9 items-center gap-1.5 rounded-md border px-2.5">
        <input
          type="number"
          min="0"
          value={durationStr}
          onChange={(e) => setDurationStr(e.target.value)}
          className="num text-foreground w-full bg-transparent text-right text-sm font-semibold outline-none"
        />
        <span className="text-muted-foreground text-xs">
          {t('onboarding.services.duration_unit')}
        </span>
      </div>
      <button
        type="button"
        onClick={() => onRemove(service.id)}
        className="border-border text-muted-foreground hover:text-destructive grid size-9 place-items-center rounded-md border"
        aria-label="remove"
      >
        <Trash2 className="size-4" strokeWidth={1.7} />
      </button>
    </div>
  )
}
