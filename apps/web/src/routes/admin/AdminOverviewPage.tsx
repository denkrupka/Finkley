import { useTranslation } from 'react-i18next'

import { useAdminOverview } from '@/hooks/useAdmin'
import { formatCurrency } from '@/lib/utils/format-currency'

export function AdminOverviewPage() {
  const { t } = useTranslation()
  const { data, isLoading, error } = useAdminOverview()

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

  const cards = [
    {
      label: t('admin.overview.salons_total'),
      value: data.salons.total,
      sub: t('admin.overview.salons_active', { count: data.salons.active }),
    },
    { label: t('admin.overview.users_total'), value: data.users.total, sub: '' },
    {
      label: t('admin.overview.visits_30d'),
      value: data.last30d.visits,
      sub: formatCurrency(data.last30d.revenue_cents, 'PLN'),
    },
    {
      label: t('admin.overview.expenses_30d'),
      value: data.last30d.expenses,
      sub: formatCurrency(data.last30d.expenses_cents, 'PLN'),
    },
    {
      label: t('admin.overview.gross_profit_30d'),
      value: formatCurrency(data.last30d.gross_profit_cents, 'PLN'),
      sub: '',
    },
    {
      label: t('admin.overview.messages_total'),
      value: data.messages_total,
      sub: '',
    },
  ]

  return (
    <div className="flex flex-1 flex-col gap-6 p-5 sm:p-8">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((c) => (
          <div key={c.label} className="border-border bg-card shadow-finsm rounded-lg border p-5">
            <p className="text-muted-foreground text-xs font-semibold uppercase tracking-wider">
              {c.label}
            </p>
            <p className="text-brand-navy mt-2 text-3xl font-bold">{c.value}</p>
            {c.sub ? <p className="text-muted-foreground mt-1 text-xs">{c.sub}</p> : null}
          </div>
        ))}
      </div>

      <div className="border-border bg-card shadow-finsm rounded-lg border p-5">
        <h2 className="text-brand-navy text-base font-bold">
          {t('admin.overview.messenger_breakdown')}
        </h2>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Object.entries(data.messenger_integrations).map(([ch, v]) => (
            <div key={ch} className="border-border bg-muted/30 rounded-md border p-3">
              <p className="text-foreground text-sm font-semibold capitalize">{ch}</p>
              <p className="text-muted-foreground mt-1 text-xs">
                {v.connected} / {v.total} connected
              </p>
            </div>
          ))}
          {Object.keys(data.messenger_integrations).length === 0 ? (
            <p className="text-muted-foreground col-span-full text-sm">
              {t('admin.overview.no_integrations_yet')}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  )
}
