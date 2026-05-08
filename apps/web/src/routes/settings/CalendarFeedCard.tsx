import { Calendar, Copy, Loader2, RotateCcw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useParams } from 'react-router-dom'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { useCalendarToken, useRevokeCalendarToken } from '@/hooks/useForecastAndCalendar'

const FEED_BASE = `${import.meta.env.VITE_SUPABASE_URL?.replace('.supabase.co', '.functions.supabase.co')}/calendar-feed`

export function CalendarFeedCard() {
  const { t } = useTranslation()
  const { salonId } = useParams<{ salonId: string }>()
  const { data: token, isLoading } = useCalendarToken(salonId)
  const revoke = useRevokeCalendarToken(salonId)

  if (!salonId) return null

  const url = token ? `${FEED_BASE}?token=${encodeURIComponent(token)}` : null

  return (
    <section className="border-border bg-card shadow-finsm rounded-lg border p-5">
      <div className="flex items-start gap-3">
        <span
          className="bg-brand-teal-soft text-brand-teal-deep grid size-9 shrink-0 place-items-center rounded-md"
          aria-hidden
        >
          <Calendar className="size-4" strokeWidth={1.8} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-brand-navy text-base font-bold">{t('settings.calendar.title')}</h2>
          <p className="text-muted-foreground mt-1 text-sm leading-snug">
            {t('settings.calendar.subtitle')}
          </p>
        </div>
      </div>

      <div className="mt-4">
        {isLoading ? (
          <Loader2 className="text-muted-foreground size-4 animate-spin" />
        ) : url ? (
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <code className="border-border bg-muted/40 num text-foreground/80 flex-1 truncate rounded-md border px-3 py-2 text-xs">
                {url}
              </code>
              <Button
                variant="outline"
                size="md"
                onClick={() => {
                  navigator.clipboard.writeText(url)
                  toast.success(t('settings.calendar.toast_copied'))
                }}
              >
                <Copy className="size-4" strokeWidth={1.8} />
                {t('settings.calendar.copy')}
              </Button>
            </div>
            <p className="text-muted-foreground text-xs">{t('settings.calendar.how_to')}</p>
            <button
              type="button"
              onClick={() => {
                if (!confirm(t('settings.calendar.confirm_revoke'))) return
                revoke.mutate(undefined, {
                  onSuccess: () => toast.success(t('settings.calendar.toast_revoked')),
                })
              }}
              disabled={revoke.isPending}
              className="text-muted-foreground hover:text-destructive inline-flex items-center gap-1 self-start text-xs underline disabled:opacity-50"
            >
              <RotateCcw className="size-3.5" strokeWidth={1.7} />
              {t('settings.calendar.revoke')}
            </button>
          </div>
        ) : null}
      </div>
    </section>
  )
}
