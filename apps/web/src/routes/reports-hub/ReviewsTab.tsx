import { format, parseISO } from 'date-fns'
import { ChevronLeft, ChevronRight, Eye, MessageCircle, Star } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Input } from '@/components/ui/input'
import { PageTabsNav, type PageTab } from '@/components/ui/PageTabsNav'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useReviews, useReviewsImport, useMarkReviewRead } from '@/hooks/useReviews'
import { cn } from '@/lib/utils/cn'
import { getDateLocale } from '@/lib/utils/format-date'

const PAGE_SIZE = 25

type ReviewSort = 'newest' | 'oldest' | 'rating_asc' | 'rating_desc'

/**
 * /reports → Отзывы.
 * 2 sub-tab:
 *   - external — Booksy + Google импорт + новые негативные (read_at=null, rating<5)
 *   - internal — отзывы пришедшие через FlySMS-flow (/review/:token, rating 1-4)
 */
type ReviewsSubTab = 'external' | 'internal'

const SUB_TABS: PageTab<ReviewsSubTab>[] = [
  { id: 'external', labelKey: 'reports_hub.reviews.tabs.external', icon: Star },
  { id: 'internal', labelKey: 'reports_hub.reviews.tabs.internal', icon: MessageCircle },
]

type SourceFilter = 'all' | 'google' | 'booksy' | 'internal'
type ReadFilter = 'all' | 'unread' | 'read'

export function ReviewsTab({ salonId }: { salonId: string }) {
  const { t } = useTranslation()
  const [sub, setSub] = useState<ReviewsSubTab>('external')
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<ReviewSort>('newest')
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all')
  const [readFilter, setReadFilter] = useState<ReadFilter>('all')
  const [page, setPage] = useState(1)
  const { data: rows = [], isLoading } = useReviews(salonId)
  const markRead = useMarkReviewRead(salonId)
  const importMutation = useReviewsImport(salonId)
  const autoImportedRef = useRef(false)

  // Авто-импорт при первом mount: тянем актуальные отзывы Google+Booksy.
  // Только 1 раз за сессию — повторные открытия страницы не дёргают API.
  useEffect(() => {
    if (autoImportedRef.current || !salonId) return
    autoImportedRef.current = true
    importMutation.mutate(undefined, {
      onError: (e) => {
        // Тихо — авто-импорт не должен бросаться ошибкой в UI.
        console.warn('auto-import failed:', e)
      },
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [salonId])

  // Сброс пагинации при смене фильтров.
  useEffect(() => {
    setPage(1)
  }, [sub, search, sort, sourceFilter, readFilter])

  // KPI по источникам.
  const kpi = useMemo(() => {
    const groups = {
      google: [] as typeof rows,
      booksy: [] as typeof rows,
      internal: [] as typeof rows,
    }
    for (const r of rows) {
      if (r.source === 'google') groups.google.push(r)
      else if (r.source === 'booksy') groups.booksy.push(r)
      else if (r.source === 'internal') groups.internal.push(r)
    }
    function summary(list: typeof rows) {
      const rated = list.filter((x) => x.rating != null)
      const avg =
        rated.length > 0 ? rated.reduce((s, x) => s + (x.rating as number), 0) / rated.length : null
      return {
        count: list.length,
        avg: avg != null ? Math.round(avg * 10) / 10 : null,
      }
    }
    return {
      google: summary(groups.google),
      booksy: summary(groups.booksy),
      internal: summary(groups.internal),
    }
  }, [rows])

  const filtered = useMemo(() => {
    let r = rows
    if (sub === 'external') r = r.filter((x) => x.source !== 'internal')
    else r = r.filter((x) => x.source === 'internal')
    // Источник (вторичный фильтр — work внутри active sub).
    if (sourceFilter !== 'all') {
      r = r.filter((x) => x.source === sourceFilter)
    }
    // Прочитано/Не прочитано.
    if (readFilter === 'unread') r = r.filter((x) => !x.read_at)
    else if (readFilter === 'read') r = r.filter((x) => !!x.read_at)
    const q = search.trim().toLowerCase()
    if (q) {
      r = r.filter(
        (x) =>
          (x.body ?? '').toLowerCase().includes(q) ||
          (x.author_name ?? '').toLowerCase().includes(q),
      )
    }
    // Сортировка. Для rating null трактуем как 0.
    const sorted = [...r]
    sorted.sort((a, b) => {
      if (sort === 'newest') return b.posted_at.localeCompare(a.posted_at)
      if (sort === 'oldest') return a.posted_at.localeCompare(b.posted_at)
      if (sort === 'rating_asc') return (a.rating ?? 0) - (b.rating ?? 0)
      return (b.rating ?? 0) - (a.rating ?? 0)
    })
    return sorted
  }, [rows, sub, search, sort, sourceFilter, readFilter])

  const negativeUnread =
    sub === 'external'
      ? rows.filter((r) => r.source !== 'internal' && (r.rating ?? 0) < 5 && !r.read_at)
      : []

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const pageStart = (page - 1) * PAGE_SIZE
  const pageRows = filtered.slice(pageStart, pageStart + PAGE_SIZE)

  return (
    <div>
      <PageTabsNav tabs={SUB_TABS} active={sub} onChange={setSub} t={t} />

      {/* KPI по источникам — отдельный блок над фильтрами. */}
      <div className="mb-3 mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
        <KpiCard
          label="Booksy"
          rating={kpi.booksy.avg}
          count={kpi.booksy.count}
          color="text-blue-700"
        />
        <KpiCard
          label="Google"
          rating={kpi.google.avg}
          count={kpi.google.count}
          color="text-red-700"
        />
        <KpiCard
          label={t('reports_hub.reviews.tabs.internal')}
          rating={kpi.internal.avg}
          count={kpi.internal.count}
          color="text-brand-sage-deep"
        />
      </div>

      <div className="mb-3 mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
        <Input
          placeholder={t('reports_hub.reviews.search_placeholder')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="sm:max-w-sm"
        />
        <Select value={sort} onValueChange={(v) => setSort(v as ReviewSort)}>
          <SelectTrigger className="sm:w-44" data-testid="reviews-sort">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="newest">{t('reports_hub.reviews.sort.newest')}</SelectItem>
            <SelectItem value="oldest">{t('reports_hub.reviews.sort.oldest')}</SelectItem>
            <SelectItem value="rating_asc">{t('reports_hub.reviews.sort.rating_asc')}</SelectItem>
            <SelectItem value="rating_desc">{t('reports_hub.reviews.sort.rating_desc')}</SelectItem>
          </SelectContent>
        </Select>
        {sub === 'external' ? (
          <Select value={sourceFilter} onValueChange={(v) => setSourceFilter(v as SourceFilter)}>
            <SelectTrigger className="sm:w-40" data-testid="reviews-source-filter">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('reports_hub.reviews.source.all')}</SelectItem>
              <SelectItem value="google">Google</SelectItem>
              <SelectItem value="booksy">Booksy</SelectItem>
            </SelectContent>
          </Select>
        ) : null}
        <Select value={readFilter} onValueChange={(v) => setReadFilter(v as ReadFilter)}>
          <SelectTrigger className="sm:w-40" data-testid="reviews-read-filter">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('reports_hub.reviews.read.all')}</SelectItem>
            <SelectItem value="unread">{t('reports_hub.reviews.read.unread')}</SelectItem>
            <SelectItem value="read">{t('reports_hub.reviews.read.read')}</SelectItem>
          </SelectContent>
        </Select>
        {importMutation.isPending ? (
          <span className="text-muted-foreground text-xs sm:ml-auto">
            {t('reports_hub.reviews.auto_importing')}
          </span>
        ) : null}
      </div>

      {negativeUnread.length > 0 ? (
        <div className="border-destructive/40 bg-destructive/5 mb-4 rounded-lg border p-4">
          <p className="text-destructive text-sm font-bold">
            🚨 {t('reports_hub.reviews.negative_unread_title', { count: negativeUnread.length })}
          </p>
          <div className="mt-3 flex flex-col gap-2">
            {negativeUnread.slice(0, 5).map((r) => (
              <ReviewRow
                key={r.id}
                review={r}
                onMarkRead={() => {
                  markRead.mutate(r.id, {
                    onSuccess: () => toast.success(t('reports_hub.reviews.marked_read')),
                    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
                  })
                }}
                compact
                t={t}
              />
            ))}
          </div>
        </div>
      ) : null}

      <div className="border-border bg-card shadow-finsm overflow-hidden rounded-lg border">
        {isLoading ? (
          <p className="text-muted-foreground px-5 py-8 text-center text-sm">
            {t('common.loading')}
          </p>
        ) : filtered.length === 0 ? (
          <p className="text-muted-foreground px-5 py-12 text-center text-sm">
            {t('reports_hub.reviews.empty')}
          </p>
        ) : (
          <>
            <div className="divide-border divide-y">
              {pageRows.map((r) => (
                <ReviewRow
                  key={r.id}
                  review={r}
                  onMarkRead={() => {
                    markRead.mutate(r.id, {
                      onSuccess: () => toast.success(t('reports_hub.reviews.marked_read')),
                      onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
                    })
                  }}
                  t={t}
                />
              ))}
            </div>
            {totalPages > 1 ? (
              <div className="border-border/40 bg-muted/10 flex items-center justify-between border-t px-4 py-3 text-xs">
                <span className="text-muted-foreground">
                  {t('reports_hub.reviews.pagination_info', {
                    from: pageStart + 1,
                    to: Math.min(pageStart + PAGE_SIZE, filtered.length),
                    total: filtered.length,
                  })}
                </span>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page === 1}
                    className="hover:bg-muted/60 inline-flex size-7 items-center justify-center rounded disabled:cursor-not-allowed disabled:opacity-30"
                  >
                    <ChevronLeft className="size-4" strokeWidth={2} />
                  </button>
                  <span className="text-foreground px-2 font-semibold">
                    {page} / {totalPages}
                  </span>
                  <button
                    type="button"
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={page === totalPages}
                    className="hover:bg-muted/60 inline-flex size-7 items-center justify-center rounded disabled:cursor-not-allowed disabled:opacity-30"
                  >
                    <ChevronRight className="size-4" strokeWidth={2} />
                  </button>
                </div>
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  )
}

function KpiCard({
  label,
  rating,
  count,
  color,
}: {
  label: string
  rating: number | null
  count: number
  color: string
}) {
  return (
    <div className="border-border bg-card shadow-finsm flex items-center justify-between rounded-lg border p-3">
      <span className={cn('text-xs font-bold uppercase tracking-wider', color)}>{label}</span>
      <div className="text-right">
        {rating != null ? (
          <span className="num text-foreground text-base font-bold">⭐ {rating.toFixed(1)}</span>
        ) : (
          <span className="text-muted-foreground/50 text-xs">—</span>
        )}
        <span className="text-muted-foreground num ml-2 text-xs">({count})</span>
      </div>
    </div>
  )
}

function ReviewRow({
  review,
  onMarkRead,
  compact,
  t,
}: {
  review: ReturnType<typeof useReviews>['data'] extends (infer R)[] | undefined ? R : never
  onMarkRead: () => void
  compact?: boolean
  t: (k: string, opts?: Record<string, unknown>) => string
}) {
  return (
    <div
      className={cn(
        'flex items-start gap-3 px-4 py-3',
        compact && 'border-border bg-card rounded-md border',
      )}
    >
      <div className="flex flex-col items-center gap-1">
        <div className="flex">
          {[1, 2, 3, 4, 5].map((n) => (
            <Star
              key={n}
              className={cn(
                'size-3.5',
                n <= (review.rating ?? 0)
                  ? 'text-brand-gold-deep fill-current'
                  : 'text-muted-foreground/30',
              )}
              strokeWidth={1.5}
            />
          ))}
        </div>
        <SourceBadge source={review.source} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <p className="text-foreground text-sm font-semibold">
            {review.author_name ?? t('reports_hub.reviews.anonymous')}
          </p>
          <p className="text-muted-foreground text-[10px]">
            {format(parseISO(review.posted_at), 'd MMM yyyy', { locale: getDateLocale() })}
          </p>
        </div>
        {review.body ? (
          <p className="text-muted-foreground mt-1 text-xs leading-relaxed">{review.body}</p>
        ) : (
          <p className="text-muted-foreground/60 mt-1 text-xs italic">
            {t('reports_hub.reviews.no_text')}
          </p>
        )}
      </div>
      {!review.read_at ? (
        <button
          type="button"
          onClick={onMarkRead}
          className="text-muted-foreground hover:text-foreground inline-flex shrink-0 items-center gap-1 text-[11px] font-semibold underline-offset-2 hover:underline"
        >
          <Eye className="size-3" strokeWidth={2} />
          {t('reports_hub.reviews.mark_read')}
        </button>
      ) : null}
    </div>
  )
}

// ReviewsImportButton удалён: auto-import при mount закрывает потребность.
// Если кому-то понадобится ручной импорт — добавить кнопку обратно.

function SourceBadge({ source }: { source: string }) {
  if (source === 'booksy') {
    return (
      <span
        className="inline-flex h-4 items-center rounded-sm px-1.5 text-[9px] font-extrabold uppercase tracking-wider text-white"
        style={{ background: '#FF5C5C' }}
        title="Booksy"
      >
        Booksy
      </span>
    )
  }
  if (source === 'google') {
    return (
      <span
        className="inline-flex h-4 items-center gap-1 rounded-sm border border-[#dadce0] bg-white px-1.5 text-[9px] font-semibold text-[#3c4043]"
        title="Google"
      >
        <GoogleGlyph />
        <span>Google</span>
      </span>
    )
  }
  return (
    <span
      className="border-border bg-muted/40 text-muted-foreground inline-flex h-4 items-center gap-1 rounded-sm border px-1.5 text-[9px] font-semibold uppercase tracking-wider"
      title="Internal"
    >
      <MessageCircle className="size-2.5" strokeWidth={2.5} />
    </span>
  )
}

function GoogleGlyph() {
  return (
    <svg viewBox="0 0 48 48" width="10" height="10" aria-hidden>
      <path
        fill="#4285F4"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#34A853"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#EA4335"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  )
}
