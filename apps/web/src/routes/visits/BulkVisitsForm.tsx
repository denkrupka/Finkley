import { Plus, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
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
import { useServices } from '@/hooks/useServices'
import { useStaff } from '@/hooks/useStaff'
import { useCreateVisit, type PaymentMethod } from '@/hooks/useVisits'

type Row = {
  id: string
  staff_id: string
  service_id: string
  amount: string
  payment_method: PaymentMethod
}

const EMPTY_ROW = (): Row => ({
  id: Math.random().toString(36).slice(2, 9),
  staff_id: '',
  service_id: '',
  amount: '',
  payment_method: 'cash',
})

/**
 * Форма «несколько визитов сразу» — ранее жила в BulkVisitsDialog как
 * отдельный модальный диалог. Сейчас вставляется как вторая вкладка
 * QuickEntryModal. Без Dialog wrapper.
 */
export function BulkVisitsForm({
  salonId,
  currency,
  onDone,
}: {
  salonId: string
  currency: string
  onDone: () => void
}) {
  const { t } = useTranslation()
  const { data: staff = [] } = useStaff(salonId)
  const { data: services = [] } = useServices(salonId)
  const createVisit = useCreateVisit(salonId)

  const today = new Date().toISOString().slice(0, 10)
  const [date, setDate] = useState(today)
  const [rows, setRows] = useState<Row[]>(() => [EMPTY_ROW(), EMPTY_ROW(), EMPTY_ROW()])
  const [submitting, setSubmitting] = useState(false)

  function patchRow(id: string, patch: Partial<Row>) {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)))
  }

  function addRow() {
    if (rows.length >= 10) {
      toast.error(t('visits.bulk.max_rows'))
      return
    }
    setRows((prev) => [...prev, EMPTY_ROW()])
  }

  function removeRow(id: string) {
    setRows((prev) => (prev.length === 1 ? prev : prev.filter((r) => r.id !== id)))
  }

  const validRows = useMemo(
    () =>
      rows.filter((r) => {
        if (!r.staff_id) return false
        const n = Number(r.amount.replace(',', '.'))
        return Number.isFinite(n) && n > 0
      }),
    [rows],
  )

  async function submit() {
    if (validRows.length === 0) {
      toast.error(t('visits.bulk.no_valid_rows'))
      return
    }
    setSubmitting(true)
    let inserted = 0
    let failed = 0
    for (const r of validRows) {
      const amountCents = Math.round(Number(r.amount.replace(',', '.')) * 100)
      const service = services.find((s) => s.id === r.service_id)
      try {
        await createVisit.mutateAsync({
          salon_id: salonId,
          staff_id: r.staff_id,
          service_id: r.service_id || null,
          service_name_snapshot: service?.name ?? null,
          visit_at: `${date}T12:00:00Z`,
          amount_cents: amountCents,
          payment_method: r.payment_method,
        })
        inserted++
      } catch {
        failed++
      }
    }
    setSubmitting(false)
    if (inserted > 0) toast.success(t('visits.bulk.toast_done', { count: inserted }))
    if (failed > 0) toast.error(t('visits.bulk.toast_failed', { count: failed }))
    if (inserted > 0 && failed === 0) {
      setRows([EMPTY_ROW(), EMPTY_ROW(), EMPTY_ROW()])
      onDone()
    }
  }

  const currencySymbol = currency === 'EUR' ? '€' : currency === 'USD' ? '$' : currency

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-col gap-3 overflow-y-auto px-5 pb-2 pt-3">
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground text-sm">{t('visits.bulk.date_label')}</span>
          <Input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="h-9 w-44"
          />
        </div>

        <div className="border-border bg-muted/20 text-muted-foreground grid grid-cols-[1fr_88px_88px_28px] gap-1.5 rounded-md border px-2 py-2 text-[10px] font-bold uppercase tracking-wider">
          <span>{t('visits.bulk.staff')}</span>
          <span>{t('visits.bulk.amount')}</span>
          <span>{t('visits.bulk.payment')}</span>
          <span />
        </div>

        <div className="flex flex-col gap-2">
          {rows.map((r) => (
            <div key={r.id} className="grid grid-cols-[1fr_88px_88px_28px] items-center gap-1.5">
              <div className="flex flex-col gap-1.5">
                <Select value={r.staff_id} onValueChange={(v) => patchRow(r.id, { staff_id: v })}>
                  <SelectTrigger className="h-9">
                    <SelectValue placeholder={t('visits.bulk.staff')} />
                  </SelectTrigger>
                  <SelectContent>
                    {staff.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.full_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={r.service_id}
                  onValueChange={(v) => {
                    const svc = services.find((s) => s.id === v)
                    patchRow(r.id, {
                      service_id: v,
                      amount: r.amount || (svc ? String(svc.default_price_cents / 100) : ''),
                    })
                  }}
                >
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder={t('visits.bulk.service')} />
                  </SelectTrigger>
                  <SelectContent>
                    {services.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="border-brand-yellow-deep bg-brand-yellow flex h-9 items-center gap-1 rounded-md border-[1.5px] px-2">
                <input
                  type="number"
                  inputMode="decimal"
                  step="any"
                  min="0"
                  placeholder="0"
                  value={r.amount}
                  onChange={(e) => patchRow(r.id, { amount: e.target.value })}
                  className="num text-brand-navy h-full min-w-0 flex-1 bg-transparent text-sm font-bold outline-none"
                />
                <span className="num text-brand-navy/70 text-[10px]">{currencySymbol}</span>
              </div>
              <Select
                value={r.payment_method}
                onValueChange={(v) => patchRow(r.id, { payment_method: v as PaymentMethod })}
              >
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="cash">{t('payment_methods.cash')}</SelectItem>
                  <SelectItem value="card">{t('payment_methods.card')}</SelectItem>
                  <SelectItem value="transfer">{t('payment_methods.transfer')}</SelectItem>
                </SelectContent>
              </Select>
              <button
                type="button"
                onClick={() => removeRow(r.id)}
                disabled={rows.length === 1}
                className="text-muted-foreground hover:text-destructive grid size-7 place-items-center rounded-md disabled:opacity-30"
                aria-label="remove row"
              >
                <Trash2 className="size-3.5" strokeWidth={1.7} />
              </button>
            </div>
          ))}
        </div>

        <button
          type="button"
          onClick={addRow}
          className="text-secondary inline-flex items-center gap-1 self-start text-xs font-bold hover:underline"
        >
          <Plus className="size-3.5" strokeWidth={2.5} />
          {t('visits.bulk.add_row')}
        </button>
      </div>

      <div className="border-border flex flex-col gap-2 border-t px-5 pb-5 pt-3">
        <span className="text-muted-foreground text-center text-xs">
          {t('visits.bulk.valid_count', { count: validRows.length, total: rows.length })}
        </span>
        <Button onClick={submit} disabled={submitting || validRows.length === 0} size="lg">
          {submitting ? t('common.loading') : t('visits.bulk.save_all')}
        </Button>
      </div>
    </div>
  )
}
