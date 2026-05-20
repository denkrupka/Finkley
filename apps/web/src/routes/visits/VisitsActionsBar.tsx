import { CalendarDays, List, RefreshCw, Upload } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'

import { useBooksySync, useSalonIntegrations } from '@/hooks/useIntegrations'
import { cn } from '@/lib/utils/cn'

import { ExportVisitsButton } from './ExportVisitsButton'

/**
 * Action-кнопки страницы Визитов: Синк Booksy / Импорт CSV /
 * переключатель Список|Календарь. Вынесено из VisitsPage в отдельный
 * компонент чтобы можно было рендерить как в собственном header
 * (standalone /visits), так и в rightSlot PageTabsNav родительской
 * страницы /income (Image #54).
 */
export function VisitsActionsBar() {
  const { t } = useTranslation()
  const { salonId } = useParams<{ salonId: string }>()
  const [params, setParams] = useSearchParams()
  const view = params.get('view') === 'list' ? 'list' : 'calendar'

  const { data: integrations = [] } = useSalonIntegrations(salonId)
  const booksy = integrations.find((i) => i.provider === 'booksy')
  const booksyConnected = booksy?.status === 'connected'
  const sync = useBooksySync(salonId)

  function setView(v: 'list' | 'calendar') {
    const next = new URLSearchParams(params)
    if (v === 'list') next.set('view', 'list')
    else next.delete('view')
    setParams(next, { replace: true })
  }

  async function handleSync() {
    if (!booksyConnected) {
      toast.error(t('visits.sync_not_connected'))
      return
    }
    const toastId = toast.loading(t('visits.sync_in_progress'))
    try {
      const stats = (await sync.mutateAsync()) as {
        visits_synced?: number
        reservations_synced?: number
      }
      toast.success(
        t('visits.sync_done', {
          visits: stats.visits_synced ?? 0,
          reservations: stats.reservations_synced ?? 0,
        }),
        { id: toastId },
      )
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      toast.error(`${t('visits.sync_failed')}: ${msg}`, { id: toastId })
    }
  }

  return (
    <div className="flex items-center gap-2">
      {booksy && (
        <button
          type="button"
          onClick={handleSync}
          disabled={sync.isPending}
          className="border-border bg-card hover:bg-muted/40 inline-flex h-9 items-center gap-1.5 rounded-md border px-3 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60"
          title={t('visits.sync_now')}
        >
          <RefreshCw
            className={cn('size-3.5', sync.isPending && 'animate-spin')}
            strokeWidth={1.8}
          />
          <span className="hidden sm:inline">{t('visits.sync_now')}</span>
          <span className="sm:hidden">{t('visits.sync_now_short')}</span>
        </button>
      )}
      <ExportVisitsButton />
      <Link
        to={`/${salonId}/settings/import`}
        className="border-border bg-card hover:bg-muted/40 inline-flex h-9 items-center gap-1.5 rounded-md border px-3 text-xs font-semibold transition-colors"
        title={t('visits.import_csv')}
      >
        <Upload className="size-3.5" strokeWidth={1.8} />
        <span className="hidden sm:inline">{t('visits.import_csv')}</span>
      </Link>
      <div className="border-border bg-card inline-flex rounded-md border p-0.5">
        <button
          type="button"
          onClick={() => setView('list')}
          className={cn(
            'inline-flex items-center gap-1 rounded-sm px-2.5 py-1 text-xs font-semibold transition-colors',
            view === 'list'
              ? 'bg-primary text-primary-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          <List className="size-3.5" strokeWidth={1.8} />
          <span className="hidden sm:inline">{t('visits.view.list')}</span>
        </button>
        <button
          type="button"
          onClick={() => setView('calendar')}
          className={cn(
            'inline-flex items-center gap-1 rounded-sm px-2.5 py-1 text-xs font-semibold transition-colors',
            view === 'calendar'
              ? 'bg-primary text-primary-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          <CalendarDays className="size-3.5" strokeWidth={1.8} />
          <span className="hidden sm:inline">{t('visits.view.calendar')}</span>
        </button>
      </div>
    </div>
  )
}
