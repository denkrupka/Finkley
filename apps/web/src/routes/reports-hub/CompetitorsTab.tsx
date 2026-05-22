import {
  BarChart2,
  Check,
  DollarSign,
  Eye,
  Image as ImageIcon,
  Pencil,
  Settings as SettingsIcon,
  Sparkles,
  Star,
  Trash2,
  X,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { GooglePlaceSearchInput } from '@/components/settings/GooglePlaceSearchInput'
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
  useOwnSalonBooksyRating,
  useOwnSalonContent,
  useOwnSalonMetrics,
  type OwnSalonContent,
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

  // Авто-sync при открытии любой data-вкладки: тянем актуальные snapshots Booksy/IG/Google.
  // One-shot per session — повторный заход в Reports не дёргает edge function.
  const syncCompetitors = useSyncCompetitors(salonId)
  const autoSyncedRef = useRef(false)
  useEffect(() => {
    if (autoSyncedRef.current) return
    if (!competitors || competitors.length === 0) return
    autoSyncedRef.current = true
    syncCompetitors.mutate(undefined, {
      onError: (e) => console.warn('competitors auto-sync failed:', e),
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [competitors?.length])
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
  const { data: ownContent } = useOwnSalonContent(salonId)
  const { data: ownBooksyRating } = useOwnSalonBooksyRating(salonId)

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
      ) : kind === 'rating' ? (
        <RatingTable
          competitors={competitors}
          snapshots={snapshots}
          ownSalon={salon}
          ownBooksy={ownBooksyRating ?? null}
          ownGoogle={ownMetrics ?? null}
          t={t}
        />
      ) : kind === 'content' ? (
        <ContentTable
          competitors={competitors}
          snapshots={snapshots}
          ownSalon={salon}
          ownContent={ownContent ?? null}
          t={t}
        />
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
                ownContent={ownContent ?? null}
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
 * Rating таб — таблица «свой vs конкуренты» с разделёнными Booksy и Google.
 * 4 data-колонки: Booksy ★+count+👁, Google ★+count+👁.
 */
function RatingTable({
  competitors,
  snapshots,
  ownSalon,
  ownBooksy,
  ownGoogle,
  t,
}: {
  competitors: NonNullable<ReturnType<typeof useCompetitors>['data']>
  snapshots: ReturnType<typeof useCompetitorSnapshots>['data']
  ownSalon: ReturnType<typeof useSalon>['data']
  ownBooksy: { rating: number; count: number } | null
  ownGoogle: { rating_avg: number | null; rating_count: number } | null
  t: (k: string, opts?: Record<string, unknown>) => string
}) {
  function bySource(items: ReturnType<typeof useCompetitorSnapshots>['data'], src: string) {
    return items?.find((s) => s.source === src) ?? null
  }
  const byCompetitor = new Map<string, ReturnType<typeof useCompetitorSnapshots>['data']>()
  for (const s of snapshots ?? []) {
    const arr = byCompetitor.get(s.competitor_id) ?? []
    arr.push(s)
    byCompetitor.set(s.competitor_id, arr)
  }

  return (
    <div className="border-border bg-card shadow-finsm overflow-x-auto rounded-lg border">
      <table className="w-full min-w-[640px] text-sm">
        <thead className="bg-muted/40 text-muted-foreground border-b text-[11px] uppercase tracking-wider">
          <tr>
            <th rowSpan={2} className="border-border/40 border-r px-4 py-3 text-left font-semibold">
              {t('reports_hub.competitors.col_name')}
            </th>
            <th
              colSpan={2}
              className="border-border/40 border-r px-3 py-2 text-center font-bold text-blue-700"
            >
              Booksy
            </th>
            <th colSpan={2} className="px-3 py-2 text-center font-bold text-red-700">
              Google
            </th>
          </tr>
          <tr>
            <th className="px-3 py-2 text-right font-semibold">
              {t('reports_hub.competitors.col_rating')}
            </th>
            <th className="border-border/40 border-r px-3 py-2 text-right font-semibold">
              {t('reports_hub.competitors.col_reviews_count')}
            </th>
            <th className="px-3 py-2 text-right font-semibold">
              {t('reports_hub.competitors.col_rating')}
            </th>
            <th className="px-3 py-2 text-right font-semibold">
              {t('reports_hub.competitors.col_reviews_count')}
            </th>
          </tr>
        </thead>
        <tbody className="divide-border divide-y">
          {/* Own salon row */}
          <tr className="bg-brand-sage-soft/30 border-brand-sage-soft border-l-4">
            <td className="text-brand-sage-deep px-4 py-3 font-bold">
              <div className="flex items-center gap-2">
                <Sparkles className="size-3.5" strokeWidth={2} />
                {ownSalon?.name ?? t('reports_hub.competitors.own_label')}
                <span className="bg-brand-sage-soft text-brand-sage-deep ml-1 rounded-full px-1.5 py-0.5 text-[9.5px] font-bold uppercase">
                  {t('reports_hub.competitors.own_badge')}
                </span>
              </div>
            </td>
            <RatingCells
              rating={ownBooksy?.rating ?? null}
              count={ownBooksy?.count ?? null}
              url={ownSalon?.booksy_url ?? null}
            />
            <RatingCells
              rating={ownGoogle?.rating_avg ?? null}
              count={ownGoogle?.rating_count ?? null}
              url={ownSalon?.google_place_url ?? null}
            />
          </tr>
          {competitors.map((c) => {
            const snaps = byCompetitor.get(c.id) ?? []
            const booksy = bySource(snaps, 'booksy')
            const google = bySource(snaps, 'google')
            const bData = booksy?.data as { rating?: number; count?: number } | undefined
            const gData = google?.data as { rating?: number; count?: number } | undefined
            return (
              <tr key={c.id}>
                <td className="text-foreground px-4 py-3 font-semibold">{c.name}</td>
                <RatingCells
                  rating={bData?.rating ?? null}
                  count={bData?.count ?? null}
                  url={c.booksy_url}
                />
                <RatingCells
                  rating={gData?.rating ?? null}
                  count={gData?.count ?? null}
                  url={c.google_place_url}
                />
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/** Пара ячеек «★ rating | count» + опц. 👁→external link. */
function RatingCells({
  rating,
  count,
  url,
}: {
  rating: number | null
  count: number | null
  url: string | null
}) {
  return (
    <>
      <td className="num px-3 py-3 text-right text-sm font-semibold">
        {rating != null ? (
          <span className="text-brand-gold-deep inline-flex items-center gap-1">
            ⭐ {rating.toFixed(1)}
            {url ? (
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-muted-foreground hover:text-foreground ml-1"
                title="Открыть отзывы"
              >
                <Eye className="size-3.5" strokeWidth={2} />
              </a>
            ) : null}
          </span>
        ) : (
          <span className="text-muted-foreground/50">—</span>
        )}
      </td>
      <td className="num text-muted-foreground px-3 py-3 text-right text-xs">{count ?? '—'}</td>
    </>
  )
}

/**
 * Content таб — таблица с 5 колонками: Posts, Reels Views, Frequency, Followers, Following.
 * «Просмотры рилсов» — недоступно через scrape (требует IG Business Graph API).
 */
function ContentTable({
  competitors,
  snapshots,
  ownSalon,
  ownContent,
  t,
}: {
  competitors: NonNullable<ReturnType<typeof useCompetitors>['data']>
  snapshots: ReturnType<typeof useCompetitorSnapshots>['data']
  ownSalon: ReturnType<typeof useSalon>['data']
  ownContent: OwnSalonContent | null
  t: (k: string, opts?: Record<string, unknown>) => string
}) {
  // У одного конкурента может быть 2 snapshot (insta + fb) — мержим.
  type ContentData = {
    posts?: number
    followers?: number
    following?: number
    posts_per_month?: number
    fb_likes?: number
    reels_views?: number
  }
  const byCompetitor = new Map<string, ContentData>()
  for (const s of snapshots ?? []) {
    if (s.kind !== 'content') continue
    const cur = byCompetitor.get(s.competitor_id) ?? {}
    const d = s.data as Record<string, unknown>
    if (cur.posts == null && typeof d.posts === 'number') cur.posts = d.posts
    if (cur.followers == null && typeof d.followers === 'number') cur.followers = d.followers
    if (cur.following == null && typeof d.following === 'number') cur.following = d.following
    if (cur.posts_per_month == null && typeof d.posts_per_month === 'number')
      cur.posts_per_month = d.posts_per_month
    if (cur.fb_likes == null && typeof d.fb_likes === 'number') cur.fb_likes = d.fb_likes
    byCompetitor.set(s.competitor_id, cur)
  }

  function fmtNum(v: number | null | undefined): string {
    return v == null ? '—' : v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(v)
  }

  return (
    <div className="border-border bg-card shadow-finsm overflow-x-auto rounded-lg border">
      <table className="w-full min-w-[720px] text-sm">
        <thead className="bg-muted/40 text-muted-foreground border-b text-[11px] uppercase tracking-wider">
          <tr>
            <th className="px-4 py-3 text-left font-semibold">
              {t('reports_hub.competitors.col_name')}
            </th>
            <th
              className="px-3 py-3 text-right font-semibold"
              title={t('reports_hub.competitors.col_posts_hint')}
            >
              📷 {t('reports_hub.competitors.col_posts')}
            </th>
            <th
              className="px-3 py-3 text-right font-semibold"
              title={t('reports_hub.competitors.col_reels_views_hint')}
            >
              ▶ {t('reports_hub.competitors.col_reels_views')}
            </th>
            <th
              className="px-3 py-3 text-right font-semibold"
              title={t('reports_hub.competitors.col_freq_hint')}
            >
              📅 {t('reports_hub.competitors.col_freq')}
            </th>
            <th className="px-3 py-3 text-right font-semibold">
              👥 {t('reports_hub.competitors.col_followers')}
            </th>
            <th className="px-3 py-3 text-right font-semibold">
              ➡ {t('reports_hub.competitors.col_following')}
            </th>
          </tr>
        </thead>
        <tbody className="divide-border divide-y">
          {/* Own salon */}
          <tr className="bg-brand-sage-soft/30 border-brand-sage-soft border-l-4">
            <td className="text-brand-sage-deep px-4 py-3 font-bold">
              <div className="flex items-center gap-2">
                <Sparkles className="size-3.5" strokeWidth={2} />
                {ownSalon?.name ?? t('reports_hub.competitors.own_label')}
                <span className="bg-brand-sage-soft text-brand-sage-deep ml-1 rounded-full px-1.5 py-0.5 text-[9.5px] font-bold uppercase">
                  {t('reports_hub.competitors.own_badge')}
                </span>
              </div>
            </td>
            <td className="num px-3 py-3 text-right">{fmtNum(ownContent?.posts ?? null)}</td>
            <td className="num text-muted-foreground/60 px-3 py-3 text-right text-xs">—</td>
            <td className="num px-3 py-3 text-right">
              {ownContent?.posts_per_month != null ? `${ownContent.posts_per_month}/мес` : '—'}
            </td>
            <td className="num px-3 py-3 text-right">{fmtNum(ownContent?.followers ?? null)}</td>
            <td className="num px-3 py-3 text-right">{fmtNum(ownContent?.following ?? null)}</td>
          </tr>
          {competitors.map((c) => {
            const d = byCompetitor.get(c.id)
            return (
              <tr key={c.id}>
                <td className="text-foreground px-4 py-3 font-semibold">{c.name}</td>
                <td className="num px-3 py-3 text-right">{fmtNum(d?.posts ?? null)}</td>
                <td className="num text-muted-foreground/60 px-3 py-3 text-right text-xs">—</td>
                <td className="num px-3 py-3 text-right">
                  {d?.posts_per_month != null ? `${d.posts_per_month}/мес` : '—'}
                </td>
                <td className="num px-3 py-3 text-right">{fmtNum(d?.followers ?? null)}</td>
                <td className="num px-3 py-3 text-right">{fmtNum(d?.following ?? null)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <div className="border-border/40 bg-muted/10 border-t px-5 py-3">
        <p className="text-muted-foreground text-[11px]">
          ▶ {t('reports_hub.competitors.col_reels_views_footer')}
        </p>
      </div>
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
  ownContent,
  t,
}: {
  kind: 'prices' | 'occupancy' | 'rating' | 'content'
  salon: ReturnType<typeof useSalon>['data']
  ownMetrics: { rating_avg: number | null; rating_count: number } | null
  ownContent: OwnSalonContent | null
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
    if (ownContent?.has_data) {
      const parts: string[] = []
      if (ownContent.followers != null) parts.push(`👥 ${ownContent.followers}`)
      if (ownContent.posts != null) parts.push(`📷 ${ownContent.posts}`)
      if (ownContent.following != null) parts.push(`➡ ${ownContent.following}`)
      if (ownContent.posts_per_month != null) parts.push(`📅 ${ownContent.posts_per_month}/мес`)
      if (ownContent.fb_likes != null) parts.push(`👍 ${ownContent.fb_likes}`)
      dataCell = <span>{parts.join(' · ')}</span>
    } else {
      dataCell = (
        <span className="text-muted-foreground/70">
          {t('reports_hub.competitors.own_content_hint')}
        </span>
      )
    }
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
    const following = data.following as number | undefined
    const ppm = data.posts_per_month as number | undefined
    const parts: string[] = []
    parts.push(`👥 ${followers ?? '?'}`)
    parts.push(`📷 ${posts ?? '?'}`)
    if (following != null) parts.push(`➡ ${following}`)
    if (ppm != null) parts.push(`📅 ${ppm}/мес`)
    return parts.join(' · ')
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
  const [newName, setNewName] = useState('')
  const [newGooglePlaceId, setNewGooglePlaceId] = useState<string | null>(null)
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
        google_place_id: newGooglePlaceId,
        instagram_url: newInsta.trim() || null,
        facebook_url: newFb.trim() || null,
      },
      {
        onSuccess: () => {
          setNewName('')
          setNewGooglePlaceId(null)
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

      <div className="border-border bg-card shadow-finsm rounded-lg border p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-brand-navy text-base font-bold">
              {t('reports_hub.competitors.params.add_title')}
            </h3>
            <p className="text-muted-foreground mt-1 text-xs">
              {t('reports_hub.competitors.params.add_subtitle')}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              discoverCompetitors.mutate(undefined, {
                onSuccess: (n) =>
                  toast.success(t('reports_hub.competitors.params.discover_done', { count: n })),
                onError: (e) => {
                  const code = (e as Error & { code?: string }).code
                  const message = e instanceof Error ? e.message : String(e)
                  const key =
                    code === 'no_geo'
                      ? 'reports_hub.competitors.params.discover_error_no_geo'
                      : code === 'forbidden'
                        ? 'reports_hub.competitors.params.discover_error_forbidden'
                        : code === 'salon_not_found'
                          ? 'reports_hub.competitors.params.discover_error_salon_not_found'
                          : 'reports_hub.competitors.params.discover_error_generic'
                  toast.error(t(key, { message }))
                },
              })
            }}
            disabled={discoverCompetitors.isPending}
          >
            <Sparkles className="mr-1.5 size-3.5" strokeWidth={2} />
            {discoverCompetitors.isPending
              ? t('common.loading')
              : t('reports_hub.competitors.params.discover_button')}
          </Button>
        </div>
        <div className="mt-4 flex flex-col gap-3">
          <div>
            <Label>{t('reports_hub.competitors.params.name_label')}</Label>
            <div className="mt-1.5">
              <GooglePlaceSearchInput
                initialName={newName || null}
                initialPlaceId={newGooglePlaceId}
                onPick={(p) => {
                  setNewName(p.name)
                  setNewGooglePlaceId(p.google_place_id)
                  if (p.google_maps_uri) setNewGoogle(p.google_maps_uri)
                }}
                onClear={() => {
                  setNewName('')
                  setNewGooglePlaceId(null)
                }}
              />
            </div>
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

      {(competitors?.length ?? 0) > 0 ? (
        <div className="border-border bg-card shadow-finsm rounded-lg border p-5">
          <h3 className="text-brand-navy text-base font-bold">
            {t('reports_hub.competitors.params.list_title')}
          </h3>
          <ul className="divide-border mt-3 divide-y">
            {competitors?.map((c) => (
              <CompetitorListItem
                key={c.id}
                competitor={c}
                onSave={(patch) =>
                  updateCompetitor.mutateAsync({ id: c.id, ...patch }).then(() => {
                    toast.success(t('reports_hub.competitors.params.saved'))
                  })
                }
                onArchive={() => {
                  if (!confirm(t('reports_hub.competitors.params.confirm_archive'))) return
                  updateCompetitor.mutate(
                    { id: c.id, is_archived: true },
                    {
                      onSuccess: () => toast.success(t('reports_hub.competitors.params.archived')),
                    },
                  )
                }}
                isSaving={updateCompetitor.isPending}
                t={t}
              />
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}

type CompetitorRow = NonNullable<ReturnType<typeof useCompetitors>['data']>[number]

function CompetitorListItem({
  competitor,
  onSave,
  onArchive,
  isSaving,
  t,
}: {
  competitor: CompetitorRow
  onSave: (patch: {
    name: string
    booksy_url: string | null
    google_place_url: string | null
    instagram_url: string | null
    facebook_url: string | null
  }) => Promise<unknown>
  onArchive: () => void
  isSaving: boolean
  t: (k: string, opts?: Record<string, unknown>) => string
}) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(competitor.name)
  const [booksy, setBooksy] = useState(competitor.booksy_url ?? '')
  const [google, setGoogle] = useState(competitor.google_place_url ?? '')
  const [insta, setInsta] = useState(competitor.instagram_url ?? '')
  const [fb, setFb] = useState(competitor.facebook_url ?? '')

  function startEdit() {
    setName(competitor.name)
    setBooksy(competitor.booksy_url ?? '')
    setGoogle(competitor.google_place_url ?? '')
    setInsta(competitor.instagram_url ?? '')
    setFb(competitor.facebook_url ?? '')
    setEditing(true)
  }

  async function save() {
    const trimmed = name.trim()
    if (!trimmed) {
      toast.error(t('reports_hub.competitors.params.name_required'))
      return
    }
    await onSave({
      name: trimmed,
      booksy_url: booksy.trim() || null,
      google_place_url: google.trim() || null,
      instagram_url: insta.trim() || null,
      facebook_url: fb.trim() || null,
    })
    setEditing(false)
  }

  if (!editing) {
    return (
      <li className="flex items-center justify-between gap-2 py-2.5">
        <div className="min-w-0 flex-1">
          <p className="text-foreground text-sm font-semibold">{competitor.name}</p>
          <p className="text-muted-foreground mt-0.5 truncate text-[11px]">
            {[
              competitor.booksy_url,
              competitor.google_place_url,
              competitor.instagram_url,
              competitor.facebook_url,
            ]
              .filter(Boolean)
              .join(' · ') || t('reports_hub.competitors.params.no_links')}
          </p>
        </div>
        <button
          type="button"
          onClick={startEdit}
          className="text-muted-foreground hover:text-foreground grid size-8 place-items-center rounded-md"
          aria-label={t('common.edit')}
        >
          <Pencil className="size-4" strokeWidth={1.8} />
        </button>
        <button
          type="button"
          onClick={onArchive}
          className="text-muted-foreground hover:text-destructive grid size-8 place-items-center rounded-md"
          aria-label={t('common.delete')}
        >
          <Trash2 className="size-4" strokeWidth={1.8} />
        </button>
      </li>
    )
  }

  return (
    <li className="py-3">
      <div className="flex flex-col gap-2">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('reports_hub.competitors.params.name_label')}
        />
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Input
            value={booksy}
            onChange={(e) => setBooksy(e.target.value)}
            placeholder="https://booksy.com/..."
          />
          <Input
            value={google}
            onChange={(e) => setGoogle(e.target.value)}
            placeholder="https://maps.google.com/..."
          />
          <Input
            value={insta}
            onChange={(e) => setInsta(e.target.value)}
            placeholder="https://instagram.com/..."
          />
          <Input
            value={fb}
            onChange={(e) => setFb(e.target.value)}
            placeholder="https://facebook.com/..."
          />
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={() => setEditing(false)} disabled={isSaving}>
            <X className="mr-1 size-3.5" /> {t('common.cancel')}
          </Button>
          <Button size="sm" onClick={save} disabled={isSaving}>
            <Check className="mr-1 size-3.5" /> {t('common.save')}
          </Button>
        </div>
      </div>
    </li>
  )
}
