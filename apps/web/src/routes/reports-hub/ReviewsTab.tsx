import { format, parseISO } from 'date-fns'
import { Eye, MessageCircle, Star } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Input } from '@/components/ui/input'
import { PageTabsNav, type PageTab } from '@/components/ui/PageTabsNav'
import { useReviews, useReviewsImport, useMarkReviewRead } from '@/hooks/useReviews'
import { cn } from '@/lib/utils/cn'
import { getDateLocale } from '@/lib/utils/format-date'

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

export function ReviewsTab({ salonId }: { salonId: string }) {
  const { t } = useTranslation()
  const [sub, setSub] = useState<ReviewsSubTab>('external')
  const [search, setSearch] = useState('')
  const { data: rows = [], isLoading } = useReviews(salonId)
  const markRead = useMarkReviewRead(salonId)

  const filtered = useMemo(() => {
    let r = rows
    if (sub === 'external') r = r.filter((x) => x.source !== 'internal')
    else r = r.filter((x) => x.source === 'internal')
    const q = search.trim().toLowerCase()
    if (q) {
      r = r.filter(
        (x) =>
          (x.body ?? '').toLowerCase().includes(q) ||
          (x.author_name ?? '').toLowerCase().includes(q),
      )
    }
    return r
  }, [rows, sub, search])

  const negativeUnread =
    sub === 'external'
      ? rows.filter((r) => r.source !== 'internal' && (r.rating ?? 0) < 5 && !r.read_at)
      : []

  return (
    <div>
      <PageTabsNav tabs={SUB_TABS} active={sub} onChange={setSub} t={t} />

      <div className="mb-3 mt-4 flex items-center justify-between gap-3">
        <Input
          placeholder={t('reports_hub.reviews.search_placeholder')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-sm"
        />
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
          <div className="divide-border divide-y">
            {filtered.map((r) => (
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
        )}
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
        <span className="text-muted-foreground text-[10px] uppercase tracking-wide">
          {review.source}
        </span>
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

// Кнопка импорта с Booksy/Google — пока stub.
export function ReviewsImportButton({ salonId }: { salonId: string }) {
  const { t } = useTranslation()
  const importMutation = useReviewsImport(salonId)
  return (
    <button
      type="button"
      onClick={() => {
        importMutation.mutate(undefined, {
          onSuccess: (n) => toast.success(t('reports_hub.reviews.imported', { count: n })),
          onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
        })
      }}
      className="text-secondary inline-flex items-center gap-1 text-xs font-semibold hover:underline"
    >
      {t('reports_hub.reviews.import_button')}
    </button>
  )
}
