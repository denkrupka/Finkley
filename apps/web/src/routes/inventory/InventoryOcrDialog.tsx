import { Loader2, Sparkles, Trash2, Upload } from 'lucide-react'
import { useRef, useState } from 'react'
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
import { useBulkImportInventory, type CsvImportRow } from '@/hooks/useInventory'
import { resizeImageToJpeg } from '@/lib/image-resize'
import { supabase } from '@/lib/supabase/client'

type OcrItem = {
  name: string
  unit: string
  quantity: number
  unit_cost_cents: number | null
  sku: string | null
  supplier: string | null
  notes: string | null
}

type Props = {
  open: boolean
  onClose: () => void
  salonId: string
  currency: string
}

/**
 * OCR-импорт позиций склада через Anthropic vision (edge function inventory-ocr).
 * Юзер загружает PDF / фото чека / WZ / заказа → AI распознаёт позиции →
 * preview таблица с inline-редактированием → bulk create.
 *
 * Цена за документ ~$0.003–0.01 — не критично для MVP. Гадает unit, supplier,
 * quantity, cost. Юзер всё может поправить перед confirm.
 */
export function InventoryOcrDialog({ open, onClose, salonId, currency }: Props) {
  const { t } = useTranslation()
  const inputRef = useRef<HTMLInputElement>(null)
  const [stage, setStage] = useState<'idle' | 'loading' | 'preview'>('idle')
  const [items, setItems] = useState<OcrItem[]>([])
  const [filename, setFilename] = useState('')
  const bulkImport = useBulkImportInventory(salonId)

  const currencySymbol = currency === 'EUR' ? '€' : currency === 'USD' ? '$' : currency

  function reset() {
    setStage('idle')
    setItems([])
    setFilename('')
    if (inputRef.current) inputRef.current.value = ''
  }

  async function handleFile(file: File) {
    setFilename(file.name)
    setStage('loading')

    try {
      // Bug 26088b7f follow-up: фото с iPhone бывают 5–10 МБ — сжимаем
      // изображения до 1600px JPEG. PDF не трогаем.
      const isImage = (file.type || '').startsWith('image/')
      const payload: File | Blob = isImage ? await resizeImageToJpeg(file, 1600, 0.85) : file
      const mime = isImage ? 'image/jpeg' : file.type
      const base64 = await fileToBase64(payload)
      const { data, error } = await supabase.functions.invoke('inventory-ocr', {
        body: { file_base64: base64, mime },
      })
      if (error) throw error
      const list = (data as { items?: OcrItem[] })?.items ?? []
      if (list.length === 0) {
        toast.warning(t('inventory.ocr.no_items'))
        setStage('idle')
        return
      }
      setItems(list)
      setStage('preview')
    } catch (err) {
      console.error('inventory-ocr', err)
      toast.error(t('inventory.ocr.error'), {
        description: err instanceof Error ? err.message : String(err),
      })
      setStage('idle')
    }
  }

  function updateItem(idx: number, patch: Partial<OcrItem>) {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)))
  }

  function removeItem(idx: number) {
    setItems((prev) => prev.filter((_, i) => i !== idx))
  }

  function handleConfirm() {
    const rows: CsvImportRow[] = items
      .filter((it) => it.name.trim().length > 0)
      .map((it) => ({
        name: it.name.trim(),
        unit: it.unit.trim() || 'шт',
        current_stock: it.quantity,
        min_stock: 0,
        cost_per_unit_cents: it.unit_cost_cents ?? 0,
        sku: it.sku ?? undefined,
        supplier: it.supplier ?? undefined,
      }))

    if (rows.length === 0) {
      toast.error(t('inventory.ocr.no_items_to_create'))
      return
    }

    bulkImport.mutate(rows, {
      onSuccess: ({ inserted }) => {
        toast.success(t('inventory.ocr.toast_created', { count: inserted }))
        reset()
        onClose()
      },
      onError: (err) => {
        toast.error(t('inventory.ocr.error'), {
          description: err instanceof Error ? err.message : String(err),
        })
      },
    })
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) {
          reset()
          onClose()
        }
      }}
    >
      <DialogContent className="w-[min(1100px,96vw)] max-w-none">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="text-secondary size-5" strokeWidth={2} />
            {t('inventory.ocr.title')}
          </DialogTitle>
          <DialogDescription>{t('inventory.ocr.subtitle')}</DialogDescription>
        </DialogHeader>

        {stage === 'idle' ? (
          <div className="px-5 pb-2">
            <label className="border-secondary/40 hover:border-secondary hover:bg-secondary/5 flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-10 text-center transition-colors">
              <input
                ref={inputRef}
                type="file"
                accept="application/pdf,image/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) handleFile(file)
                }}
              />
              <Upload className="text-secondary size-8" strokeWidth={1.6} />
              <p className="text-foreground text-sm font-semibold">
                {t('inventory.ocr.drop_hint')}
              </p>
              <p className="text-muted-foreground text-xs">{t('inventory.ocr.formats_hint')}</p>
            </label>
          </div>
        ) : stage === 'loading' ? (
          <div className="flex flex-col items-center gap-3 px-5 py-10">
            <Loader2 className="text-secondary size-8 animate-spin" />
            <p className="text-foreground text-sm font-semibold">{t('inventory.ocr.loading')}</p>
            <p className="text-muted-foreground text-xs">{filename}</p>
          </div>
        ) : (
          <div className="flex max-h-[60vh] flex-col gap-2 overflow-y-auto px-5 pb-2">
            <p className="text-muted-foreground text-xs">
              {t('inventory.ocr.preview_hint', { count: items.length })}
            </p>
            <div className="border-border bg-card overflow-x-auto rounded-lg border">
              <table className="w-full text-xs">
                <thead className="bg-muted/40 text-muted-foreground text-[10px] uppercase tracking-wider">
                  <tr>
                    <th className="px-2 py-2 text-left font-semibold">
                      {t('inventory.ocr.col_name')}
                    </th>
                    <th className="w-[70px] px-2 py-2 text-left font-semibold">
                      {t('inventory.ocr.col_unit')}
                    </th>
                    <th className="w-[80px] px-2 py-2 text-right font-semibold">
                      {t('inventory.ocr.col_qty')}
                    </th>
                    <th className="w-[110px] px-2 py-2 text-right font-semibold">
                      {t('inventory.ocr.col_cost', { currency: currencySymbol })}
                    </th>
                    <th className="w-[140px] px-2 py-2 text-left font-semibold">
                      {t('inventory.ocr.col_supplier')}
                    </th>
                    <th className="w-[40px] px-2 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {items.map((it, idx) => (
                    <tr key={idx} className="border-border/60 border-t align-middle">
                      <td className="px-1.5 py-1">
                        <Input
                          value={it.name}
                          onChange={(e) => updateItem(idx, { name: e.target.value })}
                          className="h-8 text-xs"
                        />
                      </td>
                      <td className="px-1.5 py-1">
                        <Input
                          value={it.unit}
                          onChange={(e) => updateItem(idx, { unit: e.target.value })}
                          className="h-8 text-xs"
                        />
                      </td>
                      <td className="px-1.5 py-1">
                        <Input
                          type="number"
                          inputMode="decimal"
                          step="any"
                          min="0"
                          value={String(it.quantity)}
                          onChange={(e) => updateItem(idx, { quantity: Number(e.target.value) })}
                          className="h-8 text-right text-xs"
                        />
                      </td>
                      <td className="px-1.5 py-1">
                        <Input
                          type="number"
                          inputMode="decimal"
                          step="any"
                          min="0"
                          value={
                            it.unit_cost_cents == null
                              ? ''
                              : String((it.unit_cost_cents / 100).toFixed(2))
                          }
                          onChange={(e) =>
                            updateItem(idx, {
                              unit_cost_cents: e.target.value
                                ? Math.round(Number(e.target.value) * 100)
                                : null,
                            })
                          }
                          className="h-8 text-right text-xs"
                        />
                      </td>
                      <td className="px-1.5 py-1">
                        <Input
                          value={it.supplier ?? ''}
                          onChange={(e) => updateItem(idx, { supplier: e.target.value || null })}
                          className="h-8 text-xs"
                        />
                      </td>
                      <td className="px-1.5 py-1 text-right">
                        <button
                          type="button"
                          onClick={() => removeItem(idx)}
                          className="text-muted-foreground hover:text-destructive grid size-7 place-items-center rounded-md"
                          aria-label={t('common.delete')}
                        >
                          <Trash2 className="size-3.5" strokeWidth={1.7} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <DialogFooter>
          {stage === 'preview' ? (
            <>
              <Button variant="outline" type="button" onClick={reset}>
                {t('inventory.ocr.upload_again')}
              </Button>
              <Button
                type="button"
                onClick={handleConfirm}
                disabled={bulkImport.isPending || items.length === 0}
              >
                {bulkImport.isPending
                  ? t('common.loading')
                  : t('inventory.ocr.confirm', { count: items.length })}
              </Button>
            </>
          ) : (
            <Button variant="outline" type="button" onClick={onClose}>
              {t('common.cancel')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function fileToBase64(file: File | Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result
      if (typeof result !== 'string') {
        reject(new Error('not a string'))
        return
      }
      // result is "data:application/pdf;base64,XXXX" — нам нужен только base64 hex
      const idx = result.indexOf(',')
      resolve(idx >= 0 ? result.slice(idx + 1) : result)
    }
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}
