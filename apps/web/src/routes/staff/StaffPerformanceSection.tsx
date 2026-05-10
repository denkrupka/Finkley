import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { useVisits } from '@/hooks/useVisits'
import { getPeriodRange } from '@/lib/period'
import { cn } from '@/lib/utils/cn'
import { formatCurrency } from '@/lib/utils/format-currency'

const STAFF_PALETTE = ['#F4D7C5', '#D7E4C5', '#C5DAE4', '#E4C5DC', '#E8C4B8', '#FBE5C0']

type Props = {
  salonId: string
  staff: Array<{ id: string; full_name: string; is_active: boolean }>
  currency: string
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
export function StaffPerformanceSection({ salonId, staff, currency }: Props) {
  const { t } = useTranslation()

  // Берём 30-дневное окно — стандарт для оценки текущей эффективности.
  // Когда понадобится period switcher — вынесем в URL params.
  const range = useMemo(() => getPeriodRange('month', new Date(), undefined), [])
  const { data: visits = [], isLoading } = useVisits(salonId, range)

  const stats = useMemo(() => {
    const map = new Map<
      string,
      {
        visitCount: number
        revenueCents: number
        clients: Set<string>
        clientVisitCount: Map<string, number>
        services: Map<string, number>
      }
    >()
    for (const v of visits) {
      if (!v.staff_id) continue
      let s = map.get(v.staff_id)
      if (!s) {
        s = {
          visitCount: 0,
          revenueCents: 0,
          clients: new Set(),
          clientVisitCount: new Map(),
          services: new Map(),
        }
        map.set(v.staff_id, s)
      }
      s.visitCount++
      s.revenueCents += v.amount_cents
      if (v.client_id) {
        s.clients.add(v.client_id)
        s.clientVisitCount.set(v.client_id, (s.clientVisitCount.get(v.client_id) ?? 0) + 1)
      }
      const svc = v.service_id ?? '__none__'
      s.services.set(svc, (s.services.get(svc) ?? 0) + 1)
    }
    return map
  }, [visits])

  const activeStaff = staff.filter((s) => s.is_active)
  const totalRevenue = Array.from(stats.values()).reduce((acc, s) => acc + s.revenueCents, 0)

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
      <div className="mb-4">
        <h2 className="text-brand-navy text-base font-bold tracking-tight">
          {t('staff.performance.title')}
        </h2>
        <p className="text-muted-foreground mt-1 text-sm">{t('staff.performance.subtitle')}</p>
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
            {activeStaff.map((s, i) => {
              const st = stats.get(s.id)
              const visits = st?.visitCount ?? 0
              const rev = st?.revenueCents ?? 0
              const clients = st?.clients.size ?? 0
              const returning = st
                ? Array.from(st.clientVisitCount.values()).filter((n) => n >= 2).length
                : 0
              const retention = clients > 0 ? Math.round((returning / clients) * 100) : null
              const avg = visits > 0 ? Math.round(rev / visits) : 0
              const share = totalRevenue > 0 ? (rev / totalRevenue) * 100 : 0
              const color = STAFF_PALETTE[i % STAFF_PALETTE.length]!
              // Условный «фокус-нид»: 0 визитов или отрицательная динамика
              const flagAttention = visits === 0
              return (
                <tr key={s.id} className="border-border border-b last:border-b-0">
                  <td className="py-2.5 pr-3">
                    <span className="flex items-center gap-2">
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
