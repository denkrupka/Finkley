import { format, parseISO } from 'date-fns'
import {
  AlertTriangle,
  Cake,
  EyeOff,
  ListChecks,
  Plus,
  Search,
  SlidersHorizontal,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router-dom'

import { AiInsightsPanel } from '@/components/reports/AiInsightsPanel'
import { getDateLocale } from '@/lib/utils/format-date'
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
import { useAuth } from '@/hooks/useAuth'
import { useClientLtvMetrics, useClients, type ClientSort } from '@/hooks/useClients'
import { useClientRegularity } from '@/hooks/useServices'
import { useClientIdsWithVisitsInPeriod, useNextVisitsByClient } from '@/hooks/useNextVisits'
import { useSalon, useSalonMembership } from '@/hooks/useSalons'
import { supabase } from '@/lib/supabase/client'
import { humanizeTag } from '@/lib/client-tags'
import { formatCurrency } from '@/lib/utils/format-currency'
import { cn } from '@/lib/utils/cn'
import { ClientDrawer } from '@/routes/clients/ClientDrawer'
import { ClientFormModal } from '@/routes/clients/ClientFormModal'
import { clientSegment, daysToBirthday, type ClientSegment } from '@/routes/clients/client-segments'
import type { ClientRow } from '@/hooks/useClients'
import { SegmentationCard } from '@/routes/settings/SegmentationCard'

type ClientsSubTab = 'list' | 'params' | 'regularity'

const SUB_TABS: PageTab<ClientsSubTab>[] = [
  { id: 'list', labelKey: 'reports_hub.clients.tabs.list', icon: ListChecks },
  {
    id: 'regularity',
    labelKey: 'reports_hub.clients.tabs.regularity',
    icon: AlertTriangle,
  },
  { id: 'params', labelKey: 'reports_hub.clients.tabs.params', icon: SlidersHorizontal },
]

function isClientsSubTab(v: string | null): v is ClientsSubTab {
  return v === 'list' || v === 'params' || v === 'regularity'
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

/** Порог количества клиентов с видимыми контактами, после которого
 *  владельцу салона уходит уведомление о массовом просмотре администратором.
 *  Установлен заказчиком (>50 = «подозрительно много в один заход»). */
const MASS_VIEW_THRESHOLD = 50

// (LTV-default не нужен — используем optional chaining + ?? '—')

/**
 * Reports → Клиенты. Два sub-tab'а:
 *   - Список — полный CRUD-список с поиском/фильтром/сегментами и AI-выводами.
 *   - Параметры — окна retention/churn для сегментации.
 *
 * Раньше был ещё «Топ клиентов по выручке»; владелец попросил убрать его и
 * перенести AI-инсайты в «Список» (TASK-46).
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
      ) : activeSub === 'regularity' ? (
        <RegularityTab salonId={salonId} t={t} />
      ) : (
        <div>{salon ? <SegmentationCard salon={salon} /> : null}</div>
      )}
    </div>
  )
}

function RegularityTab({
  salonId,
  t,
}: {
  salonId: string
  t: (k: string, opts?: Record<string, unknown>) => string
}) {
  const { data: rows = [], isLoading } = useClientRegularity(salonId)
  return (
    <div className="border-border bg-card shadow-finsm overflow-hidden rounded-lg border">
      <div className="border-border bg-muted/10 border-b px-5 py-4">
        <h2 className="text-brand-navy text-base font-bold">
          {t('reports_hub.clients.regularity.title')}
        </h2>
        <p className="text-muted-foreground mt-0.5 text-xs">
          {t('reports_hub.clients.regularity.subtitle')}
        </p>
      </div>
      {isLoading ? (
        <p className="text-muted-foreground px-5 py-8 text-center text-sm">{t('common.loading')}</p>
      ) : rows.length === 0 ? (
        <div className="px-5 py-12 text-center">
          <p className="text-muted-foreground text-sm">
            {t('reports_hub.clients.regularity.empty')}
          </p>
          <p className="text-muted-foreground/70 mt-1 text-xs">
            {t('reports_hub.clients.regularity.empty_hint')}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[700px] text-sm">
            <thead className="bg-muted/40 text-muted-foreground border-b text-[11px] uppercase tracking-wider">
              <tr>
                <th className="px-4 py-3 text-left font-semibold">
                  {t('reports_hub.clients.col_name_full')}
                </th>
                <th className="px-3 py-3 text-left font-semibold">
                  {t('reports_hub.clients.regularity.category')}
                </th>
                <th className="px-3 py-3 text-right font-semibold">
                  {t('reports_hub.clients.regularity.last_visit')}
                </th>
                <th className="px-3 py-3 text-right font-semibold">
                  {t('reports_hub.clients.regularity.expected')}
                </th>
                <th className="px-3 py-3 text-right font-semibold">
                  {t('reports_hub.clients.regularity.overdue')}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={`${r.client_id}-${r.category_id}`}
                  className="border-border/60 hover:bg-muted/20 border-t"
                >
                  <td className="px-4 py-2.5">
                    <div className="text-foreground text-sm font-semibold">{r.client_name}</div>
                    {r.client_phone || r.client_email ? (
                      <div className="text-muted-foreground mt-0.5 text-[11px]">
                        {r.client_email || ''}
                        {r.client_email && r.client_phone ? ' · ' : ''}
                        <span className="num">{r.client_phone || ''}</span>
                      </div>
                    ) : null}
                  </td>
                  <td className="text-muted-foreground px-3 py-2.5 text-xs">
                    <span className="bg-muted text-foreground rounded-full px-2 py-0.5 text-[11px] font-semibold">
                      {r.category_name}
                    </span>
                  </td>
                  <td className="num text-muted-foreground px-3 py-2.5 text-right text-xs">
                    {format(parseISO(r.last_visit_at), 'd MMM yyyy', { locale: getDateLocale() })}
                  </td>
                  <td className="num text-muted-foreground px-3 py-2.5 text-right text-xs">
                    {r.expected_period_days} {t('services_page.params.days')}
                  </td>
                  <td className="num text-destructive px-3 py-2.5 text-right text-sm font-bold">
                    +{r.days_overdue} {t('services_page.params.days')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
  const { user } = useAuth()
  const { data: membership } = useSalonMembership(salonId)
  const role = membership?.role ?? null
  // RBAC: owner/admin видят контактные данные, остальные роли — нет.
  // Если admin (не owner) загружает >MASS_VIEW_THRESHOLD клиентов,
  // владельцу уходит уведомление (email + Telegram) — см. useEffect ниже.
  const canSeeContacts = role === 'owner' || role === 'admin'
  const isAdmin = role === 'admin'

  const [search, setSearch] = useState('')
  // Image #131: debounce поиска, чтобы фильтр не дёргался на каждое
  // нажатие клавиши — uesClients посылает запрос только когда юзер
  // закончил вводить (200 ms тишины). Это убирает «долго обновляются
  // фильтры» при быстром наборе.
  const [debouncedSearch, setDebouncedSearch] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 200)
    return () => clearTimeout(t)
  }, [search])
  const [sort, setSort] = useState<ClientSort>('last_visit')
  const [segmentFilter, setSegmentFilter] = useState<SegmentFilter>('all')
  const [createOpen, setCreateOpen] = useState(false)
  const [drawerClient, setDrawerClient] = useState<ClientRow | null>(null)
  // Image #131: пагинация по 25 записей. При смене фильтра/поиска/сегмента
  // сбрасываем на первую страницу.
  const [page, setPage] = useState(1)
  const PAGE_SIZE = 25
  // Image #113: фильтр по периоду визитов. null = «все время» (default —
  // юзер хочет видеть всю базу сразу, без сюрприза «потерянных» клиентов).
  // При выборе периода фильтруем клиентов: только те, у кого был визит в
  // выбранном диапазоне.
  const [period, setPeriod] = useState<PeriodValue | null>(null)
  const periodRangeIso = useMemo(() => {
    if (!period) return null
    const r = periodToRange(period)
    return { start: r.start.toISOString(), end: r.end.toISOString() }
  }, [period])

  const { data: allClients = [], isLoading } = useClients(salonId, {
    search: debouncedSearch,
    sort,
  })
  const { data: nextVisitsByClient = new Map<string, string>() } = useNextVisitsByClient(salonId)
  const { data: ltvByClient } = useClientLtvMetrics(salonId)
  const { data: clientsInPeriod = null } = useClientIdsWithVisitsInPeriod(salonId, periodRangeIso)

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

  const clients = useMemo(() => {
    let list = segmented
    if (segmentFilter !== 'all') list = list.filter((c) => c.segment === segmentFilter)
    // Image #113: дополнительный фильтр по периоду визитов. Применяем только
    // когда период выбран И данные по визитам в этот период загружены.
    if (period && clientsInPeriod) list = list.filter((c) => clientsInPeriod.has(c.id))
    return list
  }, [segmented, segmentFilter, period, clientsInPeriod])

  // Image #131: пагинация. При изменении количества клиентов или сброса
  // фильтра нормализуем page (если ушли за пределы) и обновляем total.
  const totalPages = Math.max(1, Math.ceil(clients.length / PAGE_SIZE))
  useEffect(() => {
    if (page > totalPages) setPage(1)
  }, [page, totalPages])
  // При смене фильтра/поиска/периода/сегмента — на первую страницу.
  useEffect(() => {
    setPage(1)
  }, [debouncedSearch, sort, segmentFilter, period])
  const pagedClients = useMemo(
    () => clients.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [clients, page],
  )

  // Privacy alert: admin загрузил список с контактами >50 клиентов.
  // Sticky-флаг в sessionStorage — чтобы не пинговать функцию каждый раз,
  // когда пользователь меняет фильтр или сортировку в рамках одной сессии.
  useEffect(() => {
    if (!isAdmin || !user) return
    if (allClients.length <= MASS_VIEW_THRESHOLD) return
    const key = `finkley:privacy-alert-fired:${salonId}`
    if (typeof sessionStorage === 'undefined') return
    if (sessionStorage.getItem(key)) return
    sessionStorage.setItem(key, '1')
    void supabase.functions
      .invoke('privacy-mass-view-notify', {
        body: { salon_id: salonId, client_count: allClients.length },
      })
      .catch(() => {
        /* silent — это сигнальное уведомление, не критично */
      })
  }, [isAdmin, user, allClients.length, salonId])

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

  // AI payload — раньше жил во вкладке «Топ клиенты». Теперь рассылаем те же
  // top-20 по обороту, но в контексте текущего фильтра. Payload собираем
  // даже когда клиентов 0 — плашка «AI-выводы» (opt-in через «Показать»)
  // должна быть видна во всех состояниях, чтобы UX был консистентным.
  const aiPayload = useMemo(() => {
    const sortedByRevenue = [...segmented].sort(
      (a, b) => b.total_revenue_cents - a.total_revenue_cents,
    )
    const top = sortedByRevenue.slice(0, 20)
    const totalRevenue = segmented.reduce((s, c) => s + c.total_revenue_cents, 0)
    return {
      currency,
      total_clients: segmented.length,
      total_revenue_cents: totalRevenue,
      segments: counts,
      top_clients: top.map((c) => ({
        name: c.name,
        visits: c.visit_count,
        revenue_cents: c.total_revenue_cents,
        avg_check_cents: c.visit_count > 0 ? Math.round(c.total_revenue_cents / c.visit_count) : 0,
        last_visit_at: c.last_visit_at,
        segment: c.segment,
      })),
    }
  }, [segmented, counts, currency])

  return (
    <div>
      {/* Image #111: убрали заголовок «База клиентов» и кнопку «Добавить»
          сверху — кнопка теперь живёт в одной строке с чипсами-сегментами
          напротив них. */}
      <AiInsightsPanel kind="clients" payload={aiPayload} />

      {/* Сегменты-чипсы + кнопка «Добавить клиента» (image #111).
          Клик по чипсу переключает фильтр, повторный клик — сбрасывает. */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
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
        <Button
          variant="primary"
          size="md"
          onClick={() => setCreateOpen(true)}
          data-testid="add-client-reports"
          className="ml-auto"
        >
          <Plus className="size-4" strokeWidth={2.4} />
          {t('clients.add')}
        </Button>
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
        {/* Image #113: PeriodPickerPopover как на вкладке Услуги. По клику
            открывает календарь, выбранный период фильтрует список клиентов
            до тех, у кого был визит в этот промежуток. Кнопка-крестик рядом
            сбрасывает фильтр обратно в «все время». */}
        <div className="flex items-center gap-1">
          <PeriodPickerPopover
            value={period ?? currentMonthPeriod()}
            onChange={(p) => setPeriod(p)}
          />
          {period ? (
            <button
              type="button"
              onClick={() => setPeriod(null)}
              className="text-muted-foreground hover:text-foreground hover:bg-muted/40 grid size-9 place-items-center rounded-md text-sm"
              aria-label={t('clients.period_clear', { defaultValue: 'Сбросить период' })}
              title={t('clients.period_clear', { defaultValue: 'Сбросить период' })}
            >
              ✕
            </button>
          ) : null}
        </div>
      </div>

      <div className="border-border bg-card shadow-finsm overflow-x-auto rounded-lg border">
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
          <table className="w-full min-w-[900px] text-sm">
            <thead className="bg-muted/40 text-muted-foreground border-b text-[11px] uppercase tracking-wider">
              <tr>
                <th className="px-4 py-3 text-left font-semibold">
                  {t('reports_hub.clients.col_name_full')}
                </th>
                <th className="px-3 py-3 text-left font-semibold">
                  {t('reports_hub.clients.col_tags')}
                </th>
                <th className="px-3 py-3 text-right font-semibold">
                  {t('reports_hub.clients.col_revenue_ltv')}
                </th>
                <th className="px-3 py-3 text-right font-semibold">
                  {t('reports_hub.clients.col_gross_ltv')}
                </th>
                <th className="px-3 py-3 text-right font-semibold">
                  {t('reports_hub.clients.col_avg_check')}
                </th>
                <th className="px-3 py-3 text-right font-semibold">
                  {t('reports_hub.clients.col_visits_count')}
                </th>
                <th className="px-3 py-3 text-right font-semibold">
                  {t('reports_hub.clients.col_lifetime')}
                </th>
                <th className="px-3 py-3 text-right font-semibold">
                  {t('reports_hub.clients.col_last_visit')}
                </th>
                <th className="px-3 py-3 text-right font-semibold">
                  {t('reports_hub.clients.col_next_visit')}
                </th>
              </tr>
            </thead>
            <tbody>
              {pagedClients.map((c) => {
                const badge = SEGMENT_BADGE[c.segment]
                const bdDays = daysToBirthday(c.birthday)
                const avg =
                  c.visit_count > 0 ? Math.round(c.total_revenue_cents / c.visit_count) : 0
                const nextVisit = nextVisitsByClient.get(c.id) ?? null
                return (
                  <tr
                    key={c.id}
                    className="border-border/60 hover:bg-muted/30 cursor-pointer border-t"
                    onClick={() => setDrawerClient(c)}
                    data-testid="client-row-reports"
                  >
                    <td className="px-4 py-2.5">
                      <p className="text-foreground text-sm font-semibold">{c.name}</p>
                      {/* Контакты: видимы только owner/admin. Для мастеров и
                          бухгалтера — иконка-плашка «контакты скрыты по роли»,
                          чтобы было понятно, что данные есть, но недоступны. */}
                      {canSeeContacts ? (
                        <p className="text-muted-foreground text-[11px]">
                          {c.email || ''}
                          {c.email && c.phone ? ' · ' : ''}
                          <span className="num">{c.phone || ''}</span>
                        </p>
                      ) : c.phone || c.email ? (
                        <p className="text-muted-foreground inline-flex items-center gap-1 text-[10.5px]">
                          <EyeOff className="size-3" strokeWidth={1.8} />
                          {t('reports_hub.clients.contacts_hidden')}
                        </p>
                      ) : null}
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex flex-wrap items-center gap-1">
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
                        {(c.tags ?? []).map((tag) => (
                          <span
                            key={tag}
                            className="bg-muted text-muted-foreground inline-flex shrink-0 rounded-full px-1.5 py-0.5 text-[9.5px] font-medium"
                            title={tag}
                          >
                            {humanizeTag(tag)}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="num text-brand-sage-deep px-3 py-2.5 text-right text-sm font-bold">
                      {formatCurrency(c.total_revenue_cents, currency)}
                    </td>
                    {(() => {
                      const ltv = ltvByClient?.get(c.id)
                      const gross = ltv?.gross_ltv_cents ?? null
                      return (
                        <td
                          className={cn(
                            'num px-3 py-2.5 text-right',
                            gross != null && gross > 0
                              ? 'text-brand-sage-deep font-semibold'
                              : 'text-muted-foreground/60',
                          )}
                          title={t('reports_hub.clients.gross_hint', {
                            defaultValue:
                              'Выручка минус себестоимость услуг (services.cost_cents).',
                          })}
                        >
                          {gross != null ? formatCurrency(gross, currency) : '—'}
                        </td>
                      )
                    })()}
                    <td className="num text-muted-foreground px-3 py-2.5 text-right">
                      {formatCurrency(avg, currency)}
                    </td>
                    <td className="num text-muted-foreground px-3 py-2.5 text-right">
                      {c.visit_count}
                    </td>
                    {(() => {
                      const months = ltvByClient?.get(c.id)?.customer_lifetime_months ?? null
                      return (
                        <td className="num text-muted-foreground px-3 py-2.5 text-right text-xs">
                          {months != null && months > 0
                            ? t('reports_hub.clients.months', {
                                count: months,
                                defaultValue: '{{count}} мес',
                              })
                            : '—'}
                        </td>
                      )
                    })()}
                    {/* Image #112/#131: одинаковый стиль для «Последний» и
                        «След. визит» — единый цвет (text-foreground), один
                        шрифт num text-xs font-medium. Различие только в
                        формате: прошлый — только дата (день/месяц/год),
                        будущий — дата + время. — */}
                    <td className="px-3 py-2.5 text-right">
                      {c.last_visit_at ? (
                        <span className="num text-foreground text-xs font-medium">
                          {format(parseISO(c.last_visit_at), 'd MMM yyyy', {
                            locale: getDateLocale(),
                          })}
                        </span>
                      ) : (
                        <span className="text-muted-foreground text-xs">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      {nextVisit ? (
                        <span className="num text-foreground text-xs font-medium">
                          {format(parseISO(nextVisit), 'd MMM yyyy, HH:mm', {
                            locale: getDateLocale(),
                          })}
                        </span>
                      ) : (
                        <span className="text-muted-foreground text-xs">—</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Image #131: пагинация по 25 записей. Скрываем когда страница одна. */}
      {!isLoading && totalPages > 1 ? (
        <div className="mt-3 flex items-center justify-between gap-2">
          <p className="text-muted-foreground text-xs">
            {t('clients.pagination.summary', {
              from: (page - 1) * PAGE_SIZE + 1,
              to: Math.min(page * PAGE_SIZE, clients.length),
              total: clients.length,
              defaultValue: '{{from}}—{{to}} из {{total}}',
            })}
          </p>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setPage(Math.max(1, page - 1))}
              disabled={page === 1}
              className="border-border text-muted-foreground hover:bg-muted/40 hover:text-foreground inline-flex h-8 items-center rounded-md border px-2 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-30"
            >
              ‹
            </button>
            {/* Окно из 5 страниц вокруг текущей. На больших списках не плодим
                все кнопки — показываем … где нужно. */}
            {(() => {
              const pages: (number | 'gap')[] = []
              const push = (p: number) => {
                if (!pages.includes(p)) pages.push(p)
              }
              push(1)
              for (let p = Math.max(2, page - 2); p <= Math.min(totalPages - 1, page + 2); p++) {
                push(p)
              }
              if (totalPages > 1) push(totalPages)
              const withGaps: (number | 'gap')[] = []
              let last: number | null = null
              for (const p of pages) {
                if (typeof p === 'number') {
                  if (last != null && p - last > 1) withGaps.push('gap')
                  withGaps.push(p)
                  last = p
                }
              }
              return withGaps.map((p, i) =>
                p === 'gap' ? (
                  <span key={`gap-${i}`} className="text-muted-foreground px-1 text-xs">
                    …
                  </span>
                ) : (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setPage(p)}
                    className={`inline-flex h-8 min-w-[32px] items-center justify-center rounded-md border px-2 text-xs font-semibold transition-colors ${
                      page === p
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-border text-muted-foreground hover:bg-muted/40 hover:text-foreground'
                    }`}
                  >
                    {p}
                  </button>
                ),
              )
            })()}
            <button
              type="button"
              onClick={() => setPage(Math.min(totalPages, page + 1))}
              disabled={page === totalPages}
              className="border-border text-muted-foreground hover:bg-muted/40 hover:text-foreground inline-flex h-8 items-center rounded-md border px-2 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-30"
            >
              ›
            </button>
          </div>
        </div>
      ) : null}

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
