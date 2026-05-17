import { Plus, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  useDeleteServiceMaterial,
  useInventoryItems,
  useServiceRecipe,
  useUpsertServiceMaterial,
} from '@/hooks/useInventory'
import { Link } from 'react-router-dom'

type Props = {
  open: boolean
  onClose: () => void
  salonId: string
  service: { id: string; name: string } | null
}

/**
 * Редактор рецепта услуги — какие материалы списываются автоматически
 * при оплаченном визите этой услуги, и в каком количестве. Списание
 * происходит через trigger trg_visits_consume_materials.
 */
export function ServiceRecipeDialog({ open, onClose, salonId, service }: Props) {
  const { t } = useTranslation()
  const { data: recipe = [], isLoading } = useServiceRecipe(service?.id)
  const { data: items = [] } = useInventoryItems(salonId, { includeArchived: false })
  const upsert = useUpsertServiceMaterial(salonId)
  const remove = useDeleteServiceMaterial(salonId)

  const [newMaterialId, setNewMaterialId] = useState<string>('')
  const [newQty, setNewQty] = useState<string>('')

  const usedIds = useMemo(() => new Set(recipe.map((r) => r.material_id)), [recipe])
  const availableItems = useMemo(() => items.filter((it) => !usedIds.has(it.id)), [items, usedIds])

  function addMaterial() {
    if (!service) return
    if (!newMaterialId) {
      toast.error(t('services_page.recipe.errors.no_material'))
      return
    }
    const qNum = Number(newQty.replace(',', '.'))
    if (!Number.isFinite(qNum) || qNum <= 0) {
      toast.error(t('services_page.recipe.errors.qty_invalid'))
      return
    }
    upsert.mutate(
      { service_id: service.id, material_id: newMaterialId, quantity: qNum },
      {
        onSuccess: () => {
          toast.success(t('services_page.recipe.toast_added'))
          setNewMaterialId('')
          setNewQty('')
        },
        onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
      },
    )
  }

  function updateQty(materialId: string, value: string) {
    const qNum = Number(value.replace(',', '.'))
    if (!Number.isFinite(qNum) || qNum <= 0) return
    if (!service) return
    upsert.mutate(
      { service_id: service.id, material_id: materialId, quantity: qNum },
      {
        onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
      },
    )
  }

  function removeMaterial(materialId: string) {
    if (!service) return
    if (!confirm(t('services_page.recipe.confirm_remove'))) return
    remove.mutate(
      { service_id: service.id, material_id: materialId },
      {
        onSuccess: () => toast.success(t('services_page.recipe.toast_removed')),
        onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
      },
    )
  }

  if (!service) return null

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="w-[min(720px,96vw)] max-w-none">
        <DialogHeader>
          <DialogTitle>{t('services_page.recipe.title', { service: service.name })}</DialogTitle>
          <DialogDescription>{t('services_page.recipe.subtitle')}</DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-col gap-4 overflow-y-auto px-5 pb-2 pt-4">
          {/* Existing recipe rows */}
          {isLoading ? (
            <div className="bg-muted/40 h-20 animate-pulse rounded-md" />
          ) : recipe.length === 0 ? (
            <p className="text-muted-foreground text-sm">{t('services_page.recipe.empty')}</p>
          ) : (
            <ul className="border-border divide-border bg-muted/20 divide-y rounded-md border">
              {recipe.map((r) => (
                <li
                  key={r.id}
                  className="grid grid-cols-[minmax(0,1fr)_120px_40px] items-center gap-2 px-3 py-2 text-sm"
                >
                  <span className="text-foreground min-w-0 break-words font-semibold">
                    {r.material?.name ?? '—'}
                    {r.material?.category ? (
                      <span className="text-muted-foreground ml-1.5 text-[10.5px] font-medium">
                        {r.material.category}
                      </span>
                    ) : null}
                  </span>
                  <div className="flex items-center gap-1">
                    <Input
                      type="number"
                      inputMode="decimal"
                      step="any"
                      min="0"
                      defaultValue={r.quantity}
                      onBlur={(e) => {
                        const v = e.target.value
                        if (v && Number(v.replace(',', '.')) !== r.quantity) {
                          updateQty(r.material_id, v)
                        }
                      }}
                      className="num h-8 w-20 text-right text-xs"
                    />
                    <span className="text-muted-foreground text-xs">{r.material?.unit ?? ''}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeMaterial(r.material_id)}
                    className="text-muted-foreground hover:text-destructive grid size-8 place-items-center rounded-md"
                    aria-label={t('common.delete')}
                  >
                    <Trash2 className="size-4" strokeWidth={1.7} />
                  </button>
                </li>
              ))}
            </ul>
          )}

          {/* Add new material */}
          {availableItems.length > 0 ? (
            <div className="border-border bg-card rounded-md border p-3">
              <Label className="text-muted-foreground mb-2 block text-xs font-bold uppercase">
                {t('services_page.recipe.add_title')}
              </Label>
              <div className="grid grid-cols-[minmax(0,1fr)_120px_auto] gap-2">
                <Select value={newMaterialId} onValueChange={setNewMaterialId}>
                  <SelectTrigger className="h-10 min-w-0">
                    <SelectValue
                      placeholder={t('services_page.recipe.material_placeholder')}
                      className="truncate"
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {availableItems.map((it) => (
                      <SelectItem key={it.id} value={it.id}>
                        <span className="truncate">
                          {it.name} ({it.unit})
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  type="number"
                  inputMode="decimal"
                  step="any"
                  min="0"
                  placeholder={t('services_page.recipe.qty_placeholder')}
                  value={newQty}
                  onChange={(e) => setNewQty(e.target.value)}
                  className="num text-right text-sm"
                />
                <Button size="sm" onClick={addMaterial} disabled={upsert.isPending}>
                  <Plus className="size-4" strokeWidth={2} />
                </Button>
              </div>
            </div>
          ) : items.length === 0 ? (
            <p className="text-muted-foreground rounded-md border border-dashed p-3 text-center text-xs">
              {t('services_page.recipe.no_items')}{' '}
              <Link
                to={`/${salonId}/inventory`}
                className="text-primary font-semibold hover:underline"
              >
                {t('services_page.recipe.add_to_inventory')} →
              </Link>
            </p>
          ) : null}

          <p className="text-muted-foreground text-xs">{t('services_page.recipe.note')}</p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('common.close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
