import { useQuery } from '@tanstack/react-query'
import { AlertCircle, Medal } from 'lucide-react'
import { useMemo, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { periodToRange, type PeriodValue } from '@/components/ui/period-picker-utils'
import { useSalon } from '@/hooks/useSalons'
import { useVisits } from '@/hooks/useVisits'
import { supabase } from '@/lib/supabase/client'
import { cn } from '@/lib/utils/cn'
import { formatCurrency } from '@/lib/utils/format-currency'

type LiteVisit = { staff_id: string | null; client_id: string | null; visit_at: string }

const STAFF_PALETTE = ['#F4D7C5', '#D7E4C5', '#C5DAE4', '#E4C5DC', '#E8C4B8', '#FBE5C0']

type Props = {
  salonId: string
  staff: Array<{
    id: string
    full_name: string
    is_active: boolean
    retention_window_days?: number | null
    avatar_url?: string | null
  }>
  currency: string
  /**
   * Период из родителя — фильтр визитов + окно для KPI. Если не задан,
   * fallback на retention_window_days мастера/салона (старое поведение).
   */
  period?: PeriodValue
  /** Слот для PeriodPickerPopover справа от заголовка. */
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
export function StaffPerformanceSection({ salonId, staff, currency, period, headerRight }: Props) {
  const { t } = useTranslation()
  const { data: salon } = useSalon(salonId)
  const salonWindow = salon?.retention_window_days ?? 60
  const salonChurnWindow = salon?.churn_window_days ?? 90

  // Если период задан — используем его как окно для всех мастеров (общая
  // фильтрация). Иначе fallback на retention_window_days мастеров/салона.
  const periodRange = useMemo(() => (period ? periodToRange(period) : null), [period])

  // Берём максимальное окно ретеншна по всем мастерам (или дефолт салона) —
  // тянем visits за этот период; per-master ретеншн считаем уже из этого
  // выборного диапазона. Если salon=60 а у одного мастера 90 — нужно тянуть 90.
  const lookbackDays = useMemo(
    () => Math.max(salonWindow, ...staff.map((s) => s.retention_window_days ?? 0)),
    [salonWindow, staff],
  )
  const range = useMemo(() => {
    if (periodRange) {
      return { start: periodRange.start.toISOString(), end: periodRange.end.toISOString() }
    }
    const end = new Date()
    const start = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000)
    return { start: start.toISOString(), end: end.toISOString() }
  }, [periodRange, lookbackDays])
  const { data: visits = [], isLoading } = useVisits(salonId, range)

  // Полная история визитов салона — нужна чтобы определить «новый/постоянный
  // клиент мастера». Lite-выборка (3 колонки), для маленьких салонов это
  // быстро. Только kind='visit' (retail-продажа не считается посещением
  // мастера). Кэш отдельный, инвалидируется только новой записью.
  const { data: allTimeVisits = [] } = useQuery({
    queryKey: ['visits-lite-all-time', salonId],
    enabled: !!salonId,
    queryFn: async (): Promise<LiteVisit[]> => {
      const { data, error } = await supabase
        .from('visits')
        .select('staff_id, client_id, visit_at')
        .eq('salon_id', salonId)
        .eq('kind', 'visit')
        .is('deleted_at', null)
      if (error) throw error
      return (data ?? []) as LiteVisit[]
    },
  })

  // T85/T86 — для расчёта Оттока на клиенте: per client_id → last_visit_in_salon
  // (любой мастер) И per (staff_id × client_id) → last_visit_at_master.
  // Если last_at_master == last_in_salon → клиент после этого мастера в салон
  // вообще не вернулся (классический отток).
  const lastInSalonByClient = useMemo(() => {
    const m = new Map<string, number>()
    for (const v of allTimeVisits) {
      if (!v.client_id) continue
      const t = new Date(v.visit_at).getTime()
      const cur = m.get(v.client_id)
      if (!cur || t > cur) m.set(v.client_id, t)
    }
    return m
  }, [allTimeVisits])

  // Per (staff_id × client_id): first_at + total_count за ВСЁ время.
  // Используется для split «новый клиент мастера» vs «постоянный».
  const firstVisitMap = useMemo(() => {
    const m = new Map<string, { first_at: number; count: number }>()
    for (const v of allTimeVisits) {
      if (!v.staff_id || !v.client_id) continue
      const key = `${v.staff_id}::${v.client_id}`
      const t = new Date(v.visit_at).getTime()
      const cur = m.get(key)
      if (cur) {
        if (t < cur.first_at) cur.first_at = t
        cur.count += 1
      } else {
        m.set(key, { first_at: t, count: 1 })
      }
    }
    return m
  }, [allTimeVisits])

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
    // Если задан period — фильтрация по нему общая для всех мастеров.
    // Иначе — по индивидуальному retention-окну (старое поведение).
    const startMs = periodRange
      ? periodRange.start.getTime()
      : Date.now() - windowDays * 24 * 60 * 60 * 1000
    const endMs = periodRange ? periodRange.end.getTime() : Date.now()
    const inWindow = (visitsByStaff.get(staffId) ?? []).filter((v) => {
      const t = new Date(v.visit_at).getTime()
      return t >= startMs && t <= endMs
    })
    const clientVisitCount = new Map<string, number>()
    let visitsRevenueCents = 0
    let retailRevenueCents = 0
    let tipsCents = 0
    for (const v of inWindow) {
      if (v.kind === 'retail') retailRevenueCents += v.amount_cents
      else visitsRevenueCents += v.amount_cents
      tipsCents += v.tip_cents ?? 0
      if (v.client_id)
        clientVisitCount.set(v.client_id, (clientVisitCount.get(v.client_id) ?? 0) + 1)
    }
    const revenueCents = visitsRevenueCents + retailRevenueCents

    // Retention split: «новый клиент» (первый раз пришёл к этому мастеру
    // в периоде) vs «постоянный» (≥2 визитов в истории, первый был ДО периода).
    const periodClientIds = new Set(
      Array.from(visitsByStaff.get(staffId) ?? [])
        .filter((v) => {
          const t = new Date(v.visit_at).getTime()
          return v.client_id && t >= startMs && t <= endMs
        })
        .map((v) => v.client_id as string),
    )
    let newClients = 0
    let newClientsReturned = 0
    let regularClients = 0
    let regularClientsActive = 0
    for (const [key, fv] of firstVisitMap) {
      const sep = key.indexOf('::')
      const sid = key.slice(0, sep)
      const cid = key.slice(sep + 2)
      if (sid !== staffId) continue
      if (fv.first_at >= startMs && fv.first_at <= endMs) {
        newClients += 1
        if (fv.count >= 2) newClientsReturned += 1
      } else if (fv.first_at < startMs && fv.count >= 2) {
        regularClients += 1
        if (periodClientIds.has(cid)) regularClientsActive += 1
      }
    }
    const newRetentionPct =
      newClients > 0 ? Math.round((newClientsReturned * 100) / newClients) : null
    const regularRetentionPct =
      regularClients > 0 ? Math.round((regularClientsActive * 100) / regularClients) : null

    return {
      visitCount: inWindow.length,
      revenueCents,
      visitsRevenueCents,
      retailRevenueCents,
      tipsCents,
      uniqueClients: clientVisitCount.size,
      newClients,
      newClientsReturned,
      newRetentionPct,
      regularClients,
      regularClientsActive,
      regularRetentionPct,
    }
  }

  /**
   * Period-aware churn (запрос юзера 01.06):
   *   «Из клиентов которые были у мастера в ОКНЕ-ПРЕДШЕСТВЕННИКЕ той же
   *    длины, что и текущий период, сколько НЕ пришли в текущем периоде?»
   *
   * Пример. Период = «Май 2026» (31 день).
   *   prevWindow = «Апрель 2026» (31 день).
   *   prevClients = клиенты мастера в апреле.
   *   currentInSalon = клиенты любого мастера салона в мае.
   *   churned = prevClients ∖ currentInSalon → % = churned / prevClients.
   *
   * Если периода нет (старый flow) — fallback на «давно не были»:
   * last_in_salon < (today − churn_window_days). Если периода нет И у
   * мастера 0 клиентов когда-либо — `null` (показываем «—»).
   *
   * Скоринг — newR × regR × (1 − ch), 0..1.
   */
  function churnFor(staffId: string): { churn_pct: number | null; total: number } {
    if (periodRange) {
      const periodStartMs = periodRange.start.getTime()
      const periodEndMs = periodRange.end.getTime()
      const periodLenMs = periodEndMs - periodStartMs
      const prevStartMs = periodStartMs - periodLenMs
      const prevEndMs = periodStartMs

      const prevClientsAtMaster = new Set<string>()
      const currentInSalon = new Set<string>()
      for (const v of allTimeVisits) {
        if (!v.client_id) continue
        const t = new Date(v.visit_at).getTime()
        if (t >= prevStartMs && t < prevEndMs && v.staff_id === staffId) {
          prevClientsAtMaster.add(v.client_id)
        }
        if (t >= periodStartMs && t <= periodEndMs) {
          currentInSalon.add(v.client_id)
        }
      }
      if (prevClientsAtMaster.size === 0) return { churn_pct: null, total: 0 }
      let churned = 0
      for (const cid of prevClientsAtMaster) {
        if (!currentInSalon.has(cid)) churned += 1
      }
      return {
        churn_pct: (churned / prevClientsAtMaster.size) * 100,
        total: prevClientsAtMaster.size,
      }
    }

    // Fallback (нет periodRange): классическое «давно не были».
    const clientsAtMaster = new Set<string>()
    for (const v of allTimeVisits) {
      if (v.staff_id === staffId && v.client_id) clientsAtMaster.add(v.client_id)
    }
    if (clientsAtMaster.size === 0) return { churn_pct: null, total: 0 }
    const churnedBefore = Date.now() - salonChurnWindow * 24 * 60 * 60 * 1000
    let churned = 0
    for (const cid of clientsAtMaster) {
      const lastInSalon = lastInSalonByClient.get(cid) ?? 0
      if (lastInSalon > 0 && lastInSalon < churnedBefore) churned += 1
    }
    return { churn_pct: (churned / clientsAtMaster.size) * 100, total: clientsAtMaster.size }
  }

  function scoringFor(
    newRetentionPct: number | null,
    regularRetentionPct: number | null,
    churn_pct: number | null,
  ): number | null {
    if (newRetentionPct === null || regularRetentionPct === null || churn_pct === null) return null
    const newR = newRetentionPct / 100
    const regR = regularRetentionPct / 100
    const ch = Math.min(Math.max(churn_pct / 100, 0), 1)
    return newR * regR * (1 - ch)
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

      {/* T85 — без horizontal-scroll. Padding/font сжаты, (n/m) суффиксы
          переведены в подстрочный font-[10px] чтобы не съедать ширину. */}
      <div>
        <table className="w-full text-xs">
          <thead>
            <tr className="text-muted-foreground border-border border-b text-left text-[10px] uppercase tracking-wider">
              <th className="py-2 pr-2 font-semibold">{t('staff.performance.col_master')}</th>
              <th className="py-2 pr-2 text-right font-semibold">
                {t('staff.performance.col_visits')}
              </th>
              <th className="py-2 pr-2 text-right font-semibold">
                {t('staff.performance.col_visits_revenue')}
              </th>
              <th className="py-2 pr-2 text-right font-semibold">
                {t('staff.performance.col_retail_revenue')}
              </th>
              <th className="py-2 pr-2 text-right font-semibold">
                {t('staff.performance.col_tips')}
              </th>
              <th className="py-2 pr-2 text-right font-semibold">
                {t('staff.performance.col_revenue')}
              </th>
              <th className="py-2 pr-2 text-right font-semibold">
                {t('staff.performance.col_share')}
              </th>
              <th className="py-2 pr-2 text-right font-semibold">
                {t('staff.performance.col_clients')}
              </th>
              <th
                className="py-2 pr-2 text-right font-semibold"
                title={t('staff.performance.col_retention_new_hint')}
              >
                {t('staff.performance.col_retention_new')}
              </th>
              <th
                className="py-2 pr-2 text-right font-semibold"
                title={t('staff.performance.col_retention_regular_hint')}
              >
                {t('staff.performance.col_retention_regular')}
              </th>
              {/* T85 — Отток + Скоринг (server-side, RPC) */}
              <th
                className="py-2 pr-2 text-right font-semibold"
                title={t('reports_hub.staff.col_churn_tooltip', {
                  defaultValue:
                    '% клиентов мастера, которые после визита у него больше не вернулись в салон',
                })}
              >
                {t('reports_hub.staff.col_churn', { defaultValue: 'Отток' })}
              </th>
              <th
                className="py-2 pr-2 text-right font-semibold"
                title={t('reports_hub.staff.col_scoring_tooltip', {
                  defaultValue: '(Возврат × Удержание) / Отток. Чем выше — тем лучше.',
                })}
              >
                {t('reports_hub.staff.col_scoring', { defaultValue: 'Скоринг' })}
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
                  <td className="py-2 pr-2">
                    <span className="flex items-center gap-2">
                      {isTop3 ? (
                        <Medal
                          className={cn('size-4 shrink-0', medalColor)}
                          strokeWidth={2}
                          aria-label={`top-${i + 1}`}
                        />
                      ) : flagAttention ? (
                        // T85 — «ВНИМАНИЕ»-badge справа от имени съедал ширину
                        // таблицы. Теперь — компактный значок ! слева, на
                        // месте медали (для мастеров без визитов в окне).
                        <span
                          className="inline-flex shrink-0"
                          title={t('staff.performance.flag_attention')}
                        >
                          <AlertCircle
                            className="size-4 text-amber-600"
                            strokeWidth={2.2}
                            aria-label={t('staff.performance.flag_attention')}
                          />
                        </span>
                      ) : (
                        <span className="w-4 shrink-0" />
                      )}
                      {s.avatar_url ? (
                        <img
                          src={s.avatar_url}
                          alt=""
                          loading="lazy"
                          className="size-7 shrink-0 rounded-full object-cover"
                        />
                      ) : (
                        <span
                          className="text-brand-navy grid size-7 place-items-center rounded-full text-xs font-bold"
                          style={{ background: color }}
                        >
                          {s.full_name.charAt(0).toUpperCase()}
                        </span>
                      )}
                      <span className="text-foreground font-semibold">{s.full_name}</span>
                    </span>
                  </td>
                  <td className="num py-2 pr-2 text-right">{visits}</td>
                  <td className="num text-foreground py-2 pr-2 text-right">
                    {st.visitsRevenueCents > 0
                      ? formatCurrency(st.visitsRevenueCents, currency)
                      : '—'}
                  </td>
                  <td className="num text-foreground py-2 pr-2 text-right">
                    {st.retailRevenueCents > 0
                      ? formatCurrency(st.retailRevenueCents, currency)
                      : '—'}
                  </td>
                  <td className="num text-brand-gold-deep py-2 pr-2 text-right">
                    {st.tipsCents > 0 ? formatCurrency(st.tipsCents, currency) : '—'}
                  </td>
                  <td className="num py-2 pr-2 text-right font-bold">
                    {formatCurrency(rev, currency)}
                  </td>
                  <td className="num text-muted-foreground py-2 pr-2 text-right">
                    {share.toFixed(0)}%
                  </td>
                  <td className="num text-muted-foreground py-2 pr-2 text-right">{clients}</td>
                  <td
                    className="num py-2 pr-2 text-right"
                    title={t('staff.performance.col_retention_new_title', {
                      returned: st.newClientsReturned,
                      total: st.newClients,
                    })}
                  >
                    {st.newRetentionPct === null ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      <span
                        className={cn(
                          st.newRetentionPct >= 50
                            ? 'text-brand-sage-deep font-bold'
                            : st.newRetentionPct >= 25
                              ? 'text-brand-gold-deep font-semibold'
                              : 'text-destructive font-semibold',
                        )}
                      >
                        {st.newRetentionPct}%
                        <span className="text-muted-foreground ml-1 text-[10px]">
                          ({st.newClientsReturned}/{st.newClients})
                        </span>
                      </span>
                    )}
                  </td>
                  <td
                    className="num py-2 pr-2 text-right"
                    title={t('staff.performance.col_retention_regular_title', {
                      active: st.regularClientsActive,
                      total: st.regularClients,
                      window: masterWindow,
                      custom: isCustomWindow ? ' (индивид.)' : '',
                    })}
                  >
                    {st.regularRetentionPct === null ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      <span
                        className={cn(
                          st.regularRetentionPct >= 60
                            ? 'text-brand-sage-deep font-bold'
                            : st.regularRetentionPct >= 30
                              ? 'text-brand-gold-deep font-semibold'
                              : 'text-destructive font-semibold',
                        )}
                      >
                        {st.regularRetentionPct}%
                        <span className="text-muted-foreground ml-1 text-[10px]">
                          ({st.regularClientsActive}/{st.regularClients})
                        </span>
                      </span>
                    )}
                  </td>
                  {/* Отток + Скоринг — client-side. RPC хранит старую формулу
                      (churn = last_in_salon == last_at_master, scoring через
                      деление), которая давала несогласованные с retention
                      значения (100/100% retention + 60% churn у мастера, чьи
                      клиенты ещё ходят). До обновления RPC всегда считаем
                      на клиенте по `salonChurnWindow`. */}
                  {(() => {
                    const local = churnFor(s.id)
                    const churnPct = local.churn_pct
                    const scoring = scoringFor(st.newRetentionPct, st.regularRetentionPct, churnPct)
                    return (
                      <>
                        <td
                          className="num py-2 pr-2 text-right"
                          title={
                            churnPct !== null && local.total > 0
                              ? `${Math.round((churnPct / 100) * local.total)}/${local.total} клиентов`
                              : undefined
                          }
                        >
                          {churnPct === null ? (
                            <span className="text-muted-foreground">—</span>
                          ) : (
                            <span
                              className={cn(
                                'font-bold',
                                churnPct < 20
                                  ? 'text-brand-sage-deep'
                                  : churnPct <= 40
                                    ? 'text-brand-gold-deep'
                                    : 'text-destructive',
                              )}
                            >
                              {churnPct.toFixed(0)}%
                            </span>
                          )}
                        </td>
                        <td className="num py-2 pr-2 text-right">
                          {scoring === null ? (
                            <span className="text-muted-foreground">—</span>
                          ) : (
                            <span
                              className={cn(
                                'font-bold',
                                scoring >= 0.6
                                  ? 'text-brand-sage-deep'
                                  : scoring >= 0.3
                                    ? 'text-foreground'
                                    : 'text-destructive',
                              )}
                            >
                              {scoring.toFixed(2)}
                            </span>
                          )}
                        </td>
                      </>
                    )
                  })()}
                </tr>
              )
            })}
          </tbody>
          {/* Bug d385072d (Елена 02.06): строка "Итого" в Reports → Мастера.
              Суммируем абсолютные показатели; ретеншен/отток/скоринг не
              складываются — оставляем "—" чтобы не вводить в заблуждение. */}
          {sortedStaff.length > 0
            ? (() => {
                let totalVisitsRev = 0
                let totalRetailRev = 0
                let totalTips = 0
                let totalVisits = 0
                let totalClients = 0
                for (const s of sortedStaff) {
                  const masterWindow = s.retention_window_days ?? salonWindow
                  const st = statsFor(s.id, masterWindow)
                  totalVisitsRev += st.visitsRevenueCents
                  totalRetailRev += st.retailRevenueCents
                  totalTips += st.tipsCents
                  totalVisits += st.visitCount
                  totalClients += st.uniqueClients
                }
                return (
                  <tfoot>
                    <tr className="border-border bg-muted/20 border-t-2 font-bold">
                      <td className="text-foreground py-2 pr-2 text-[11px] uppercase tracking-wider">
                        {t('reports_hub.staff.total', { defaultValue: 'Итого' })}
                      </td>
                      <td className="num text-foreground py-2 pr-2 text-right">
                        {formatCurrency(totalVisitsRev, currency)}
                      </td>
                      <td className="num text-foreground py-2 pr-2 text-right">
                        {formatCurrency(totalRetailRev, currency)}
                      </td>
                      <td className="num text-foreground py-2 pr-2 text-right">
                        {formatCurrency(totalTips, currency)}
                      </td>
                      <td className="num text-foreground py-2 pr-2 text-right">
                        {formatCurrency(totalRevenue, currency)}
                      </td>
                      <td className="num text-muted-foreground py-2 pr-2 text-right">100%</td>
                      <td className="num text-foreground py-2 pr-2 text-right">
                        {totalVisits} · {totalClients}
                      </td>
                      <td className="text-muted-foreground py-2 pr-2 text-right">—</td>
                      <td className="text-muted-foreground py-2 pr-2 text-right">—</td>
                      <td className="text-muted-foreground py-2 pr-2 text-right">—</td>
                      <td className="text-muted-foreground py-2 pr-2 text-right">—</td>
                    </tr>
                  </tfoot>
                )
              })()
            : null}
        </table>
      </div>
      <p className="text-muted-foreground mt-3 text-xs">{t('staff.performance.note')}</p>
    </section>
  )
}
