import {
  BarChart2,
  DollarSign,
  Image as ImageIcon,
  Settings as SettingsIcon,
  Sparkles,
  Star,
  Trash2,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { PageTabsNav, type PageTab } from '@/components/ui/PageTabsNav'
import {
  currentMonthPeriod,
  periodToRange,
  type PeriodValue,
} from '@/components/ui/period-picker-utils'
import { PeriodPickerPopover } from '@/components/ui/PeriodPickerPopover'
import {
  useCompetitors,
  useCompetitorSettings,
  useCompetitorSnapshots,
  useCreateCompetitor,
  useDiscoverCompetitors,
  useOwnSalonMetrics,
  useSyncCompetitors,
  useUpdateCompetitor,
  useUpsertCompetitorSettings,
} from '@/hooks/useCompetitors'
import { useSalon } from '@/hooks/useSalons'
import { cn } from '@/lib/utils/cn'
import { formatCurrency } from '@/lib/utils/format-currency'

type CompetitorsSubTab = 'prices' | 'occupancy' | 'rating' | 'content' | 'params'

const SUB_TABS: PageTab<CompetitorsSubTab>[] = [
  { id: 'prices', labelKey: 'reports_hub.competitors.tabs.prices', icon: DollarSign },
  { id: 'occupancy', labelKey: 'reports_hub.competitors.tabs.occupancy', icon: BarChart2 },
  { id: 'rating', labelKey: 'reports_hub.competitors.tabs.rating', icon: Star },
  { id: 'content', labelKey: 'reports_hub.competitors.tabs.content', icon: ImageIcon },
  { id: 'params', labelKey: 'reports_hub.competitors.tabs.params', icon: SettingsIcon },
]

/**
 * Reports → Конкуренты — мониторинг 4 категорий + настройки.
 *
 * Текущий статус: schema + UI готовы, реальные источники (Booksy скрейпинг,
 * Google Places API, Meta Graph) — следующая итерация через edge function
 * competitor-sync (cron). Сейчас показываем placeholder когда snapshots пусты.
 */
export function CompetitorsTab({ salonId }: { salonId: string }) {
  const { t } = useTranslation()
  const [sub, setSub] = useState<CompetitorsSubTab>('prices')
  const { data: salon } = useSalon(salonId)
  const { data: competitors = [] } = useCompetitors(salonId)
  const currency = salon?.currency ?? 'PLN'

  return (
    <div>
      <PageTabsNav tabs={SUB_TABS} active={sub} onChange={setSub} t={t} />
      <div className="mt-4">
        {sub === 'params' ? (
          <ParamsSection salonId={salonId} competitors={competitors} t={t} />
        ) : (
          <DataSection
            kind={sub}
            salonId={salonId}
            competitors={competitors}
            currency={currency}
            salon={salon}
            t={t}
          />
        )}
      </div>
    </div>
  )
}

function DataSection({
  kind,
  salonId,
  competitors,
  currency,
  salon,
  t,
}: {
  kind: 'prices' | 'occupancy' | 'rating' | 'content'
  salonId: string
  competitors: ReturnType<typeof useCompetitors>['data']
  currency: string
  salon: ReturnType<typeof useSalon>['data']
  t: (k: string, opts?: Record<string, unknown>) => string
}) {
  const competitorIds = useMemo(() => competitors?.map((c) => c.id) ?? [], [competitors])
  const apiKind = kind === 'prices' ? 'price' : kind
  // Период применяется ко всем подвкладкам, не только к occupancy — это позволяет
  // смотреть исторические цены/рейтинги/контент за выбранный диапазон.
  const [period, setPeriod] = useState<PeriodValue>(() => currentMonthPeriod())
  const range = periodToRange(period)
  const dateFilter = useMemo(
    () => ({
      startIso: range.start.toISOString().slice(0, 10),
      endIso: range.end.toISOString().slice(0, 10),
    }),
    [range.start, range.end],
  )
  const { data: snapshots = [], isLoading } = useCompetitorSnapshots(
    competitorIds,
    apiKind,
    dateFilter,
  )
  const { data: ownMetrics } = useOwnSalonMetrics(salonId)

  if (!competitors || competitors.length === 0) {
    return (
      <div className="border-border bg-card shadow-finsm rounded-lg border px-5 py-12 text-center">
        <p className="text-muted-foreground text-sm">
          {t('reports_hub.competitors.no_competitors')}
        </p>
        <p className="text-muted-foreground/70 mt-1 text-xs">
          {t('reports_hub.competitors.no_competitors_hint')}
        </p>
      </div>
    )
  }

  // Группируем snapshots по competitor → последний за каждую категорию в окне.
  const latestPerCompetitor = new Map<string, typeof snapshots>()
  for (const s of snapshots) {
    const list = latestPerCompetitor.get(s.competitor_id) ?? []
    list.push(s)
    latestPerCompetitor.set(s.competitor_id, list)
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="text-muted-foreground text-xs">{t('reports_hub.competitors.period_hint')}</p>
        <PeriodPickerPopover value={period} onChange={setPeriod} />
      </div>

      {isLoading ? (
        <p className="text-muted-foreground px-5 py-8 text-center text-sm">{t('common.loading')}</p>
      ) : (
        <div className="border-border bg-card shadow-finsm overflow-hidden rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-muted-foreground border-b text-[11px] uppercase tracking-wider">
              <tr>
                <th className="px-4 py-3 text-left font-semibold">
                  {t('reports_hub.competitors.col_name')}
                </th>
                <th className="px-4 py-3 text-left font-semibold">
                  {t('reports_hub.competitors.col_data')}
                </th>
                <th className="px-3 py-3 text-right font-semibold">
                  {t('reports_hub.competitors.col_date')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-border divide-y">
              <OwnSalonRow
                kind={kind}
                salon={salon}
                ownMetrics={ownMetrics ?? null}
                currency={currency}
                t={t}
              />
              {competitors.map((c) => {
                const items = latestPerCompetitor.get(c.id) ?? []
                const latest = items[0]
                return (
                  <tr key={c.id}>
                    <td className="text-foreground px-4 py-3 font-semibold">{c.name}</td>
                    <td className="text-muted-foreground px-4 py-3 text-xs">
                      {latest
                        ? renderSnapshotData(latest, currency)
                        : t('reports_hub.competitors.no_data')}
                    </td>
                    <td className="num text-muted-foreground px-3 py-3 text-right text-xs">
                      {latest ? latest.snapshot_date : '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {snapshots.length === 0 ? (
            <div className="border-border bg-muted/20 border-t px-5 py-4 text-center">
              <p className="text-muted-foreground text-xs">
                {t('reports_hub.competitors.sync_pending')}
              </p>
            </div>
          ) : null}
        </div>
      )}
    </div>
  )
}

/**
 * Первая строка таблицы «Ваш салон» — для прямого визуального сравнения с
 * конкурентами. Источники данных:
 *   - rating: avg(reviews.rating) по reviews салона
 *   - content: пока — instagram_url наличие (полные метрики требуют Meta Graph)
 *   - prices/occupancy: для своего салона показываем «настройте» — это
 *     метрики которые нужно тянуть отдельным RPC (на следующей итерации).
 */
function OwnSalonRow({
  kind,
  salon,
  ownMetrics,
  t,
}: {
  kind: 'prices' | 'occupancy' | 'rating' | 'content'
  salon: ReturnType<typeof useSalon>['data']
  ownMetrics: { rating_avg: number | null; rating_count: number } | null
  currency: string
  t: (k: string, opts?: Record<string, unknown>) => string
}) {
  let dataCell: React.ReactNode = (
    <span className="text-muted-foreground/60">{t('reports_hub.competitors.own_no_data')}</span>
  )
  if (kind === 'rating' && ownMetrics) {
    if (ownMetrics.rating_avg != null) {
      dataCell = (
        <span>
          ⭐ {ownMetrics.rating_avg.toFixed(1)} ({ownMetrics.rating_count})
        </span>
      )
    }
  }
  if (kind === 'content') {
    dataCell = (
      <span className="text-muted-foreground/70">
        {t('reports_hub.competitors.own_content_hint')}
      </span>
    )
  }
  return (
    <tr className={cn('bg-brand-sage-soft/30 border-brand-sage-soft border-l-4')}>
      <td className="text-brand-sage-deep px-4 py-3 font-bold">
        <div className="flex items-center gap-2">
          <Sparkles className="size-3.5" strokeWidth={2} />
          {salon?.name ?? t('reports_hub.competitors.own_label')}
          <span className="bg-brand-sage-soft text-brand-sage-deep ml-1 rounded-full px-1.5 py-0.5 text-[9.5px] font-bold uppercase">
            {t('reports_hub.competitors.own_badge')}
          </span>
        </div>
      </td>
      <td className="text-foreground px-4 py-3 text-xs">{dataCell}</td>
      <td className="num text-muted-foreground px-3 py-3 text-right text-xs">
        {t('reports_hub.competitors.now')}
      </td>
    </tr>
  )
}

function renderSnapshotData(
  s: ReturnType<typeof useCompetitorSnapshots>['data'] extends (infer R)[] | undefined ? R : never,
  currency: string,
): string {
  const data = s.data as Record<string, unknown>
  if (s.kind === 'price') {
    const prices = data.prices as Record<string, number> | undefined
    if (prices) {
      const top = Object.entries(prices).slice(0, 3)
      return top.map(([svc, p]) => `${svc}: ${formatCurrency(p, currency)}`).join(' · ')
    }
  }
  if (s.kind === 'rating') {
    const r = data.rating as number | undefined
    const c = data.count as number | undefined
    if (r != null) return `⭐ ${r.toFixed(1)} (${c ?? '?'})`
  }
  if (s.kind === 'content') {
    const followers = data.followers as number | undefined
    const posts = data.posts as number | undefined
    return `👥 ${followers ?? '?'} · 📷 ${posts ?? '?'}`
  }
  if (s.kind === 'occupancy') {
    const pct = data.occupancy_pct as number | undefined
    return pct != null ? `${pct.toFixed(0)}%` : '—'
  }
  return JSON.stringify(data).slice(0, 100)
}

function ParamsSection({
  salonId,
  competitors,
  t,
}: {
  salonId: string
  competitors: ReturnType<typeof useCompetitors>['data']
  t: (k: string, opts?: Record<string, unknown>) => string
}) {
  const { data: settings } = useCompetitorSettings(salonId)
  const upsertSettings = useUpsertCompetitorSettings(salonId)
  const createCompetitor = useCreateCompetitor(salonId)
  const updateCompetitor = useUpdateCompetitor(salonId)
  const discoverCompetitors = useDiscoverCompetitors(salonId)
  const syncCompetitors = useSyncCompetitors(salonId)
  const [newName, setNewName] = useState('')
  const [newBooksy, setNewBooksy] = useState('')
  const [newGoogle, setNewGoogle] = useState('')
  const [newInsta, setNewInsta] = useState('')
  const [newFb, setNewFb] = useState('')
  const [watchedServicesStr, setWatchedServicesStr] = useState(
    settings?.watched_services.join(', ') ?? '',
  )

  function addCompetitor() {
    if (!newName.trim()) {
      toast.error(t('reports_hub.competitors.params.name_required'))
      return
    }
    createCompetitor.mutate(
      {
        name: newName.trim(),
        booksy_url: newBooksy.trim() || null,
        google_place_url: newGoogle.trim() || null,
        instagram_url: newInsta.trim() || null,
        facebook_url: newFb.trim() || null,
      },
      {
        onSuccess: () => {
          setNewName('')
          setNewBooksy('')
          setNewGoogle('')
          setNewInsta('')
          setNewFb('')
          toast.success(t('reports_hub.competitors.params.added'))
        },
        onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
      },
    )
  }

  function saveWatchedServices() {
    const arr = watchedServicesStr
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    upsertSettings.mutate(
      { watched_services: arr },
      {
        onSuccess: () => toast.success(t('reports_hub.competitors.params.saved')),
        onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
      },
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="border-brand-teal-soft bg-brand-teal-soft/30 rounded-lg border p-5">
        <h3 className="text-brand-teal-deep flex items-center gap-2 text-base font-bold">
          <Sparkles className="size-4" strokeWidth={2} />
          {t('reports_hub.competitors.params.discover_title')}
        </h3>
        <p className="text-muted-foreground mt-1 text-xs">
          {t('reports_hub.competitors.params.discover_subtitle')}
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            onClick={() => {
              discoverCompetitors.mutate(undefined, {
                onSuccess: (n) =>
                  toast.success(t('reports_hub.competitors.params.discover_done', { count: n })),
                onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
              })
            }}
            disabled={discoverCompetitors.isPending}
          >
            {discoverCompetitors.isPending
              ? t('common.loading')
              : t('reports_hub.competitors.params.discover_button')}
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              syncCompetitors.mutate(undefined, {
                onSuccess: (r) =>
                  toast.success(
                    t('reports_hub.competitors.params.sync_done', {
                      competitors: r.competitors,
                      snapshots: r.snapshots,
                    }),
                  ),
                onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
              })
            }}
            disabled={syncCompetitors.isPending || (competitors?.length ?? 0) === 0}
            title={
              (competitors?.length ?? 0) === 0
                ? t('reports_hub.competitors.params.sync_disabled_hint')
                : undefined
            }
          >
            {syncCompetitors.isPending
              ? t('common.loading')
              : t('reports_hub.competitors.params.sync_button')}
          </Button>
        </div>
      </div>

      <div className="border-border bg-card shadow-finsm rounded-lg border p-5">
        <h3 className="text-brand-navy text-base font-bold">
          {t('reports_hub.competitors.params.add_title')}
        </h3>
        <p className="text-muted-foreground mt-1 text-xs">
          {t('reports_hub.competitors.params.add_subtitle')}
        </p>
        <div className="mt-4 flex flex-col gap-3">
          <div>
            <Label htmlFor="comp-name">{t('reports_hub.competitors.params.name_label')}</Label>
            <Input
              id="comp-name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder={t('reports_hub.competitors.params.name_placeholder')}
              className="mt-1.5"
            />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="comp-booksy">Booksy URL</Label>
              <Input
                id="comp-booksy"
                value={newBooksy}
                onChange={(e) => setNewBooksy(e.target.value)}
                placeholder="https://booksy.com/..."
                className="mt-1.5"
              />
            </div>
            <div>
              <Label htmlFor="comp-google">Google Maps URL</Label>
              <Input
                id="comp-google"
                value={newGoogle}
                onChange={(e) => setNewGoogle(e.target.value)}
                placeholder="https://maps.google.com/..."
                className="mt-1.5"
              />
            </div>
            <div>
              <Label htmlFor="comp-insta">Instagram</Label>
              <Input
                id="comp-insta"
                value={newInsta}
                onChange={(e) => setNewInsta(e.target.value)}
                placeholder="https://instagram.com/..."
                className="mt-1.5"
              />
            </div>
            <div>
              <Label htmlFor="comp-fb">Facebook</Label>
              <Input
                id="comp-fb"
                value={newFb}
                onChange={(e) => setNewFb(e.target.value)}
                placeholder="https://facebook.com/..."
                className="mt-1.5"
              />
            </div>
          </div>
          <Button onClick={addCompetitor} disabled={createCompetitor.isPending}>
            {t('reports_hub.competitors.params.add_button')}
          </Button>
        </div>
      </div>

      <div className="border-border bg-card shadow-finsm rounded-lg border p-5">
        <h3 className="text-brand-navy text-base font-bold">
          {t('reports_hub.competitors.params.watched_title')}
        </h3>
        <p className="text-muted-foreground mt-1 text-xs">
          {t('reports_hub.competitors.params.watched_subtitle')}
        </p>
        <div className="mt-4">
          <Input
            value={watchedServicesStr}
            onChange={(e) => setWatchedServicesStr(e.target.value)}
            placeholder={t('reports_hub.competitors.params.watched_placeholder')}
          />
          <Button
            onClick={saveWatchedServices}
            disabled={upsertSettings.isPending}
            className="mt-3"
          >
            {t('reports_hub.competitors.params.save_button')}
          </Button>
        </div>
      </div>

      {(competitors?.length ?? 0) > 0 ? (
        <div className="border-border bg-card shadow-finsm rounded-lg border p-5">
          <h3 className="text-brand-navy text-base font-bold">
            {t('reports_hub.competitors.params.list_title')}
          </h3>
          <ul className="divide-border mt-3 divide-y">
            {competitors?.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-2 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="text-foreground text-sm font-semibold">{c.name}</p>
                  <p className="text-muted-foreground mt-0.5 truncate text-[11px]">
                    {[c.booksy_url, c.google_place_url, c.instagram_url, c.facebook_url]
                      .filter(Boolean)
                      .join(' · ') || t('reports_hub.competitors.params.no_links')}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    if (!confirm(t('reports_hub.competitors.params.confirm_archive'))) return
                    updateCompetitor.mutate(
                      { id: c.id, is_archived: true },
                      {
                        onSuccess: () =>
                          toast.success(t('reports_hub.competitors.params.archived')),
                      },
                    )
                  }}
                  className="text-muted-foreground hover:text-destructive grid size-8 place-items-center rounded-md"
                  aria-label={t('common.delete')}
                >
                  <Trash2 className="size-4" strokeWidth={1.8} />
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}
