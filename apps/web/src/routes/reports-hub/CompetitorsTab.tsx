import {
  BarChart2,
  Check,
  DollarSign,
  Eye,
  Image as ImageIcon,
  Loader2,
  Pencil,
  Settings as SettingsIcon,
  Sparkles,
  Star,
  Trash2,
  X,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
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
import { useMessengerIntegrations } from '@/hooks/useMessenger'
import { useRefreshReportInsights, useServiceMatchAi } from '@/hooks/useReportInsights'
import { useSalon } from '@/hooks/useSalons'
import { useServices } from '@/hooks/useServices'
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
  // Дефолт «Рейтинг» — там сразу видны данные (Booksy/Google ratings собираются
  // автосинком сразу). Цены / Загруженность требуют AI-матчинга → пустые при
  // первом открытии, что выглядит как «не работает».
  const [sub, setSub] = useState<CompetitorsSubTab>('rating')
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

  // Авто-sync при открытии любой data-вкладки. Условия:
  //   - между запусками минимум 3 минуты (lastSyncAt в localStorage),
  //   - если юзер ушёл с вкладки/закрыл tab — фоновый запрос остаётся, но UI его игнорирует
  //     (через aborted-флаг в cleanup useEffect; повторного mutate не будет).
  const syncCompetitors = useSyncCompetitors(salonId)
  const SYNC_COOLDOWN_MS = 3 * 60 * 1000
  const lastSyncKey = `competitors-last-sync-${salonId}`
  const [showStatusBar, setShowStatusBar] = useState(false)
  useEffect(() => {
    if (!competitors || competitors.length === 0) return
    let lastAt = 0
    try {
      const raw = localStorage.getItem(lastSyncKey)
      lastAt = raw ? parseInt(raw, 10) : 0
    } catch {
      /* ignore */
    }
    const now = Date.now()
    if (now - lastAt < SYNC_COOLDOWN_MS) return
    let aborted = false
    try {
      localStorage.setItem(lastSyncKey, String(now))
    } catch {
      /* ignore */
    }
    setShowStatusBar(true)
    syncCompetitors.mutate(undefined, {
      onSuccess: () => {
        if (aborted) return
        setShowStatusBar(false)
      },
      onError: (e) => {
        if (aborted) return
        setShowStatusBar(false)
        console.warn('competitors auto-sync failed:', e)
      },
    })
    return () => {
      aborted = true
      setShowStatusBar(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [competitors?.length, kind])
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
      {showStatusBar ? <CompetitorsSyncStatusBar t={t} /> : null}

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
      ) : kind === 'prices' ? (
        <PricesTable
          salonId={salonId}
          competitors={competitors}
          snapshots={snapshots}
          currency={currency}
          t={t}
        />
      ) : kind === 'occupancy' ? (
        <OccupancyTable salonId={salonId} competitors={competitors} snapshots={snapshots} t={t} />
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
              {t('reports_hub.competitors.col_posts')}
            </th>
            <th
              className="px-3 py-3 text-right font-semibold"
              title={t('reports_hub.competitors.col_reels_views_hint')}
            >
              {t('reports_hub.competitors.col_reels_views')}
            </th>
            <th
              className="px-3 py-3 text-right font-semibold"
              title={t('reports_hub.competitors.col_freq_hint')}
            >
              {t('reports_hub.competitors.col_freq')}
            </th>
            <th className="px-3 py-3 text-right font-semibold">
              {t('reports_hub.competitors.col_followers')}
            </th>
            <th className="px-3 py-3 text-right font-semibold">
              {t('reports_hub.competitors.col_following')}
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
  const { data: ownSalon } = useSalon(salonId)
  const { data: messengerInt = [] } = useMessengerIntegrations(salonId)
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
  // Watched services: чекбоксы услуг салона + textarea для ручных дополнений.
  // Tag-picker для услуг мониторинга. Максимум 3, выпадающий список с
  // автокомплитом из services салона, ручной ввод (Enter) если такой услуги
  // нет в каталоге. Хранится один упорядоченный массив строк.
  const { data: salonServices = [] } = useServices(salonId)
  const MAX_WATCHED = 3
  const [watchedItems, setWatchedItems] = useState<string[]>(() => settings?.watched_services ?? [])
  const [watchedQuery, setWatchedQuery] = useState('')
  const [watchedSuggestionsOpen, setWatchedSuggestionsOpen] = useState(false)
  // Синкаем стейт когда settings подгрузились или поменялся салон.
  useEffect(() => {
    if (!settings) return
    setWatchedItems(settings.watched_services ?? [])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings?.salon_id])

  function addWatched(name: string) {
    const trimmed = name.trim()
    if (!trimmed) return
    if (watchedItems.includes(trimmed)) {
      toast.error(t('reports_hub.competitors.params.watched_already'))
      return
    }
    if (watchedItems.length >= MAX_WATCHED) {
      toast.error(t('reports_hub.competitors.params.watched_max', { max: MAX_WATCHED }))
      return
    }
    setWatchedItems([...watchedItems, trimmed])
    setWatchedQuery('')
    setWatchedSuggestionsOpen(false)
  }

  function removeWatched(name: string) {
    setWatchedItems(watchedItems.filter((n) => n !== name))
  }

  const watchedSuggestions = useMemo(() => {
    const q = watchedQuery.trim().toLowerCase()
    return salonServices
      .filter((s) => !s.is_archived && !watchedItems.includes(s.name))
      .filter((s) => (q ? s.name.toLowerCase().includes(q) : true))
      .slice(0, 10)
  }, [salonServices, watchedItems, watchedQuery])

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
    upsertSettings.mutate(
      { watched_services: watchedItems },
      {
        onSuccess: () => toast.success(t('reports_hub.competitors.params.saved')),
        onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
      },
    )
  }

  // Статусы подключений для анализа конкурентов. Если у нашего салона нет
  // google_place_id / booksy_url / Instagram OAuth — соответствующие метрики
  // в Рейтинг / Контент будут пустыми. Юзеру важно видеть что подключено.
  const igStatus = messengerInt.find((m) => m.channel === 'instagram')?.status === 'connected'
  const fbStatus = messengerInt.find((m) => m.channel === 'facebook')?.status === 'connected'
  const connections = [
    {
      key: 'google',
      label: t('reports_hub.competitors.params.conn_google'),
      hint: t('reports_hub.competitors.params.conn_google_hint'),
      connected: !!ownSalon?.google_place_id,
      linkLabel: t('reports_hub.competitors.params.conn_go_to_settings'),
      linkTo: `/${salonId}/settings`,
    },
    {
      key: 'booksy',
      label: t('reports_hub.competitors.params.conn_booksy'),
      hint: t('reports_hub.competitors.params.conn_booksy_hint'),
      connected: !!ownSalon?.booksy_url,
      linkLabel: t('reports_hub.competitors.params.conn_go_to_settings'),
      linkTo: `/${salonId}/settings`,
    },
    {
      key: 'instagram',
      label: t('reports_hub.competitors.params.conn_instagram'),
      hint: t('reports_hub.competitors.params.conn_instagram_hint'),
      connected: igStatus,
      linkLabel: t('reports_hub.competitors.params.conn_go_to_integrations'),
      linkTo: `/${salonId}/integrations?tab=messengers`,
    },
    {
      key: 'facebook',
      label: t('reports_hub.competitors.params.conn_facebook'),
      hint: t('reports_hub.competitors.params.conn_facebook_hint'),
      connected: fbStatus,
      linkLabel: t('reports_hub.competitors.params.conn_go_to_integrations'),
      linkTo: `/${salonId}/integrations?tab=messengers`,
    },
  ]

  return (
    <div className="flex flex-col gap-4">
      <div className="border-brand-teal-soft bg-brand-teal-soft/15 rounded-lg border p-5">
        <h3 className="text-brand-navy text-base font-bold">
          {t('reports_hub.competitors.params.connections_title')}
        </h3>
        <p className="text-muted-foreground mt-1 text-xs">
          {t('reports_hub.competitors.params.connections_subtitle')}
        </p>
        <ul className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {connections.map((c) => (
            <li
              key={c.key}
              className={cn(
                'border-border bg-card flex items-center justify-between gap-3 rounded-md border p-3',
                c.connected ? 'border-emerald-200' : 'border-amber-200',
              )}
            >
              <div className="min-w-0 flex-1">
                <p className="text-foreground inline-flex items-center gap-1.5 text-sm font-semibold">
                  {c.connected ? (
                    <Check className="size-3.5 text-emerald-600" strokeWidth={2.5} />
                  ) : (
                    <X className="size-3.5 text-amber-600" strokeWidth={2.5} />
                  )}
                  {c.label}
                </p>
                <p className="text-muted-foreground mt-0.5 text-[11px]">{c.hint}</p>
              </div>
              {!c.connected ? (
                <a
                  href={c.linkTo}
                  className="text-secondary hover:text-secondary/80 shrink-0 text-[11px] font-semibold underline-offset-2 hover:underline"
                >
                  {c.linkLabel} →
                </a>
              ) : null}
            </li>
          ))}
        </ul>
      </div>

      <div className="border-border bg-card shadow-finsm rounded-lg border p-5">
        <h3 className="text-brand-navy text-base font-bold">
          {t('reports_hub.competitors.params.watched_title')}
        </h3>
        <p className="text-muted-foreground mt-1 text-xs">
          {t('reports_hub.competitors.params.watched_subtitle')}
        </p>
        <div className="mt-4 flex flex-col gap-3">
          <Label className="text-muted-foreground text-[11px] font-semibold uppercase tracking-wider">
            {t('reports_hub.competitors.params.watched_picker_label', { max: MAX_WATCHED })}
          </Label>
          {/* Поле для tag-picker с chips внутри + input + dropdown снизу */}
          <div className="relative">
            <div
              className={cn(
                'border-input bg-background flex flex-wrap items-center gap-1.5 rounded-md border px-2 py-1.5 transition-colors focus-within:ring-2',
                watchedItems.length >= MAX_WATCHED
                  ? 'focus-within:ring-amber-300'
                  : 'focus-within:ring-brand-sage-deep/40',
              )}
            >
              {watchedItems.map((name) => (
                <span
                  key={name}
                  className="bg-brand-sage-deep inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold text-white"
                >
                  {name}
                  <button
                    type="button"
                    onClick={() => removeWatched(name)}
                    className="grid size-4 place-items-center rounded-full transition-colors hover:bg-white/20"
                    aria-label="remove"
                  >
                    <X className="size-3" strokeWidth={2.5} />
                  </button>
                </span>
              ))}
              {watchedItems.length < MAX_WATCHED ? (
                <input
                  type="text"
                  value={watchedQuery}
                  onChange={(e) => {
                    setWatchedQuery(e.target.value)
                    setWatchedSuggestionsOpen(true)
                  }}
                  onFocus={() => setWatchedSuggestionsOpen(true)}
                  onBlur={() => {
                    // Задержка чтобы клик по suggestion успел сработать.
                    setTimeout(() => setWatchedSuggestionsOpen(false), 150)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && watchedQuery.trim()) {
                      e.preventDefault()
                      addWatched(watchedQuery)
                    } else if (
                      e.key === 'Backspace' &&
                      watchedQuery === '' &&
                      watchedItems.length > 0
                    ) {
                      // Удалить последний chip backspace'ом в пустом поле.
                      const last = watchedItems[watchedItems.length - 1]
                      if (last) removeWatched(last)
                    }
                  }}
                  placeholder={
                    watchedItems.length === 0
                      ? t('reports_hub.competitors.params.watched_picker_placeholder_empty')
                      : t('reports_hub.competitors.params.watched_picker_placeholder_more')
                  }
                  className="placeholder:text-muted-foreground min-w-[140px] flex-1 bg-transparent text-sm outline-none"
                />
              ) : null}
            </div>
            {watchedSuggestionsOpen &&
            watchedItems.length < MAX_WATCHED &&
            watchedSuggestions.length > 0 ? (
              <div className="border-border bg-card shadow-finsm absolute left-0 right-0 top-full z-20 mt-1 max-h-60 overflow-y-auto rounded-md border">
                {watchedSuggestions.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => addWatched(s.name)}
                    className="hover:bg-muted/40 text-foreground block w-full px-3 py-1.5 text-left text-sm transition-colors"
                  >
                    {s.name}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <p className="text-muted-foreground/70 text-[10px]">
            {t('reports_hub.competitors.params.watched_picker_hint', { max: MAX_WATCHED })}
          </p>
          <div>
            <Button onClick={saveWatchedServices} disabled={upsertSettings.isPending}>
              {t('reports_hub.competitors.params.save_button')}
            </Button>
          </div>
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

function CompetitorsSyncStatusBar({
  t,
}: {
  t: (k: string, opts?: Record<string, unknown>) => string
}) {
  return (
    <div className="border-brand-sage-soft bg-brand-sage-soft/30 text-brand-sage-deep mb-3 flex items-center gap-2 rounded-md border px-3 py-2 text-xs">
      <Loader2 className="size-3.5 animate-spin" strokeWidth={2} />
      <span className="font-semibold">{t('reports_hub.competitors.sync_status_bar')}</span>
    </div>
  )
}

// =============================================================================
// OccupancyTable — слоты конкурентов на ближайшие 7 дней по top-5 услугам.
// =============================================================================

type OccupancyService = {
  name: string
  duration_min: number
  staff_count: number
  free_slots_7d: number
  days_covered: number
}

function OccupancyTable({
  salonId,
  competitors,
  snapshots,
  t,
}: {
  salonId: string
  competitors: NonNullable<ReturnType<typeof useCompetitors>['data']>
  snapshots: ReturnType<typeof useCompetitorSnapshots>['data']
  t: (k: string, opts?: Record<string, unknown>) => string
}) {
  const refresh = useRefreshReportInsights(salonId)
  const [insights, setInsights] = useState<{ title: string; body: string }[] | null>(null)

  // Собираем последний occupancy-snapshot на каждого конкурента.
  const latestByCompetitor = useMemo(() => {
    const map = new Map<string, NonNullable<typeof snapshots>[number]>()
    for (const s of snapshots ?? []) {
      if (s.kind !== 'occupancy') continue
      const prev = map.get(s.competitor_id)
      if (!prev || prev.snapshot_date < s.snapshot_date) {
        map.set(s.competitor_id, s)
      }
    }
    return map
  }, [snapshots])

  // Уплощаем: каждая строка = (competitor × его услуга-snapshot).
  type Row = {
    competitorId: string
    competitorName: string
    service: OccupancyService
    totalStaff: number
  }
  const rows = useMemo<Row[]>(() => {
    const out: Row[] = []
    for (const c of competitors) {
      const snap = latestByCompetitor.get(c.id)
      if (!snap) continue
      const data = snap.data as { services?: OccupancyService[]; total_staff?: number }
      const services = Array.isArray(data.services) ? data.services : []
      for (const svc of services) {
        out.push({
          competitorId: c.id,
          competitorName: c.name,
          service: svc,
          totalStaff: data.total_staff ?? 0,
        })
      }
    }
    return out
  }, [competitors, latestByCompetitor])

  // Среднее по всем — для % vs средний.
  const avgSlotsByService = useMemo(() => {
    const map = new Map<string, number>()
    const buckets = new Map<string, number[]>()
    for (const r of rows) {
      const list = buckets.get(r.service.name) ?? []
      list.push(r.service.free_slots_7d)
      buckets.set(r.service.name, list)
    }
    for (const [name, list] of buckets.entries()) {
      const avg = list.reduce((s, x) => s + x, 0) / list.length
      map.set(name, avg)
    }
    return map
  }, [rows])

  function runAi() {
    const payload = {
      week_days: 7,
      services: rows.map((r) => ({
        competitor: r.competitorName,
        service: r.service.name,
        duration_min: r.service.duration_min,
        staff_count: r.service.staff_count,
        free_slots_7d: r.service.free_slots_7d,
        days_with_slots: r.service.days_covered,
      })),
    }
    refresh.mutate(
      { kind: 'competitors_occupancy' as const, payload },
      {
        onSuccess: (list) => setInsights(list),
        onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
      },
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="border-border bg-card shadow-finsm overflow-x-auto rounded-lg border">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="bg-muted/40 text-muted-foreground border-b text-[11px] uppercase tracking-wider">
            <tr>
              <th className="px-4 py-3 text-left font-semibold">
                {t('reports_hub.competitors.col_competitor')}
              </th>
              <th className="px-4 py-3 text-left font-semibold">
                {t('reports_hub.competitors.col_service')}
              </th>
              <th className="px-3 py-3 text-right font-semibold">
                {t('reports_hub.competitors.col_staff_count')}
              </th>
              <th className="px-3 py-3 text-right font-semibold">
                {t('reports_hub.competitors.col_slots_7d')}
              </th>
              <th className="px-3 py-3 text-right font-semibold">
                {t('reports_hub.competitors.col_days_covered')}
              </th>
              <th className="px-3 py-3 text-right font-semibold">
                {t('reports_hub.competitors.col_vs_avg')}
              </th>
            </tr>
          </thead>
          <tbody className="divide-border divide-y">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="text-muted-foreground px-5 py-12 text-center text-sm">
                  {t('reports_hub.competitors.occupancy_empty')}
                </td>
              </tr>
            ) : (
              rows.map((r, i) => {
                const avg = avgSlotsByService.get(r.service.name) ?? 0
                const diffPct =
                  avg > 0 ? Math.round(((r.service.free_slots_7d - avg) / avg) * 100) : null
                return (
                  <tr key={`${r.competitorId}_${i}`}>
                    <td className="text-foreground px-4 py-3 font-semibold">{r.competitorName}</td>
                    <td className="text-foreground px-4 py-3 text-xs">
                      {r.service.name}
                      {r.service.duration_min ? (
                        <span className="text-muted-foreground ml-1">
                          · {r.service.duration_min} {t('common.min')}
                        </span>
                      ) : null}
                    </td>
                    <td className="num text-foreground px-3 py-3 text-right">
                      {r.service.staff_count}
                    </td>
                    <td className="num text-foreground px-3 py-3 text-right font-bold">
                      {r.service.free_slots_7d}
                    </td>
                    <td className="num text-muted-foreground px-3 py-3 text-right text-xs">
                      {r.service.days_covered} / 7
                    </td>
                    <td
                      className={cn(
                        'num px-3 py-3 text-right font-bold',
                        diffPct == null
                          ? 'text-muted-foreground/60'
                          : diffPct > 10
                            ? 'text-emerald-700'
                            : diffPct < -10
                              ? 'text-rose-600'
                              : 'text-muted-foreground',
                      )}
                    >
                      {diffPct == null ? '—' : `${diffPct > 0 ? '+' : ''}${diffPct}%`}
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      <div className="border-brand-sage-deep/30 from-brand-sage/5 rounded-lg border bg-gradient-to-br to-transparent p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h4 className="text-foreground inline-flex items-center gap-1.5 text-sm font-bold">
            <Sparkles className="text-brand-sage-deep size-4" strokeWidth={2} />
            {t('reports_hub.competitors.ai_title')}
          </h4>
          <Button
            size="sm"
            variant="outline"
            onClick={runAi}
            disabled={refresh.isPending || rows.length === 0}
          >
            {refresh.isPending
              ? t('common.loading')
              : insights
                ? t('reports_hub.competitors.ai_refresh')
                : t('reports_hub.competitors.ai_generate')}
          </Button>
        </div>
        {insights == null ? (
          <p className="text-muted-foreground text-xs">
            {t('reports_hub.competitors.ai_occupancy_hint')}
          </p>
        ) : insights.length === 0 ? (
          <p className="text-muted-foreground text-xs">{t('reports_hub.competitors.ai_empty')}</p>
        ) : (
          <ul className="space-y-2.5">
            {insights.map((it, i) => (
              <li key={i} className="border-border bg-card rounded-md border p-3">
                <p className="text-foreground text-xs font-bold">{it.title}</p>
                <p className="text-muted-foreground mt-1 text-xs leading-relaxed">{it.body}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

// =============================================================================
// PricesTable — матчинг наших услуг с услугами конкурентов через fuzzy-name.
// =============================================================================

/** Нормализация имени услуги для матча: lowercase, заменяем диакритику,
 * выкидываем не-буквенные символы и стоп-слова. */
function normalizeServiceName(s: string): string[] {
  const stripDiacritics = s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ł/gi, 'l')
    .replace(/ё/gi, 'е')
  const STOP = new Set([
    'и',
    'на',
    'с',
    'для',
    'от',
    'до',
    'без',
    'usługa',
    'serwis',
    'service',
    'услуга',
    'salonu',
    'cena',
    'price',
    'oraz',
    'pl',
    'ru',
    'en',
  ])
  return stripDiacritics
    .toLowerCase()
    .replace(/[^a-zа-яёії\s+]/giu, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOP.has(w))
}

/** Jaccard-similarity по токенам [0..1]. */
function tokenSimilarity(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0
  const sa = new Set(a)
  const sb = new Set(b)
  let inter = 0
  for (const x of sa) if (sb.has(x)) inter++
  const union = sa.size + sb.size - inter
  return inter / union
}

type CompetitorService = {
  name: string
  price_cents: number
  duration_min?: number
}

type PriceMatchRow = {
  ownService: { id: string; name: string; price_cents: number; duration_min: number }
  matches: Array<{ competitorId: string; competitorName: string; service: CompetitorService }>
  competitorMin: number | null
  competitorMax: number | null
  competitorAvg: number | null
  diffPct: number | null
}

function PricesTable({
  salonId,
  competitors,
  snapshots,
  currency,
  t,
}: {
  salonId: string
  competitors: NonNullable<ReturnType<typeof useCompetitors>['data']>
  snapshots: ReturnType<typeof useCompetitorSnapshots>['data']
  currency: string
  t: (k: string, opts?: Record<string, unknown>) => string
}) {
  const { data: ownServices = [] } = useServices(salonId)
  const { data: settings } = useCompetitorSettings(salonId)
  const { i18n } = useTranslation()
  const refresh = useRefreshReportInsights(salonId)
  const matchAi = useServiceMatchAi(salonId)
  const [insights, setInsights] = useState<{ title: string; body: string }[] | null>(null)
  const [aiMatches, setAiMatches] = useState<Array<{
    our_service: string
    competitors: Array<{ competitor_id: string; competitor_service: string; confidence: string }>
  }> | null>(null)

  // Собираем «последний на конкурента» snapshot kind='price'.
  const latestByCompetitor = useMemo(() => {
    const map = new Map<string, NonNullable<typeof snapshots>[number]>()
    for (const s of snapshots ?? []) {
      if (s.kind !== 'price') continue
      const prev = map.get(s.competitor_id)
      if (!prev || prev.snapshot_date < s.snapshot_date) {
        map.set(s.competitor_id, s)
      }
    }
    return map
  }, [snapshots])

  // Парсим services из snapshot.data — поддерживаем оба формата:
  //   - новый: { services: [{name, price_cents, duration_min, ...}] }
  //   - старый: { prices: {<name>: <cents>} }
  const competitorServices = useMemo(() => {
    const out = new Map<string, CompetitorService[]>()
    for (const [compId, snap] of latestByCompetitor.entries()) {
      const data = snap.data as Record<string, unknown>
      const list: CompetitorService[] = []
      if (Array.isArray(data.services)) {
        for (const v of data.services as Record<string, unknown>[]) {
          if (typeof v.name === 'string' && typeof v.price_cents === 'number') {
            list.push({
              name: v.name,
              price_cents: v.price_cents,
              duration_min: typeof v.duration_min === 'number' ? v.duration_min : 0,
            })
          }
        }
      } else if (data.prices && typeof data.prices === 'object') {
        for (const [name, cents] of Object.entries(data.prices as Record<string, number>)) {
          if (typeof cents === 'number') list.push({ name, price_cents: cents })
        }
      }
      out.set(compId, list)
    }
    return out
  }, [latestByCompetitor])

  // Какие услуги отслеживаем — из watched_services настроек (если пусто, берём все из salon).
  const watchedNames = useMemo(() => {
    const watched = settings?.watched_services ?? []
    if (watched.length === 0) return null
    return new Set(watched)
  }, [settings?.watched_services])

  // Загружаем кеш AI-матчинга из localStorage по hash от inputs.
  const cacheKey = useMemo(() => {
    if (!salonId) return null
    const our = ownServices
      .filter((s) => !s.is_archived && (!watchedNames || watchedNames.has(s.name)))
      .map((s) => s.name)
      .sort()
      .join('|')
    const comp = competitors
      .map((c) => {
        const list = (competitorServices.get(c.id) ?? [])
          .map((s) => s.name)
          .sort()
          .join(',')
        return `${c.id}:${list}`
      })
      .sort()
      .join(';;')
    return `svc-match:${salonId}:${our}:${comp}`
  }, [salonId, ownServices, competitors, competitorServices, watchedNames])

  useEffect(() => {
    if (!cacheKey) return
    try {
      const raw = localStorage.getItem(cacheKey)
      if (raw) {
        setAiMatches(JSON.parse(raw))
        return
      }
    } catch {
      /* ignore */
    }
    setAiMatches(null)
  }, [cacheKey])

  function runAiMatch() {
    const our_services = ownServices
      .filter((s) => !s.is_archived && (!watchedNames || watchedNames.has(s.name)))
      .map((s) => s.name)
    if (our_services.length === 0) {
      toast.error(t('reports_hub.competitors.no_services_to_match'))
      return
    }
    const compsInput = competitors.map((c) => ({
      competitor_id: c.id,
      services: (competitorServices.get(c.id) ?? []).map((s) => s.name),
    }))
    matchAi.mutate(
      { our_services, competitors: compsInput },
      {
        onSuccess: (matches) => {
          setAiMatches(matches)
          if (cacheKey) {
            try {
              localStorage.setItem(cacheKey, JSON.stringify(matches))
            } catch {
              /* quota → пофиг */
            }
          }
          toast.success(t('reports_hub.competitors.ai_match_done', { count: matches.length }))
        },
        onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
      },
    )
  }

  const rows = useMemo<PriceMatchRow[]>(() => {
    const result: PriceMatchRow[] = []
    for (const ownSvc of ownServices) {
      if (ownSvc.is_archived) continue
      if (watchedNames && !watchedNames.has(ownSvc.name)) continue
      const matches: PriceMatchRow['matches'] = []

      // Если есть AI-матчинг — используем его. Иначе fallback на fuzzy Jaccard.
      const aiForThis = aiMatches?.find((m) => m.our_service === ownSvc.name)
      if (aiForThis) {
        for (const cm of aiForThis.competitors) {
          if (cm.confidence === 'low') continue
          const compServices = competitorServices.get(cm.competitor_id) ?? []
          const svc = compServices.find((s) => s.name === cm.competitor_service)
          if (!svc) continue
          const comp = competitors.find((c) => c.id === cm.competitor_id)
          if (!comp) continue
          matches.push({ competitorId: comp.id, competitorName: comp.name, service: svc })
        }
      } else {
        const ownTokens = normalizeServiceName(ownSvc.name)
        for (const c of competitors) {
          const list = competitorServices.get(c.id) ?? []
          let best: { score: number; svc: CompetitorService } | null = null
          for (const svc of list) {
            const sim = tokenSimilarity(ownTokens, normalizeServiceName(svc.name))
            if (sim >= 0.4 && (!best || sim > best.score)) best = { score: sim, svc }
          }
          if (best) matches.push({ competitorId: c.id, competitorName: c.name, service: best.svc })
        }
      }

      const prices = matches.map((m) => m.service.price_cents)
      const min = prices.length > 0 ? Math.min(...prices) : null
      const max = prices.length > 0 ? Math.max(...prices) : null
      const avg = prices.length > 0 ? prices.reduce((s, x) => s + x, 0) / prices.length : null
      const diffPct =
        avg != null && avg > 0 ? Math.round(((ownSvc.default_price_cents - avg) / avg) * 100) : null
      result.push({
        ownService: {
          id: ownSvc.id,
          name: ownSvc.name,
          price_cents: ownSvc.default_price_cents,
          duration_min: ownSvc.default_duration_min ?? 0,
        },
        matches,
        competitorMin: min,
        competitorMax: max,
        competitorAvg: avg,
        diffPct,
      })
    }
    result.sort((a, b) => {
      const am = a.matches.length > 0 ? 1 : 0
      const bm = b.matches.length > 0 ? 1 : 0
      if (am !== bm) return bm - am
      return Math.abs(b.diffPct ?? 0) - Math.abs(a.diffPct ?? 0)
    })
    return result
  }, [ownServices, competitors, competitorServices, aiMatches, watchedNames])

  function runAi() {
    const payload = {
      our_services: rows.map((r) => ({
        name: r.ownService.name,
        our_price: r.ownService.price_cents / 100,
        competitor_min: r.competitorMin != null ? r.competitorMin / 100 : null,
        competitor_max: r.competitorMax != null ? r.competitorMax / 100 : null,
        competitor_avg: r.competitorAvg != null ? Math.round(r.competitorAvg) / 100 : null,
        diff_pct: r.diffPct,
        matched_competitors: r.matches.length,
      })),
      currency,
    }
    refresh.mutate(
      { kind: 'competitors_prices', payload },
      {
        onSuccess: (list) => setInsights(list),
        onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
      },
    )
  }

  const locale = i18n.language?.split('-')[0] ?? 'ru'

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-muted-foreground text-xs">
          {aiMatches
            ? t('reports_hub.competitors.ai_match_active', { count: aiMatches.length })
            : t('reports_hub.competitors.ai_match_hint')}
        </p>
        <Button
          size="sm"
          variant="outline"
          onClick={runAiMatch}
          disabled={matchAi.isPending || competitors.length === 0}
        >
          <Sparkles className="mr-1.5 size-3.5" strokeWidth={2} />
          {matchAi.isPending
            ? t('common.loading')
            : aiMatches
              ? t('reports_hub.competitors.ai_match_refresh')
              : t('reports_hub.competitors.ai_match_run')}
        </Button>
      </div>
      <div className="border-border bg-card shadow-finsm overflow-x-auto rounded-lg border">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="bg-muted/40 text-muted-foreground border-b text-[11px] uppercase tracking-wider">
            <tr>
              <th className="px-4 py-3 text-left font-semibold">
                {t('reports_hub.competitors.col_service')}
              </th>
              <th className="px-3 py-3 text-right font-semibold">
                {t('reports_hub.competitors.col_our_price')}
              </th>
              <th className="px-3 py-3 text-right font-semibold">
                {t('reports_hub.competitors.col_competitor_range')}
              </th>
              <th className="px-3 py-3 text-right font-semibold">
                {t('reports_hub.competitors.col_competitor_avg')}
              </th>
              <th className="px-3 py-3 text-right font-semibold">
                {t('reports_hub.competitors.col_diff_pct')}
              </th>
            </tr>
          </thead>
          <tbody className="divide-border divide-y">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="text-muted-foreground px-5 py-12 text-center text-sm">
                  {t('reports_hub.competitors.no_services_to_compare')}
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.ownService.id}>
                  <td className="text-foreground px-4 py-3 font-semibold">
                    {r.ownService.name}
                    {r.matches.length === 0 ? (
                      <span className="text-muted-foreground/60 ml-2 text-[10px] font-normal italic">
                        {t('reports_hub.competitors.no_match')}
                      </span>
                    ) : (
                      <span className="text-muted-foreground/60 ml-2 text-[10px] font-normal">
                        ({r.matches.length})
                      </span>
                    )}
                  </td>
                  <td className="num text-foreground px-3 py-3 text-right">
                    {formatCurrency(r.ownService.price_cents, currency, locale)}
                  </td>
                  <td className="num text-muted-foreground px-3 py-3 text-right text-xs">
                    {r.competitorMin != null && r.competitorMax != null
                      ? `${formatCurrency(r.competitorMin, currency, locale)} – ${formatCurrency(r.competitorMax, currency, locale)}`
                      : '—'}
                  </td>
                  <td className="num text-foreground px-3 py-3 text-right">
                    {r.competitorAvg != null
                      ? formatCurrency(Math.round(r.competitorAvg), currency, locale)
                      : '—'}
                  </td>
                  <td
                    className={cn(
                      'num px-3 py-3 text-right font-bold',
                      r.diffPct == null
                        ? 'text-muted-foreground/60'
                        : r.diffPct > 5
                          ? 'text-rose-600'
                          : r.diffPct < -5
                            ? 'text-amber-600'
                            : 'text-emerald-700',
                    )}
                    title={
                      r.diffPct == null
                        ? undefined
                        : r.diffPct > 0
                          ? t('reports_hub.competitors.diff_hint_higher')
                          : r.diffPct < 0
                            ? t('reports_hub.competitors.diff_hint_lower')
                            : t('reports_hub.competitors.diff_hint_eq')
                    }
                  >
                    {r.diffPct == null ? '—' : `${r.diffPct > 0 ? '+' : ''}${r.diffPct}%`}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="border-brand-sage-deep/30 from-brand-sage/5 rounded-lg border bg-gradient-to-br to-transparent p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h4 className="text-foreground inline-flex items-center gap-1.5 text-sm font-bold">
            <Sparkles className="text-brand-sage-deep size-4" strokeWidth={2} />
            {t('reports_hub.competitors.ai_title')}
          </h4>
          <Button
            size="sm"
            variant="outline"
            onClick={runAi}
            disabled={refresh.isPending || rows.length === 0}
          >
            {refresh.isPending
              ? t('common.loading')
              : insights
                ? t('reports_hub.competitors.ai_refresh')
                : t('reports_hub.competitors.ai_generate')}
          </Button>
        </div>
        {insights == null ? (
          <p className="text-muted-foreground text-xs">
            {t('reports_hub.competitors.ai_prices_hint')}
          </p>
        ) : insights.length === 0 ? (
          <p className="text-muted-foreground text-xs">{t('reports_hub.competitors.ai_empty')}</p>
        ) : (
          <ul className="space-y-2.5">
            {insights.map((it, i) => (
              <li key={i} className="border-border bg-card rounded-md border p-3">
                <p className="text-foreground text-xs font-bold">{it.title}</p>
                <p className="text-muted-foreground mt-1 text-xs leading-relaxed">{it.body}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
