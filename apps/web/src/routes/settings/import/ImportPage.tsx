import { ArrowLeft, FileUp, Loader2, Upload } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useParams } from 'react-router-dom'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useClients } from '@/hooks/useClients'
import { useServices } from '@/hooks/useServices'
import { useStaff } from '@/hooks/useStaff'
import { useImportVisits, type ImportProgress } from '@/hooks/useImportVisits'
import { parseCsv, type CsvParseResult } from '@/lib/utils/csv'

type DomainField =
  | 'skip'
  | 'visit_at'
  | 'amount'
  | 'client_name'
  | 'client_phone'
  | 'service_name'
  | 'staff_name'
  | 'payment_method'
  | 'comment'

const ALL_FIELDS: DomainField[] = [
  'skip',
  'visit_at',
  'amount',
  'client_name',
  'client_phone',
  'service_name',
  'staff_name',
  'payment_method',
  'comment',
]

/** Эвристика автомаппинга колонок по их заголовку. */
function guessField(header: string): DomainField {
  const h = header.toLowerCase().trim()
  if (/(date|время|дата|day|когда)/i.test(h)) return 'visit_at'
  if (/(price|amount|sum|итого|сумма|стоимость|cena|kwota)/i.test(h)) return 'amount'
  if (/(phone|tel|телефон|номер)/i.test(h)) return 'client_phone'
  if (/(client|customer|клиент|имя|name)/i.test(h) && !/staff|master|мастер/i.test(h))
    return 'client_name'
  if (/(staff|master|мастер|specialist|pracownik)/i.test(h)) return 'staff_name'
  if (/(service|услуга|product|treatment|usługa)/i.test(h)) return 'service_name'
  if (/(payment|способ|оплата|method)/i.test(h)) return 'payment_method'
  if (/(comment|note|комментарий|примечание|notatka)/i.test(h)) return 'comment'
  return 'skip'
}

export function ImportPage() {
  const { t } = useTranslation()
  const { salonId } = useParams<{ salonId: string }>()
  const fileRef = useRef<HTMLInputElement>(null)

  const [parsed, setParsed] = useState<CsvParseResult | null>(null)
  const [mapping, setMapping] = useState<Record<number, DomainField>>({})
  const [progress, setProgress] = useState<ImportProgress | null>(null)

  const { data: clients = [] } = useClients(salonId)
  const { data: staff = [] } = useStaff(salonId, { activeOnly: false })
  const { data: services = [] } = useServices(salonId)

  const importVisits = useImportVisits(salonId)

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const text = String(reader.result ?? '')
        const result = parseCsv(text)
        if (result.headers.length === 0) {
          toast.error(t('import.errors.empty'))
          return
        }
        setParsed(result)
        // Авто-маппинг
        const m: Record<number, DomainField> = {}
        result.headers.forEach((h, i) => {
          m[i] = guessField(h)
        })
        setMapping(m)
        setProgress(null)
      } catch (err) {
        toast.error(err instanceof Error ? err.message : String(err))
      }
    }
    reader.readAsText(file)
  }

  // Валидируем что обязательные поля выбраны
  const requiredOk = useMemo(() => {
    const used = new Set(Object.values(mapping))
    return used.has('visit_at') && used.has('amount')
  }, [mapping])

  async function startImport() {
    if (!parsed || !salonId) return
    setProgress({
      done: 0,
      total: parsed.rows.length,
      inserted: 0,
      skipped: 0,
      failed: 0,
      errors: [],
    })
    try {
      const result = await importVisits.mutateAsync({
        rows: parsed.rows,
        mapping,
        clients,
        staff,
        services,
        onProgress: (p) => setProgress(p),
      })
      toast.success(
        t('import.toast_done', {
          inserted: result.inserted,
          skipped: result.skipped,
        }),
      )
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }

  if (!salonId) return null

  return (
    <div className="flex flex-1 flex-col px-5 py-7 sm:px-8 lg:pb-12">
      <div className="mb-5">
        <Link
          to={`/${salonId}/settings`}
          className="text-muted-foreground hover:text-foreground mb-2 inline-flex items-center gap-1 text-sm"
        >
          <ArrowLeft className="size-4" strokeWidth={1.7} />
          {t('import.back_to_settings')}
        </Link>
        <h1 className="text-brand-navy text-2xl font-bold tracking-tight">{t('import.title')}</h1>
        <p className="text-muted-foreground mt-1 text-sm">{t('import.subtitle')}</p>
      </div>

      {/* Шаг 1: загрузка */}
      {!parsed ? (
        <div className="border-border bg-card shadow-finsm rounded-lg border p-8">
          <div className="flex flex-col items-center text-center">
            <div className="bg-brand-yellow/40 mb-4 grid size-14 place-items-center rounded-full">
              <FileUp className="text-brand-navy size-7" strokeWidth={1.7} />
            </div>
            <h2 className="text-brand-navy text-lg font-bold">{t('import.upload.title')}</h2>
            <p className="text-muted-foreground mt-1 max-w-md text-sm">
              {t('import.upload.subtitle')}
            </p>
            <Button onClick={() => fileRef.current?.click()} className="mt-5">
              <Upload className="size-4" strokeWidth={2} />
              {t('import.upload.button')}
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              onChange={onFileChange}
              className="hidden"
            />
            <p className="text-muted-foreground mt-3 text-xs">{t('import.upload.formats')}</p>
          </div>
        </div>
      ) : (
        <>
          {/* Шаг 2: маппинг колонок */}
          <section className="border-border bg-card shadow-finsm mb-4 rounded-lg border p-5">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-brand-navy text-base font-bold">{t('import.mapping.title')}</h2>
                <p className="text-muted-foreground mt-0.5 text-xs">
                  {t('import.mapping.subtitle', { count: parsed.rows.length })}
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setParsed(null)
                  setMapping({})
                  setProgress(null)
                }}
              >
                {t('import.mapping.reset')}
              </Button>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {parsed.headers.map((header, i) => (
                <div key={i} className="flex flex-col gap-1.5">
                  <Label className="truncate" title={header}>
                    {header || `col-${i + 1}`}
                  </Label>
                  <Select
                    value={mapping[i] ?? 'skip'}
                    onValueChange={(v) => setMapping((m) => ({ ...m, [i]: v as DomainField }))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ALL_FIELDS.map((f) => (
                        <SelectItem key={f} value={f}>
                          {t(`import.fields.${f}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>
          </section>

          {/* Шаг 3: превью */}
          <section className="border-border bg-card shadow-finsm mb-4 rounded-lg border p-5">
            <h2 className="text-brand-navy mb-3 text-base font-bold">
              {t('import.preview.title', { count: Math.min(10, parsed.rows.length) })}
            </h2>
            <div className="overflow-x-auto">
              <table className="text-muted-foreground min-w-full text-xs">
                <thead>
                  <tr>
                    {parsed.headers.map((h, i) => (
                      <th
                        key={i}
                        className="border-border border-b px-2 py-1.5 text-left font-bold"
                      >
                        {h}
                        {mapping[i] && mapping[i] !== 'skip' ? (
                          <span className="text-brand-navy/70 ml-1 font-normal">
                            → {t(`import.fields.${mapping[i]}`)}
                          </span>
                        ) : null}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {parsed.rows.slice(0, 10).map((r, ri) => (
                    <tr key={ri}>
                      {r.map((cell, ci) => (
                        <td
                          key={ci}
                          className="border-border max-w-[180px] truncate border-b px-2 py-1.5"
                          title={cell}
                        >
                          {cell}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* Шаг 4: запуск + прогресс */}
          <section className="border-border bg-card shadow-finsm rounded-lg border p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-muted-foreground text-sm">
                  {requiredOk
                    ? t('import.ready', { count: parsed.rows.length })
                    : t('import.errors.missing_required')}
                </p>
              </div>
              <Button onClick={startImport} disabled={!requiredOk || importVisits.isPending}>
                {importVisits.isPending ? (
                  <Loader2 className="size-4 animate-spin" strokeWidth={2} />
                ) : (
                  <Upload className="size-4" strokeWidth={2} />
                )}
                {t('import.start_button')}
              </Button>
            </div>

            {progress ? (
              <div className="mt-4 flex flex-col gap-2">
                <div className="bg-muted h-2 overflow-hidden rounded-full">
                  <div
                    className="bg-brand-navy h-full transition-all"
                    style={{
                      width: `${(progress.done / Math.max(1, progress.total)) * 100}%`,
                    }}
                  />
                </div>
                <div className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-xs">
                  <span>
                    {t('import.progress.done', { done: progress.done, total: progress.total })}
                  </span>
                  <span className="text-emerald-600">
                    {t('import.progress.inserted', { count: progress.inserted })}
                  </span>
                  {progress.skipped > 0 ? (
                    <span>{t('import.progress.skipped', { count: progress.skipped })}</span>
                  ) : null}
                  {progress.failed > 0 ? (
                    <span className="text-destructive">
                      {t('import.progress.failed', { count: progress.failed })}
                    </span>
                  ) : null}
                </div>
                {progress.errors.length > 0 ? (
                  <details className="mt-2">
                    <summary className="text-muted-foreground cursor-pointer text-xs">
                      {t('import.progress.errors_label', { count: progress.errors.length })}
                    </summary>
                    <ul className="text-destructive mt-1 list-disc pl-5 text-xs">
                      {progress.errors.slice(0, 20).map((e, i) => (
                        <li key={i}>
                          {t('import.progress.row')} {e.row}: {e.message}
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : null}
              </div>
            ) : null}
          </section>
        </>
      )}
    </div>
  )
}
