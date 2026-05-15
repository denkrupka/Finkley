import { formatDistanceToNow, formatDistanceToNowStrict, parseISO } from 'date-fns'
import { ru } from 'date-fns/locale'
import { BarChart3, Cake, EyeOff, ListChecks, Plus, Search, SlidersHorizontal } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router-dom'

import { AiInsightsPanel } from '@/components/reports/AiInsightsPanel'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { PageTabsNav, type PageTab } from '@/components/ui/PageTabsNav'
import {
  currentMonthPeriod,
  periodToRange,
  type PeriodValue,
} from '@/components/ui/period-picker-utils'
import { PeriodPickerPopover } from '@/components/ui/PeriodPickerPopover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useClients, type ClientSort } from '@/hooks/useClients'
import { useSalon, useSalonMembership } from '@/hooks/useSalons'
import { useTopClientsByRevenue } from '@/hooks/useTopClients'
import { formatCurrency } from '@/lib/utils/format-currency'
import { formatPhoneDisplay } from '@/lib/utils/format-phone'
import { cn } from '@/lib/utils/cn'
import { ClientDrawer } from '@/routes/clients/ClientDrawer'
import { ClientFormModal } from '@/routes/clients/ClientFormModal'
import {
  clientSegment,
  daysSinceLastVisit,
  daysToBirthday,
  type ClientSegment,
} from '@/routes/clients/client-segments'
import type { ClientRow } from '@/hooks/useClients'
import { SegmentationCard } from '@/routes/settings/SegmentationCard'

type ClientsSubTab = 'list' | 'top' | 'params'

const SUB_TABS: PageTab<ClientsSubTab>[] = [
  { id: 'list', labelKey: 'reports_hub.clients.tabs.list', icon: ListChecks },
  { id: 'top', labelKey: 'reports_hub.clients.tabs.top', icon: BarChart3 },
  { id: 'params', labelKey: 'reports_hub.clients.tabs.params', icon: SlidersHorizontal },
]

function isClientsSubTab(v: string | null): v is ClientsSubTab {
  return v === 'list' || v === 'top' || v === 'params'
}

type SegmentFilter = 'all' | ClientSegment

const SEGMENT_BADGE: Record<ClientSegment, { className: string; i18nKey: string }> = {
  new: { className: 'bg-brand-teal-soft text-brand-teal-deep', i18nKey: 'clients.segments.new' },
  regular: {
    className: 'bg-brand-sage-soft text-brand-sage',
    i18nKey: 'clients.segments.regular',
  },
  lapsed: { className: 'bg-amber-100 text-amber-800', i18nKey: 'clients.segments.lapsed' },
  churned: { className: 'bg-destructive/10 text-destructive', i18nKey: 'clients.segments.churned' },
  prospect: { className: 'bg-muted text-muted-foreground', i18nKey: 'clients.segments.prospect' },
}

/**
 * Reports → Клиенты. Три sub-tab'а после merge'а со справочником:
 *
 *   - Список   — полный список клиентов с CRUD, поиск/сортировка/фильтр
 *                по сегменту. Перенесён из /clients (бывший справочник),
 *                чтобы не плодить дублей.
 *   - Топ      — Top-20 за выбранный период по обороту, c AI-инсайтами.
 *   - Параметры — SegmentationCard (окна retention/churn).
 *
 * Активный sub-tab в URL через `?client=list|top|params`.
 *
 * RBAC: контактные данные (phone/email) показываются только owner/admin.
 * Мастера и бухгалтер видят только имя и метрики.
 */
export function ClientsAnalyticsTab({ salonId }: { salonId: string }) {
  const { t } = useTranslation()
  const { data: salon } = useSalon(salonId)
  const currency = salon?.currency ?? 'PLN'

  const [params, setParams] = useSearchParams()
  const subParam = params.get('client')
  const activeSub: ClientsSubTab = isClientsSubTab(subParam) ? subParam : 'list'

  function setActiveSub(id: ClientsSubTab) {
    const next = new URLSearchParams(params)
    next.set('client', id)
    setParams(next, { replace: true })
  }

  return (
    <div>
      <PageTabsNav tabs={SUB_TABS} active={activeSub} onChange={setActiveSub} t={t} />
      {activeSub === 'list' ? (
        <ClientsListTab salonId={salonId} currency={currency} t={t} salon={salon} />
      ) : activeSub === 'top' ? (
        <TopClientsTab salonId={salonId} currency={currency} t={t} />
      ) : (
        <div>{salon ? <SegmentationCard salon={salon} /> : null}</div>
      )}
    </div>
  )
}

function ClientsListTab({
  salonId,
  currency,
  t,
  salon,
}: {
  salonId: string
  currency: string
  t: (k: string, opts?: Record<string, unknown>) => string
  salon: ReturnType<typeof useSalon>['data']
}) {
  const { data: membership } = useSalonMembership(salonId)
  const canSeeContacts = membership?.role === 'owner' || membership?.role === 'admin'

  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<ClientSort>('last_visit')
  const [segmentFilter, setSegmentFilter] = useState<SegmentFilter>('all')
  const [createOpen, setCreateOpen] = useState(false)
  const [drawerClient, setDrawerClient] = useState<ClientRow | null>(null)

  const { data: allClients = [], isLoading } = useClients(salonId, { search, sort })

  const thresholds = useMemo(
    () => ({
      retentionDays: salon?.retention_window_days ?? 60,
      churnDays: salon?.churn_window_days ?? 180,
    }),
    [salon?.retention_window_days, salon?.churn_window_days],
  )

  const segmented = useMemo(
    () => allClients.map((c) => ({ ...c, segment: clientSegment(c, thresholds) })),
    [allClients, thresholds],
  )

  const clients = useMemo(
    () =>
      segmentFilter === 'all' ? segmented : segmented.filter((c) => c.segment === segmentFilter),
    [segmented, segmentFilter],
  )

  const counts = useMemo(() => {
    const acc: Record<ClientSegment, number> = {
      new: 0,
      regular: 0,
      lapsed: 0,
      churned: 0,
      prospect: 0,
    }
    for (const c of segmented) acc[c.segment]++
    return acc
  }, [segmented])

  return (
    <div>
      <div className="mb-5 flex items-center justify-between gap-3">
        <h2 className="text-brand-navy text-lg font-bold tracking-tight">
          {t('reports_hub.clients.list_title')}
        </h2>
        <Button
          variant="primary"
          size="md"
          onClick={() => setCreateOpen(true)}
          data-testid="add-client-reports"
        >
          <Plus className="size-4" strokeWidth={2.4} />
          {t('clients.add')}
        </Button>
      </div>

      {/* Сегменты-чипсы. Клик переключает фильтр, повторный клик — сбрасывает.
          Owner-видимая аналитика без потери компактности. */}
      <div className="mb-4 flex flex-wrap gap-2">
        <SegmentPill
          label={`${t('clients.kpi.total')} · ${segmented.length}`}
          active={segmentFilter === 'all'}
          tone="navy"
          onClick={() => setSegmentFilter('all')}
        />
        {(['new', 'regular', 'lapsed', 'churned'] as const).map((seg) => (
          <SegmentPill
            key={seg}
            label={`${t(`clients.segments.${seg}`)} · ${counts[seg]}`}
            active={segmentFilter === seg}
            tone={
              seg === 'new'
                ? 'teal'
                : seg === 'regular'
                  ? 'sage'
                  : seg === 'lapsed'
                    ? 'amber'
                    : 'red'
            }
            onClick={() => setSegmentFilter(segmentFilter === seg ? 'all' : seg)}
          />
        ))}
      </div>

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
            data-testid="cl-search-reports"
          />
        </div>
        <Select value={sort} onValueChange={(v) => setSort(v as ClientSort)}>
          <SelectTrigger className="sm:w-56" data-testid="cl-sort-reports">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="last_visit">{t('clients.sort.last_visit')}</SelectItem>
            <SelectItem value="name">{t('clients.sort.name')}</SelectItem>
            <SelectItem value="revenue">{t('clients.sort.revenue')}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="border-border bg-card shadow-finsm rounded-lg border">
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
                  data-testid="client-row-reports"
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
                    </p>
                    {canSeeContacts ? (
                      <p className="num text-brand-text-faint text-[12px]">
                        {c.phone ? formatPhoneDisplay(c.phone) : c.email || ''}
                      </p>
                    ) : c.phone || c.email ? (
                      <p className="text-muted-foreground inline-flex items-center gap-1 text-[10.5px]">
                        <EyeOff className="size-3" strokeWidth={1.8} />
                        {t('reports_hub.clients.contacts_hidden')}
                      </p>
                    ) : null}
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

type PillTone = 'navy' | 'sage' | 'amber' | 'teal' | 'red'

function SegmentPill({
  label,
  active,
  tone,
  onClick,
}: {
  label: string
  active: boolean
  tone: PillTone
  onClick: () => void
}) {
  const toneClass: Record<PillTone, string> = {
    navy: 'border-brand-navy/40 data-[active=true]:bg-brand-navy data-[active=true]:text-white',
    sage: 'border-brand-sage/40 data-[active=true]:bg-brand-sage data-[active=true]:text-white',
    amber:
      'border-amber-400/60 data-[active=true]:bg-amber-500 data-[active=true]:text-white text-amber-900',
    teal: 'border-brand-teal/40 data-[active=true]:bg-brand-teal data-[active=true]:text-white',
    red: 'border-destructive/40 data-[active=true]:bg-destructive data-[active=true]:text-white text-destructive',
  }
  return (
    <button
      type="button"
      onClick={onClick}
      data-active={active}
      className={cn(
        'bg-card inline-flex h-8 items-center rounded-full border px-3 text-xs font-semibold transition-colors',
        toneClass[tone],
      )}
    >
      {label}
    </button>
  )
}

function TopClientsTab({
  salonId,
  currency,
  t,
}: {
  salonId: string
  currency: string
  t: (key: string, opts?: Record<string, unknown>) => string
}) {
  const { data: membership } = useSalonMembership(salonId)
  const canSeeContacts = membership?.role === 'owner' || membership?.role === 'admin'

  const [period, setPeriod] = useState<PeriodValue>(() => currentMonthPeriod())
  const range = periodToRange(period)
  const startIso = range.start.toISOString()
  const endIso = range.end.toISOString()
  const { data: rows = [], isLoading } = useTopClientsByRevenue(salonId, startIso, endIso, 20)

  const aiPayload = useMemo(() => {
    if (rows.length === 0) return null
    const totalRevenue = rows.reduce((s, r) => s + r.revenue_cents, 0)
    return {
      period: { start: startIso.slice(0, 10), end: endIso.slice(0, 10) },
      currency,
      total_revenue_cents: totalRevenue,
      top_clients: rows.slice(0, 20).map((r) => ({
        name: r.full_name,
        visits: r.visit_count,
        revenue_cents: r.revenue_cents,
        avg_check_cents: r.visit_count > 0 ? Math.round(r.revenue_cents / r.visit_count) : 0,
        last_visit_at: r.last_visit_at,
      })),
    }
  }, [rows, startIso, endIso, currency])

  return (
    <div>
      <div className="mb-5 flex items-center justify-between gap-3">
        <h2 className="text-brand-navy text-lg font-bold tracking-tight">
          {t('reports_hub.clients.title')}
        </h2>
        <PeriodPickerPopover value={period} onChange={setPeriod} />
      </div>

      {aiPayload ? <AiInsightsPanel kind="clients" payload={aiPayload} /> : null}

      <p className="text-muted-foreground mb-3 hidden text-sm print:block">
        {t('common.print_period', {
          start: startIso.slice(0, 10),
          end: endIso.slice(0, 10),
        })}
      </p>

      <div className="border-border bg-card shadow-finsm overflow-x-auto rounded-lg border">
        {isLoading ? (
          <p className="text-muted-foreground p-6 text-sm">{t('common.loading')}</p>
        ) : rows.length === 0 ? (
          <p className="text-muted-foreground p-6 text-sm">{t('reports_hub.clients.empty')}</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-muted-foreground text-xs uppercase tracking-wider">
              <tr>
                <th className="px-4 py-2 text-left font-semibold">
                  {t('reports_hub.clients.col_name')}
                </th>
                <th className="px-4 py-2 text-right font-semibold">
                  {t('reports_hub.clients.col_visits')}
                </th>
                <th className="px-4 py-2 text-right font-semibold">
                  {t('reports_hub.clients.col_revenue')}
                </th>
                <th className="px-4 py-2 text-right font-semibold">
                  {t('reports_hub.clients.col_avg_check')}
                </th>
                <th className="px-4 py-2 text-right font-semibold">
                  {t('reports_hub.clients.col_last_visit')}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const avg = r.visit_count > 0 ? Math.round(r.revenue_cents / r.visit_count) : 0
                return (
                  <tr key={r.client_id} className="border-border/60 border-t">
                    <td className="text-foreground px-4 py-2">
                      <span className="block font-semibold">{r.full_name}</span>
                      {canSeeContacts && r.phone ? (
                        <span className="text-muted-foreground block text-xs">{r.phone}</span>
                      ) : !canSeeContacts && r.phone ? (
                        <span className="text-muted-foreground inline-flex items-center gap-1 text-[10.5px]">
                          <EyeOff className="size-3" strokeWidth={1.8} />
                          {t('reports_hub.clients.contacts_hidden')}
                        </span>
                      ) : null}
                    </td>
                    <td className="num text-muted-foreground px-4 py-2 text-right">
                      {r.visit_count}
                    </td>
                    <td className="num text-brand-sage-deep px-4 py-2 text-right font-bold">
                      {formatCurrency(r.revenue_cents, currency)}
                    </td>
                    <td className="num text-muted-foreground px-4 py-2 text-right">
                      {formatCurrency(avg, currency)}
                    </td>
                    <td className="text-muted-foreground px-4 py-2 text-right text-xs">
                      {r.last_visit_at
                        ? formatDistanceToNowStrict(new Date(r.last_visit_at), {
                            addSuffix: true,
                            locale: ru,
                          })
                        : '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
