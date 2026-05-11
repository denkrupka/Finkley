import { ArrowLeft, Check, ChevronRight, Loader2, Lock, RefreshCw, Trash2 } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useParams } from 'react-router-dom'
import { toast } from 'sonner'

import {
  BOOKSY_SYNC_INTERVAL_OPTIONS,
  useAccountingSync,
  useBooksySync,
  useClearBooksyVisits,
  useDisconnectIntegration,
  useKsefSync,
  useSalonIntegrations,
  useUpdateBooksyInterval,
  useWfirmaSync,
  type IntegrationProvider,
  type SalonIntegrationPublic,
} from '@/hooks/useIntegrations'

import { BankingSection } from './BankingSection'
import { BooksyConnectDialog } from './BooksyConnectDialog'
import { ConnectIntegrationDialog } from './ConnectIntegrationDialog'
import { KsefConnectDialog } from './KsefConnectDialog'
import {
  CATEGORY_ORDER,
  INTEGRATIONS,
  getCategoryLabel,
  getCategorySubtitle,
  type IntegrationCategory,
  type IntegrationDef,
} from './integrations-config'
import { WfirmaConnectDialog } from './WfirmaConnectDialog'

/**
 * Список доступных интеграций. Сейчас визуал-only (TASK-27 visual scaffold):
 * статус всегда «не подключено», кнопка connect открывает модалку с полями,
 * сохранение пока вызывает toast «скоро будет». Реальный sync — TASK-28/29.
 */
export function IntegrationsPage() {
  const { t } = useTranslation()
  const { salonId } = useParams<{ salonId: string }>()
  const [connecting, setConnecting] = useState<IntegrationDef | null>(null)
  const [booksyOpen, setBooksyOpen] = useState(false)
  const [wfirmaOpen, setWfirmaOpen] = useState(false)
  const [ksefOpen, setKsefOpen] = useState(false)
  const { data: connected = [] } = useSalonIntegrations(salonId)

  if (!salonId) return null

  const connectedMap = new Map<IntegrationProvider, SalonIntegrationPublic>(
    connected.map((c) => [c.provider, c]),
  )

  function handleConnect(p: IntegrationDef) {
    if (p.id === 'booksy') setBooksyOpen(true)
    else if (p.id === 'wfirma') setWfirmaOpen(true)
    else if (p.id === 'ksef') setKsefOpen(true)
    else setConnecting(p)
  }

  return (
    <div className="flex flex-1 flex-col px-5 py-7 sm:px-8 lg:pb-12">
      <div className="mb-5">
        <Link
          to={`/${salonId}/settings`}
          className="text-muted-foreground hover:text-foreground mb-2 inline-flex items-center gap-1 text-sm"
        >
          <ArrowLeft className="size-4" strokeWidth={1.7} />
          {t('integrations.back_to_settings')}
        </Link>
        <h1 className="text-brand-navy text-2xl font-bold tracking-tight">
          {t('integrations.title')}
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">{t('integrations.subtitle')}</p>
      </div>

      {/* Группировка по категориям. Банкинг — кастомная секция (одно
          подключение != одна интеграция: юзер линкует N банков с разными
          сессиями и сроками). Бухгалтерия / запись — обычные карточки. */}
      {CATEGORY_ORDER.map((cat) => {
        if (cat === 'banking') {
          return (
            <CategorySection key={cat} category={cat}>
              <BankingSection salonId={salonId} />
            </CategorySection>
          )
        }
        const providers = INTEGRATIONS.filter((p) => p.category === cat)
        if (providers.length === 0) return null
        return (
          <CategorySection key={cat} category={cat}>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {providers.map((p) => (
                <IntegrationCard
                  key={p.id}
                  provider={p}
                  connection={connectedMap.get(p.id) ?? null}
                  salonId={salonId}
                  onConnect={() => handleConnect(p)}
                />
              ))}
            </div>
          </CategorySection>
        )
      })}

      <p className="text-muted-foreground mt-6 text-xs">{t('integrations.privacy_note')}</p>

      <ConnectIntegrationDialog provider={connecting} onClose={() => setConnecting(null)} />
      <BooksyConnectDialog open={booksyOpen} onClose={() => setBooksyOpen(false)} />
      <WfirmaConnectDialog open={wfirmaOpen} onClose={() => setWfirmaOpen(false)} />
      <KsefConnectDialog open={ksefOpen} onClose={() => setKsefOpen(false)} />
    </div>
  )
}

function CategorySection({
  category,
  children,
}: {
  category: IntegrationCategory
  children: ReactNode
}) {
  const { t } = useTranslation()
  return (
    <section className="mb-7">
      <header className="mb-3">
        <h2 className="text-brand-navy text-sm font-bold uppercase tracking-wider">
          {t(getCategoryLabel(category))}
        </h2>
        <p className="text-muted-foreground mt-0.5 text-xs">{t(getCategorySubtitle(category))}</p>
      </header>
      {children}
    </section>
  )
}

function IntegrationCard({
  provider,
  connection,
  salonId,
  onConnect,
}: {
  provider: IntegrationDef
  connection: SalonIntegrationPublic | null
  salonId: string
  onConnect: () => void
}) {
  const { t } = useTranslation()
  const Icon = provider.icon
  const booksySync = useBooksySync(salonId)
  const wfirmaSync = useWfirmaSync(salonId)
  const ksefSync = useKsefSync(salonId)
  // Универсальный sync для accounting-порталов с api_token-style auth.
  // Передаём null для booksy/wfirma/ksef — они выше в собственных хуках.
  const accountingProviderId =
    provider.id === 'fakturownia' || provider.id === 'infakt' ? provider.id : null
  const accountingSync = useAccountingSync(accountingProviderId, salonId)
  const disconnect = useDisconnectIntegration(salonId)
  const clearVisits = useClearBooksyVisits(salonId)
  const updateInterval = useUpdateBooksyInterval(salonId)
  const isLocked = provider.status !== 'available' && provider.status !== 'in_research'
  const isConnected = !!connection && connection.status !== 'disconnected'

  function triggerSync() {
    if (provider.id === 'wfirma') {
      wfirmaSync.mutate(undefined, {
        onSuccess: (stats) =>
          toast.success(
            t('integrations.toast_synced_wfirma', {
              synced: stats.expenses_synced,
              skipped: stats.expenses_skipped,
            }),
          ),
        onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
      })
      return
    }
    if (provider.id === 'ksef') {
      ksefSync.mutate(undefined, {
        onSuccess: (stats) =>
          toast.success(
            t('integrations.toast_synced_ksef', {
              synced: stats.expenses_synced,
              skipped: stats.expenses_skipped,
            }),
          ),
        onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
      })
      return
    }
    if (accountingProviderId) {
      accountingSync.mutate(undefined, {
        onSuccess: (stats) =>
          toast.success(
            t('integrations.toast_synced_expenses', {
              name: provider.name,
              synced: stats.expenses_synced,
              skipped: stats.expenses_skipped,
            }),
          ),
        onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
      })
      return
    }
    booksySync.mutate(undefined, {
      onSuccess: (stats) =>
        toast.success(
          t('integrations.toast_synced', {
            staff: stats.staff_synced,
            services: stats.services_synced,
            visits: stats.visits_synced,
          }),
        ),
      onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
    })
  }
  const syncPending =
    provider.id === 'wfirma'
      ? wfirmaSync.isPending
      : provider.id === 'ksef'
        ? ksefSync.isPending
        : accountingProviderId
          ? accountingSync.isPending
          : booksySync.isPending

  return (
    <div
      className={[
        'border-border bg-card shadow-finsm flex flex-col gap-3 rounded-lg border p-5',
        isLocked ? 'opacity-60' : '',
        isConnected ? 'border-brand-sage/40' : '',
      ].join(' ')}
    >
      <div className="flex items-start gap-3">
        <div
          className="grid size-12 shrink-0 place-items-center rounded-md text-white"
          style={{ background: provider.brandColor }}
        >
          <Icon className="size-6" strokeWidth={1.8} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-brand-navy text-base font-bold">{provider.name}</h2>
            {isConnected ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-700">
                <Check className="size-3" strokeWidth={2.5} />
                {t('integrations.status.connected')}
              </span>
            ) : (
              <StatusPill status={provider.status} />
            )}
          </div>
          <p className="text-muted-foreground mt-0.5 text-xs">{provider.region}</p>
        </div>
      </div>

      {isConnected && connection ? (
        <div className="border-border bg-muted/30 rounded-md border p-2.5 text-xs">
          {connection.last_sync_at ? (
            <p className="text-muted-foreground">
              {t('integrations.last_sync_at', {
                date: new Date(connection.last_sync_at).toLocaleString('ru-RU'),
              })}
            </p>
          ) : (
            <p className="text-muted-foreground">{t('integrations.never_synced')}</p>
          )}
          {connection.last_sync_stats ? (
            provider.id === 'wfirma' ||
            provider.id === 'ksef' ||
            provider.id === 'fakturownia' ||
            provider.id === 'infakt' ? (
              <p className="text-foreground mt-1 font-semibold">
                {t('integrations.last_sync_stats_expenses', {
                  synced: connection.last_sync_stats.expenses_synced ?? 0,
                  skipped: connection.last_sync_stats.expenses_skipped ?? 0,
                })}
              </p>
            ) : (
              <p className="text-foreground mt-1 font-semibold">
                {t('integrations.last_sync_stats', {
                  staff: connection.last_sync_stats.staff_synced ?? 0,
                  services: connection.last_sync_stats.services_synced ?? 0,
                  visits: connection.last_sync_stats.visits_synced ?? 0,
                })}
              </p>
            )
          ) : null}
          {connection.last_error ? (
            <p className="text-destructive mt-1 line-clamp-2">⚠ {connection.last_error}</p>
          ) : null}
          {provider.id === 'booksy' ? (
            <div className="border-border mt-2 flex items-center justify-between gap-2 border-t pt-2">
              <label
                htmlFor={`int-${provider.id}-interval`}
                className="text-muted-foreground text-xs"
              >
                {t('integrations.auto_sync_every')}
              </label>
              <select
                id={`int-${provider.id}-interval`}
                value={connection.sync_interval_minutes}
                onChange={(e) => {
                  const v = Number(e.target.value)
                  updateInterval.mutate(v, {
                    onSuccess: () => toast.success(t('integrations.toast_interval_updated')),
                    onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
                  })
                }}
                disabled={updateInterval.isPending}
                className="border-input bg-background h-7 rounded-md border px-2 text-xs disabled:opacity-50"
              >
                {BOOKSY_SYNC_INTERVAL_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {t(opt.label_key)}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
        </div>
      ) : (
        <p className="text-foreground/80 text-sm leading-snug">{t(provider.description_key)}</p>
      )}

      <div className="mt-auto flex items-center justify-between gap-2">
        {isLocked ? (
          <span className="text-muted-foreground inline-flex items-center gap-1 text-xs">
            <Lock className="size-3.5" strokeWidth={1.7} />
            {t('integrations.locked_hint')}
          </span>
        ) : isConnected ? (
          <>
            <button
              type="button"
              onClick={triggerSync}
              disabled={syncPending}
              className="text-secondary inline-flex items-center gap-1 text-sm font-semibold hover:underline disabled:opacity-50"
            >
              {syncPending ? (
                <Loader2 className="size-3.5 animate-spin" strokeWidth={2} />
              ) : (
                <RefreshCw className="size-3.5" strokeWidth={2} />
              )}
              {t('integrations.sync_now')}
            </button>
            {provider.id === 'booksy' ? (
              <button
                type="button"
                onClick={() => {
                  if (!confirm(t('integrations.confirm_clear_visits'))) return
                  clearVisits.mutate(undefined, {
                    onSuccess: (n) => toast.success(t('integrations.toast_visits_cleared', { n })),
                    onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
                  })
                }}
                disabled={clearVisits.isPending}
                className="text-muted-foreground hover:text-destructive text-xs underline disabled:opacity-50"
                title={t('integrations.clear_visits')}
              >
                {t('integrations.clear_visits')}
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => {
                if (!confirm(t('integrations.confirm_disconnect'))) return
                disconnect.mutate(provider.id, {
                  onSuccess: () => toast.success(t('integrations.toast_disconnected')),
                })
              }}
              className="text-muted-foreground hover:text-destructive grid size-7 place-items-center rounded-md"
              aria-label={t('integrations.disconnect')}
              title={t('integrations.disconnect')}
            >
              <Trash2 className="size-3.5" strokeWidth={1.7} />
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={onConnect}
            className="text-secondary inline-flex items-center gap-1 text-sm font-semibold hover:underline"
          >
            {t('integrations.connect')}
            <ChevronRight className="size-3.5" strokeWidth={2} />
          </button>
        )}
      </div>
    </div>
  )
}

function StatusPill({ status }: { status: IntegrationDef['status'] }) {
  const { t } = useTranslation()
  const map = {
    available: { label: 'integrations.status.available', cls: 'bg-emerald-100 text-emerald-700' },
    in_research: { label: 'integrations.status.in_research', cls: 'bg-amber-100 text-amber-800' },
    coming_soon: { label: 'integrations.status.coming_soon', cls: 'bg-slate-100 text-slate-600' },
  } as const
  const m = map[status]
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${m.cls}`}
    >
      {status === 'available' ? <Check className="size-3" strokeWidth={2.5} /> : null}
      {t(m.label)}
    </span>
  )
}
