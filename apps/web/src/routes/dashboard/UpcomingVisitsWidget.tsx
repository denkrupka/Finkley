import { CalendarClock } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { useUpcomingTemplates } from '@/hooks/useVisitTemplates'

/**
 * Виджет «Скоро придут» — клиенты, у которых есть recurring-шаблон визита
 * с next_due_at в ближайшие 7 дней. Помогает владельцу не забыть напомнить.
 */
export function UpcomingVisitsWidget({ salonId }: { salonId: string }) {
  const { t } = useTranslation()
  const { data: upcoming = [] } = useUpcomingTemplates(salonId, 7)

  return (
    <div className="border-border bg-card shadow-finsm rounded-lg border p-4">
      <div className="mb-2 flex items-center gap-2">
        <CalendarClock className="text-brand-teal-deep size-4" strokeWidth={2} />
        <p className="text-muted-foreground text-[11px] font-bold uppercase tracking-wider">
          {t('dashboard.upcoming.title')}
        </p>
      </div>
      {upcoming.length === 0 ? (
        <p className="text-muted-foreground text-xs">{t('dashboard.upcoming.empty')}</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {upcoming.slice(0, 4).map((u) => (
            <li key={u.id} className="flex items-center justify-between gap-2 text-sm">
              <span className="text-foreground truncate font-semibold">{u.client_name}</span>
              <span
                className={`shrink-0 text-xs ${
                  u.days_until <= 0
                    ? 'text-destructive font-bold'
                    : u.days_until <= 2
                      ? 'font-semibold text-amber-600'
                      : 'text-muted-foreground'
                }`}
              >
                {u.days_until <= 0
                  ? t('dashboard.upcoming.overdue', { count: Math.abs(u.days_until) })
                  : t('dashboard.upcoming.in_days', { count: u.days_until })}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
