import { useQuery } from '@tanstack/react-query'
import { Layers, ListTree, MousePointerClick } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { supabase } from '@/lib/supabase/client'

type Subtab = 'stats' | 'portal' | 'onboarding'

const SUBS: { id: Subtab; label: string; icon: typeof Layers }[] = [
  { id: 'stats', label: 'Статистика', icon: Layers },
  { id: 'portal', label: 'Портал', icon: ListTree },
  { id: 'onboarding', label: 'Онбординг', icon: MousePointerClick },
]

/**
 * Admin → Трекинг.
 * Юзер 02.06: 'в админке создай вкладку трекинг — отслеживать что
 * пользуется в портале. Подвкладки Статистика | Портал | Онбординг'.
 *
 * MVP-версия с 3 subtabs:
 * - Статистика: total clicks/users/salons + top/least path (RPC admin_tracking_overview)
 * - Портал: список путей с count/unique_users (RPC admin_tracking_pages_stats)
 * - Онбординг: funnel reached/completed/skipped/drop_off (RPC admin_tracking_onboarding_funnel)
 *
 * Все RPC проверяют app_admins.is_super=true. Трекинг событий пишется
 * через клиентский хук (отдельный PR — пока таблица заполняется
 * системными событиями типа page_view).
 */
export function AdminTrackingPage() {
  void useTranslation() // зарезервировано для будущей локализации
  const [sub, setSub] = useState<Subtab>('stats')

  return (
    <div className="flex flex-1 flex-col p-5 sm:p-8">
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

      {sub === 'stats' ? <StatsTab /> : null}
      {sub === 'portal' ? <PortalTab /> : null}
      {sub === 'onboarding' ? <OnboardingTab /> : null}
    </div>
  )
}

function StatsTab() {
  const { data, isLoading } = useQuery({
    queryKey: ['admin-tracking-overview'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('admin_tracking_overview', {
        p_date_from: null,
        p_date_to: null,
      })
      if (error) throw error
      return (data?.[0] ?? null) as {
        total_events: number
        total_users: number
        total_salons: number
        top_path: string
        top_path_clicks: number
        least_used_path: string
        least_used_path_clicks: number
      } | null
    },
  })

  if (isLoading) return <p className="text-muted-foreground text-sm">Загружаю...</p>
  if (!data)
    return (
      <p className="text-muted-foreground text-sm">
        Пока нет данных. Трекинг событий начнётся после первого page_view.
      </p>
    )

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <KpiCard label="Всего событий" value={String(data.total_events)} />
      <KpiCard label="Уникальных юзеров" value={String(data.total_users)} />
      <KpiCard label="Уникальных салонов" value={String(data.total_salons)} />
      <KpiCard
        label="Самая популярная страница"
        value={data.top_path}
        sub={`${data.top_path_clicks} кликов`}
      />
      <KpiCard
        label="Наименее используемая"
        value={data.least_used_path}
        sub={`${data.least_used_path_clicks} кликов`}
      />
    </div>
  )
}

function PortalTab() {
  const { data, isLoading } = useQuery({
    queryKey: ['admin-tracking-pages'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('admin_tracking_pages_stats', {
        p_date_from: null,
        p_date_to: null,
        p_user_id: null,
        p_salon_id: null,
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
          </tr>
        </thead>
        <tbody className="divide-border/40 divide-y">
          {data.map((r) => {
            const avg = r.unique_users > 0 ? (r.total_clicks / r.unique_users).toFixed(1) : '—'
            return (
              <tr key={r.path}>
                <td className="text-foreground truncate px-4 py-3 text-xs">{r.path}</td>
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
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function OnboardingTab() {
  const { data, isLoading } = useQuery({
    queryKey: ['admin-tracking-onboarding'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('admin_tracking_onboarding_funnel', {
        p_date_from: null,
        p_date_to: null,
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

function KpiCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="border-border bg-card shadow-finsm rounded-lg border p-4">
      <p className="text-muted-foreground text-[10px] font-bold uppercase tracking-wider">
        {label}
      </p>
      <p className="text-foreground num mt-1 truncate text-xl font-bold">{value}</p>
      {sub ? <p className="text-muted-foreground mt-0.5 text-[10px]">{sub}</p> : null}
    </div>
  )
}
