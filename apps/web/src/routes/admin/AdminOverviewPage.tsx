import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import { useAdminOverview } from '@/hooks/useAdmin'

/** "YYYY-MM" → "май" (русское короткое название месяца). */
const MONTH_RU = [
  'янв',
  'фев',
  'мар',
  'апр',
  'май',
  'июн',
  'июл',
  'авг',
  'сен',
  'окт',
  'ноя',
  'дек',
]
function monthLabel(key: string): string {
  const [, m] = key.split('-')
  const idx = Number(m) - 1
  return MONTH_RU[idx] ?? key
}

export function AdminOverviewPage() {
  const { t } = useTranslation()
  const { data, isLoading, error } = useAdminOverview()

  const salonChartData = useMemo(
    () => (data?.charts.salons_by_month ?? []).map((p) => ({ ...p, label: monthLabel(p.month) })),
    [data],
  )
  const userChartData = useMemo(
    () => (data?.charts.users_by_month ?? []).map((p) => ({ ...p, label: monthLabel(p.month) })),
    [data],
  )
  if (isLoading) {
    return (
      <div className="p-8">
        <p className="text-muted-foreground text-sm">{t('common.loading')}</p>
      </div>
    )
  }
  if (error || !data) {
    return (
      <div className="p-8">
        <p className="text-destructive text-sm">
          {error instanceof Error ? error.message : 'load_failed'}
        </p>
      </div>
    )
  }

  const salonCards = [
    { label: t('admin.overview.salons_total'), value: data.salons.total, tone: 'navy' as const },
    {
      label: t('admin.overview.salons_subscribed'),
      value: data.salons.subscribed,
      tone: 'green' as const,
    },
    {
      label: t('admin.overview.salons_on_trial'),
      value: data.salons.on_trial,
      tone: 'blue' as const,
    },
    {
      label: t('admin.overview.salons_trial_expired'),
      value: data.salons.trial_expired,
      tone: 'amber' as const,
    },
    {
      label: t('admin.overview.salons_inactive_no_sub'),
      value: data.salons.inactive_no_sub,
      tone: 'slate' as const,
      hint: t('admin.overview.inactive_hint'),
    },
  ]
  const userCards = [
    { label: t('admin.overview.users_total'), value: data.users.total, tone: 'navy' as const },
    {
      label: t('admin.overview.users_active_30d'),
      value: data.users.active_30d,
      tone: 'green' as const,
    },
  ]

  const TONE_STYLE: Record<string, string> = {
    navy: 'text-brand-navy',
    green: 'text-emerald-600',
    blue: 'text-sky-600',
    amber: 'text-amber-600',
    slate: 'text-slate-500',
  }

  return (
    <div className="flex flex-1 flex-col gap-6 p-5 sm:p-8">
      <section>
        <h2 className="text-brand-navy text-base font-bold">
          {t('admin.overview.section_salons')}
        </h2>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {salonCards.map((c) => (
            <div key={c.label} className="border-border bg-card shadow-finsm rounded-lg border p-4">
              <p className="text-muted-foreground text-[11px] font-semibold uppercase tracking-wider">
                {c.label}
              </p>
              <p className={`mt-2 text-3xl font-bold ${TONE_STYLE[c.tone]}`}>{c.value}</p>
              {c.hint ? <p className="text-muted-foreground mt-1 text-[10px]">{c.hint}</p> : null}
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="text-brand-navy text-base font-bold">{t('admin.overview.section_users')}</h2>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {userCards.map((c) => (
            <div key={c.label} className="border-border bg-card shadow-finsm rounded-lg border p-4">
              <p className="text-muted-foreground text-[11px] font-semibold uppercase tracking-wider">
                {c.label}
              </p>
              <p className={`mt-2 text-3xl font-bold ${TONE_STYLE[c.tone]}`}>{c.value}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <ChartCard title={t('admin.overview.chart_salons')}>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={salonChartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
              <XAxis dataKey="label" stroke="#94a3b8" fontSize={11} />
              <YAxis stroke="#94a3b8" fontSize={11} allowDecimals={false} />
              <Tooltip />
              <Bar dataKey="count" fill="#0ea5e9" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title={t('admin.overview.chart_users')}>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={userChartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
              <XAxis dataKey="label" stroke="#94a3b8" fontSize={11} />
              <YAxis stroke="#94a3b8" fontSize={11} allowDecimals={false} />
              <Tooltip />
              <Line
                type="monotone"
                dataKey="count"
                stroke="#10b981"
                strokeWidth={2}
                dot={{ r: 3 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>
        {/* «Визиты по месяцам» удалён — на админ-обзоре эта метрика
            бесполезна (она не отражает рост платформы и путает с
            продакт-метриками; удалено по запросу владельца). */}
      </section>
    </div>
  )
}

function ChartCard({
  title,
  children,
  wide,
}: {
  title: string
  children: React.ReactNode
  wide?: boolean
}) {
  return (
    <div
      className={[
        'border-border bg-card shadow-finsm rounded-lg border p-4',
        wide ? 'xl:col-span-2' : '',
      ].join(' ')}
    >
      <h3 className="text-foreground text-sm font-bold">{title}</h3>
      <div className="mt-3">{children}</div>
    </div>
  )
}
