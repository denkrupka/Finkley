import { ChevronDown, ChevronRight, Plus, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Input } from '@/components/ui/input'
import { useServiceCategories, useServices, type ServiceRow } from '@/hooks/useServices'
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

  const groups = useMemo(() => {
    const map = new Map<string, ServiceRow[]>()
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

  async function addCategory() {
    const name = prompt(t('onboarding.step3.add_category'))
    if (!name?.trim()) return
    try {
      const { error } = await supabase.from('service_categories').insert({
        salon_id: salonId,
        name: name.trim(),
        sort_order: categories.length,
      })
      if (error) throw error
      qc.invalidateQueries({ queryKey: ['service_categories', salonId] })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
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
          onClick={addCategory}
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
                    <div
                      key={s.id}
                      className={cn(
                        'grid grid-cols-1 gap-2 sm:grid-cols-[1fr_120px_120px_44px] sm:items-center',
                      )}
                    >
                      <div className="relative flex items-center">
                        <Input
                          defaultValue={s.name}
                          onBlur={(e) => {
                            if (e.target.value !== s.name)
                              updateService(s.id, { name: e.target.value })
                          }}
                          className="h-9 text-sm"
                        />
                        {s.external_source === 'booksy' ? (
                          <span
                            className="bg-brand-teal-soft text-brand-teal-deep absolute right-2 rounded px-1.5 py-0.5 text-[9px] font-bold uppercase"
                            title={t('onboarding.step3.imported_from_booksy')}
                          >
                            Booksy
                          </span>
                        ) : null}
                      </div>
                      <div className="border-input bg-card flex h-9 items-center gap-1.5 rounded-md border px-2.5">
                        <input
                          type="number"
                          min="0"
                          defaultValue={Math.round(s.default_price_cents / 100)}
                          onBlur={(e) => {
                            const v = Math.max(0, Number(e.target.value)) * 100
                            if (v !== s.default_price_cents)
                              updateService(s.id, { default_price_cents: v })
                          }}
                          className="num text-foreground w-full bg-transparent text-right text-sm font-semibold outline-none"
                        />
                        <span className="text-muted-foreground text-xs">PLN</span>
                      </div>
                      <div className="border-input bg-card flex h-9 items-center gap-1.5 rounded-md border px-2.5">
                        <input
                          type="number"
                          min="0"
                          defaultValue={s.default_duration_min ?? 60}
                          onBlur={(e) => {
                            const v = Math.max(0, Number(e.target.value)) || null
                            if (v !== s.default_duration_min)
                              updateService(s.id, { default_duration_min: v })
                          }}
                          className="num text-foreground w-full bg-transparent text-right text-sm font-semibold outline-none"
                        />
                        <span className="text-muted-foreground text-xs">мин</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => removeService(s.id)}
                        className="border-border text-muted-foreground hover:text-destructive grid size-9 place-items-center rounded-md border"
                        aria-label="remove"
                      >
                        <Trash2 className="size-4" strokeWidth={1.7} />
                      </button>
                    </div>
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
                        placeholder="мин"
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
    </div>
  )
}
