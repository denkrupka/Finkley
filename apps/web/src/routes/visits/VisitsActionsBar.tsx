import { CalendarDays, List, Upload } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link, useParams, useSearchParams } from 'react-router-dom'

import { cn } from '@/lib/utils/cn'

import { ExportVisitsButton } from './ExportVisitsButton'

/**
 * Action-кнопки страницы Визитов: Импорт CSV / переключатель Список|Календарь.
 * Вынесено из VisitsPage в отдельный компонент чтобы можно было рендерить
 * как в собственном header (standalone /visits), так и в rightSlot PageTabsNav
 * родительской страницы /income (Image #54).
 */
export function VisitsActionsBar() {
  const { t } = useTranslation()
  const { salonId } = useParams<{ salonId: string }>()
  const [params, setParams] = useSearchParams()
  const view = params.get('view') === 'list' ? 'list' : 'calendar'

  function setView(v: 'list' | 'calendar') {
    const next = new URLSearchParams(params)
    if (v === 'list') next.set('view', 'list')
    else next.delete('view')
    setParams(next, { replace: true })
  }

  return (
    <div className="flex items-center gap-2">
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
