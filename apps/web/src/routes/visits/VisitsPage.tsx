import { Layers, Pencil, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useParams, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'

import { BulkVisitsDialog } from './BulkVisitsDialog'
import { EditVisitModal } from './EditVisitModal'

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useClients } from '@/hooks/useClients'
import { useDeleteVisit, useVisits, type PaymentMethod, type VisitRow } from '@/hooks/useVisits'
import { useSalon } from '@/hooks/useSalons'
import { useStaff } from '@/hooks/useStaff'
import { useServices } from '@/hooks/useServices'
import { getPeriodRange, type PeriodKey } from '@/lib/period'
import { cn } from '@/lib/utils/cn'
import { formatCurrency } from '@/lib/utils/format-currency'
import { formatVisitDayHeading, formatVisitDate, groupByDay } from '@/lib/utils/format-date'

const STAFF_PALETTE = ['#F4D7C5', '#D7E4C5', '#C5DAE4', '#E4C5DC', '#E8C4B8', '#FBE5C0']

const PAY_LABEL: Record<PaymentMethod, { label: string; bg: string; fg: string }> = {
  cash: { label: 'cash', bg: '#EFEEF5', fg: 'hsl(var(--brand-navy))' },
  card: { label: 'card', bg: 'hsl(var(--brand-teal-soft))', fg: 'hsl(var(--brand-teal-deep))' },
  transfer: {
    label: 'transfer',
    bg: 'hsl(var(--brand-sage-soft))',
    fg: 'hsl(var(--brand-sage))',
  },
  online: { label: 'online', bg: '#E5F0F4', fg: 'hsl(var(--brand-teal))' },
  mixed: { label: 'mixed', bg: '#EEE', fg: 'hsl(var(--brand-navy))' },
}

export function VisitsPage() {
  const { t } = useTranslation()
  const { salonId } = useParams<{ salonId: string }>()
  const [params, setParams] = useSearchParams()
  const period = (params.get('period') ?? 'month') as PeriodKey
  const staffFilter = params.get('staff') || ''
  const paymentFilter = (params.get('pay') || '') as PaymentMethod | ''

  const range = getPeriodRange(period)
  const { data: salon } = useSalon(salonId)
  const { data: staff = [] } = useStaff(salonId)
  const { data: services = [] } = useServices(salonId)
  const { data: clients = [] } = useClients(salonId)
  const {
    data: visits = [],
    isLoading,
    error,
  } = useVisits(salonId, range, {
    staffId: staffFilter || null,
    paymentMethod: paymentFilter || null,
  })
  const deleteVisit = useDeleteVisit(salonId)
  const [bulkOpen, setBulkOpen] = useState(false)
  const [editingVisit, setEditingVisit] = useState<VisitRow | null>(null)

  function setFilter(key: string, value: string | null) {
    const next = new URLSearchParams(params)
    if (value && value !== 'all') next.set(key, value)
    else next.delete(key)
    setParams(next, { replace: true })
  }

  if (!salon || !salonId) return null
  const currency = salon.currency

  const totalRevenue = visits.reduce((acc, v) => acc + v.amount_cents, 0)
  const grouped = groupByDay(visits)

  return (
    <div className="flex flex-1 flex-col px-5 py-7 sm:px-8 lg:pb-12">
      {/* Header */}
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
        <div>
          <h1 className="text-brand-navy text-2xl font-bold tracking-tight">{t('visits.title')}</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {t('visits.subtitle_total', {
              count: visits.length,
              revenue: formatCurrency(totalRevenue, currency),
            })}
          </p>
        </div>
        <Button variant="outline" size="md" onClick={() => setBulkOpen(true)}>
          <Layers className="size-4" strokeWidth={1.7} />
          {t('visits.bulk_button')}
        </Button>
      </div>

      <BulkVisitsDialog
        open={bulkOpen}
        onOpenChange={setBulkOpen}
        salonId={salonId}
        currency={currency}
      />

      <EditVisitModal
        visit={editingVisit}
        onClose={() => setEditingVisit(null)}
        salonId={salonId}
        currency={currency}
      />

      {/* Filters */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Select
          value={staffFilter || 'all'}
          onValueChange={(v) => setFilter('staff', v === 'all' ? null : v)}
        >
          <SelectTrigger className="h-10 w-[200px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('visits.filters.all_staff')}</SelectItem>
            {staff.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.full_name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={paymentFilter || 'all'}
          onValueChange={(v) => setFilter('pay', v === 'all' ? null : v)}
        >
          <SelectTrigger className="h-10 w-[180px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('visits.filters.all_payments')}</SelectItem>
            {(['cash', 'card', 'transfer'] as const).map((p) => (
              <SelectItem key={p} value={p}>
                {t(`payment_methods.${p}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Body */}
      {isLoading ? (
        <div className="flex flex-col gap-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="bg-muted/60 h-14 animate-pulse rounded-md" />
          ))}
        </div>
      ) : error ? (
        <p className="text-destructive text-sm">{(error as Error).message}</p>
      ) : visits.length === 0 ? (
        <div className="border-border bg-card rounded-lg border border-dashed px-6 py-12 text-center">
          <p className="text-muted-foreground text-base font-medium">{t('visits.empty')}</p>
          <p className="text-muted-foreground mt-1 text-sm">{t('visits.empty_hint')}</p>
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {Array.from(grouped.entries()).map(([day, items]) => (
            <section key={day}>
              <h2 className="text-muted-foreground mb-3 text-xs font-bold uppercase tracking-wider">
                {formatVisitDayHeading(day + 'T00:00:00.000Z')}
              </h2>
              <ul className="border-border bg-card shadow-finsm overflow-hidden rounded-lg border">
                {items.map((v) => {
                  const staffMember = staff.find((s) => s.id === v.staff_id)
                  const svc = services.find((s) => s.id === v.service_id)
                  const client = clients.find((c) => c.id === v.client_id)
                  const idx = staff.findIndex((s) => s.id === v.staff_id)
                  const color = idx >= 0 ? STAFF_PALETTE[idx % STAFF_PALETTE.length]! : '#E8E5DF'
                  const pay = PAY_LABEL[v.payment_method]
                  const visitTime = new Date(v.visit_at).toLocaleTimeString('ru-RU', {
                    hour: '2-digit',
                    minute: '2-digit',
                  })
                  return (
                    <li
                      key={v.id}
                      className="border-border grid grid-cols-[64px_1fr_auto_72px] items-center gap-3 border-t px-4 py-3 first:border-t-0 sm:grid-cols-[90px_1.2fr_1.6fr_1.4fr_110px_100px_72px]"
                      data-testid="visit-row"
                    >
                      <span className="num text-muted-foreground flex flex-col text-xs leading-tight">
                        <span>{formatVisitDate(v.visit_at)}</span>
                        <span className="text-foreground/70">{visitTime}</span>
                      </span>
                      <span className="flex items-center gap-2.5">
                        <span
                          className="text-brand-navy grid size-6 place-items-center rounded-full text-[10px] font-bold"
                          style={{ background: color }}
                        >
                          {(staffMember?.full_name ?? '?').charAt(0).toUpperCase()}
                        </span>
                        <span className="text-foreground truncate text-sm font-medium">
                          {staffMember?.full_name ?? t('visits.no_staff')}
                        </span>
                      </span>
                      <span className="text-foreground hidden truncate text-sm sm:inline">
                        {svc?.name ?? v.service_name_snapshot ?? '—'}
                      </span>
                      <span className="text-muted-foreground hidden truncate text-sm sm:inline">
                        {client?.name ?? '—'}
                      </span>
                      <span
                        className={cn(
                          'num text-brand-sage text-right text-sm font-bold',
                          'col-start-3 sm:col-auto',
                        )}
                      >
                        +{formatCurrency(v.amount_cents, currency)}
                      </span>
                      <span
                        className="hidden rounded-full px-2.5 py-1 text-[11px] font-semibold sm:inline-flex"
                        style={{ background: pay.bg, color: pay.fg }}
                      >
                        {t(`payment_methods.${pay.label}`)}
                      </span>
                      <span className="flex items-center justify-end gap-0.5">
                        <button
                          type="button"
                          onClick={() => setEditingVisit(v)}
                          className="text-muted-foreground hover:text-secondary grid size-8 place-items-center rounded-md"
                          aria-label={t('visits.edit_aria')}
                          title={t('visits.edit_aria')}
                        >
                          <Pencil className="size-4" strokeWidth={1.7} />
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            if (!confirm(t('visits.confirm_delete'))) return
                            deleteVisit.mutate(v.id, {
                              onSuccess: () => toast.success(t('visits.toast_deleted')),
                            })
                          }}
                          className="text-muted-foreground hover:text-destructive grid size-8 place-items-center rounded-md"
                          aria-label="delete"
                        >
                          <Trash2 className="size-4" strokeWidth={1.7} />
                        </button>
                      </span>
                    </li>
                  )
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}
