import { Download, FileText, Upload } from 'lucide-react'
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
import { useBulkImportInventory, type CsvImportRow } from '@/hooks/useInventory'
import { cn } from '@/lib/utils/cn'

type Props = {
  open: boolean
  onClose: () => void
  salonId: string
}

const TEMPLATE_CSV =
  'name,unit,category,current_stock,min_stock,cost_per_unit,sku,supplier\n' +
  'Краска Wella Koleston 7/0,мл,Краска,500,200,0.45,WLA-K70,Wella Pro\n' +
  'Фольга алюминиевая,м,Расходники,250,100,0.30,FOIL-100,Iglostock\n'

/**
 * CSV import: парсим columns name,unit,category,current_stock,min_stock,
 * cost_per_unit,sku,supplier (header в первой строке). Цена в виде десятичного
 * числа в валюте (e.g. 0.45 → 45 центов).
 *
 * Идём через простой split — не подключаем тяжёлый csv-parse. Если у юзера
 * запятые в названиях, дадим возможность скачать template и заполнить руками.
 */
export function InventoryImportDialog({ open, onClose, salonId }: Props) {
  const { t } = useTranslation()
  const fileRef = useRef<HTMLInputElement>(null)
  const importMut = useBulkImportInventory(salonId)
  const [parsed, setParsed] = useState<CsvImportRow[]>([])
  const [errors, setErrors] = useState<string[]>([])
  const [filename, setFilename] = useState<string>('')

  function reset() {
    setParsed([])
    setErrors([])
    setFilename('')
  }

  function downloadTemplate() {
    const blob = new Blob([TEMPLATE_CSV], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'inventory-template.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  function parseCsvLine(line: string): string[] {
    // Простой parser: respects кавычки. Без полной RFC-поддержки (escape "")
    // но достаточно для типовых случаев.
    const out: string[] = []
    let cur = ''
    let inQ = false
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]
      if (ch === '"') {
        inQ = !inQ
        continue
      }
      if (ch === ',' && !inQ) {
        out.push(cur)
        cur = ''
        continue
      }
      cur += ch
    }
    out.push(cur)
    return out.map((s) => s.trim())
  }

  async function handleFile(file: File) {
    setFilename(file.name)
    const text = await file.text()
    const lines = text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
    if (lines.length < 2) {
      setErrors([t('inventory.import.errors.empty')])
      return
    }
    const header = parseCsvLine(lines[0]!).map((h) => h.toLowerCase())
    const idx = {
      name: header.indexOf('name'),
      unit: header.indexOf('unit'),
      category: header.indexOf('category'),
      stock: header.indexOf('current_stock'),
      min: header.indexOf('min_stock'),
      cost: header.indexOf('cost_per_unit'),
      sku: header.indexOf('sku'),
      supplier: header.indexOf('supplier'),
    }
    if (idx.name < 0) {
      setErrors([t('inventory.import.errors.no_name_col')])
      return
    }

    const rows: CsvImportRow[] = []
    const errs: string[] = []
    for (let i = 1; i < lines.length; i++) {
      const cols = parseCsvLine(lines[i]!)
      const name = cols[idx.name]?.trim()
      if (!name) {
        errs.push(t('inventory.import.errors.row_no_name', { line: i + 1 }))
        continue
      }
      const num = (col: number) => {
        if (col < 0) return undefined
        const v = cols[col]?.replace(',', '.')
        if (!v) return undefined
        const n = Number(v)
        return Number.isFinite(n) ? n : undefined
      }
      const stock = num(idx.stock) ?? 0
      const min = num(idx.min) ?? 0
      const cost = num(idx.cost) ?? 0
      rows.push({
        name,
        unit: cols[idx.unit]?.trim() || 'шт',
        category: cols[idx.category]?.trim() || undefined,
        current_stock: stock,
        min_stock: min,
        cost_per_unit_cents: Math.round(cost * 100),
        sku: cols[idx.sku]?.trim() || undefined,
        supplier: cols[idx.supplier]?.trim() || undefined,
      })
    }
    setParsed(rows)
    setErrors(errs)
  }

  function submit() {
    if (parsed.length === 0) return
    importMut.mutate(parsed, {
      onSuccess: (res) => {
        toast.success(t('inventory.import.toast_done', { count: res.inserted }))
        reset()
        onClose()
      },
      onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
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
      <DialogContent className="sm:!max-w-[560px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Upload className="text-brand-teal size-5" strokeWidth={1.8} />
            {t('inventory.import.title')}
          </DialogTitle>
          <DialogDescription>{t('inventory.import.subtitle')}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 px-5 pb-2 pt-4">
          <div className="border-border bg-muted/30 rounded-md border border-dashed p-4 text-center">
            <FileText className="text-muted-foreground mx-auto mb-2 size-8" strokeWidth={1.7} />
            <p className="text-foreground/80 mb-3 text-sm">
              {filename || t('inventory.import.choose_file')}
            </p>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) void handleFile(f)
              }}
            />
            <div className="flex justify-center gap-2">
              <Button size="sm" variant="primary" onClick={() => fileRef.current?.click()}>
                <Upload className="size-4" strokeWidth={2} />
                {t('inventory.import.choose')}
              </Button>
              <Button size="sm" variant="outline" onClick={downloadTemplate}>
                <Download className="size-4" strokeWidth={2} />
                {t('inventory.import.template')}
              </Button>
            </div>
          </div>

          {errors.length > 0 ? (
            <div className="border-destructive/30 bg-destructive/5 rounded-md border p-3 text-sm">
              <p className="text-destructive font-semibold">{t('inventory.import.errors_title')}</p>
              <ul className="text-destructive/80 mt-1 list-disc pl-5 text-xs">
                {errors.slice(0, 5).map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
                {errors.length > 5 ? (
                  <li>… {t('inventory.import.more_errors', { count: errors.length - 5 })}</li>
                ) : null}
              </ul>
            </div>
          ) : null}

          {parsed.length > 0 ? (
            <div className="border-border bg-card rounded-md border p-3">
              <p className="text-foreground text-xs font-semibold">
                {t('inventory.import.preview', { count: parsed.length })}
              </p>
              <ul className="mt-2 max-h-40 overflow-y-auto text-xs">
                {parsed.slice(0, 10).map((r, i) => (
                  <li
                    key={i}
                    className="text-muted-foreground border-border flex items-center justify-between gap-2 border-b py-1 last:border-b-0"
                  >
                    <span className="text-foreground truncate font-medium">{r.name}</span>
                    <span className="num shrink-0">
                      {r.current_stock} {r.unit}
                    </span>
                  </li>
                ))}
                {parsed.length > 10 ? (
                  <li className="text-muted-foreground pt-1 text-center">
                    {t('inventory.import.more', { count: parsed.length - 10 })}
                  </li>
                ) : null}
              </ul>
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button
            type="button"
            size="lg"
            onClick={submit}
            disabled={importMut.isPending || parsed.length === 0}
            className={cn(parsed.length === 0 && 'opacity-50')}
          >
            {importMut.isPending
              ? t('common.loading')
              : t('inventory.import.submit', { count: parsed.length })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
