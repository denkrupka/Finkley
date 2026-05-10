import { Pencil, Save, Tags, Trash2, X } from 'lucide-react'
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
import { useInventoryItems, useRenameCategory, type InventoryItemRow } from '@/hooks/useInventory'

type Props = {
  open: boolean
  onClose: () => void
  salonId: string
}

/**
 * Управление категориями материалов. Категории — свободный текст в
 * inventory_items.category (нет отдельной таблицы), поэтому
 * «переименование» = UPDATE inventory_items SET category=новая WHERE
 * category=старая. «Удаление» = SET category=NULL для всех материалов
 * этой категории. Делается через RPC useRenameCategory.
 */
export function InventoryCategoriesDialog({ open, onClose, salonId }: Props) {
  const { t } = useTranslation()
  const { data: items = [] } = useInventoryItems(salonId, { includeArchived: false })
  const rename = useRenameCategory(salonId)

  const [editing, setEditing] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')

  const categories = useMemo(() => {
    const map = new Map<string, InventoryItemRow[]>()
    for (const it of items) {
      if (!it.category) continue
      const arr = map.get(it.category) ?? []
      arr.push(it)
      map.set(it.category, arr)
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]))
  }, [items])

  function startEdit(name: string) {
    setEditing(name)
    setEditValue(name)
  }

  function saveRename() {
    if (!editing) return
    const trimmed = editValue.trim()
    if (!trimmed) {
      toast.error(t('inventory.categories.errors.empty'))
      return
    }
    if (trimmed === editing) {
      setEditing(null)
      return
    }
    rename.mutate(
      { from: editing, to: trimmed },
      {
        onSuccess: () => {
          toast.success(t('inventory.categories.toast_renamed'))
          setEditing(null)
        },
        onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
      },
    )
  }

  function deleteCategory(name: string, count: number) {
    if (!confirm(t('inventory.categories.confirm_delete', { name, count }))) return
    rename.mutate(
      { from: name, to: null },
      {
        onSuccess: () => toast.success(t('inventory.categories.toast_deleted', { count })),
        onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
      },
    )
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Tags className="text-brand-teal size-5" strokeWidth={1.8} />
            {t('inventory.categories.title')}
          </DialogTitle>
          <DialogDescription>{t('inventory.categories.subtitle')}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3 px-5 pb-2 pt-4">
          {categories.length === 0 ? (
            <p className="text-muted-foreground text-sm">{t('inventory.categories.empty')}</p>
          ) : (
            <ul className="border-border bg-card divide-border divide-y rounded-md border">
              {categories.map(([name, list]) => (
                <li
                  key={name}
                  className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
                >
                  {editing === name ? (
                    <>
                      <Input
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        autoFocus
                        className="h-8 text-sm"
                      />
                      <span className="flex shrink-0 gap-1">
                        <button
                          type="button"
                          onClick={saveRename}
                          disabled={rename.isPending}
                          className="text-brand-sage hover:bg-brand-sage-soft grid size-8 place-items-center rounded-md"
                        >
                          <Save className="size-4" strokeWidth={2} />
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditing(null)}
                          className="text-muted-foreground hover:bg-muted/40 grid size-8 place-items-center rounded-md"
                        >
                          <X className="size-4" strokeWidth={2} />
                        </button>
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="text-foreground flex-1 truncate font-semibold">
                        {name}
                        <span className="text-muted-foreground ml-2 text-xs font-medium">
                          ({list.length})
                        </span>
                      </span>
                      <span className="flex shrink-0 gap-0.5">
                        <button
                          type="button"
                          onClick={() => startEdit(name)}
                          className="text-muted-foreground hover:text-foreground grid size-8 place-items-center rounded-md"
                          title={t('common.edit')}
                        >
                          <Pencil className="size-3.5" strokeWidth={1.8} />
                        </button>
                        <button
                          type="button"
                          onClick={() => deleteCategory(name, list.length)}
                          disabled={rename.isPending}
                          className="text-muted-foreground hover:text-destructive grid size-8 place-items-center rounded-md"
                          title={t('inventory.categories.delete')}
                        >
                          <Trash2 className="size-3.5" strokeWidth={1.8} />
                        </button>
                      </span>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}

          <p className="text-muted-foreground text-xs">{t('inventory.categories.note')}</p>
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
