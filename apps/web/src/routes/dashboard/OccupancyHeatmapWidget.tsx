import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { useVisitsHeatmap, type HeatmapCell } from '@/hooks/useAnalytics'
import { useSalon } from '@/hooks/useSalons'

/**
 * bug 4fc86f35 — «График Загрузка по дням и часам перенести на главный
 * дашборд». Widget показывает heatmap визитов за последние 30 дней.
 */
const WEEKDAYS_MON_FIRST: { dow: number; key: string }[] = [
  { dow: 1, key: 'reports.weekday.mon' },
  { dow: 2, key: 'reports.weekday.tue' },
  { dow: 3, key: 'reports.weekday.wed' },
  { dow: 4, key: 'reports.weekday.thu' },
  { dow: 5, key: 'reports.weekday.fri' },
  { dow: 6, key: 'reports.weekday.sat' },
  { dow: 0, key: 'reports.weekday.sun' },
]

const BUSINESS_HOURS = Array.from({ length: 14 }, (_, i) => i + 8)

export function OccupancyHeatmapWidget({ salonId }: { salonId: string }) {
  const { t } = useTranslation()
  const { data: salon } = useSalon(salonId)
  const timezone = salon?.timezone ?? 'Europe/Warsaw'
  const end = useMemo(() => new Date(), [])
  const start = useMemo(() => {
    const d = new Date(end)
    d.setDate(d.getDate() - 30)
    return d
  }, [end])
  const heatmap = useVisitsHeatmap(salonId, start.toISOString(), end.toISOString(), timezone)
  const cells: HeatmapCell[] = useMemo(() => heatmap.data ?? [], [heatmap.data])
  const cellMap = useMemo(() => {
    const m = new Map<string, number>()
    for (const c of cells) m.set(`${c.dow}:${c.hour_of_day}`, c.visits_count)
    return m
  }, [cells])
  const maxCount = Math.max(1, ...cells.map((c) => c.visits_count))

  return (
    <div className="border-border bg-card shadow-finsm rounded-lg border p-4">
      <h2 className="text-brand-navy mb-3 text-sm font-bold uppercase tracking-wider">
        {t('dashboard.heatmap.title')}
      </h2>
      {cells.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t('dashboard.heatmap.empty')}</p>
      ) : (
        <div className="overflow-x-auto">
          <div
            className="grid gap-0.5"
            style={{
              gridTemplateColumns: `48px repeat(${BUSINESS_HOURS.length}, minmax(20px, 1fr))`,
            }}
          >
            <div />
            {BUSINESS_HOURS.map((h) => (
              <div
                key={`h-${h}`}
                className="text-muted-foreground text-center text-[10px] font-semibold"
              >
                {h}
              </div>
            ))}
            {WEEKDAYS_MON_FIRST.map((wd) => (
              <Row
                key={wd.dow}
                label={t(wd.key)}
                cells={BUSINESS_HOURS.map((h) => cellMap.get(`${wd.dow}:${h}`) ?? 0)}
                max={maxCount}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function Row({ label, cells, max }: { label: string; cells: number[]; max: number }) {
  return (
    <>
      <div className="text-muted-foreground py-1 pr-2 text-right text-[11px] font-semibold">
        {label}
      </div>
      {cells.map((count, i) => {
        const intensity = count / max
        const bg = count === 0 ? 'transparent' : `rgba(28, 30, 79, ${0.15 + intensity * 0.7})`
        return (
          <div
            key={i}
            className="border-border h-6 rounded-sm border text-center"
            style={{ background: bg }}
            title={count ? `${count}` : ''}
          >
            {count > 0 ? (
              <span
                className={`num text-[10px] font-bold ${intensity > 0.5 ? 'text-white' : 'text-brand-navy'}`}
              >
                {count}
              </span>
            ) : null}
          </div>
        )
      })}
    </>
  )
}
