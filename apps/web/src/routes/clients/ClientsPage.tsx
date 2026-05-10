import { formatDistanceToNow, parseISO } from 'date-fns'
import { ru } from 'date-fns/locale'
import { Cake, Plus, Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useParams } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useClients, type ClientRow, type ClientSort } from '@/hooks/useClients'
import { useSalon } from '@/hooks/useSalons'
import { formatCurrency } from '@/lib/utils/format-currency'
import { formatPhoneDisplay } from '@/lib/utils/format-phone'
import { cn } from '@/lib/utils/cn'

import { ClientDrawer } from './ClientDrawer'
import { ClientFormModal } from './ClientFormModal'
import {
  clientSegment,
  daysSinceLastVisit,
  daysToBirthday,
  type ClientSegment,
} from './client-segments'

type SegmentFilter = 'all' | 'new' | 'regular' | 'lapsed' | 'churned' | 'prospect'

const SEGMENT_BADGE: Record<ClientSegment, { className: string; i18nKey: string }> = {
  new: { className: 'bg-brand-teal-soft text-brand-teal-deep', i18nKey: 'clients.segments.new' },
  regular: {
    className: 'bg-brand-sage-soft text-brand-sage',
    i18nKey: 'clients.segments.regular',
  },
  lapsed: {
    className: 'bg-amber-100 text-amber-800',
    i18nKey: 'clients.segments.lapsed',
  },
  churned: {
    className: 'bg-destructive/10 text-destructive',
    i18nKey: 'clients.segments.churned',
  },
  prospect: { className: 'bg-muted text-muted-foreground', i18nKey: 'clients.segments.prospect' },
}

export function ClientsPage() {
  const { t } = useTranslation()
  const { salonId } = useParams<{ salonId: string }>()
  const { data: salon } = useSalon(salonId)
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<ClientSort>('last_visit')
  const [segmentFilter, setSegmentFilter] = useState<SegmentFilter>('all')
  const [createOpen, setCreateOpen] = useState(false)
  const [drawerClient, setDrawerClient] = useState<ClientRow | null>(null)

  const { data: allClients = [], isLoading } = useClients(salonId, { search, sort })

  // Считаем сегменты для всех клиентов (без фильтра — нужны для KPI)
  const segmented = useMemo(
    () => allClients.map((c) => ({ ...c, segment: clientSegment(c) })),
    [allClients],
  )

  const clients = useMemo(
    () =>
      segmentFilter === 'all' ? segmented : segmented.filter((c) => c.segment === segmentFilter),
    [segmented, segmentFilter],
  )

  // Расширенные KPI: сегменты + общие
  const summary = useMemo(() => {
    const counts: Record<ClientSegment, number> = {
      new: 0,
      regular: 0,
      lapsed: 0,
      churned: 0,
      prospect: 0,
    }
    for (const c of segmented) counts[c.segment]++
    const totalRevenue = segmented.reduce((acc, c) => acc + c.total_revenue_cents, 0)
    const upcomingBirthdays = segmented.filter((c) => daysToBirthday(c.birthday) !== null).length
    return { totalCount: segmented.length, counts, totalRevenue, upcomingBirthdays }
  }, [segmented])

  if (!salon || !salonId) return null
  const currency = salon.currency

  return (
    <div className="flex flex-1 flex-col px-5 py-7 sm:px-8 lg:pb-12">
      {/* Header */}
      <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
        <div>
          <h1 className="text-brand-navy text-2xl font-bold tracking-tight">
            {t('clients.title')}
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {t('clients.subtitle', { count: summary.totalCount })}
          </p>
        </div>
        <Button
          variant="primary"
          size="md"
          onClick={() => setCreateOpen(true)}
          data-testid="add-client"
        >
          <Plus className="size-4" strokeWidth={2.4} />
          {t('clients.add')}
        </Button>
      </div>

      {/* Summary cards: сегменты RFM-lite + birthdays */}
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <KpiCard label={t('clients.kpi.total')} value={String(summary.totalCount)} tone="navy" />
        <KpiCard
          label={t('clients.segments.new')}
          value={String(summary.counts.new)}
          tone="teal"
          onClick={() => setSegmentFilter(segmentFilter === 'new' ? 'all' : 'new')}
          active={segmentFilter === 'new'}
        />
        <KpiCard
          label={t('clients.segments.regular')}
          value={String(summary.counts.regular)}
          tone="sage"
          onClick={() => setSegmentFilter(segmentFilter === 'regular' ? 'all' : 'regular')}
          active={segmentFilter === 'regular'}
        />
        <KpiCard
          label={t('clients.segments.lapsed')}
          value={String(summary.counts.lapsed)}
          tone="amber"
          onClick={() => setSegmentFilter(segmentFilter === 'lapsed' ? 'all' : 'lapsed')}
          active={segmentFilter === 'lapsed'}
        />
        <KpiCard
          label={t('clients.segments.churned')}
          value={String(summary.counts.churned)}
          tone="red"
          onClick={() => setSegmentFilter(segmentFilter === 'churned' ? 'all' : 'churned')}
          active={segmentFilter === 'churned'}
        />
        <KpiCard
          label={t('clients.kpi.upcoming_birthdays')}
          value={String(summary.upcomingBirthdays)}
          tone="navy"
        />
      </div>

      {/* Toolbar */}
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
        <div className="relative flex-1">
          <Search
            className="text-muted-foreground pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2"
            strokeWidth={1.7}
          />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('clients.search_placeholder')}
            className="pl-10"
            data-testid="cl-search"
          />
        </div>
        <Select value={sort} onValueChange={(v) => setSort(v as ClientSort)}>
          <SelectTrigger className="sm:w-56" data-testid="cl-sort">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="last_visit">{t('clients.sort.last_visit')}</SelectItem>
            <SelectItem value="name">{t('clients.sort.name')}</SelectItem>
            <SelectItem value="revenue">{t('clients.sort.revenue')}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* List */}
      <div className="border-border bg-card shadow-finsm rounded-lg border">
        <div className="border-border flex items-baseline justify-between border-b px-5 py-4">
          <h2 className="text-brand-navy text-base font-bold tracking-tight">
            {t('clients.list_title')}
          </h2>
          <span className="text-muted-foreground text-xs">
            {clients.length} {t('clients.records')}
          </span>
        </div>

        {isLoading ? (
          <div className="space-y-2 p-3">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="bg-muted/60 h-14 animate-pulse rounded-md" />
            ))}
          </div>
        ) : clients.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <p className="text-muted-foreground text-sm">
              {search ? t('clients.empty_search') : t('clients.empty')}
            </p>
          </div>
        ) : (
          <ul>
            {clients.map((c) => {
              const badge = SEGMENT_BADGE[c.segment]
              const bdDays = daysToBirthday(c.birthday)
              const lastDays = daysSinceLastVisit(c.last_visit_at)
              return (
                <li
                  key={c.id}
                  className="border-border hover:bg-muted/40 grid cursor-pointer grid-cols-[1fr_auto_auto] items-center gap-3 border-t px-5 py-3 first:border-t-0"
                  onClick={() => setDrawerClient(c)}
                  data-testid="client-row"
                >
                  <div className="min-w-0">
                    <p className="text-foreground flex items-center gap-2 truncate text-sm font-semibold">
                      <span className="truncate">{c.name}</span>
                      <span
                        className={cn(
                          'shrink-0 rounded-full px-1.5 py-0.5 text-[9.5px] font-bold uppercase',
                          badge.className,
                        )}
                      >
                        {t(badge.i18nKey)}
                      </span>
                      {bdDays !== null ? (
                        <span
                          className="bg-brand-yellow/40 text-brand-navy inline-flex shrink-0 items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[9.5px] font-bold"
                          title={t('clients.birthday_in', { count: bdDays })}
                        >
                          <Cake className="size-2.5" strokeWidth={2.4} />
                          {bdDays === 0 ? t('clients.birthday_today') : `${bdDays}д`}
                        </span>
                      ) : null}
                      {c.source ? (
                        <span className="bg-muted text-muted-foreground hidden shrink-0 rounded-full px-1.5 py-0.5 text-[9.5px] font-medium md:inline">
                          {c.source}
                        </span>
                      ) : null}
                    </p>
                    <p className="num text-brand-text-faint text-[12px]">
                      {c.phone ? formatPhoneDisplay(c.phone) : c.email || ''}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="num text-foreground text-sm font-bold">
                      {formatCurrency(c.total_revenue_cents, currency)}
                    </p>
                    <p className="text-muted-foreground text-[11px]">
                      {c.visit_count} {t('clients.drawer.visits_count')}
                    </p>
                  </div>
                  <span
                    className={cn(
                      'hidden w-[110px] text-right text-[11px] sm:block',
                      lastDays !== null && lastDays > 60
                        ? 'font-semibold text-amber-700'
                        : 'text-muted-foreground',
                    )}
                  >
                    {c.last_visit_at
                      ? formatDistanceToNow(parseISO(c.last_visit_at), {
                          addSuffix: true,
                          locale: ru,
                        })
                      : '—'}
                  </span>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      <ClientFormModal open={createOpen} onOpenChange={setCreateOpen} salonId={salonId} />

      <ClientDrawer
        open={!!drawerClient}
        onOpenChange={(o) => {
          if (!o) setDrawerClient(null)
        }}
        salonId={salonId}
        client={drawerClient}
        currency={currency}
      />
    </div>
  )
}

type Tone = 'navy' | 'sage' | 'amber' | 'teal' | 'red'

function KpiCard({
  label,
  value,
  tone,
  onClick,
  active,
}: {
  label: string
  value: string
  tone: Tone
  onClick?: () => void
  active?: boolean
}) {
  const colorClass: Record<Tone, string> = {
    navy: 'border-l-brand-navy',
    sage: 'border-l-brand-sage',
    amber: 'border-l-brand-yellow-deep',
    teal: 'border-l-brand-teal',
    red: 'border-l-destructive',
  }
  const baseClass = `border-border bg-card shadow-finsm rounded-lg border border-l-4 p-4 ${colorClass[tone]}`
  const interactive = onClick
    ? `cursor-pointer transition-shadow hover:shadow-md ${active ? 'ring-2 ring-primary/50' : ''}`
    : ''
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={`${baseClass} ${interactive} text-left`}>
        <div className="text-muted-foreground text-xs font-semibold">{label}</div>
        <div className="num text-foreground mt-2 text-xl font-bold tracking-tight">{value}</div>
      </button>
    )
  }
  return (
    <div className={baseClass}>
      <div className="text-muted-foreground text-xs font-semibold">{label}</div>
      <div className="num text-foreground mt-2 text-xl font-bold tracking-tight">{value}</div>
    </div>
  )
}
