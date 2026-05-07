import { formatDistanceToNow, parseISO } from 'date-fns'
import { ru } from 'date-fns/locale'
import { Plus, Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useParams } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useClients, type ClientRow, type ClientSort } from '@/hooks/useClients'
import { useSalon } from '@/hooks/useSalons'
import { formatCurrency } from '@/lib/utils/format-currency'
import { formatPhoneDisplay } from '@/lib/utils/format-phone'
import { ClientDrawer } from './ClientDrawer'
import { ClientFormModal } from './ClientFormModal'

export function ClientsPage() {
  const { t } = useTranslation()
  const { salonId } = useParams<{ salonId: string }>()
  const { data: salon } = useSalon(salonId)
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<ClientSort>('last_visit')
  const [createOpen, setCreateOpen] = useState(false)
  const [drawerClient, setDrawerClient] = useState<ClientRow | null>(null)

  const { data: clients = [], isLoading } = useClients(salonId, { search, sort })

  // Простые KPI поверх списка
  const summary = useMemo(() => {
    const totalCount = clients.length
    const activeCount = clients.filter((c) => c.last_visit_at).length
    const totalRevenue = clients.reduce((acc, c) => acc + c.total_revenue_cents, 0)
    return { totalCount, activeCount, totalRevenue }
  }, [clients])

  if (!salon || !salonId) return null
  const currency = salon.currency

  return (
    <div className="flex flex-1 flex-col px-5 py-7 sm:px-8 lg:pb-12">
      {/* Header */}
      <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
        <div>
          <h1 className="text-brand-navy text-2xl font-bold tracking-tight">
            {t('clients.title')}
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {t('clients.subtitle', { count: summary.totalCount })}
          </p>
        </div>
        <Button
          variant="primary"
          size="md"
          onClick={() => setCreateOpen(true)}
          data-testid="add-client"
        >
          <Plus className="size-4" strokeWidth={2.4} />
          {t('clients.add')}
        </Button>
      </div>

      {/* Summary cards */}
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <KpiCard label={t('clients.kpi.total')} value={String(summary.totalCount)} tone="navy" />
        <KpiCard label={t('clients.kpi.active')} value={String(summary.activeCount)} tone="sage" />
        <KpiCard
          label={t('clients.kpi.lifetime_revenue')}
          value={formatCurrency(summary.totalRevenue, currency)}
          tone="amber"
        />
      </div>

      {/* Toolbar */}
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
        <div className="relative flex-1">
          <Search
            className="text-muted-foreground pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2"
            strokeWidth={1.7}
          />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('clients.search_placeholder')}
            className="pl-10"
            data-testid="cl-search"
          />
        </div>
        <Select value={sort} onValueChange={(v) => setSort(v as ClientSort)}>
          <SelectTrigger className="sm:w-56" data-testid="cl-sort">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="last_visit">{t('clients.sort.last_visit')}</SelectItem>
            <SelectItem value="name">{t('clients.sort.name')}</SelectItem>
            <SelectItem value="revenue">{t('clients.sort.revenue')}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* List */}
      <div className="border-border bg-card shadow-finsm rounded-lg border">
        <div className="border-border flex items-baseline justify-between border-b px-5 py-4">
          <h2 className="text-brand-navy text-base font-bold tracking-tight">
            {t('clients.list_title')}
          </h2>
          <span className="text-muted-foreground text-xs">
            {clients.length} {t('clients.records')}
          </span>
        </div>

        {isLoading ? (
          <div className="space-y-2 p-3">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="bg-muted/60 h-14 animate-pulse rounded-md" />
            ))}
          </div>
        ) : clients.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <p className="text-muted-foreground text-sm">
              {search ? t('clients.empty_search') : t('clients.empty')}
            </p>
          </div>
        ) : (
          <ul>
            {clients.map((c) => (
              <li
                key={c.id}
                className="border-border hover:bg-muted/40 grid cursor-pointer grid-cols-[1fr_auto_auto] items-center gap-3 border-t px-5 py-3 first:border-t-0"
                onClick={() => setDrawerClient(c)}
                data-testid="client-row"
              >
                <div className="min-w-0">
                  <p className="text-foreground truncate text-sm font-semibold">{c.name}</p>
                  <p className="num text-brand-text-faint text-[12px]">
                    {c.phone ? formatPhoneDisplay(c.phone) : c.email || ''}
                  </p>
                </div>
                <div className="text-right">
                  <p className="num text-foreground text-sm font-bold">
                    {formatCurrency(c.total_revenue_cents, currency)}
                  </p>
                  <p className="text-muted-foreground text-[11px]">
                    {c.visit_count} {t('clients.drawer.visits_count')}
                  </p>
                </div>
                <span className="text-muted-foreground hidden w-[100px] text-right text-[11px] sm:block">
                  {c.last_visit_at
                    ? formatDistanceToNow(parseISO(c.last_visit_at), {
                        addSuffix: true,
                        locale: ru,
                      })
                    : '—'}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <ClientFormModal open={createOpen} onOpenChange={setCreateOpen} salonId={salonId} />

      <ClientDrawer
        open={!!drawerClient}
        onOpenChange={(o) => {
          if (!o) setDrawerClient(null)
        }}
        salonId={salonId}
        client={drawerClient}
        currency={currency}
      />
    </div>
  )
}

type Tone = 'navy' | 'sage' | 'amber'

function KpiCard({ label, value, tone }: { label: string; value: string; tone: Tone }) {
  const colorClass: Record<Tone, string> = {
    navy: 'border-l-brand-navy',
    sage: 'border-l-brand-sage',
    amber: 'border-l-brand-yellow-deep',
  }
  return (
    <div
      className={`border-border bg-card shadow-finsm rounded-lg border border-l-4 p-4 ${colorClass[tone]}`}
    >
      <div className="text-muted-foreground text-xs font-semibold">{label}</div>
      <div className="num text-foreground mt-2 text-xl font-bold tracking-tight">{value}</div>
    </div>
  )
}
