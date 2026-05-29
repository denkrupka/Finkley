import {
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
import { useSearchParams } from 'react-router-dom'
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
  type Competitor,
  useCompetitors,
  useCompetitorSettings,
  useCompetitorSnapshots,
  useCreateCompetitor,
  useDiscoverCompetitors,
  useOwnSalonBooksyRating,
  useOwnSalonContent,
  useOwnSalonGoogleRating,
  useOwnSalonOccupancy,
  useOwnSalonMetrics,
  type OwnSalonContent,
  useSyncCompetitors,
  useUpdateCompetitor,
  useUpsertCompetitorSettings,
} from '@/hooks/useCompetitors'
import { AiReportPanel } from '@/components/domain/AiReportPanel'
import { useMessengerIntegrations } from '@/hooks/useMessenger'
import { useRefreshReportInsights, useServiceMatchAi } from '@/hooks/useReportInsights'
import { useSalon } from '@/hooks/useSalons'
import { useServices } from '@/hooks/useServices'
import { cn } from '@/lib/utils/cn'
import { formatCurrency } from '@/lib/utils/format-currency'

// bug 20106e42 — sub-tab «Загруженность» (occupancy) удалён по решению
// владельца (данные/кроны не нужны). Тип/массив SUB_TABS оставили без
// 'occupancy'; legacy URL с ?sub=occupancy редиректит на 'rating'.
type CompetitorsSubTab = 'prices' | 'rating' | 'content' | 'params'

const SUB_TABS: PageTab<CompetitorsSubTab>[] = [
  { id: 'prices', labelKey: 'reports_hub.competitors.tabs.prices', icon: DollarSign },
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
  const [params, setParams] = useSearchParams()
  // sub-tab синхронизирован с URL (?sub=prices|occupancy|rating|content|params).
  // Дефолт «Рейтинг» — там сразу видны данные.
  const subParam = params.get('sub') as CompetitorsSubTab | null
  const sub: CompetitorsSubTab =
    subParam && ['prices', 'rating', 'content', 'params'].includes(subParam) ? subParam : 'rating'
  function setSub(next: CompetitorsSubTab) {
    const p = new URLSearchParams(params)
    p.set('sub', next)
    setParams(p, { replace: true })
  }
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
  //   - между запусками минимум 30 секунд (защита от 5-кратного sync при быстром
  //     переключении вкладок и от Booksy/Google rate-limit),
  //   - если юзер ушёл с вкладки/закрыл tab — фоновый запрос остаётся, но UI его игнорирует
  //     (через aborted-флаг в cleanup useEffect; повторного mutate не будет).
  const syncCompetitors = useSyncCompetitors(salonId)
  const SYNC_COOLDOWN_MS = 30 * 1000
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
  // ownContent/ownOccupancy фильтруются по периоду — чтобы при смене периода
  // строка нашего салона не висела «застывшей» от другого месяца.
  const { data: ownContent } = useOwnSalonContent(salonId, dateFilter)
  const { data: ownBooksyRating } = useOwnSalonBooksyRating(salonId)
  const { data: ownGoogleRating } = useOwnSalonGoogleRating(salonId)

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
      <div className="mb-3 flex items-center justify-end gap-2">
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
          ownGoogle={ownGoogleRating ?? null}
          ownGoogleFallback={ownMetrics ?? null}
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
        <OccupancyTable
          salonId={salonId}
          competitors={competitors}
          snapshots={snapshots}
          ownSalonName={salon?.name ?? t('reports_hub.competitors.own_label')}
          dateFilter={dateFilter}
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
                        ? renderSnapshotData(latest, currency, t)
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
  ownGoogleFallback,
  t,
}: {
  competitors: NonNullable<ReturnType<typeof useCompetitors>['data']>
  snapshots: ReturnType<typeof useCompetitorSnapshots>['data']
  ownSalon: ReturnType<typeof useSalon>['data']
  ownBooksy: { rating: number; count: number } | null
  ownGoogle: { rating: number; count: number } | null
  ownGoogleFallback: { rating_avg: number | null; rating_count: number } | null
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
    <div className="flex flex-col gap-2">
      <div className="border-border bg-card shadow-finsm overflow-x-auto rounded-lg border">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="bg-muted/40 text-muted-foreground border-b text-[11px] uppercase tracking-wider">
            <tr>
              <th
                rowSpan={2}
                className="border-border/40 border-r px-4 py-3 text-left font-semibold"
              >
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
                rating={ownGoogle?.rating ?? ownGoogleFallback?.rating_avg ?? null}
                count={ownGoogle?.count ?? ownGoogleFallback?.rating_count ?? null}
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
      <p className="text-muted-foreground/80 text-[10.5px] leading-relaxed">
        {t('reports_hub.competitors.google_reviews_limit_hint')}
      </p>
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
  const { t } = useTranslation()
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
                title={t('reports.competitors.open_reviews')}
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
 * Content таб — отдельные таблицы Instagram и Facebook. Данные тянутся из
 * snapshots за выбранный период (если в периоде snapshot отсутствует — «—»).
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
  type ContentData = {
    posts?: number
    followers?: number
    following?: number
    posts_per_month?: number
    fb_likes?: number
    avg_likes?: number
    avg_comments?: number
    engagement_rate?: number
    /** Постов добавлено за выбранный период (max-min posts по snapshots в range).
     *  null = в периоде только 1 snapshot (недостаточно данных). */
    posts_added_in_period?: number | null
  }
  const byCompetitor = new Map<string, ContentData>()
  // Sort by date ascending — берём latest values, плюс tracking min/max posts.
  const postsRange = new Map<string, { min: number; max: number; samples: number }>()
  const sortedSnapshots = [...(snapshots ?? [])].sort((a, b) =>
    a.snapshot_date.localeCompare(b.snapshot_date),
  )
  for (const s of sortedSnapshots) {
    if (s.kind !== 'content') continue
    const cur = byCompetitor.get(s.competitor_id) ?? {}
    const d = s.data as Record<string, unknown>
    // Latest values (последний snapshot перезаписывает предыдущие).
    if (typeof d.posts === 'number') cur.posts = d.posts
    if (typeof d.followers === 'number') cur.followers = d.followers
    if (typeof d.following === 'number') cur.following = d.following
    if (typeof d.posts_per_month === 'number') cur.posts_per_month = d.posts_per_month
    if (typeof d.fb_likes === 'number') cur.fb_likes = d.fb_likes
    if (typeof d.avg_likes === 'number') cur.avg_likes = d.avg_likes
    if (typeof d.avg_comments === 'number') cur.avg_comments = d.avg_comments
    if (typeof d.engagement_rate === 'number') cur.engagement_rate = d.engagement_rate
    // Tracking min/max posts для «постов добавлено за период».
    if (typeof d.posts === 'number') {
      const r = postsRange.get(s.competitor_id) ?? { min: d.posts, max: d.posts, samples: 0 }
      r.min = Math.min(r.min, d.posts)
      r.max = Math.max(r.max, d.posts)
      r.samples += 1
      postsRange.set(s.competitor_id, r)
    }
    byCompetitor.set(s.competitor_id, cur)
  }
  // Считаем posts_added_in_period: max - min среди snapshots в периоде.
  // Нужно ≥2 sample'а — иначе показываем «—» (не успели накопить историю).
  for (const [cid, r] of postsRange) {
    const data = byCompetitor.get(cid)
    if (!data) continue
    data.posts_added_in_period = r.samples >= 2 ? r.max - r.min : null
  }

  function fmtNum(v: number | null | undefined): string {
    if (v == null) return '—'
    if (v >= 1000) return `${(v / 1000).toFixed(1)}k`
    if (v < 10 && !Number.isInteger(v)) return v.toFixed(2)
    if (v < 100 && !Number.isInteger(v)) return v.toFixed(1)
    return String(v)
  }
  function fmtPct(v: number | null | undefined): string {
    return v == null ? '—' : `${v.toFixed(2)}%`
  }

  // «+ N постов за период» — для +/- маркера.
  function fmtDelta(v: number | null | undefined): string {
    if (v == null) return '—'
    if (v === 0) return '0'
    return v > 0 ? `+${v}` : String(v)
  }

  const ownEffective: ContentData = {
    posts_added_in_period: ownContent?.posts_added_in_period ?? undefined,
    followers: ownContent?.followers ?? undefined,
    posts: ownContent?.posts ?? undefined,
    following: ownContent?.following ?? undefined,
    fb_likes: ownContent?.fb_likes ?? undefined,
    posts_per_month: ownContent?.posts_per_month ?? undefined,
    avg_likes: ownContent?.avg_likes ?? undefined,
    avg_comments: ownContent?.avg_comments ?? undefined,
    engagement_rate: ownContent?.engagement_rate ?? undefined,
  }
  function competitorEffective(c: Competitor): ContentData {
    return byCompetitor.get(c.id) ?? {}
  }

  const ownEmpty =
    ownEffective.posts == null &&
    ownEffective.followers == null &&
    ownEffective.following == null &&
    ownEffective.posts_per_month == null
  const noOwnSocial = !ownSalon?.instagram_url && !ownSalon?.facebook_url

  return (
    <div className="flex flex-col gap-6">
      {ownEmpty && noOwnSocial ? (
        <div className="border-brand-yellow-deep/40 bg-brand-yellow/30 rounded-lg border p-3 text-xs">
          {t('reports_hub.competitors.content_no_social_hint')}
        </div>
      ) : null}

      {/* ============ Instagram ============ */}
      <section>
        <h3 className="text-foreground mb-2 flex items-center gap-2 text-sm font-bold">
          <span
            className="inline-flex size-5 items-center justify-center rounded-md bg-gradient-to-br from-[#F58529] via-[#DD2A7B] to-[#515BD4] text-[10px] font-extrabold text-white"
            aria-hidden
          >
            IG
          </span>
          Instagram
        </h3>
        <div className="border-border bg-card shadow-finsm overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-muted/40 text-muted-foreground border-b text-[11px] uppercase tracking-wider">
              <tr>
                <th className="px-4 py-3 text-left font-semibold">
                  {t('reports_hub.competitors.col_name')}
                </th>
                <th className="px-3 py-3 text-right font-semibold">
                  {t('reports_hub.competitors.col_ig_followers')}
                </th>
                <th
                  className="px-3 py-3 text-right font-semibold"
                  title={t('reports_hub.competitors.col_ig_posts_hint')}
                >
                  {t('reports_hub.competitors.col_ig_posts')}
                </th>
                <th
                  className="px-3 py-3 text-right font-semibold"
                  title={t('reports_hub.competitors.col_ig_avg_likes_hint')}
                >
                  {t('reports_hub.competitors.col_ig_avg_likes')}
                </th>
                <th
                  className="px-3 py-3 text-right font-semibold"
                  title={t('reports_hub.competitors.col_ig_avg_comments_hint')}
                >
                  {t('reports_hub.competitors.col_ig_avg_comments')}
                </th>
                <th
                  className="px-3 py-3 text-right font-semibold"
                  title={t('reports_hub.competitors.col_ig_engagement_hint')}
                >
                  {t('reports_hub.competitors.col_ig_engagement')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-border divide-y">
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
                <td className="num px-3 py-3 text-right font-bold">
                  {fmtNum(ownEffective.followers)}
                </td>
                <td
                  className={cn(
                    'num px-3 py-3 text-right font-semibold',
                    ownEffective.posts_added_in_period == null ? 'text-muted-foreground/60' : '',
                  )}
                  title={
                    ownEffective.posts_added_in_period == null
                      ? t('reports_hub.competitors.col_ig_posts_added_no_history')
                      : undefined
                  }
                >
                  {ownEffective.posts_added_in_period == null
                    ? '—'
                    : ownEffective.posts_added_in_period}
                </td>
                <td className="num px-3 py-3 text-right">{fmtNum(ownEffective.avg_likes)}</td>
                <td className="num px-3 py-3 text-right">{fmtNum(ownEffective.avg_comments)}</td>
                <td className="num px-3 py-3 text-right">{fmtPct(ownEffective.engagement_rate)}</td>
              </tr>
              {competitors.map((c) => {
                const d = competitorEffective(c)
                return (
                  <tr key={c.id}>
                    <td className="text-foreground px-4 py-3 font-semibold">{c.name}</td>
                    <td className="num text-foreground px-3 py-3 text-right font-bold">
                      {fmtNum(d.followers)}
                    </td>
                    <td className="num px-3 py-3 text-right">{fmtNum(d.posts)}</td>
                    <td
                      className={cn(
                        'num px-3 py-3 text-right font-semibold',
                        d.posts_added_in_period == null
                          ? 'text-muted-foreground/60'
                          : d.posts_added_in_period > 0
                            ? 'text-emerald-700'
                            : 'text-muted-foreground',
                      )}
                      title={
                        d.posts_added_in_period == null
                          ? t('reports_hub.competitors.col_ig_posts_added_no_history')
                          : undefined
                      }
                    >
                      {fmtDelta(d.posts_added_in_period)}
                    </td>
                    <td className="num px-3 py-3 text-right">{fmtNum(d.avg_likes)}</td>
                    <td className="num px-3 py-3 text-right">{fmtNum(d.avg_comments)}</td>
                    <td className="num px-3 py-3 text-right">{fmtPct(d.engagement_rate)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* ============ Facebook ============ */}
      <section>
        <h3 className="text-foreground mb-2 flex items-center gap-2 text-sm font-bold">
          <span
            className="inline-flex size-5 items-center justify-center rounded-md bg-[#1877F2] text-[10px] font-extrabold text-white"
            aria-hidden
          >
            f
          </span>
          Facebook
        </h3>
        <div className="border-border bg-card shadow-finsm overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[440px] text-sm">
            <thead className="bg-muted/40 text-muted-foreground border-b text-[11px] uppercase tracking-wider">
              <tr>
                <th className="px-4 py-3 text-left font-semibold">
                  {t('reports_hub.competitors.col_name')}
                </th>
                <th
                  className="px-3 py-3 text-right font-semibold"
                  title={t('reports_hub.competitors.col_fb_page_likes_hint')}
                >
                  {t('reports_hub.competitors.col_fb_page_likes')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-border divide-y">
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
                <td className="num px-3 py-3 text-right font-bold">
                  {fmtNum(ownEffective.fb_likes)}
                </td>
              </tr>
              {competitors.map((c) => {
                const d = competitorEffective(c)
                return (
                  <tr key={c.id}>
                    <td className="text-foreground px-4 py-3 font-semibold">{c.name}</td>
                    <td className="num text-foreground px-3 py-3 text-right font-bold">
                      {fmtNum(d.fb_likes)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>
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
      if (ownContent.posts_per_month != null)
        parts.push(`📅 ${ownContent.posts_per_month}/${t('reports.competitors.per_month_suffix')}`)
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
  t: (key: string, opts?: Record<string, unknown>) => string,
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
    if (ppm != null) parts.push(`📅 ${ppm}/${t('reports.competitors.per_month_suffix')}`)
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
  /** label'ы свёрнутых variants («+ kolor», «french»). Backend начиная с
   *  2026-05-23 группирует variants по parent_name. */
  variant_labels?: string[]
  duration_min: number
  staff_count: number
  free_slots_7d: number
  days_covered: number
  /** Backend пометил variant существует, но публичное бронирование закрыто. */
  closed_to_public?: boolean
}

function OccupancyTable({
  salonId,
  competitors,
  snapshots,
  ownSalonName,
  dateFilter,
  t,
}: {
  salonId: string
  competitors: NonNullable<ReturnType<typeof useCompetitors>['data']>
  snapshots: ReturnType<typeof useCompetitorSnapshots>['data']
  ownSalonName: string
  dateFilter: { startIso: string; endIso: string } | null
  t: (k: string, opts?: Record<string, unknown>) => string
}) {
  const refresh = useRefreshReportInsights(salonId)
  const [insights, setInsights] = useState<{ title: string; body: string }[] | null>(null)
  const syncCompetitors = useSyncCompetitors(salonId)
  const { data: settings } = useCompetitorSettings(salonId)
  const { data: ownOccupancy } = useOwnSalonOccupancy(salonId, dateFilter)

  // Загруженность приходит только от Booksy — если у конкурента нет
  // booksy_url, источника нет. Считаем чтобы отличить «нет Booksy-источника»
  // от «sync ещё не отработал».
  const booksyCompetitors = useMemo(() => competitors.filter((c) => c.booksy_url), [competitors])

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
    isOwn: boolean
    service: OccupancyService
    totalStaff: number
  }
  /** Backend начиная с 2026-05-23 группирует variants по parent_name и
   *  возвращает уже агрегированную строку — старые snapshots могут содержать
   *  per-variant записи. На клиенте делаем доп-fallback group-by-name чтобы
   *  не было дублей при переходном периоде. */
  function aggregateLegacy(services: OccupancyService[]): OccupancyService[] {
    // Если backend пометил variant_labels — данные уже агрегированы, ничего не делаем.
    if (services.some((s) => Array.isArray(s.variant_labels))) return services
    // Иначе — fallback: группируем по нормализованному name.
    const groups = new Map<string, OccupancyService[]>()
    for (const s of services) {
      const k = s.name.split(/[—-]/, 1)[0]?.trim() || s.name
      const list = groups.get(k) ?? []
      list.push(s)
      groups.set(k, list)
    }
    const out: OccupancyService[] = []
    for (const [name, list] of groups) {
      // Берём MAX (pessimistic): один staffer не может одновременно делать 4 variants.
      const max = list.reduce((m, x) => (x.free_slots_7d > m.free_slots_7d ? x : m), list[0]!)
      out.push({
        ...max,
        name,
        variant_labels: list.map((s) => s.name).filter((n) => n !== name),
        closed_to_public: list.every((s) => s.free_slots_7d === 0 && s.days_covered === 0),
      })
    }
    return out
  }

  // ===========================================================================
  // НОВАЯ структура: pivot rows = watched_services (или, если watched пуст, top
  // имена услуг по объединённому каталогу). Колонки = (наш салон) + конкуренты.
  // Внутри ячейки: free_slots_7d (max среди variants matching), days, staff.
  // ===========================================================================

  /** Все watched-имена (если есть) или union топ-имен из всех caталогов. */
  const watchedList = useMemo(() => {
    return settings?.watched_services ?? []
  }, [settings?.watched_services])

  /** Для каждого (party_id, watched_name) собираем агрегацию variants:
   *  - free_slots_7d: MAX (избегаем задвоения — слоты разных variants ОДНОГО
   *    мастера это его календарь, общий)
   *  - staff_count: MAX (сколько мастеров делают наиболее популярный variant)
   *  - days_covered: MAX
   *  - variant_labels: список имён variants matching
   *  - closed_to_public: TRUE если все variants закрыты
   *  - matched: FALSE если ни один variant не совпадает с watched (показать «—»). */
  type Cell = {
    free_slots_7d: number
    days_covered: number
    staff_count: number
    duration_min: number
    variant_labels: string[]
    closed_to_public: boolean
    matched: boolean
  }
  const emptyCell: Cell = {
    free_slots_7d: 0,
    days_covered: 0,
    staff_count: 0,
    duration_min: 0,
    variant_labels: [],
    closed_to_public: false,
    matched: false,
  }
  function aggCell(services: OccupancyService[], watchedTokensForName: string[]): Cell {
    const matching = services.filter(
      (s) => tokenSimilarity(watchedTokensForName, normalizeServiceName(s.name)) >= 0.3,
    )
    if (matching.length === 0) return emptyCell
    const allClosed = matching.every((s) => s.closed_to_public || s.free_slots_7d === 0)
    const max = matching.reduce((m, x) => (x.free_slots_7d > m.free_slots_7d ? x : m), matching[0]!)
    return {
      free_slots_7d: max.free_slots_7d,
      days_covered: max.days_covered,
      staff_count: Math.max(...matching.map((s) => s.staff_count)),
      duration_min: max.duration_min,
      variant_labels: matching.map((s) => s.name),
      closed_to_public: allClosed,
      matched: true,
    }
  }

  /** Все доступные party-id и services (own + competitors) в одном списке. */
  type Party = {
    id: string
    name: string
    isOwn: boolean
    services: OccupancyService[]
    hasSnapshot: boolean
  }
  const parties = useMemo<Party[]>(() => {
    const list: Party[] = []
    list.push({
      id: salonId,
      name: ownSalonName,
      isOwn: true,
      services: ownOccupancy ? aggregateLegacy(ownOccupancy.services as OccupancyService[]) : [],
      hasSnapshot: !!ownOccupancy,
    })
    for (const c of competitors) {
      const snap = latestByCompetitor.get(c.id)
      const data = snap?.data as { services?: OccupancyService[]; total_staff?: number } | undefined
      list.push({
        id: c.id,
        name: c.name,
        isOwn: false,
        services: data ? aggregateLegacy(Array.isArray(data.services) ? data.services : []) : [],
        hasSnapshot: !!snap,
      })
    }
    return list
  }, [competitors, latestByCompetitor, ownOccupancy, salonId, ownSalonName])

  /** Имена для строк — watched services если заданы, иначе union имён из
   *  всех каталогов (не более 10 уникальных). */
  const rowServiceNames = useMemo<string[]>(() => {
    if (watchedList.length > 0) return watchedList
    const seen = new Set<string>()
    for (const p of parties) {
      for (const s of p.services) {
        if (s.name) seen.add(s.name)
        if (seen.size >= 10) break
      }
    }
    return Array.from(seen)
  }, [watchedList, parties])

  /** Aggregate cells: для каждой watched-услуги × каждого party. */
  const grid = useMemo(() => {
    const out = new Map<string, Map<string, Cell>>()
    for (const name of rowServiceNames) {
      const tokens = normalizeServiceName(name)
      const partyCells = new Map<string, Cell>()
      for (const p of parties) {
        partyCells.set(p.id, aggCell(p.services, tokens))
      }
      out.set(name, partyCells)
    }
    return out
    // aggCell — pure function, не зависит от внешнего состояния.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowServiceNames, parties])

  /** Среднее slots per service (для % vs средний). closed не учитываются. */
  const avgSlotsByService = useMemo(() => {
    const map = new Map<string, number>()
    for (const name of rowServiceNames) {
      const cells = grid.get(name)
      if (!cells) continue
      const usable: number[] = []
      for (const cell of cells.values()) {
        if (!cell.matched || cell.closed_to_public) continue
        usable.push(cell.free_slots_7d)
      }
      if (usable.length > 0) {
        map.set(name, usable.reduce((s, x) => s + x, 0) / usable.length)
      }
    }
    return map
  }, [rowServiceNames, grid])

  // Legacy rows для AI-выводов (не меняем shape payload).
  const rows = useMemo(() => {
    const out: Row[] = []
    for (const name of rowServiceNames) {
      const cells = grid.get(name)
      if (!cells) continue
      for (const p of parties) {
        if (p.isOwn) continue
        const cell = cells.get(p.id)
        if (!cell?.matched) continue
        out.push({
          competitorId: p.id,
          competitorName: p.name,
          isOwn: false,
          service: {
            name,
            duration_min: cell.duration_min,
            staff_count: cell.staff_count,
            free_slots_7d: cell.free_slots_7d,
            days_covered: cell.days_covered,
            closed_to_public: cell.closed_to_public,
            variant_labels: cell.variant_labels,
          },
          totalStaff: 0,
        })
      }
    }
    return out
  }, [rowServiceNames, grid, parties])

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

  function Slot({ cell }: { cell: Cell }) {
    if (!cell.matched) {
      return <span className="text-muted-foreground/40">—</span>
    }
    if (cell.closed_to_public) {
      return (
        <span
          className="text-[11px] text-amber-700"
          title={t('reports_hub.competitors.occupancy_closed_to_public')}
        >
          закрыто
        </span>
      )
    }
    return (
      <div className="flex flex-col items-end gap-0.5">
        <span className="num text-foreground text-base font-bold">{cell.free_slots_7d}</span>
        <span className="text-muted-foreground/80 text-[10px]">
          {cell.days_covered}/7 дн · {cell.staff_count}{' '}
          {t('reports_hub.competitors.col_staff_count').toLowerCase()}
        </span>
        {cell.variant_labels.length > 1 ? (
          <span
            className="text-muted-foreground/60 max-w-[180px] truncate text-[9.5px]"
            title={cell.variant_labels.join(' · ')}
          >
            ×{cell.variant_labels.length} {t('reports_hub.competitors.occupancy_variants_short')}
          </span>
        ) : null}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <AiReportPanel
        insights={insights}
        isLoading={refresh.isPending}
        onShow={runAi}
        hint={t('reports_hub.competitors.ai_occupancy_hint')}
      />

      {rowServiceNames.length === 0 ? (
        <div className="border-border bg-card shadow-finsm rounded-lg border px-5 py-12 text-center">
          <p className="text-muted-foreground text-sm">
            {booksyCompetitors.length === 0
              ? t('reports_hub.competitors.occupancy_no_booksy')
              : t('reports_hub.competitors.occupancy_empty')}
          </p>
          <p className="text-muted-foreground/70 mt-1 text-xs">
            {t('reports_hub.competitors.occupancy_pick_watched_hint')}
          </p>
        </div>
      ) : (
        <div className="border-border bg-card shadow-finsm overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[760px] text-sm">
            <colgroup>
              <col />
              <col className="bg-brand-sage-soft/15" />
              {parties.slice(1).map((_, i) => (
                <col key={i} className={i % 2 === 0 ? 'bg-sky-50/60' : 'bg-amber-50/60'} />
              ))}
            </colgroup>
            <thead className="bg-muted/40 text-muted-foreground text-[11px] uppercase tracking-wider">
              <tr className="border-b">
                <th className="border-border/40 border-r px-4 py-2 text-left font-bold">
                  {t('reports_hub.competitors.col_service')}
                </th>
                {parties.map((p) => (
                  <th
                    key={p.id}
                    className={cn(
                      'border-border/40 border-r px-3 py-2 text-right font-bold',
                      p.isOwn && 'bg-brand-sage-soft/30 text-brand-sage-deep',
                    )}
                  >
                    <div className="flex items-center justify-end gap-1.5">
                      {p.isOwn ? <Sparkles className="size-3" strokeWidth={2.5} /> : null}
                      <span className="max-w-[140px] truncate" title={p.name}>
                        {p.name}
                      </span>
                      {p.isOwn ? (
                        <span className="bg-brand-sage-soft text-brand-sage-deep rounded-full px-1 py-0.5 text-[8.5px] font-bold uppercase">
                          {t('reports_hub.competitors.own_badge')}
                        </span>
                      ) : null}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-border divide-y">
              {rowServiceNames.map((name) => {
                const cells = grid.get(name)
                if (!cells) return null
                return (
                  <tr key={name}>
                    <td className="text-foreground border-border/40 border-r px-4 py-3 align-top font-semibold">
                      {name}
                    </td>
                    {parties.map((p) => (
                      <td key={p.id} className="border-border/40 border-r px-3 py-3 text-right">
                        <Slot cell={cells.get(p.id) ?? emptyCell} />
                      </td>
                    ))}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Кнопка Force-sync — показываем только когда ничего ещё не подтянулось. */}
      {parties.every((p) => !p.hasSnapshot) && booksyCompetitors.length > 0 ? (
        <div className="flex justify-center">
          <button
            type="button"
            onClick={() => {
              try {
                localStorage.removeItem(`competitors-last-sync-${salonId}`)
              } catch {
                /* ignore */
              }
              syncCompetitors.mutate(undefined, {
                onSuccess: (res) =>
                  toast.success(t('reports_hub.competitors.sync_done', { count: res.snapshots })),
                onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
              })
            }}
            disabled={syncCompetitors.isPending}
            className="bg-brand-navy hover:bg-brand-navy/90 inline-flex h-9 items-center gap-1.5 rounded-md px-3 text-xs font-semibold text-white transition-colors disabled:cursor-not-allowed disabled:opacity-60"
          >
            {syncCompetitors.isPending ? (
              <Loader2 className="size-3.5 animate-spin" strokeWidth={2.5} />
            ) : null}
            {syncCompetitors.isPending
              ? t('reports_hub.competitors.sync_running')
              : t('reports_hub.competitors.sync_now')}
          </button>
        </div>
      ) : null}

      {/* Avg-by-service для AI payload (используется в runAi). */}
      <div className="hidden">
        {rows.map((r) => (
          <span key={`${r.competitorId}-${r.service.name}`}>
            {avgSlotsByService.get(r.service.name) ?? 0}
          </span>
        ))}
      </div>
    </div>
  )
}

// =============================================================================
// PricesTable — матчинг наших услуг с услугами конкурентов через fuzzy-name.
// =============================================================================

/** Очень лёгкий стемминг PL/RU/EN — нужен чтобы матч ловил словоформы
 *  «hybrydowy / hybrydowym / hybrydowa» как одно слово. Не лингвистический,
 *  но для услуг салонной индустрии — достаточно. */
function stemToken(t: string): string {
  // Польские/русские/английские флексии (по убыванию длины — длинные первыми).
  const suffixes = [
    'iego',
    'ego',
    'iej',
    'emu',
    'iego',
    'ego',
    'ymi',
    'imi',
    'ami',
    'ach',
    'ich',
    'ych',
    'ego',
    'ach',
    'ące',
    'owy',
    'owa',
    'owe',
    'ova',
    'owej',
    'ской',
    'ская',
    'ское',
    'ского',
    'ская',
    'ние',
    'ние',
    'ение',
    'ation',
    'ing',
    'ные',
    'ных',
    'ным',
    'ость',
    'енн',
    'ова',
    'ово',
    'ovy',
    'owy',
    'ymi',
    'ie',
    'ym',
    'em',
    'mi',
    'ej',
    'ą',
    'om',
    'ów',
    'aj',
    'ay',
    'ия',
    'ой',
    'ою',
    'ые',
    'ый',
    'ая',
    'ое',
    'ev',
    'ev',
    'er',
    'es',
    'ed',
    'a',
    'e',
    'i',
    'o',
    'u',
    'y',
  ]
  if (t.length <= 4) return t
  for (const suf of suffixes) {
    if (t.length - suf.length >= 4 && t.endsWith(suf)) {
      return t.slice(0, t.length - suf.length)
    }
  }
  return t
}

/** Нормализация имени услуги для матча: lowercase, заменяем диакритику,
 * выкидываем не-буквенные символы и стоп-слова, потом стеммим. */
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
    'innej',
    'inny',
    'inn',
    'stylistce',
    'stylistki',
    'stylist',
    'mast',
  ])
  return stripDiacritics
    .toLowerCase()
    .replace(/[^a-zа-яёії\s+]/giu, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOP.has(w))
    .map(stemToken)
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
  parent_name?: string
  price_cents: number
  original_price_cents?: number
  discount_pct?: number | null
  duration_min?: number
}

type CompetitorMatch = {
  competitorId: string
  competitorName: string
  /** Анкорный variant из AI-матчинга (или fuzzy fallback). */
  service: CompetitorService
  /** Если у конкурента несколько variants одной услуги (по мастерам/тарифам) —
   *  показываем диапазон min-max финальных клиентских цен. */
  priceMin: number
  priceMax: number
  variantCount: number
}

type PriceMatchRow = {
  ownService: {
    id: string
    name: string
    /** Min цена среди нашего варианта (если у нас несколько услуг с тем же именем). */
    price_cents: number
    /** Max цена среди наших вариантов с тем же именем. */
    price_max_cents: number
    /** Сколько наших услуг с этим именем (1 если уникальное). */
    own_variant_count: number
    duration_min: number
  }
  matches: CompetitorMatch[]
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
              parent_name: typeof v.parent_name === 'string' ? v.parent_name : undefined,
              price_cents: v.price_cents,
              original_price_cents:
                typeof v.original_price_cents === 'number' ? v.original_price_cents : undefined,
              discount_pct: typeof v.discount_pct === 'number' ? v.discount_pct : null,
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

  // Авто-trigger AI-матчинга: если для текущего cacheKey ещё нет cached
  // результата — запускаем матч в фоне один раз. Ранее пользователь жал
  // кнопку «ИИ-матчинг» — теперь это происходит автоматически.
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
    // Если есть конкуренты + наши услуги — старт автоматически.
    if (competitors.length === 0) return
    const our_services_count = ownServices.filter(
      (s) => !s.is_archived && (!watchedNames || watchedNames.has(s.name)),
    ).length
    if (our_services_count === 0) return
    // Не запускаем повторно — флаг inFlight по cacheKey.
    const flightKey = `${cacheKey}:inflight`
    try {
      if (sessionStorage.getItem(flightKey)) return
      sessionStorage.setItem(flightKey, '1')
    } catch {
      /* ignore */
    }
    runAiMatch(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cacheKey])

  function runAiMatch(silent = false) {
    const our_services = ownServices
      .filter((s) => !s.is_archived && (!watchedNames || watchedNames.has(s.name)))
      .map((s) => s.name)
    if (our_services.length === 0) {
      if (!silent) toast.error(t('reports_hub.competitors.no_services_to_match'))
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
              sessionStorage.removeItem(`${cacheKey}:inflight`)
            } catch {
              /* quota → пофиг */
            }
          }
          if (!silent) {
            toast.success(t('reports_hub.competitors.ai_match_done', { count: matches.length }))
          }
        },
        onError: (e) => {
          if (cacheKey) {
            try {
              sessionStorage.removeItem(`${cacheKey}:inflight`)
            } catch {
              /* ignore */
            }
          }
          if (!silent) toast.error(e instanceof Error ? e.message : String(e))
          else console.warn('auto AI-match failed:', e)
        },
      },
    )
  }

  const rows = useMemo<PriceMatchRow[]>(() => {
    const result: PriceMatchRow[] = []

    /** Группа variants одной услуги у одного конкурента: min-max финальных цен. */
    function buildMatch(
      competitor: { id: string; name: string },
      anchor: CompetitorService,
      allVariants: CompetitorService[],
    ): CompetitorMatch {
      const groupKey = anchor.parent_name ?? anchor.name
      // Берём все variants, имеющие тот же parent_name (или совпадающее name —
      // если parent_name не пришёл, как со старых snapshot'ов).
      const siblings = allVariants.filter((v) => (v.parent_name ?? v.name) === groupKey)
      const prices = (siblings.length > 0 ? siblings : [anchor]).map((s) => s.price_cents)
      return {
        competitorId: competitor.id,
        competitorName: competitor.name,
        service: anchor,
        priceMin: Math.min(...prices),
        priceMax: Math.max(...prices),
        variantCount: siblings.length || 1,
      }
    }

    // Дедупим наши услуги по имени: если у юзера два «Laminacja brwi»
    // (разные мастера / категории), сворачиваем в одну строку с диапазоном цен.
    const byName = new Map<
      string,
      {
        ids: string[]
        prices: number[]
        durations: number[]
        firstId: string
      }
    >()
    for (const ownSvc of ownServices) {
      if (ownSvc.is_archived) continue
      if (watchedNames && !watchedNames.has(ownSvc.name)) continue
      const key = ownSvc.name
      const cur = byName.get(key) ?? { ids: [], prices: [], durations: [], firstId: ownSvc.id }
      cur.ids.push(ownSvc.id)
      cur.prices.push(ownSvc.default_price_cents)
      if (ownSvc.default_duration_min) cur.durations.push(ownSvc.default_duration_min)
      byName.set(key, cur)
    }

    for (const [name, group] of byName.entries()) {
      const matches: CompetitorMatch[] = []

      // Если есть AI-матчинг — используем его. Иначе fallback на fuzzy Jaccard.
      const aiForThis = aiMatches?.find((m) => m.our_service === name)
      if (aiForThis) {
        for (const cm of aiForThis.competitors) {
          if (cm.confidence === 'low') continue
          const compServices = competitorServices.get(cm.competitor_id) ?? []
          const svc = compServices.find((s) => s.name === cm.competitor_service)
          if (!svc) continue
          const comp = competitors.find((c) => c.id === cm.competitor_id)
          if (!comp) continue
          matches.push(buildMatch(comp, svc, compServices))
        }
      } else {
        const ownTokens = normalizeServiceName(name)
        for (const c of competitors) {
          const list = competitorServices.get(c.id) ?? []
          let best: { score: number; svc: CompetitorService } | null = null
          for (const svc of list) {
            const sim = tokenSimilarity(ownTokens, normalizeServiceName(svc.name))
            if (sim >= 0.3 && (!best || sim > best.score)) best = { score: sim, svc }
          }
          if (best) matches.push(buildMatch(c, best.svc, list))
        }
      }

      const allPrices: number[] = []
      for (const m of matches) {
        allPrices.push(m.priceMin)
        if (m.priceMax !== m.priceMin) allPrices.push(m.priceMax)
      }
      const min = allPrices.length > 0 ? Math.min(...allPrices) : null
      const max = allPrices.length > 0 ? Math.max(...allPrices) : null
      const avg =
        allPrices.length > 0 ? allPrices.reduce((s, x) => s + x, 0) / allPrices.length : null
      const ownMin = Math.min(...group.prices)
      const ownMax = Math.max(...group.prices)
      const ownAvgForDiff = (ownMin + ownMax) / 2
      const diffPct =
        avg != null && avg > 0 ? Math.round(((ownAvgForDiff - avg) / avg) * 100) : null
      result.push({
        ownService: {
          id: group.firstId,
          name,
          price_cents: ownMin,
          price_max_cents: ownMax,
          own_variant_count: group.ids.length,
          duration_min: group.durations[0] ?? 0,
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

  // Helper для service URL у конкурента — пока нет deep-link на конкретный
  // service в Booksy/Google, ведём на главную страницу салона.
  function competitorServiceUrl(competitorId: string): string | null {
    const c = competitors.find((x) => x.id === competitorId)
    return c?.booksy_url ?? c?.google_place_url ?? null
  }

  return (
    <div className="flex flex-col gap-3">
      {/* AI наверху — collapsed pill «Показать» */}
      <AiReportPanel
        insights={insights}
        isLoading={refresh.isPending}
        onShow={runAi}
        hint={t('reports_hub.competitors.ai_prices_hint')}
      />

      {/* Визуально таблица разбита на три «блока»:
            1) НАШ САЛОН — sage-soft tint (наша услуга + цена)
            2) КОНКУРЕНТЫ — каждая колонка с лёгким accent-tint + бордером слева
            3) ИТОГ — диапазон / средний / разница, neutral muted
          Это даёт глазу опору при горизонтальном чтении. */}
      <div className="border-border bg-card shadow-finsm overflow-x-auto rounded-lg border">
        <table className="w-full min-w-[760px] text-sm">
          <colgroup>
            <col />
            <col className="bg-brand-sage-soft/15" />
            {competitors.map((_, i) => (
              <col key={i} className={i % 2 === 0 ? 'bg-sky-50/60' : 'bg-amber-50/60'} />
            ))}
            <col className="bg-muted/15" />
            <col className="bg-muted/15" />
            <col className="bg-muted/15" />
          </colgroup>
          <thead className="bg-muted/40 text-muted-foreground text-[11px] uppercase tracking-wider">
            {/* Двух-уровневый header: верх группирует «Наш салон» / «Конкуренты» /
                «Итог». Низ — отдельные колонки. */}
            <tr className="border-b">
              <th rowSpan={2} className="border-border/40 border-r px-4 py-2 text-left font-bold">
                {t('reports_hub.competitors.col_service')}
              </th>
              <th
                rowSpan={2}
                className="border-border/40 bg-brand-sage-soft/30 text-brand-sage-deep border-r px-3 py-2 text-right font-bold"
              >
                {t('reports_hub.competitors.col_our_price')}
              </th>
              <th
                colSpan={competitors.length}
                className="border-border/40 text-foreground border-r px-3 py-2 text-center font-bold"
              >
                {t('reports_hub.competitors.col_group_competitors')}
              </th>
              <th colSpan={3} className="text-foreground px-3 py-2 text-center font-bold">
                {t('reports_hub.competitors.col_group_summary')}
              </th>
            </tr>
            <tr className="border-b">
              {competitors.map((c, i) => (
                <th
                  key={c.id}
                  className={cn(
                    'border-border/40 border-l px-3 py-2 text-right font-semibold',
                    i === competitors.length - 1 && 'border-r',
                  )}
                  title={c.name}
                >
                  <span className="inline-block max-w-[140px] truncate align-middle">{c.name}</span>
                </th>
              ))}
              <th className="px-3 py-2 text-right font-semibold">
                {t('reports_hub.competitors.col_competitor_range')}
              </th>
              <th className="px-3 py-2 text-right font-semibold">
                {t('reports_hub.competitors.col_competitor_avg')}
              </th>
              <th className="px-3 py-2 text-right font-semibold">
                {t('reports_hub.competitors.col_diff_pct')}
              </th>
            </tr>
          </thead>
          <tbody className="divide-border divide-y">
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={5 + competitors.length}
                  className="text-muted-foreground px-5 py-12 text-center text-sm"
                >
                  {t('reports_hub.competitors.no_services_to_compare')}
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.ownService.id}>
                  <td className="border-border/40 text-foreground border-r px-4 py-3 font-semibold">
                    {r.ownService.name}
                    {r.matches.length === 0 ? (
                      <span className="text-muted-foreground/60 ml-2 text-[10px] font-normal italic">
                        {t('reports_hub.competitors.no_match')}
                      </span>
                    ) : null}
                  </td>
                  <td className="num border-border/40 text-foreground border-r px-3 py-3 text-right font-bold">
                    {r.ownService.own_variant_count > 1
                      ? `${formatCurrency(r.ownService.price_cents, currency, locale)} – ${formatCurrency(r.ownService.price_max_cents, currency, locale)}`
                      : formatCurrency(r.ownService.price_cents, currency, locale)}
                    {r.ownService.own_variant_count > 1 ? (
                      <span className="text-muted-foreground/60 ml-1 text-[10px]">
                        {' '}
                        ×{r.ownService.own_variant_count}
                      </span>
                    ) : null}
                  </td>
                  {competitors.map((c, idx) => {
                    const m = r.matches.find((x) => x.competitorId === c.id)
                    const cellBorder = cn(
                      'border-border/40 border-l px-3 py-3 text-right',
                      idx === competitors.length - 1 && 'border-r',
                    )
                    if (!m) {
                      return (
                        <td key={c.id} className={cn(cellBorder, 'text-muted-foreground/40')}>
                          —
                        </td>
                      )
                    }
                    const url = competitorServiceUrl(c.id)
                    const hasRange = m.priceMax > m.priceMin
                    const hasDiscount =
                      typeof m.service.discount_pct === 'number' &&
                      m.service.discount_pct > 0 &&
                      typeof m.service.original_price_cents === 'number' &&
                      m.service.original_price_cents > m.service.price_cents
                    return (
                      <td key={c.id} className={cn(cellBorder, 'num text-foreground')}>
                        <div className="flex flex-col items-end">
                          {hasDiscount && !hasRange ? (
                            <span className="text-muted-foreground/60 text-[10px] line-through">
                              {formatCurrency(
                                m.service.original_price_cents as number,
                                currency,
                                locale,
                              )}
                            </span>
                          ) : null}
                          <span className="inline-flex items-center justify-end gap-1.5 font-semibold">
                            {hasRange
                              ? `${formatCurrency(m.priceMin, currency, locale)} – ${formatCurrency(m.priceMax, currency, locale)}`
                              : formatCurrency(m.service.price_cents, currency, locale)}
                            {url ? (
                              <a
                                href={url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-muted-foreground hover:text-foreground"
                                title={t('reports_hub.competitors.open_competitor', {
                                  name: c.name,
                                })}
                              >
                                <Eye className="size-3" strokeWidth={2} />
                              </a>
                            ) : null}
                          </span>
                          {m.variantCount > 1 ? (
                            <span className="text-muted-foreground/60 text-[10px]">
                              {t('reports_hub.competitors.variants_count', {
                                count: m.variantCount,
                              })}
                            </span>
                          ) : null}
                        </div>
                      </td>
                    )
                  })}
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
    </div>
  )
}
