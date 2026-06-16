import { Clock, Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useParams } from 'react-router-dom'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useUpdateSalon } from '@/hooks/useSalonMutations'
import { useSalon } from '@/hooks/useSalons'
import {
  DAY_KEYS_ORDERED,
  DEFAULT_OPENING_HOURS,
  type DayKey,
  type OpeningHours,
} from '@/hooks/useSalonHours'

const DAY_LABELS: Record<DayKey, string> = {
  mon: 'Пн',
  tue: 'Вт',
  wed: 'Ср',
  thu: 'Чт',
  fri: 'Пт',
  sat: 'Сб',
  sun: 'Вс',
}

/**
 * График работы салона по дням недели. JSONB в salons.opening_hours.
 * Используется календарём резерваций для штриховки нерабочего времени
 * (см. VisitsCalendarView).
 *
 * Раньше жил вместе с праздниками в OpeningHoursCard на вкладке «Профиль»;
 * по запросу владельца разнесён на отдельные подвкладки в Settings →
 * «График работы» (SalonHoursCard + SalonHolidaysCard).
 */
export function SalonHoursCard() {
  const { t } = useTranslation()
  const { salonId } = useParams<{ salonId: string }>()
  const { data: salon } = useSalon(salonId)
  const update = useUpdateSalon()

  const [hours, setHours] = useState<OpeningHours>(DEFAULT_OPENING_HOURS)

  useEffect(() => {
    if (salon?.opening_hours) {
      setHours(salon.opening_hours as OpeningHours)
    } else {
      setHours(DEFAULT_OPENING_HOURS)
    }
  }, [salon])

  function patchDay(day: DayKey, patch: Partial<OpeningHours[DayKey]>) {
    setHours((prev) => ({ ...prev, [day]: { ...prev[day], ...patch } }))
  }

  function saveHours() {
    if (!salonId) return
    update.mutate(
      { id: salonId, opening_hours: hours },
      {
        onSuccess: () => toast.success(t('settings.opening_hours.toast_saved')),
        onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
      },
    )
  }

  return (
    <section className="border-border bg-card shadow-finsm rounded-lg border p-5 sm:p-6">
      <div className="mb-4 flex items-center gap-2">
        <Clock className="text-brand-teal size-5" strokeWidth={1.8} />
        <h2 className="text-brand-navy text-base font-bold tracking-tight">
          {t('settings.opening_hours.title')}
        </h2>
      </div>
      <p className="text-muted-foreground mb-2 text-sm">{t('settings.opening_hours.subtitle')}</p>
      <p className="text-muted-foreground border-brand-teal-deep/40 bg-brand-teal-soft/15 mb-4 rounded-md border-l-2 px-3 py-2 text-xs">
        {t('settings.opening_hours.master_note', {
          defaultValue:
            'Это график салона — для клиентов и расчёта загрузки. Он не ограничивает мастеров: у каждого мастера свой график (Мастера → карточка мастера), и принять клиента можно даже когда салон по этому графику закрыт.',
        })}
      </p>

      <div className="border-border bg-muted/10 mb-5 overflow-hidden rounded-md border">
        <table className="w-full text-sm">
          <thead className="border-border border-b">
            <tr className="text-muted-foreground text-left text-[11px] font-semibold uppercase tracking-wider">
              <th className="w-16 px-3 py-2">{t('settings.opening_hours.col_day')}</th>
              <th className="px-3 py-2 text-center">{t('settings.opening_hours.col_closed')}</th>
              <th className="px-3 py-2">{t('settings.opening_hours.col_open')}</th>
              <th className="px-3 py-2">{t('settings.opening_hours.col_close')}</th>
            </tr>
          </thead>
          <tbody className="divide-border divide-y">
            {DAY_KEYS_ORDERED.map((day) => {
              const cfg = hours[day] ?? {}
              const closed = !!cfg.closed
              return (
                <tr key={day} className={closed ? 'bg-muted/20 opacity-60' : ''}>
                  <td className="text-foreground px-3 py-2 text-sm font-bold">{DAY_LABELS[day]}</td>
                  <td className="px-3 py-2 text-center">
                    <input
                      type="checkbox"
                      checked={closed}
                      onChange={(e) =>
                        patchDay(day, e.target.checked ? { closed: true } : { closed: false })
                      }
                      className="size-4 accent-amber-500"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <Input
                      type="time"
                      value={cfg.open ?? '09:00'}
                      onChange={(e) => patchDay(day, { open: e.target.value })}
                      disabled={closed}
                      className="num h-9 max-w-[140px]"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <Input
                      type="time"
                      value={cfg.close ?? '20:00'}
                      onChange={(e) => patchDay(day, { close: e.target.value })}
                      disabled={closed}
                      className="num h-9 max-w-[140px]"
                    />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="flex justify-end">
        <Button onClick={saveHours} disabled={update.isPending}>
          {update.isPending ? <Loader2 className="size-4 animate-spin" strokeWidth={2} /> : null}
          {t('settings.opening_hours.save_hours')}
        </Button>
      </div>
    </section>
  )
}
