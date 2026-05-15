import { Calculator, ChevronDown, ChevronRight, Pencil, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useParams, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'

import { EditVisitModal } from './EditVisitModal'
import { FreeSlotsPanel } from './FreeSlotsPanel'
import { VisitsActionsBar } from './VisitsActionsBar'
import { VisitsCalendarView } from './VisitsCalendarView'

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useClients } from '@/hooks/useClients'
import {
  useDeleteVisit,
  useVisits,
  type PaymentMethod,
  type VisitKind,
  type VisitRow,
} from '@/hooks/useVisits'
import { useSalon } from '@/hooks/useSalons'
import { useStaff } from '@/hooks/useStaff'
import { useServices } from '@/hooks/useServices'
import { getPeriodRange, readCustomFromParams, type PeriodKey } from '@/lib/period'
import { cn } from '@/lib/utils/cn'
import { formatCurrency } from '@/lib/utils/format-currency'
import { formatVisitDayHeading, groupByDay } from '@/lib/utils/format-date'

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

type VisitsPageProps = {
  /**
   * Если задан — фильтр по виду визита `kind` форсируется (игнорирует
   * URL-параметр `?kind`). Используется когда VisitsPage рендерится
   * внутри IncomePage в табе «Визиты» (`forcedKind='visit'`) или
   * «Продажи» (`forcedKind='retail'`).
   */
  forcedKind?: VisitKind
}

export function VisitsPage({ forcedKind }: VisitsPageProps = {}) {
  const { t } = useTranslation()
  const { salonId } = useParams<{ salonId: string }>()
  const [params, setParams] = useSearchParams()
  const period = (params.get('period') ?? 'month') as PeriodKey
  const staffFilter = params.get('staff') || ''
  const paymentFilter = (params.get('pay') || '') as PaymentMethod | ''
  const serviceFilter = params.get('service') || ''
  /** Toggle list/calendar. По дефолту calendar (так удобнее, owner 2026-05-12).
   *  ?view=list переключает на список (как было раньше). */
  const view = params.get('view') === 'list' ? 'list' : 'calendar'
  // `?kind=retail` фильтрует список до товарных продаж. Может быть задан
  // через URL (старые роуты) или пропсом `forcedKind` (из IncomePage).
  const kindParam = params.get('kind')
  const kindFromUrl: VisitKind | null =
    kindParam === 'retail' || kindParam === 'visit' ? (kindParam as VisitKind) : null
  const kindFilter: VisitKind | null = forcedKind ?? kindFromUrl

  const range = getPeriodRange(period, new Date(), readCustomFromParams(params))
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
    serviceId: serviceFilter || null,
    kind: kindFilter,
  })
  const deleteVisit = useDeleteVisit(salonId)
  const [editingVisit, setEditingVisit] = useState<VisitRow | null>(null)
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())

  function toggleGroup(key: string) {
    setExpandedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

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

  // Когда VisitsPage встроен в IncomePage (forcedKind задан) — обёрточные
  // отступы и заголовок уже даёт родитель. Actions-кнопки тоже рендерятся
  // в rightSlot PageTabsNav родителя (см. Image #54), не дублируем.
  const embedded = !!forcedKind

  return (
    <div className={cn('flex flex-1 flex-col', embedded ? '' : 'px-5 py-7 sm:px-8 lg:pb-12')}>
      {/* Header — только для standalone (/visits). В embedded actions выше в табах. */}
      {!embedded ? (
        <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-brand-navy text-2xl font-bold tracking-tight">
              {t('visits.title')}
            </h1>
            <p className="text-muted-foreground mt-1 text-sm">
              {t('visits.subtitle_total', {
                count: visits.length,
                revenue: formatCurrency(totalRevenue, currency),
              })}
            </p>
          </div>
          <VisitsActionsBar />
        </div>
      ) : null}

      {view === 'calendar' ? (
        <div className="border-border bg-card shadow-finsm flex-1 overflow-hidden rounded-lg border">
          <VisitsCalendarView salonId={salonId} />
        </div>
      ) : (
        <>
          {/* Перенесённый ниже list-content внутри fragment чтобы Calendar
            бранч не рендерил его */}

          <EditVisitModal
            visit={editingVisit}
            onClose={() => setEditingVisit(null)}
            salonId={salonId}
            currency={currency}
          />
          {null /* helpers below */}

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

            <Select
              value={serviceFilter || 'all'}
              onValueChange={(v) => setFilter('service', v === 'all' ? null : v)}
            >
              <SelectTrigger className="h-10 w-[200px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('visits.filters.all_services')}</SelectItem>
                {services.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Свободные окна — раскрывающаяся панель над списком визитов */}
          <FreeSlotsPanel salonId={salonId} />

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
                    {(() => {
                      // Группируем визиты по group_key. Уникальные группы рендерятся
                      // как раскрываемая строка; visits без group_key — обычная строка.
                      type RenderGroup = { key: string; visits: VisitRow[] }
                      const seen = new Set<string>()
                      const rows: (VisitRow | RenderGroup)[] = []
                      for (const v of items) {
                        if (v.group_key) {
                          if (seen.has(v.group_key)) continue
                          seen.add(v.group_key)
                          const groupVisits = items.filter((x) => x.group_key === v.group_key)
                          rows.push({ key: v.group_key, visits: groupVisits })
                        } else {
                          rows.push(v)
                        }
                      }
                      return rows.map((row) => {
                        if ('visits' in row) {
                          return (
                            <GroupRow
                              key={row.key}
                              group={row}
                              isExpanded={expandedGroups.has(row.key)}
                              onToggle={() => toggleGroup(row.key)}
                              onEdit={(v) => setEditingVisit(v)}
                              onDelete={(id) => {
                                if (!confirm(t('visits.confirm_delete'))) return
                                deleteVisit.mutate(id, {
                                  onSuccess: () => toast.success(t('visits.toast_deleted')),
                                })
                              }}
                              staff={staff}
                              services={services}
                              clients={clients}
                              currency={currency}
                              t={t}
                            />
                          )
                        }
                        return (
                          <SingleVisitRow
                            key={row.id}
                            visit={row}
                            onEdit={() => setEditingVisit(row)}
                            onDelete={() => {
                              if (!confirm(t('visits.confirm_delete'))) return
                              deleteVisit.mutate(row.id, {
                                onSuccess: () => toast.success(t('visits.toast_deleted')),
                              })
                            }}
                            staff={staff}
                            services={services}
                            clients={clients}
                            currency={currency}
                            t={t}
                          />
                        )
                      })
                    })()}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}

// =============================================================================
// Row components
// =============================================================================

type StaffLite = { id: string; full_name: string }
type ServiceLite = { id: string; name: string }
type ClientLite = { id: string; name: string }

const ROW_GRID =
  'grid grid-cols-[56px_1fr_auto_72px] items-center gap-3 px-4 py-3 sm:grid-cols-[64px_1.2fr_1.5fr_1.3fr_110px_100px_72px]'

function visitTimeStr(visitAt: string): string {
  return new Date(visitAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
}

function staffColor(staffId: string | null, staff: StaffLite[]): string {
  const idx = staff.findIndex((s) => s.id === staffId)
  return idx >= 0 ? STAFF_PALETTE[idx % STAFF_PALETTE.length]! : '#E8E5DF'
}

function SingleVisitRow({
  visit: v,
  onEdit,
  onDelete,
  staff,
  services,
  clients,
  currency,
  t,
}: {
  visit: VisitRow
  onEdit: () => void
  onDelete: () => void
  staff: StaffLite[]
  services: ServiceLite[]
  clients: ClientLite[]
  currency: string
  t: (k: string, opts?: Record<string, unknown>) => string
}) {
  const staffMember = staff.find((s) => s.id === v.staff_id)
  const svc = services.find((s) => s.id === v.service_id)
  const client = clients.find((c) => c.id === v.client_id)
  const color = staffColor(v.staff_id, staff)
  const pay = PAY_LABEL[v.payment_method]
  return (
    <li
      className={cn(
        'border-border hover:bg-muted/40 cursor-pointer border-t transition-colors first:border-t-0',
        ROW_GRID,
      )}
      data-testid="visit-row"
      onClick={onEdit}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onEdit()
        }
      }}
      role="button"
      tabIndex={0}
    >
      <span className="num text-muted-foreground text-xs">{visitTimeStr(v.visit_at)}</span>
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
        {v.kind === 'retail' ? (
          <span className="bg-brand-yellow/40 text-brand-navy mr-1.5 inline-block rounded-full px-1.5 py-0.5 text-[9.5px] font-bold uppercase">
            {t('visits.retail.badge')}
          </span>
        ) : null}
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
      {v.status === 'pending' ? (
        <span className="hidden rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-semibold text-amber-800 sm:inline-flex">
          {t('visits.status_pending')}
        </span>
      ) : (
        <span
          className="hidden rounded-full px-2.5 py-1 text-[11px] font-semibold sm:inline-flex"
          style={{ background: pay.bg, color: pay.fg }}
        >
          {t(`payment_methods.${pay.label}`)}
        </span>
      )}
      <span className="flex items-center justify-end gap-0.5">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onEdit()
          }}
          className={cn(
            'grid size-8 place-items-center rounded-md',
            v.status === 'pending'
              ? 'text-secondary hover:bg-secondary/10'
              : 'text-muted-foreground hover:text-secondary',
          )}
          aria-label={v.status === 'pending' ? t('visits.charge_aria') : t('visits.edit_aria')}
          title={v.status === 'pending' ? t('visits.charge_aria') : t('visits.edit_aria')}
        >
          {v.status === 'pending' ? (
            <Calculator className="size-4" strokeWidth={1.9} />
          ) : (
            <Pencil className="size-4" strokeWidth={1.7} />
          )}
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onDelete()
          }}
          className="text-muted-foreground hover:text-destructive grid size-8 place-items-center rounded-md"
          aria-label="delete"
        >
          <Trash2 className="size-4" strokeWidth={1.7} />
        </button>
      </span>
    </li>
  )
}

function GroupRow({
  group,
  isExpanded,
  onToggle,
  onEdit,
  onDelete,
  staff,
  services,
  clients,
  currency,
  t,
}: {
  group: { key: string; visits: VisitRow[] }
  isExpanded: boolean
  onToggle: () => void
  onEdit: (v: VisitRow) => void
  onDelete: (id: string) => void
  staff: StaffLite[]
  services: ServiceLite[]
  clients: ClientLite[]
  currency: string
  t: (k: string, opts?: Record<string, unknown>) => string
}) {
  const visits = group.visits
  const primary = visits[0]
  if (!primary) return null
  const totalAmount = visits.reduce((acc, v) => acc + v.amount_cents, 0)
  const client = clients.find((c) => c.id === primary.client_id)
  const allPaid = visits.every((v) => v.status === 'paid')
  // Если все одного метода — показываем; иначе "Смешано"
  const methods = new Set(visits.map((v) => v.payment_method))
  const sharedPay = methods.size === 1 ? PAY_LABEL[primary.payment_method] : null

  // Уникальные мастера группы — рендерим их аватары + имена (как в обычной строке)
  const uniqueStaff: { id: string | null; name: string }[] = []
  const seenStaffIds = new Set<string>()
  for (const v of visits) {
    const key = v.staff_id ?? '__none__'
    if (seenStaffIds.has(key)) continue
    seenStaffIds.add(key)
    const member = staff.find((s) => s.id === v.staff_id)
    uniqueStaff.push({ id: v.staff_id, name: member?.full_name ?? t('visits.no_staff') })
  }

  return (
    <>
      <li
        className={cn(
          'border-border hover:bg-muted/30 cursor-pointer border-t first:border-t-0',
          ROW_GRID,
        )}
        onClick={onToggle}
        data-testid="visit-group-row"
      >
        <span className="num text-muted-foreground flex items-center gap-1 text-xs">
          {isExpanded ? (
            <ChevronDown className="size-3.5" strokeWidth={2} />
          ) : (
            <ChevronRight className="size-3.5" strokeWidth={2} />
          )}
          {visitTimeStr(primary.visit_at)}
        </span>
        <span className="flex min-w-0 items-center gap-2">
          {uniqueStaff.map((s, i) => (
            <span key={s.id ?? `none-${i}`} className="flex min-w-0 items-center gap-1.5">
              <span
                className="text-brand-navy grid size-6 shrink-0 place-items-center rounded-full text-[10px] font-bold"
                style={{ background: staffColor(s.id, staff) }}
              >
                {s.name.charAt(0).toUpperCase()}
              </span>
              <span className="text-foreground truncate text-sm font-medium">{s.name}</span>
              {i < uniqueStaff.length - 1 ? (
                <span className="text-muted-foreground text-sm">+</span>
              ) : null}
            </span>
          ))}
        </span>
        <span className="text-foreground hidden truncate text-sm sm:inline">
          {visits
            .map(
              (v) =>
                services.find((s) => s.id === v.service_id)?.name ?? v.service_name_snapshot ?? '—',
            )
            .join(' + ')}
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
          +{formatCurrency(totalAmount, currency)}
        </span>
        {!allPaid ? (
          <span className="hidden rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-semibold text-amber-800 sm:inline-flex">
            {t('visits.status_pending')}
          </span>
        ) : sharedPay ? (
          <span
            className="hidden rounded-full px-2.5 py-1 text-[11px] font-semibold sm:inline-flex"
            style={{ background: sharedPay.bg, color: sharedPay.fg }}
          >
            {t(`payment_methods.${sharedPay.label}`)}
          </span>
        ) : (
          <span className="bg-muted text-foreground hidden rounded-full px-2.5 py-1 text-[11px] font-semibold sm:inline-flex">
            {t('visits.mixed_payments')}
          </span>
        )}
        <span />
      </li>
      {isExpanded
        ? visits.map((v) => {
            const staffMember = staff.find((s) => s.id === v.staff_id)
            const svc = services.find((s) => s.id === v.service_id)
            const color = staffColor(v.staff_id, staff)
            const pay = PAY_LABEL[v.payment_method]
            return (
              <li
                key={v.id}
                className={cn(
                  'bg-muted/20 hover:bg-muted/40 border-border cursor-pointer border-t transition-colors',
                  ROW_GRID,
                  'pl-10',
                )}
                data-testid="visit-subitem"
                onClick={() => onEdit(v)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    onEdit(v)
                  }
                }}
                role="button"
                tabIndex={0}
              >
                <span className="num text-muted-foreground text-xs">
                  {visitTimeStr(v.visit_at)}
                </span>
                <span className="flex items-center gap-2.5">
                  <span
                    className="text-brand-navy grid size-6 place-items-center rounded-full text-[10px] font-bold"
                    style={{ background: color }}
                  >
                    {(staffMember?.full_name ?? '?').charAt(0).toUpperCase()}
                  </span>
                  <span className="text-foreground/80 truncate text-sm">
                    {staffMember?.full_name ?? t('visits.no_staff')}
                  </span>
                </span>
                <span className="text-foreground/80 hidden truncate text-sm sm:inline">
                  {svc?.name ?? v.service_name_snapshot ?? '—'}
                </span>
                <span className="hidden sm:inline" />
                <span
                  className={cn(
                    'num text-brand-sage text-right text-sm font-semibold',
                    'col-start-3 sm:col-auto',
                  )}
                >
                  +{formatCurrency(v.amount_cents, currency)}
                </span>
                {v.status === 'pending' ? (
                  <span className="hidden rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800 sm:inline-flex">
                    {t('visits.status_pending')}
                  </span>
                ) : (
                  <span
                    className="hidden rounded-full px-2 py-0.5 text-[10px] font-semibold sm:inline-flex"
                    style={{ background: pay.bg, color: pay.fg }}
                  >
                    {t(`payment_methods.${pay.label}`)}
                  </span>
                )}
                <span className="flex items-center justify-end gap-0.5">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      onEdit(v)
                    }}
                    className={cn(
                      'grid size-8 place-items-center rounded-md',
                      v.status === 'pending'
                        ? 'text-secondary hover:bg-secondary/10'
                        : 'text-muted-foreground hover:text-secondary',
                    )}
                    aria-label={
                      v.status === 'pending' ? t('visits.charge_aria') : t('visits.edit_aria')
                    }
                  >
                    {v.status === 'pending' ? (
                      <Calculator className="size-4" strokeWidth={1.9} />
                    ) : (
                      <Pencil className="size-4" strokeWidth={1.7} />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      onDelete(v.id)
                    }}
                    className="text-muted-foreground hover:text-destructive grid size-8 place-items-center rounded-md"
                    aria-label="delete"
                  >
                    <Trash2 className="size-4" strokeWidth={1.7} />
                  </button>
                </span>
              </li>
            )
          })
        : null}
    </>
  )
}
