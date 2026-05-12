import { Copy, SlidersHorizontal } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useParams } from 'react-router-dom'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  useBulkUpdateServicePlanning,
  useServices,
  useUpdateService,
  type ServicePlanningField,
  type ServiceRow,
} from '@/hooks/useServices'
import { useSalon } from '@/hooks/useSalons'
import { cn } from '@/lib/utils/cn'
import { formatCurrency } from '@/lib/utils/format-currency'

/**
 * Параметры услуг — capacity-planning матрица.
 * Строки = параметры (рабочих мест, среднее время, %загрузки и т.п.),
 * колонки = услуги. Inline-edit + bulk «Применить ко всем» по строке.
 *
 * Дефолты заведены в миграции 20260513000002:
 * staff_count=1, avg_hours=1, work_hours/day=8, work_days/month=21,
 * utilization=50%, payout=40%, materials=3%.
 */

type FieldKind = 'int' | 'hours' | 'percent' | 'currency'

type Row = {
  field: ServicePlanningField
  labelKey: string
  unitKey: string
  kind: FieldKind
}

const ROWS: Row[] = [
  {
    field: 'staff_count_required',
    labelKey: 'services_page.planning.staff_count',
    unitKey: 'services_page.planning.unit_pcs',
    kind: 'int',
  },
  {
    field: 'avg_service_hours',
    labelKey: 'services_page.planning.avg_hours',
    unitKey: 'services_page.planning.unit_hours',
    kind: 'hours',
  },
  {
    field: 'staff_work_hours_per_day',
    labelKey: 'services_page.planning.work_hours_per_day',
    unitKey: 'services_page.planning.unit_hours',
    kind: 'hours',
  },
  {
    field: 'staff_work_days_per_month',
    labelKey: 'services_page.planning.work_days_per_month',
    unitKey: 'services_page.planning.unit_days',
    kind: 'int',
  },
  {
    field: 'utilization_pct',
    labelKey: 'services_page.planning.utilization',
    unitKey: 'services_page.planning.unit_pct',
    kind: 'percent',
  },
  {
    field: 'avg_check_cents',
    labelKey: 'services_page.planning.avg_check',
    unitKey: 'services_page.planning.unit_currency',
    kind: 'currency',
  },
  {
    field: 'staff_payout_pct',
    labelKey: 'services_page.planning.payout',
    unitKey: 'services_page.planning.unit_pct',
    kind: 'percent',
  },
  {
    field: 'materials_pct',
    labelKey: 'services_page.planning.materials',
    unitKey: 'services_page.planning.unit_pct',
    kind: 'percent',
  },
]

export function ServicePlanningCard() {
  const { t } = useTranslation()
  const { salonId } = useParams<{ salonId: string }>()
  const { data: salon } = useSalon(salonId)
  const currency = salon?.currency ?? 'PLN'
  const { data: services = [] } = useServices(salonId)
  const updateService = useUpdateService(salonId)
  const bulkUpdate = useBulkUpdateServicePlanning(salonId)
  const [bulkPrompt, setBulkPrompt] = useState<{
    field: ServicePlanningField
    kind: FieldKind
  } | null>(null)
  const [bulkValue, setBulkValue] = useState('')

  if (services.length === 0) {
    return (
      <section className="border-border bg-card shadow-finsm rounded-lg border p-5">
        <div className="flex items-center gap-2">
          <SlidersHorizontal className="text-brand-teal size-5" strokeWidth={1.7} />
          <h2 className="text-brand-navy text-lg font-bold tracking-tight">
            {t('services_page.planning.title')}
          </h2>
        </div>
        <p className="text-muted-foreground mt-2 text-sm">{t('services_page.planning.empty')}</p>
      </section>
    )
  }

  function renderValue(svc: ServiceRow, row: Row): string {
    const raw = svc[row.field]
    if (row.kind === 'currency') return String((raw as number) / 100)
    return String(raw)
  }

  function parseValue(s: string, kind: FieldKind): number | null {
    const n = Number(s.replace(',', '.'))
    if (!Number.isFinite(n) || n < 0) return null
    if (kind === 'currency') return Math.round(n * 100)
    if (kind === 'percent' && n > 100) return null
    return n
  }

  function commitCell(svc: ServiceRow, row: Row, raw: string) {
    const parsed = parseValue(raw, row.kind)
    if (parsed == null) {
      toast.error(t('services_page.planning.errors.invalid'))
      return
    }
    if (parsed === svc[row.field]) return
    updateService.mutate(
      { id: svc.id, [row.field]: parsed },
      {
        onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
      },
    )
  }

  function applyBulk() {
    if (!bulkPrompt) return
    const parsed = parseValue(bulkValue, bulkPrompt.kind)
    if (parsed == null) {
      toast.error(t('services_page.planning.errors.invalid'))
      return
    }
    bulkUpdate.mutate(
      { field: bulkPrompt.field, value: parsed },
      {
        onSuccess: () => {
          toast.success(t('services_page.planning.toast_bulk_applied', { count: services.length }))
          setBulkPrompt(null)
          setBulkValue('')
        },
        onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
      },
    )
  }

  return (
    <section className="border-border bg-card shadow-finsm rounded-lg border p-5">
      <div className="mb-4 flex items-start gap-3">
        <SlidersHorizontal className="text-brand-teal mt-0.5 size-5" strokeWidth={1.7} />
        <div>
          <h2 className="text-brand-navy text-lg font-bold tracking-tight">
            {t('services_page.planning.title')}
          </h2>
          <p className="text-muted-foreground mt-1 text-sm">
            {t('services_page.planning.subtitle')}
          </p>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-border border-b">
              <th className="text-muted-foreground bg-card sticky left-0 z-10 px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider">
                {t('services_page.planning.col_param')}
              </th>
              <th className="text-muted-foreground px-2 py-2 text-left text-xs font-semibold">
                {t('services_page.planning.col_unit')}
              </th>
              {services.map((s) => (
                <th
                  key={s.id}
                  className="text-foreground min-w-[110px] px-2 py-2 text-center text-xs font-bold"
                >
                  {s.name}
                </th>
              ))}
              <th className="px-2 py-2 text-center text-xs font-semibold">
                {t('services_page.planning.col_bulk')}
              </th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map((row) => (
              <tr key={row.field} className="border-border/60 border-b">
                <td className="text-foreground bg-card sticky left-0 z-10 px-3 py-2 font-medium">
                  {t(row.labelKey)}
                </td>
                <td className="text-muted-foreground px-2 py-2 text-xs">{t(row.unitKey)}</td>
                {services.map((s) => (
                  <td key={s.id} className="px-1.5 py-1.5">
                    <PlanningCell
                      svc={s}
                      row={row}
                      currency={currency}
                      initial={renderValue(s, row)}
                      onCommit={(v) => commitCell(s, row, v)}
                    />
                  </td>
                ))}
                <td className="px-1.5 py-1.5 text-center">
                  <button
                    type="button"
                    onClick={() => {
                      setBulkPrompt({ field: row.field, kind: row.kind })
                      setBulkValue('')
                    }}
                    className="text-secondary hover:bg-secondary/10 inline-flex size-7 items-center justify-center rounded-md"
                    title={t('services_page.planning.bulk_button')}
                  >
                    <Copy className="size-3.5" strokeWidth={1.8} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Bulk prompt */}
      {bulkPrompt ? (
        <div className="border-border bg-muted/30 mt-4 flex flex-wrap items-center gap-2 rounded-md border p-3">
          <p className="text-foreground text-sm font-semibold">
            {t('services_page.planning.bulk_prompt', {
              field: t(ROWS.find((r) => r.field === bulkPrompt.field)?.labelKey ?? ''),
            })}
          </p>
          <Input
            type="number"
            inputMode="decimal"
            step="any"
            min="0"
            value={bulkValue}
            onChange={(e) => setBulkValue(e.target.value)}
            className="h-9 max-w-[140px]"
            autoFocus
          />
          <Button
            variant="primary"
            size="sm"
            onClick={applyBulk}
            disabled={!bulkValue || bulkUpdate.isPending}
          >
            {bulkUpdate.isPending
              ? t('common.loading')
              : t('services_page.planning.bulk_apply_button')}
          </Button>
          <Button variant="outline" size="sm" onClick={() => setBulkPrompt(null)}>
            {t('common.cancel')}
          </Button>
        </div>
      ) : null}
    </section>
  )
}

function PlanningCell({
  svc,
  row,
  currency,
  initial,
  onCommit,
}: {
  svc: ServiceRow
  row: Row
  currency: string
  initial: string
  onCommit: (v: string) => void
}) {
  const [value, setValue] = useState(initial)
  // Sync external updates (after bulk-apply / refetch)
  if (
    value !== initial &&
    document.activeElement?.getAttribute('data-pcell-id') !== `${svc.id}-${row.field}`
  ) {
    setValue(initial)
  }

  return (
    <div className="flex flex-col items-end gap-0.5">
      <Input
        data-pcell-id={`${svc.id}-${row.field}`}
        type="number"
        inputMode="decimal"
        step="any"
        min="0"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => onCommit(value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            ;(e.currentTarget as HTMLInputElement).blur()
          }
        }}
        className={cn('h-8 text-right text-xs', row.kind === 'percent' && 'pr-1')}
      />
      {row.kind === 'currency' ? (
        <span className="text-muted-foreground text-[10px]">
          ≈ {formatCurrency(svc.avg_check_cents, currency)}
        </span>
      ) : null}
    </div>
  )
}
