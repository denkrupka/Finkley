import { format } from 'date-fns'
import { Download, FileSpreadsheet, FileText, Loader2, Printer } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useParams } from 'react-router-dom'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useClients } from '@/hooks/useClients'
import { useSalon } from '@/hooks/useSalons'
import { useServices } from '@/hooks/useServices'
import { useStaff } from '@/hooks/useStaff'
import { useVisits, type VisitRow } from '@/hooks/useVisits'
import { formatCurrency } from '@/lib/utils/format-currency'

type Format = 'csv' | 'excel' | 'pdf'
type PeriodPreset = 'today' | 'week' | 'month' | 'custom'

/**
 * Экспорт списка визитов за выбранный период в CSV/Excel/PDF.
 *
 * - CSV + Excel: тот же UTF-8 файл с BOM (Excel правильно открывает кириллицу).
 *   Разница только в расширении и MIME. Не тащим тяжёлые libs (xlsx ≈ 800 KB
 *   gzip) — MVP покрывает 99% юзкейсов.
 * - PDF: через window.print() с print-only стилями (см. globals.css
 *   `@media print`). Юзер выбирает «Сохранить как PDF» в системном диалоге.
 *   Без jspdf — экономим ещё 200 KB.
 *
 * Период: today / week (текущие 7 дней) / month (текущий месяц) / custom
 * (диапазон дат). По дефолту — сегодня.
 */
export function ExportVisitsButton() {
  const { t } = useTranslation()
  const { salonId } = useParams<{ salonId: string }>()
  const [open, setOpen] = useState(false)
  const [preset, setPreset] = useState<PeriodPreset>('today')
  const [from, setFrom] = useState(() => format(new Date(), 'yyyy-MM-dd'))
  const [to, setTo] = useState(() => format(new Date(), 'yyyy-MM-dd'))
  const [busy, setBusy] = useState(false)

  const { data: salon } = useSalon(salonId)
  const { data: staff = [] } = useStaff(salonId)
  const { data: services = [] } = useServices(salonId)
  const { data: clients = [] } = useClients(salonId)

  function presetRange(): { start: Date; end: Date; label: string } {
    const now = new Date()
    if (preset === 'today') {
      const start = new Date(now)
      start.setHours(0, 0, 0, 0)
      const end = new Date(now)
      end.setHours(23, 59, 59, 999)
      return { start, end, label: format(now, 'yyyy-MM-dd') }
    }
    if (preset === 'week') {
      const end = new Date(now)
      end.setHours(23, 59, 59, 999)
      const start = new Date(now)
      start.setDate(start.getDate() - 6)
      start.setHours(0, 0, 0, 0)
      return {
        start,
        end,
        label: `${format(start, 'yyyy-MM-dd')}_${format(end, 'yyyy-MM-dd')}`,
      }
    }
    if (preset === 'month') {
      const start = new Date(now.getFullYear(), now.getMonth(), 1)
      const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999)
      return {
        start,
        end,
        label: format(now, 'yyyy-MM'),
      }
    }
    const [fy, fm, fd] = from.split('-').map(Number)
    const [ty, tm, td] = to.split('-').map(Number)
    const start = new Date(fy!, (fm ?? 1) - 1, fd ?? 1, 0, 0, 0, 0)
    const end = new Date(ty!, (tm ?? 1) - 1, td ?? 1, 23, 59, 59, 999)
    return { start, end, label: `${from}_${to}` }
  }

  const range = presetRange()
  const visitsQuery = useVisits(
    salonId,
    { start: range.start.toISOString(), end: range.end.toISOString() },
    { kind: 'visit' },
  )

  async function doExport(formatType: Format) {
    if (!salon) return
    setBusy(true)
    try {
      const visits = visitsQuery.data ?? []
      if (visits.length === 0) {
        toast.info(t('visits.export.no_data'))
        return
      }
      const rows = buildRows(visits, salon.currency, staff, services, clients, t)
      const filename = `visits_${range.label}`

      if (formatType === 'pdf') {
        printPdf(rows, range, salon.name, t)
      } else {
        downloadSpreadsheet(
          rows,
          formatType === 'excel' ? `${filename}.xls` : `${filename}.csv`,
          formatType,
        )
      }
      toast.success(t('visits.export.toast_done', { count: visits.length }))
      setOpen(false)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-9 gap-1.5 text-xs font-semibold"
          title={t('visits.export.button')}
        >
          <Download className="size-3.5" strokeWidth={1.8} />
          <span className="hidden sm:inline">{t('visits.export.button')}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[320px] p-4">
        <p className="text-foreground mb-3 text-sm font-bold">{t('visits.export.title')}</p>

        <div className="mb-4">
          <Label className="text-muted-foreground text-[11px] font-semibold uppercase">
            {t('visits.export.period')}
          </Label>
          <div className="mt-1.5 grid grid-cols-4 gap-1">
            {(['today', 'week', 'month', 'custom'] as const).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPreset(p)}
                className={`rounded-md border px-2 py-1.5 text-[11px] font-semibold transition-colors ${
                  preset === p
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border bg-card hover:bg-muted/40'
                }`}
              >
                {t(`visits.export.preset_${p}`)}
              </button>
            ))}
          </div>
          {preset === 'custom' ? (
            <div className="mt-2 grid grid-cols-2 gap-2">
              <Input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="h-8 text-xs"
              />
              <Input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="h-8 text-xs"
              />
            </div>
          ) : null}
        </div>

        <div className="mb-2">
          <Label className="text-muted-foreground text-[11px] font-semibold uppercase">
            {t('visits.export.format')}
          </Label>
        </div>
        <div className="flex flex-col gap-1.5">
          <Button
            variant="outline"
            size="sm"
            onClick={() => doExport('pdf')}
            disabled={busy || visitsQuery.isLoading}
            className="justify-start"
          >
            {busy ? (
              <Loader2 className="size-3.5 animate-spin" strokeWidth={2} />
            ) : (
              <Printer className="size-3.5" strokeWidth={1.8} />
            )}
            {t('visits.export.pdf')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => doExport('excel')}
            disabled={busy || visitsQuery.isLoading}
            className="justify-start"
          >
            <FileSpreadsheet className="size-3.5" strokeWidth={1.8} />
            {t('visits.export.excel')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => doExport('csv')}
            disabled={busy || visitsQuery.isLoading}
            className="justify-start"
          >
            <FileText className="size-3.5" strokeWidth={1.8} />
            {t('visits.export.csv')}
          </Button>
        </div>

        <p className="text-muted-foreground mt-3 text-[10px] leading-relaxed">
          {t('visits.export.hint', { count: visitsQuery.data?.length ?? 0 })}
        </p>
      </PopoverContent>
    </Popover>
  )
}

// =============================================================================
// Builders
// =============================================================================

type Row = Record<string, string>

function buildRows(
  visits: VisitRow[],
  currency: string,
  staff: { id: string; full_name: string }[],
  services: { id: string; name: string }[],
  clients: { id: string; name: string }[],
  t: (k: string) => string,
): Row[] {
  return visits.map((v) => {
    const stf = staff.find((s) => s.id === v.staff_id)
    const svc = services.find((s) => s.id === v.service_id)
    const cli = clients.find((c) => c.id === v.client_id)
    const at = new Date(v.visit_at)
    return {
      [t('visits.export.col_date')]: format(at, 'dd.MM.yyyy'),
      [t('visits.export.col_time')]: format(at, 'HH:mm'),
      [t('visits.export.col_staff')]: stf?.full_name ?? '—',
      [t('visits.export.col_service')]: svc?.name ?? v.service_name_snapshot ?? '—',
      [t('visits.export.col_client')]: cli?.name ?? '—',
      [t('visits.export.col_amount')]: formatCurrency(v.amount_cents, currency),
      [t('visits.export.col_payment')]: t(`payment_methods.${v.payment_method}`),
      [t('visits.export.col_status')]:
        v.status === 'paid' ? t('visits.export.status_paid') : t('visits.export.status_pending'),
    }
  })
}

function downloadSpreadsheet(rows: Row[], filename: string, formatType: 'csv' | 'excel') {
  if (rows.length === 0) return
  const headers = Object.keys(rows[0]!)
  const lines: string[] = []
  lines.push(headers.map(csvEscape).join(';'))
  for (const r of rows) {
    lines.push(headers.map((h) => csvEscape(r[h] ?? '')).join(';'))
  }
  // BOM нужен чтобы Excel правильно прочитал UTF-8 кириллицу.
  const content = '﻿' + lines.join('\r\n')
  const mime =
    formatType === 'excel' ? 'application/vnd.ms-excel;charset=utf-8' : 'text/csv;charset=utf-8'
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

function csvEscape(s: string): string {
  if (s.includes(';') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

function printPdf(
  rows: Row[],
  range: { start: Date; end: Date },
  salonName: string,
  t: (k: string, opts?: Record<string, unknown>) => string,
) {
  if (rows.length === 0) return
  const headers = Object.keys(rows[0]!)
  const periodLabel = `${format(range.start, 'dd.MM.yyyy')} — ${format(range.end, 'dd.MM.yyyy')}`
  const html = `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<title>${t('visits.export.print_title')} — ${salonName}</title>
<style>
  body { font-family: -apple-system, system-ui, sans-serif; margin: 24px; color: #1a2738; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  .meta { color: #6b7280; font-size: 11px; margin-bottom: 16px; }
  table { width: 100%; border-collapse: collapse; font-size: 11px; }
  th { text-align: left; background: #f3f4f6; padding: 8px 6px; border-bottom: 2px solid #d1d5db; }
  td { padding: 6px; border-bottom: 1px solid #e5e7eb; }
  tr:nth-child(even) td { background: #fafafa; }
  @media print {
    body { margin: 12mm; }
    h1 { font-size: 14px; }
    table { font-size: 10px; }
  }
</style>
</head>
<body>
<h1>${escapeHtml(t('visits.export.print_title'))} — ${escapeHtml(salonName)}</h1>
<div class="meta">${escapeHtml(t('visits.export.print_period', { period: periodLabel }))} · ${escapeHtml(t('visits.export.print_total', { count: rows.length }))}</div>
<table>
  <thead>
    <tr>${headers.map((h) => `<th>${escapeHtml(h)}</th>`).join('')}</tr>
  </thead>
  <tbody>
    ${rows.map((r) => `<tr>${headers.map((h) => `<td>${escapeHtml(r[h] ?? '')}</td>`).join('')}</tr>`).join('')}
  </tbody>
</table>
<script>setTimeout(() => { window.print(); }, 200);</script>
</body></html>`
  const w = window.open('', '_blank', 'noopener,noreferrer,width=900,height=700')
  if (!w) {
    throw new Error('popup_blocked')
  }
  w.document.write(html)
  w.document.close()
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
