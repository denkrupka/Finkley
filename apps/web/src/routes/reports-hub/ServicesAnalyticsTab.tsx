import { ChevronDown, ChevronRight, Medal, Trophy } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { AiInsightsPanel } from '@/components/reports/AiInsightsPanel'
import {
  currentMonthPeriod,
  periodToRange,
  type PeriodValue,
} from '@/components/ui/period-picker-utils'
import { PeriodPickerPopover } from '@/components/ui/PeriodPickerPopover'
import { useRevenueByService } from '@/hooks/useAnalytics'
import { useSalon } from '@/hooks/useSalons'
import { useServiceCategories, useServices } from '@/hooks/useServices'
import { cn } from '@/lib/utils/cn'
import { formatCurrency } from '@/lib/utils/format-currency'

/**
 * Reports → Услуги.
 *
 * Иерархия: услуги сгруппированы по category (групповая шапка collapsible).
 * Группы отсортированы по обороту desc. Внутри группы — услуги отсортированы
 * по обороту desc.
 *
 * Топ-3 услуг в группе получают медальки (🥇/🥈/🥉).
 * Топ-20% услуг в группе подсвечены зелёным фоном.
 *
 * Новые колонки: Время услуги (duration_min) и Стоимость часа работы
 * (revenue / duration * 60).
 */
type EnrichedRow = {
  service_id: string
  service_name: string
  revenue_cents: number
  visits_count: number
  margin_cents: number | null
  margin_pct: number | null
  duration_min: number | null
  hourly_cents: number | null
  category_id: string | null
  category_name: string
}

type Group = {
  category_id: string | null
  category_name: string
  total_revenue: number
  total_visits: number
  rows: EnrichedRow[]
}

export function ServicesAnalyticsTab({ salonId }: { salonId: string }) {
  const { t } = useTranslation()
  const { data: salon } = useSalon(salonId)
  const currency = salon?.currency ?? 'PLN'

  const [period, setPeriod] = useState<PeriodValue>(() => currentMonthPeriod())
  const range = periodToRange(period)
  const startIso = range.start.toISOString()
  const endIso = range.end.toISOString()
  const { data: rows = [], isLoading } = useRevenueByService(salonId, startIso, endIso)
  const { data: services = [] } = useServices(salonId)
  const { data: categories = [] } = useServiceCategories(salonId)

  // Image #132: при открытии вкладки все категории должны быть свёрнуты
  // изначально. Хранится Set ключей свёрнутых групп; «развёрнуто» = ключа
  // в Set нет. Изначально пусто, и `initializedRef` ниже заполняет Set
  // ключами всех групп при первом успешном fetch'е, чтобы дефолт был
  // «свёрнуто», а не «развёрнуто».
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const initializedRef = useRef(false)
  function toggleGroup(key: string) {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  // Enrichment: к каждой row из RPC прицепляем category + duration_min
  // через клиентский join (использует useServices, который и так в кэше).
  const enriched: EnrichedRow[] = useMemo(() => {
    const serviceById = new Map(services.map((s) => [s.id, s]))
    const categoryById = new Map(categories.map((c) => [c.id, c]))
    const fallback = t('reports_hub.services.no_category')
    return rows.map((r) => {
      const svc = serviceById.get(r.service_id)
      const dur = svc?.default_duration_min ?? null
      const hourly = dur && dur > 0 ? Math.round((r.revenue_cents / dur) * 60) : null
      const cat = svc?.category_id ? categoryById.get(svc.category_id) : null
      return {
        service_id: r.service_id,
        service_name: r.service_name,
        revenue_cents: r.revenue_cents,
        visits_count: r.visits_count,
        margin_cents: r.margin_cents,
        margin_pct: r.margin_pct,
        duration_min: dur,
        hourly_cents: hourly,
        category_id: svc?.category_id ?? null,
        category_name: cat?.name ?? fallback,
      }
    })
  }, [rows, services, categories, t])

  // Группировка по category + сортировка
  const groups: Group[] = useMemo(() => {
    const map = new Map<string, Group>()
    for (const r of enriched) {
      const key = r.category_id ?? '__none__'
      if (!map.has(key)) {
        map.set(key, {
          category_id: r.category_id,
          category_name: r.category_name,
          total_revenue: 0,
          total_visits: 0,
          rows: [],
        })
      }
      const g = map.get(key)!
      g.total_revenue += r.revenue_cents
      g.total_visits += r.visits_count
      g.rows.push(r)
    }
    const arr = Array.from(map.values())
    for (const g of arr) g.rows.sort((a, b) => b.revenue_cents - a.revenue_cents)
    arr.sort((a, b) => b.total_revenue - a.total_revenue)
    return arr
  }, [enriched])

  const totalRevenue = enriched.reduce((s, r) => s + r.revenue_cents, 0)

  // Image #132: один раз при первом fetch'е помечаем ВСЕ группы как
  // свёрнутые. Без этого default-состояние был «всё развёрнуто», и юзер
  // видел кучу строк сразу при открытии вкладки.
  useEffect(() => {
    if (initializedRef.current) return
    if (groups.length === 0) return
    setCollapsed(new Set(groups.map((g) => g.category_id ?? '__none__')))
    initializedRef.current = true
  }, [groups])

  // AI payload — отправляем структурированно по группам. Генерируется
  // всегда, даже при пустых данных, чтобы плашка «AI-выводы» с opt-in
  // кнопкой «Показать» отрисовывалась и в Reports → Услуги без визитов.
  const aiPayload = useMemo(() => {
    return {
      period: { start: startIso.slice(0, 10), end: endIso.slice(0, 10) },
      currency,
      total_revenue_cents: totalRevenue,
      groups: groups.map((g) => ({
        category: g.category_name,
        total_revenue_cents: g.total_revenue,
        total_visits: g.total_visits,
        services: g.rows.slice(0, 10).map((r) => ({
          name: r.service_name,
          visits: r.visits_count,
          revenue_cents: r.revenue_cents,
          duration_min: r.duration_min,
          hourly_rate_cents: r.hourly_cents,
          margin_pct: r.margin_pct,
        })),
      })),
    }
  }, [groups, totalRevenue, startIso, endIso, currency])

  return (
    <div>
      {/* Image #61: убрали заголовок «Услуги по группам» — табы Reports
          (Услуги/Клиенты/Мастера/Зарплата) уже сообщают контекст. PeriodPicker
          переехал под AI-плашку — компактнее и логичнее (период действует
          и на отчёт, и на AI-payload). */}
      <AiInsightsPanel kind="services" payload={aiPayload} />

      <div className="mb-4 flex items-center justify-end">
        <PeriodPickerPopover value={period} onChange={setPeriod} />
      </div>

      <div className="border-border bg-card shadow-finsm overflow-x-auto rounded-lg border">
        {isLoading ? (
          <p className="text-muted-foreground p-6 text-sm">{t('common.loading')}</p>
        ) : groups.length === 0 ? (
          <p className="text-muted-foreground p-6 text-sm">{t('reports_hub.services.empty')}</p>
        ) : (
          <table className="w-full min-w-[820px] text-sm">
            <thead className="bg-muted/40 text-muted-foreground border-b text-[11px] uppercase tracking-wider">
              <tr>
                <th className="px-4 py-3 text-left font-semibold">
                  {t('reports_hub.services.col_name')}
                </th>
                <th className="px-3 py-3 text-right font-semibold">
                  {t('reports_hub.services.col_visits')}
                </th>
                <th className="px-3 py-3 text-right font-semibold">
                  {t('reports_hub.services.col_duration')}
                </th>
                <th className="px-3 py-3 text-right font-semibold">
                  {t('reports_hub.services.col_hourly')}
                </th>
                <th className="px-3 py-3 text-right font-semibold">
                  {t('reports_hub.services.col_revenue')}
                </th>
                <th className="px-3 py-3 text-right font-semibold">
                  {t('reports_hub.services.col_margin')}
                </th>
                <th className="px-3 py-3 text-right font-semibold">
                  {t('reports_hub.services.col_share')}
                </th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g, gIdx) => {
                const groupKey = g.category_id ?? '__none__'
                const isCollapsed = collapsed.has(groupKey)
                const topCount = Math.max(1, Math.ceil(g.rows.length * 0.2))
                const groupShare = totalRevenue > 0 ? (g.total_revenue / totalRevenue) * 100 : 0
                return (
                  <GroupBlock
                    key={groupKey}
                    group={g}
                    groupIdx={gIdx}
                    isCollapsed={isCollapsed}
                    onToggle={() => toggleGroup(groupKey)}
                    topCount={topCount}
                    groupShare={groupShare}
                    totalRevenue={totalRevenue}
                    currency={currency}
                    t={t}
                  />
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

function GroupBlock({
  group,
  groupIdx,
  isCollapsed,
  onToggle,
  topCount,
  groupShare,
  totalRevenue,
  currency,
  t,
}: {
  group: Group
  groupIdx: number
  isCollapsed: boolean
  onToggle: () => void
  topCount: number
  groupShare: number
  totalRevenue: number
  currency: string
  t: (k: string, opts?: Record<string, unknown>) => string
}) {
  // Image #118: ТОП-3 категории по обороту получают кубок (Trophy) — золото/
  // серебро/бронза. Используем Trophy (а не Medal) чтобы визуально отличить
  // от медалей у топ-услуг внутри группы.
  const isTopGroup = groupIdx < 3
  const trophyColor =
    groupIdx === 0 ? 'text-yellow-500' : groupIdx === 1 ? 'text-slate-400' : 'text-amber-700'
  return (
    <>
      <tr
        onClick={onToggle}
        className="border-border bg-muted/20 hover:bg-muted/40 cursor-pointer border-t"
      >
        <td className="px-4 py-2.5">
          <div className="flex items-center gap-2">
            {isCollapsed ? (
              <ChevronRight className="text-muted-foreground size-4" strokeWidth={2} />
            ) : (
              <ChevronDown className="text-muted-foreground size-4" strokeWidth={2} />
            )}
            {isTopGroup ? (
              <Trophy
                className={cn('size-4 shrink-0', trophyColor)}
                strokeWidth={2}
                aria-label={t(`reports_hub.services.medal_${groupIdx + 1}`)}
              />
            ) : null}
            <span className="text-brand-navy text-sm font-bold">{group.category_name}</span>
            <span className="text-muted-foreground text-[10.5px]">
              {t('reports_hub.services.group_count', { count: group.rows.length })}
            </span>
          </div>
        </td>
        <td className="num text-muted-foreground px-3 py-2.5 text-right text-xs">
          {group.total_visits}
        </td>
        <td className="px-3 py-2.5" />
        <td className="px-3 py-2.5" />
        <td className="num text-brand-sage-deep px-3 py-2.5 text-right text-sm font-bold">
          {formatCurrency(group.total_revenue, currency)}
        </td>
        <td className="px-3 py-2.5" />
        <td className="num text-muted-foreground px-3 py-2.5 text-right text-xs">
          {groupShare.toFixed(1)}%
        </td>
      </tr>
      {!isCollapsed
        ? group.rows.map((r, idx) => {
            const isTop3 = idx < 3
            const isTop20pct = idx < topCount
            const share = totalRevenue > 0 ? (r.revenue_cents / totalRevenue) * 100 : 0
            return (
              <tr
                key={r.service_id}
                className={cn(
                  'border-border/40 border-t',
                  isTop20pct ? 'bg-brand-sage-soft/20' : '',
                )}
              >
                <td className="px-4 py-2 pl-10">
                  <div className="flex items-center gap-2">
                    {isTop3 ? (
                      <Medal
                        className={cn(
                          'size-4 shrink-0',
                          idx === 0
                            ? 'text-yellow-500'
                            : idx === 1
                              ? 'text-slate-400'
                              : 'text-amber-700',
                        )}
                        strokeWidth={2}
                        aria-label={t(`reports_hub.services.medal_${idx + 1}`)}
                      />
                    ) : (
                      <span className="w-4 shrink-0" />
                    )}
                    <span className="text-foreground text-sm">{r.service_name}</span>
                  </div>
                </td>
                <td className="num text-muted-foreground px-3 py-2 text-right">{r.visits_count}</td>
                <td className="num text-muted-foreground px-3 py-2 text-right text-xs">
                  {r.duration_min ? `${r.duration_min} ${t('common.min')}` : '—'}
                </td>
                <td className="num text-muted-foreground px-3 py-2 text-right text-xs">
                  {r.hourly_cents != null ? formatCurrency(r.hourly_cents, currency) : '—'}
                </td>
                <td className="num text-foreground px-3 py-2 text-right font-semibold">
                  {formatCurrency(r.revenue_cents, currency)}
                </td>
                <td
                  className={cn(
                    'num px-3 py-2 text-right text-xs font-semibold',
                    r.margin_pct == null
                      ? 'text-muted-foreground'
                      : r.margin_pct >= 50
                        ? 'text-brand-sage-deep'
                        : r.margin_pct >= 35
                          ? 'text-amber-700'
                          : 'text-destructive',
                  )}
                >
                  {r.margin_pct == null
                    ? '—'
                    : `${formatCurrency(r.margin_cents ?? 0, currency)} (${r.margin_pct.toFixed(0)}%)`}
                </td>
                <td className="num text-muted-foreground px-3 py-2 text-right text-xs">
                  {share.toFixed(1)}%
                </td>
              </tr>
            )
          })
        : null}
    </>
  )
}
