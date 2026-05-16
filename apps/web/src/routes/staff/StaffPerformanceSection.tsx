import { Medal } from 'lucide-react'
import { useMemo, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { useSalon } from '@/hooks/useSalons'
import { useVisits } from '@/hooks/useVisits'
import { cn } from '@/lib/utils/cn'
import { formatCurrency } from '@/lib/utils/format-currency'

const STAFF_PALETTE = ['#F4D7C5', '#D7E4C5', '#C5DAE4', '#E4C5DC', '#E8C4B8', '#FBE5C0']

type Props = {
  salonId: string
  staff: Array<{
    id: string
    full_name: string
    is_active: boolean
    retention_window_days?: number | null
  }>
  currency: string
  /**
   * Image #116: слот для PeriodPickerPopover (или другого UI), который
   * рендерится справа от заголовка секции «Эффективность мастеров». Контент
   * фактического отчёта пока использует salon retention-window (не period),
   * поэтому слот просто визуальный — но он на месте, как и попросил владелец.
   */
  headerRight?: ReactNode
}

/**
 * «Эффективность мастеров» — подсчёт KPI на лету из visits за последние
 * 30 дней (визиты, выручка, средний чек, уникальных клиентов, ретеншн).
 *
 * Считаем на клиенте, без отдельного RPC: для салона на 5-15 мастеров и
 * сотен визитов в месяц это <50ms работы и не требует server-side aggr.
 *
 * Ретеншн считается грубо: % клиентов мастера, у которых ≥2 визитов за
 * период. Это не совсем то же что «вернулся ли клиент к этому мастеру»,
 * но близкая прокси и не требует полной visit-истории.
 */
export function StaffPerformanceSection({ salonId, staff, currency, headerRight }: Props) {
  const { t } = useTranslation()
  const { data: salon } = useSalon(salonId)
  const salonWindow = salon?.retention_window_days ?? 60

  // Берём максимальное окно ретеншна по всем мастерам (или дефолт салона) —
  // тянем visits за этот период; per-master ретеншн считаем уже из этого
  // выборного диапазона. Если salon=60 а у одного мастера 90 — нужно тянуть 90.
  const lookbackDays = useMemo(
    () => Math.max(salonWindow, ...staff.map((s) => s.retention_window_days ?? 0)),
    [salonWindow, staff],
  )
  const range = useMemo(() => {
    const end = new Date()
    const start = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000)
    return { start: start.toISOString(), end: end.toISOString() }
  }, [lookbackDays])
  const { data: visits = [], isLoading } = useVisits(salonId, range)

  // Группируем визиты по staff_id; KPI считаем внутри render с учётом
  // индивидуального retention-window мастера.
  const visitsByStaff = useMemo(() => {
    const map = new Map<string, typeof visits>()
    for (const v of visits) {
      if (!v.staff_id) continue
      const arr = map.get(v.staff_id) ?? []
      arr.push(v)
      map.set(v.staff_id, arr)
    }
    return map
  }, [visits])

  function statsFor(staffId: string, windowDays: number) {
    const cutoff = Date.now() - windowDays * 24 * 60 * 60 * 1000
    const inWindow = (visitsByStaff.get(staffId) ?? []).filter(
      (v) => new Date(v.visit_at).getTime() >= cutoff,
    )
    const clientVisitCount = new Map<string, number>()
    let revenueCents = 0
    for (const v of inWindow) {
      revenueCents += v.amount_cents
      if (v.client_id)
        clientVisitCount.set(v.client_id, (clientVisitCount.get(v.client_id) ?? 0) + 1)
    }
    return {
      visitCount: inWindow.length,
      revenueCents,
      uniqueClients: clientVisitCount.size,
      returningClients: Array.from(clientVisitCount.values()).filter((n) => n >= 2).length,
    }
  }

  const activeStaff = staff.filter((s) => s.is_active)
  // Total revenue считаем по salon-window для фейр-сравнения (доли мастеров).
  const totalRevenue = activeStaff.reduce(
    (acc, s) => acc + statsFor(s.id, salonWindow).revenueCents,
    0,
  )

  // Image #119: сортируем мастеров по обороту desc — топ зарабатывающие
  // оказываются наверху. Используем salon-window (общее окно), чтобы не
  // искажать порядок индивидуальными ретеншн-окнами.
  const sortedStaff = useMemo(
    () =>
      [...activeStaff].sort(
        (a, b) =>
          statsFor(b.id, salonWindow).revenueCents - statsFor(a.id, salonWindow).revenueCents,
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- statsFor зависит от visitsByStaff, который входит в deps через activeStaff/visits
    [activeStaff, visitsByStaff, salonWindow],
  )

  if (isLoading) {
    return (
      <section className="border-border bg-card shadow-finsm rounded-lg border p-5">
        <div className="bg-muted/40 h-20 animate-pulse rounded-md" />
      </section>
    )
  }

  if (activeStaff.length === 0) return null

  return (
    <section className="border-border bg-card shadow-finsm mb-6 rounded-lg border p-5 sm:p-6">
      {/* Image #116: справа от заголовка — слот для PeriodPickerPopover. */}
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-brand-navy text-base font-bold tracking-tight">
            {t('staff.performance.title')}
          </h2>
          <p className="text-muted-foreground mt-1 text-sm">{t('staff.performance.subtitle')}</p>
        </div>
        {headerRight ? <div className="shrink-0">{headerRight}</div> : null}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-muted-foreground border-border border-b text-left text-xs">
              <th className="py-2 pr-3 font-semibold">{t('staff.performance.col_master')}</th>
              <th className="py-2 pr-3 text-right font-semibold">
                {t('staff.performance.col_visits')}
              </th>
              <th className="py-2 pr-3 text-right font-semibold">
                {t('staff.performance.col_revenue')}
              </th>
              <th className="py-2 pr-3 text-right font-semibold">
                {t('staff.performance.col_share')}
              </th>
              <th className="py-2 pr-3 text-right font-semibold">
                {t('staff.performance.col_avg')}
              </th>
              <th className="py-2 pr-3 text-right font-semibold">
                {t('staff.performance.col_clients')}
              </th>
              <th className="py-2 pr-3 text-right font-semibold">
                {t('staff.performance.col_retention')}
              </th>
            </tr>
          </thead>
          <tbody>
            {sortedStaff.map((s, i) => {
              const masterWindow = s.retention_window_days ?? salonWindow
              const st = statsFor(s.id, masterWindow)
              const visits = st.visitCount
              const rev = st.revenueCents
              const clients = st.uniqueClients
              const returning = st.returningClients
              const retention = clients > 0 ? Math.round((returning / clients) * 100) : null
              const avg = visits > 0 ? Math.round(rev / visits) : 0
              const share = totalRevenue > 0 ? (rev / totalRevenue) * 100 : 0
              const color = STAFF_PALETTE[i % STAFF_PALETTE.length]!
              const flagAttention = visits === 0
              const isCustomWindow = s.retention_window_days != null
              // Image #119: ТОП-3 мастера по обороту — медали (золото/серебро/
              // бронза). Медаль скрываем для мастеров без визитов в окне —
              // иначе пустой мастер мог бы получить «бронзу» если в салоне
              // <3 активных мастеров с визитами.
              const isTop3 = i < 3 && rev > 0
              const medalColor =
                i === 0 ? 'text-yellow-500' : i === 1 ? 'text-slate-400' : 'text-amber-700'
              return (
                <tr key={s.id} className="border-border border-b last:border-b-0">
                  <td className="py-2.5 pr-3">
                    <span className="flex items-center gap-2">
                      {isTop3 ? (
                        <Medal
                          className={cn('size-4 shrink-0', medalColor)}
                          strokeWidth={2}
                          aria-label={`top-${i + 1}`}
                        />
                      ) : (
                        <span className="w-4 shrink-0" />
                      )}
                      <span
                        className="text-brand-navy grid size-7 place-items-center rounded-full text-xs font-bold"
                        style={{ background: color }}
                      >
                        {s.full_name.charAt(0).toUpperCase()}
                      </span>
                      <span className="text-foreground font-semibold">{s.full_name}</span>
                      {flagAttention ? (
                        <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-bold uppercase text-amber-800">
                          {t('staff.performance.flag_attention')}
                        </span>
                      ) : null}
                    </span>
                  </td>
                  <td className="num py-2.5 pr-3 text-right">{visits}</td>
                  <td className="num py-2.5 pr-3 text-right font-bold">
                    {formatCurrency(rev, currency)}
                  </td>
                  <td className="num text-muted-foreground py-2.5 pr-3 text-right">
                    {share.toFixed(0)}%
                  </td>
                  <td className="num text-muted-foreground py-2.5 pr-3 text-right">
                    {visits > 0 ? formatCurrency(avg, currency) : '—'}
                  </td>
                  <td className="num text-muted-foreground py-2.5 pr-3 text-right">{clients}</td>
                  <td className="num py-2.5 pr-3 text-right">
                    {retention === null ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      <span
                        className={cn(
                          retention >= 50
                            ? 'text-brand-sage'
                            : retention >= 25
                              ? 'text-brand-gold-deep'
                              : 'text-destructive',
                        )}
                        title={t('staff.performance.window_tooltip', {
                          days: masterWindow,
                          custom: isCustomWindow ? ' (индивид.)' : '',
                        })}
                      >
                        {retention}%
                      </span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="text-muted-foreground mt-3 text-xs">{t('staff.performance.note')}</p>
    </section>
  )
}
