import { useQuery } from '@tanstack/react-query'
import {
  Activity,
  CalendarDays,
  Layers,
  ListTree,
  MousePointerClick,
  TrendingDown,
  TrendingUp,
  Users,
} from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import { supabase } from '@/lib/supabase/client'

type Subtab = 'stats' | 'portal' | 'onboarding'

const SUBS: { id: Subtab; label: string; icon: typeof Layers }[] = [
  { id: 'stats', label: 'Статистика', icon: Layers },
  { id: 'portal', label: 'Портал', icon: ListTree },
  { id: 'onboarding', label: 'Онбординг', icon: MousePointerClick },
]

type Filters = {
  dateFrom: string | null
  dateTo: string | null
  userId: string | null
  salonId: string | null
}

const PRESETS: { id: string; label: string; days: number | null }[] = [
  { id: 'today', label: 'Сегодня', days: 1 },
  { id: '7d', label: '7 дней', days: 7 },
  { id: '30d', label: '30 дней', days: 30 },
  { id: '90d', label: '90 дней', days: 90 },
  { id: 'all', label: 'Всё время', days: null },
]

export function AdminTrackingPage() {
  void useTranslation()
  const [sub, setSub] = useState<Subtab>('stats')
  const [filters, setFilters] = useState<Filters>({
    dateFrom: null,
    dateTo: null,
    userId: null,
    salonId: null,
  })

  // Super-admin RPC возвращает ВСЕ салоны включая те где super-admin не member
  // (обычная salons RLS этого не делает — отсюда был баг "1 из 5").
  const { data: salons = [] } = useQuery({
    queryKey: ['admin-list-all-salons'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('admin_list_all_salons')
      if (error) throw error
      return (data ?? []) as Array<{
        id: string
        name: string
        owner_email: string | null
        created_at: string
      }>
    },
  })

  function applyPreset(id: string) {
    const preset = PRESETS.find((p) => p.id === id)
    if (!preset) return
    if (preset.days === null) {
      setFilters((f) => ({ ...f, dateFrom: null, dateTo: null }))
      return
    }
    const from = new Date(Date.now() - preset.days * 24 * 60 * 60 * 1000).toISOString()
    setFilters((f) => ({ ...f, dateFrom: from, dateTo: new Date().toISOString() }))
  }

  return (
    <div className="flex flex-1 flex-col p-5 sm:p-8">
      {/* Subtabs */}
      <div className="border-border bg-card shadow-finsm mb-4 inline-flex w-fit gap-1 rounded-md border p-1">
        {SUBS.map((s) => {
          const Icon = s.icon
          const active = sub === s.id
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => setSub(s.id)}
              className={`inline-flex items-center gap-1.5 rounded-sm px-3 py-1.5 text-xs font-semibold transition-colors ${
                active
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <Icon className="size-3.5" strokeWidth={1.8} />
              {s.label}
            </button>
          )
        })}
      </div>

      {/* Фильтры */}
      <div className="border-border bg-card mb-4 flex flex-wrap items-center gap-2 rounded-md border p-2">
        <span className="text-muted-foreground text-[10px] font-bold uppercase tracking-wider">
          Период:
        </span>
        {PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => applyPreset(p.id)}
            className="border-border hover:bg-muted/40 rounded-md border px-2.5 py-1 text-[11px] font-semibold"
          >
            {p.label}
          </button>
        ))}
        <span className="text-muted-foreground ml-auto text-[10px] font-bold uppercase tracking-wider">
          Салон:
        </span>
        <select
          value={filters.salonId ?? ''}
          onChange={(e) => setFilters((f) => ({ ...f, salonId: e.target.value || null }))}
          className="border-border bg-background h-7 rounded-md border px-2 text-xs"
        >
          <option value="">Все ({salons.length})</option>
          {salons.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
              {s.owner_email ? ` — ${s.owner_email}` : ''}
            </option>
          ))}
        </select>
      </div>

      {sub === 'stats' ? <StatsTab filters={filters} /> : null}
      {sub === 'portal' ? <PortalTab filters={filters} /> : null}
      {sub === 'onboarding' ? <OnboardingTab filters={filters} /> : null}
    </div>
  )
}

function StatsTab({ filters }: { filters: Filters }) {
  const { data: overview, isLoading } = useQuery({
    queryKey: ['admin-tracking-overview-v2', filters],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('admin_tracking_overview_v2', {
        p_date_from: filters.dateFrom,
        p_date_to: filters.dateTo,
        p_salon_id: filters.salonId,
      })
      if (error) throw error
      return (data?.[0] ?? null) as {
        total_events: number
        total_users: number
        total_salons: number
        events_today: number
        events_week: number
        avg_events_per_user: number
        top_path: string
        top_path_clicks: number
        least_used_path: string
        least_used_path_clicks: number
      } | null
    },
  })

  const { data: timeline = [] } = useQuery({
    queryKey: ['admin-tracking-timeline', filters],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('admin_tracking_timeline', {
        p_date_from: filters.dateFrom,
        p_date_to: filters.dateTo,
        p_salon_id: filters.salonId,
      })
      if (error) throw error
      return (data ?? []) as Array<{
        bucket: string
        total_events: number
        unique_users: number
      }>
    },
  })

  const { data: topUsers = [] } = useQuery({
    queryKey: ['admin-tracking-top-users', filters],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('admin_tracking_top_users', {
        p_date_from: filters.dateFrom,
        p_date_to: filters.dateTo,
        p_salon_id: filters.salonId,
        p_limit: 10,
      })
      if (error) throw error
      return (data ?? []) as Array<{
        user_id: string
        user_email: string
        total_events: number
        unique_pages: number
        last_seen_at: string
      }>
    },
  })

  if (isLoading) return <p className="text-muted-foreground text-sm">Загружаю...</p>
  if (!overview)
    return (
      <p className="text-muted-foreground text-sm">
        Пока нет данных. Трекинг событий начнётся после первого page_view.
      </p>
    )

  return (
    <div className="space-y-4">
      {/* Верхний ряд: 4 главных KPI */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard
          icon={Activity}
          label="Всего событий"
          value={Number(overview.total_events).toLocaleString('ru-RU')}
          accent="text-brand-navy"
          bg="bg-brand-teal-soft/30"
        />
        <KpiCard
          icon={Users}
          label="Уникальных юзеров"
          value={Number(overview.total_users).toLocaleString('ru-RU')}
          accent="text-brand-sage-deep"
          bg="bg-brand-sage-soft/30"
        />
        <KpiCard
          icon={Layers}
          label="Уникальных салонов"
          value={Number(overview.total_salons).toLocaleString('ru-RU')}
          accent="text-brand-clay-deep"
          bg="bg-brand-clay-soft/30"
        />
        <KpiCard
          icon={CalendarDays}
          label="Среднее на юзера"
          value={`${Number(overview.avg_events_per_user).toFixed(1)}`}
          accent="text-brand-gold-deep"
          bg="bg-brand-gold-soft/30"
        />
      </div>

      {/* Второй ряд: сегодня + неделя */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <KpiCard
          icon={Activity}
          label="Активность за 24 часа"
          value={Number(overview.events_today).toLocaleString('ru-RU')}
          sub="событий"
          accent="text-brand-navy"
        />
        <KpiCard
          icon={CalendarDays}
          label="Активность за 7 дней"
          value={Number(overview.events_week).toLocaleString('ru-RU')}
          sub="событий"
          accent="text-brand-navy"
        />
      </div>

      {/* График активности по дням */}
      {timeline.length > 0 ? (
        <div className="border-border bg-card shadow-finsm rounded-lg border p-4">
          <p className="text-muted-foreground mb-3 text-[10px] font-bold uppercase tracking-wider">
            Активность по дням
          </p>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={timeline}>
              <defs>
                <linearGradient id="evColor" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#1e3a5f" stopOpacity={0.4} />
                  <stop offset="100%" stopColor="#1e3a5f" stopOpacity={0.05} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e5e5" />
              <XAxis
                dataKey="bucket"
                tickFormatter={(v) => v?.slice(5)}
                stroke="#888"
                fontSize={10}
              />
              <YAxis stroke="#888" fontSize={10} />
              <Tooltip
                contentStyle={{
                  background: 'white',
                  border: '1px solid #e5e5e5',
                  borderRadius: 6,
                  fontSize: 12,
                }}
                formatter={(value: unknown, name: unknown) => [
                  String(value),
                  name === 'total_events' ? 'Событий' : 'Юзеров',
                ]}
              />
              <Area
                type="monotone"
                dataKey="total_events"
                stroke="#1e3a5f"
                strokeWidth={2}
                fill="url(#evColor)"
              />
              <Area
                type="monotone"
                dataKey="unique_users"
                stroke="#7a9a6e"
                strokeWidth={2}
                fill="none"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      ) : null}

      {/* Топ страницы */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="border-border bg-card shadow-finsm rounded-lg border p-4">
          <div className="mb-2 flex items-center gap-1.5">
            <TrendingUp className="text-brand-sage-deep size-4" strokeWidth={2.2} />
            <p className="text-muted-foreground text-[10px] font-bold uppercase tracking-wider">
              Самая популярная страница
            </p>
          </div>
          <p className="text-foreground num truncate font-mono text-lg font-bold">
            {overview.top_path}
          </p>
          <p className="text-brand-sage-deep num mt-1 text-xs font-semibold">
            {Number(overview.top_path_clicks).toLocaleString('ru-RU')} кликов
          </p>
        </div>
        <div className="border-border bg-card shadow-finsm rounded-lg border p-4">
          <div className="mb-2 flex items-center gap-1.5">
            <TrendingDown className="text-destructive size-4" strokeWidth={2.2} />
            <p className="text-muted-foreground text-[10px] font-bold uppercase tracking-wider">
              Наименее используемая
            </p>
          </div>
          <p className="text-foreground num truncate font-mono text-lg font-bold">
            {overview.least_used_path}
          </p>
          <p className="text-muted-foreground num mt-1 text-xs">
            {Number(overview.least_used_path_clicks).toLocaleString('ru-RU')} кликов
          </p>
        </div>
      </div>

      {/* Топ юзеров */}
      {topUsers.length > 0 ? (
        <div className="border-border bg-card shadow-finsm overflow-hidden rounded-lg border">
          <div className="border-border/40 border-b px-4 py-3">
            <p className="text-muted-foreground text-[10px] font-bold uppercase tracking-wider">
              Топ-{topUsers.length} самых активных юзеров
            </p>
          </div>
          <table className="w-full text-sm">
            <thead className="border-border bg-muted/30 border-b">
              <tr className="text-muted-foreground text-left text-[10px] font-bold uppercase tracking-wider">
                <th className="px-4 py-2.5">#</th>
                <th className="px-4 py-2.5">Email</th>
                <th className="num px-4 py-2.5 text-right">Событий</th>
                <th className="num px-4 py-2.5 text-right">Страниц</th>
                <th className="num px-4 py-2.5 text-right">Последнее</th>
              </tr>
            </thead>
            <tbody className="divide-border/40 divide-y">
              {topUsers.map((u, i) => (
                <tr key={u.user_id}>
                  <td className="text-muted-foreground num px-4 py-3 text-xs">{i + 1}</td>
                  <td className="text-foreground truncate px-4 py-3 text-xs font-semibold">
                    {u.user_email}
                  </td>
                  <td className="num text-foreground px-4 py-3 text-right text-xs font-bold">
                    {Number(u.total_events).toLocaleString('ru-RU')}
                  </td>
                  <td className="num text-muted-foreground px-4 py-3 text-right text-xs">
                    {u.unique_pages}
                  </td>
                  <td className="num text-muted-foreground px-4 py-3 text-right text-[10px]">
                    {new Date(u.last_seen_at).toLocaleString('ru-RU', {
                      day: '2-digit',
                      month: '2-digit',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  )
}

function PortalTab({ filters }: { filters: Filters }) {
  const { data, isLoading } = useQuery({
    queryKey: ['admin-tracking-pages', filters],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('admin_tracking_pages_stats', {
        p_date_from: filters.dateFrom,
        p_date_to: filters.dateTo,
        p_user_id: filters.userId,
        p_salon_id: filters.salonId,
      })
      if (error) throw error
      return (data ?? []) as Array<{
        path: string
        total_clicks: number
        unique_users: number
        unique_salons: number
        last_seen_at: string | null
      }>
    },
  })

  if (isLoading) return <p className="text-muted-foreground text-sm">Загружаю...</p>
  if (!data || data.length === 0)
    return (
      <p className="text-muted-foreground text-sm">
        Пока нет page_view событий. Трекер пишет в tracking_events при route change.
      </p>
    )

  const maxClicks = Math.max(...data.map((r) => r.total_clicks), 1)

  return (
    <div className="border-border bg-card shadow-finsm overflow-hidden rounded-lg border">
      <table className="w-full text-sm">
        <thead className="border-border bg-muted/30 border-b">
          <tr className="text-muted-foreground text-left text-[10px] font-bold uppercase tracking-wider">
            <th className="px-4 py-2.5">Страница</th>
            <th className="num px-4 py-2.5 text-right">Кликов</th>
            <th className="num px-4 py-2.5 text-right">Юзеров</th>
            <th className="num px-4 py-2.5 text-right">Салонов</th>
            <th className="num px-4 py-2.5 text-right">Среднее</th>
            <th className="px-4 py-2.5">Распределение</th>
          </tr>
        </thead>
        <tbody className="divide-border/40 divide-y">
          {data.map((r) => {
            const avg = r.unique_users > 0 ? (r.total_clicks / r.unique_users).toFixed(1) : '—'
            const pct = (r.total_clicks / maxClicks) * 100
            return (
              <tr key={r.path}>
                <td className="text-foreground truncate px-4 py-3 font-mono text-xs">{r.path}</td>
                <td className="num text-foreground px-4 py-3 text-right text-xs font-semibold">
                  {r.total_clicks}
                </td>
                <td className="num text-muted-foreground px-4 py-3 text-right text-xs">
                  {r.unique_users}
                </td>
                <td className="num text-muted-foreground px-4 py-3 text-right text-xs">
                  {r.unique_salons}
                </td>
                <td className="num text-muted-foreground px-4 py-3 text-right text-xs">{avg}</td>
                <td className="px-4 py-3" style={{ width: '25%' }}>
                  <div className="bg-muted/40 relative h-2 w-full overflow-hidden rounded-full">
                    <div
                      className="bg-brand-navy absolute left-0 top-0 h-full rounded-full"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function OnboardingTab({ filters }: { filters: Filters }) {
  const { data, isLoading } = useQuery({
    queryKey: ['admin-tracking-onboarding', filters],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('admin_tracking_onboarding_funnel', {
        p_date_from: filters.dateFrom,
        p_date_to: filters.dateTo,
      })
      if (error) throw error
      return (data ?? []) as Array<{
        step_id: string
        reached: number
        completed: number
        skipped: number
        drop_off: number
      }>
    },
  })

  if (isLoading) return <p className="text-muted-foreground text-sm">Загружаю...</p>
  if (!data || data.length === 0)
    return (
      <p className="text-muted-foreground text-sm">
        Пока нет onboarding_step событий. Трекер начнёт писать при первом проходе онбординга после
        деплоя.
      </p>
    )

  return (
    <div className="border-border bg-card shadow-finsm overflow-hidden rounded-lg border">
      <table className="w-full text-sm">
        <thead className="border-border bg-muted/30 border-b">
          <tr className="text-muted-foreground text-left text-[10px] font-bold uppercase tracking-wider">
            <th className="px-4 py-2.5">Шаг</th>
            <th className="num px-4 py-2.5 text-right">Reached</th>
            <th className="num px-4 py-2.5 text-right">Completed</th>
            <th className="num px-4 py-2.5 text-right">Skipped</th>
            <th className="num px-4 py-2.5 text-right">Drop-off</th>
            <th className="num px-4 py-2.5 text-right">% Drop</th>
          </tr>
        </thead>
        <tbody className="divide-border/40 divide-y">
          {data.map((r) => {
            const dropPct = r.reached > 0 ? ((r.drop_off / r.reached) * 100).toFixed(1) : '—'
            return (
              <tr key={r.step_id}>
                <td className="text-foreground px-4 py-3 text-xs">{r.step_id}</td>
                <td className="num text-foreground px-4 py-3 text-right text-xs">{r.reached}</td>
                <td className="num text-brand-sage-deep px-4 py-3 text-right text-xs">
                  {r.completed}
                </td>
                <td className="num text-muted-foreground px-4 py-3 text-right text-xs">
                  {r.skipped}
                </td>
                <td className="num text-destructive px-4 py-3 text-right text-xs">{r.drop_off}</td>
                <td className="num text-destructive px-4 py-3 text-right text-xs font-bold">
                  {dropPct}%
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function KpiCard({
  icon: Icon,
  label,
  value,
  sub,
  accent,
  bg,
}: {
  icon: typeof Layers
  label: string
  value: string
  sub?: string
  accent?: string
  bg?: string
}) {
  return (
    <div className={`border-border bg-card shadow-finsm rounded-lg border p-4 ${bg ?? ''}`}>
      <div className="flex items-center gap-1.5">
        <Icon className={`size-3.5 ${accent ?? 'text-muted-foreground'}`} strokeWidth={2} />
        <p className="text-muted-foreground text-[10px] font-bold uppercase tracking-wider">
          {label}
        </p>
      </div>
      <p className={`num mt-1 truncate text-2xl font-bold ${accent ?? 'text-foreground'}`}>
        {value}
      </p>
      {sub ? <p className="text-muted-foreground mt-0.5 text-[10px]">{sub}</p> : null}
    </div>
  )
}
