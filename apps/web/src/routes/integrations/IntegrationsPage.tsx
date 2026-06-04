import {
  ArrowLeft,
  Check,
  ChevronRight,
  Facebook,
  Instagram,
  Loader2,
  Lock,
  Mail,
  Phone,
  RefreshCw,
  Send,
  Trash2,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'

import { useQueryClient } from '@tanstack/react-query'

import {
  BOOKSY_SYNC_INTERVAL_OPTIONS,
  useAccountingSync,
  useBooksySync,
  useBackfillBooksyApptUids,
  useClearBooksyVisits,
  useDisconnectIntegration,
  useForceBooksyHistoryResync,
  useKsefSync,
  useSalonIntegrations,
  useUpdateBooksyInterval,
  useUpdateProviderInterval,
  useWfirmaSync,
  type IntegrationProvider,
  type SalonIntegrationPublic,
} from '@/hooks/useIntegrations'

import { InstallAppButton } from '@/components/pwa/InstallAppButton'
import { consumeOnboardingPrompt } from '@/lib/onboarding-credentials'
import {
  parsePromptQueue,
  serializePromptQueue,
  shiftPromptQueue,
} from '@/lib/onboarding-prompt-queue'

import { BankingSection } from './BankingSection'
import { SmsSection } from './SmsSection'
import { BooksyConnectDialog } from './BooksyConnectDialog'
import { BooksyStaffInviteModal } from './BooksyStaffInviteModal'
import { ConnectIntegrationDialog } from './ConnectIntegrationDialog'
import { EmailConnectDialog } from './EmailConnectDialog'
import { MessengerConnectDialog } from './MessengerConnectDialog'
import { TelegramUserbotConnectDialog } from './TelegramUserbotConnectDialog'
import { useTgLogout, useTgSessions } from '@/hooks/useTgUserbot'
import { useDisconnectMessenger, useMessengerIntegrations } from '@/hooks/useMessenger'
import {
  CATEGORY_ORDER,
  INTEGRATIONS,
  getCategorySubtitle,
  type IntegrationCategory,
  type IntegrationDef,
} from './integrations-config'
import { IntegrationsTabsNav } from './IntegrationsTabsNav'
import { KsefConnectDialog } from './KsefConnectDialog'
import { WfirmaConnectDialog } from './WfirmaConnectDialog'

/**
 * Список доступных интеграций. Используется внутри Settings → Интеграции
 * tab. Адрес страницы — `/{salonId}/settings/integrations`, без back-link
 * (страница — это подвкладка настроек).
 */
function isCategory(v: string | null): v is IntegrationCategory {
  return v != null && (CATEGORY_ORDER as readonly string[]).includes(v)
}

/** Вариант без собственного header'а — рендерится внутри SettingsPage. */
export function IntegrationsContent() {
  return <IntegrationsPage embedded />
}

export function IntegrationsPage({ embedded = false }: { embedded?: boolean } = {}) {
  const { t } = useTranslation()
  const { salonId } = useParams<{ salonId: string }>()
  const [params, setParams] = useSearchParams()
  const [connecting, setConnecting] = useState<IntegrationDef | null>(null)
  const [booksyOpen, setBooksyOpen] = useState(false)
  const [booksyInviteOpen, setBooksyInviteOpen] = useState(false)
  const [wfirmaOpen, setWfirmaOpen] = useState(false)
  const [ksefOpen, setKsefOpen] = useState(false)
  const { data: connected = [] } = useSalonIntegrations(salonId)
  const qc = useQueryClient()
  const navigate = useNavigate()

  // OAuth callback: после возврата с Meta наш edge function редиректит сюда
  // с ?fb=connected или ?ig=connected (success) или ?fb=error&reason=... (failure).
  // Показываем toast, инвалидируем кеш integrations, чистим query params.
  useEffect(() => {
    const fb = params.get('fb')
    const ig = params.get('ig')
    const igViaPage = params.get('ig_via_page')
    const fbPage = params.get('page')
    const igAccount = params.get('account')
    const reason = params.get('reason')

    let touched = false
    if (fb === 'connected') {
      touched = true
      toast.success(
        fbPage
          ? t('integrations.messengers.oauth_success', { name: 'Facebook', account: fbPage })
          : t('integrations.messengers.toast_connected', { name: 'Facebook' }),
      )
      if (igViaPage) {
        toast.success(
          t('integrations.messengers.oauth_success', { name: 'Instagram', account: igViaPage }),
        )
      }
    }
    if (ig === 'connected') {
      touched = true
      toast.success(
        igAccount
          ? t('integrations.messengers.oauth_success', { name: 'Instagram', account: igAccount })
          : t('integrations.messengers.toast_connected', { name: 'Instagram' }),
      )
    }
    if (fb === 'error' || ig === 'error') {
      touched = true
      toast.error(
        t('integrations.messengers.oauth_error', {
          reason: reason ?? 'unknown',
        }),
      )
    }
    if (touched) {
      qc.invalidateQueries({ queryKey: ['messenger-integrations', salonId] })
      const next = new URLSearchParams(params)
      for (const k of ['fb', 'ig', 'ig_via_page', 'page', 'account', 'reason']) next.delete(k)
      setParams(next, { replace: true })

      // Если OAuth был запущен из онбординга — возвращаемся туда (флаг
      // выставляется в MessengerConnectDialog.handleOAuth).
      try {
        const returnSalonId = localStorage.getItem('finkley:oauth-return-onboarding')
        if (returnSalonId) {
          localStorage.removeItem('finkley:oauth-return-onboarding')
          navigate(`/onboarding?salon=${returnSalonId}`, { replace: true })
        }
      } catch {
        /* ignore */
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.get('fb'), params.get('ig')])

  // T204 — Stripe success/cancel feedback toast после возврата из Checkout.
  // success_url/cancel_url ставит ?stripe=success или ?stripe=cancel + prompt
  // (см. create-checkout-session T186).
  const stripeStatus = params.get('stripe')
  useEffect(() => {
    if (stripeStatus === 'success') {
      toast.success(t('integrations.stripe_success'))
    } else if (stripeStatus === 'cancel') {
      toast.info(t('integrations.stripe_cancel'))
    }
    if (stripeStatus) {
      const next = new URLSearchParams(params)
      next.delete('stripe')
      setParams(next, { replace: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stripeStatus])

  // T175+T179 — обработка ?prompt=<provider1>,<provider2> из онбординга.
  // Источник: URL query (свежий редирект) ИЛИ localStorage (если юзер
  // возвращается из Stripe Checkout — query потерян).
  const promptParam = params.get('prompt')

  // T180+T218 — при закрытии каждого dialog'a берём следующий prompt
  // через pure helpers (см. lib/onboarding-prompt-queue, 14 unit-тестов).
  function consumeNextPrompt(): void {
    const queue = parsePromptQueue(params.get('prompt'))
    const { head, rest } = shiftPromptQueue(queue)
    if (!head) return
    openProviderDialog(head)
    const newParams = new URLSearchParams(params)
    const serialized = serializePromptQueue(rest)
    if (serialized) newParams.set('prompt', serialized)
    else newParams.delete('prompt')
    setParams(newParams, { replace: true })
  }

  function openProviderDialog(provider: string): void {
    if (provider === 'booksy') setBooksyOpen(true)
    else if (provider === 'wfirma') setWfirmaOpen(true)
    else if (provider === 'ksef') setKsefOpen(true)
    else if (provider === 'instagram' || provider === 'facebook' || provider === 'whatsapp') {
      const next2 = new URLSearchParams(params)
      next2.set('messenger', provider)
      next2.set('tab', 'messengers')
      setParams(next2, { replace: true })
    } else {
      const def = INTEGRATIONS.find((p) => p.id === provider)
      if (def) setConnecting(def)
    }
  }

  useEffect(() => {
    // T192+T218 — единый setParams call за effect (избегаем race).
    // Источник prompt: URL query (свежий редирект) или localStorage
    // (T199 unified). Парсинг через pure helpers (T218).
    let queue = parsePromptQueue(promptParam)
    let fromStorage = false
    if (queue.length === 0 && salonId) {
      const stored = consumeOnboardingPrompt(salonId)
      if (stored) {
        queue = parsePromptQueue(stored)
        fromStorage = true
      }
    }
    const { head, rest } = shiftPromptQueue(queue)
    if (!head) return
    openProviderDialog(head)
    const next = new URLSearchParams(params)
    const serialized = serializePromptQueue(rest)
    if (serialized) next.set('prompt', serialized)
    else next.delete('prompt')
    if (fromStorage) next.set('tab', 'booking')
    setParams(next, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [promptParam, salonId])

  // Активная вкладка — в URL `?tab=booking`, дефолт booking (запись и календарь).
  const tabParam = params.get('tab')
  const activeCategory: IntegrationCategory = isCategory(tabParam) ? tabParam : 'booking'
  function setActiveCategory(cat: IntegrationCategory) {
    const next = new URLSearchParams(params)
    next.set('tab', cat)
    setParams(next, { replace: true })
  }

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

  const tabProviders = INTEGRATIONS.filter((p) => p.category === activeCategory)

  return (
    <div className={embedded ? '' : 'flex flex-1 flex-col px-5 py-7 sm:px-8 lg:pb-12'}>
      {embedded ? null : (
        <div className="mb-5 flex flex-col gap-2">
          <Link
            to={`/${salonId}/settings`}
            className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-xs"
          >
            <ArrowLeft className="size-3.5" strokeWidth={2} />
            {t('integrations.back_to_settings')}
          </Link>
          <h1 className="text-brand-navy text-2xl font-bold tracking-tight">
            {t('integrations.title')}
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">{t('integrations.subtitle')}</p>
        </div>
      )}

      <IntegrationsTabsNav active={activeCategory} onChange={setActiveCategory} />

      <p className="text-muted-foreground mb-4 text-xs">{t(getCategorySubtitle(activeCategory))}</p>

      {activeCategory === 'banking' ? (
        <BankingSection salonId={salonId} />
      ) : activeCategory === 'messengers' ? (
        <MessengerConnectorsSection salonId={salonId} />
      ) : activeCategory === 'sms' ? (
        <SmsSection salonId={salonId} />
      ) : activeCategory === 'other' ? (
        <OtherIntegrationsSection />
      ) : tabProviders.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t('integrations.tab_empty')}</p>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {tabProviders.map((p) => (
            <IntegrationCard
              key={p.id}
              provider={p}
              connection={connectedMap.get(p.id) ?? null}
              salonId={salonId}
              onConnect={() => handleConnect(p)}
            />
          ))}
        </div>
      )}

      <p className="text-muted-foreground mt-6 text-xs">{t('integrations.privacy_note')}</p>

      <ConnectIntegrationDialog
        provider={connecting}
        onClose={() => {
          setConnecting(null)
          consumeNextPrompt()
        }}
      />
      <BooksyConnectDialog
        open={booksyOpen}
        onClose={() => {
          setBooksyOpen(false)
          // После закрытия (значит config сохранён) — открываем invite-модалку
          // с задержкой, чтобы дать caталог-sync подгрузить мастеров.
          setTimeout(() => setBooksyInviteOpen(true), 800)
          consumeNextPrompt()
        }}
      />
      <BooksyStaffInviteModal open={booksyInviteOpen} onClose={() => setBooksyInviteOpen(false)} />
      <WfirmaConnectDialog
        open={wfirmaOpen}
        onClose={() => {
          setWfirmaOpen(false)
          consumeNextPrompt()
        }}
      />
      <KsefConnectDialog
        open={ksefOpen}
        onClose={() => {
          setKsefOpen(false)
          consumeNextPrompt()
        }}
      />
    </div>
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
  // Owner-feedback 04.06: pg_cron почему-то не fire'ит auto-sync (миграции
  // применены, функция переписана через rendezvous-token, но last_sync_at
  // упорно не двигается). Клиентский fallback: при загрузке если KSeF
  // connected и интервал просрочен — дёргаем sync с клиента. One-shot
  // per mount через ref-guard. Юзер хотя бы получает синк при открытии
  // страницы Интеграции.
  const autoSyncFiredRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    if (provider.id !== 'ksef') return
    if (!connection || connection.status !== 'connected') return
    if (autoSyncFiredRef.current.has(provider.id)) return
    const interval = connection.sync_interval_minutes ?? 60
    const lastMs = connection.last_sync_at ? new Date(connection.last_sync_at).getTime() : 0
    if (Date.now() - lastMs < interval * 60_000) return
    autoSyncFiredRef.current.add(provider.id)
    ksefSync.mutate(undefined, {
      onSuccess: (stats) =>
        toast.success(
          t('integrations.toast_synced_short', {
            defaultValue: 'Авто-синк: +{{n}} фактур',
            n: stats?.expenses_synced ?? 0,
          }),
        ),
      // Тихие ошибки — не пугаем юзера на каждой загрузке. Кнопка
      // «Синхронизировать сейчас» рядом для явного retry.
      onError: () => {},
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider.id, connection?.id, connection?.status, connection?.last_sync_at])
  // Универсальный sync для accounting-порталов с api_token-style auth.
  // Передаём null для booksy/wfirma/ksef — они выше в собственных хуках.
  const accountingProviderId =
    provider.id === 'fakturownia' || provider.id === 'infakt' ? provider.id : null
  const accountingSync = useAccountingSync(accountingProviderId, salonId)
  const disconnect = useDisconnectIntegration(salonId)
  const clearVisits = useClearBooksyVisits(salonId)
  const backfillAppts = useBackfillBooksyApptUids(salonId)
  const forceHistoryResync = useForceBooksyHistoryResync(salonId)
  // Booksy имеет свой edge-function update_interval (он re-schedule'ит
  // pg_cron job). Остальные провайдеры → прямой UPDATE через RLS.
  const updateBooksyInterval = useUpdateBooksyInterval(salonId)
  const updateProviderInterval = useUpdateProviderInterval(provider.id, salonId)
  const updateInterval = provider.id === 'booksy' ? updateBooksyInterval : updateProviderInterval
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
        onSuccess: (stats) => {
          toast.success(
            t('integrations.toast_synced_expenses', {
              name: provider.name,
              synced: stats.expenses_synced,
              skipped: stats.expenses_skipped,
            }),
          )
          // Bug проактивный 03.06: если skip_reasons непустой — показываем
          // отдельный warning-toast с первыми 5 причинами. Юзер видел "10
          // пропущено" без понимания почему.
          const reasons = stats.skip_reasons ?? []
          if (reasons.length > 0) {
            toast.warning(
              `Причины skip: ${reasons.slice(0, 5).join('; ')}${reasons.length > 5 ? ` … ещё ${reasons.length - 5}` : ''}`,
              { duration: 15000 },
            )
          }
        },
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
          {/* Авто-синк интервал — теперь для всех поддерживаемых провайдеров
              (Booksy + KSeF + wFirma + Fakturownia + inFakt + Treatwell).
              Юзер 02.06: 'делай период для KSeF на выбор клиента — как в букси'. */}
          {['booksy', 'ksef', 'wfirma', 'fakturownia', 'infakt', 'treatwell'].includes(
            provider.id,
          ) ? (
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
              <>
                <button
                  type="button"
                  onClick={() => {
                    if (!confirm(t('integrations.confirm_clear_visits'))) return
                    clearVisits.mutate(undefined, {
                      onSuccess: (n) =>
                        toast.success(t('integrations.toast_visits_cleared', { n })),
                      onError: (err) =>
                        toast.error(err instanceof Error ? err.message : String(err)),
                    })
                  }}
                  disabled={clearVisits.isPending}
                  className="text-muted-foreground hover:text-destructive text-xs underline disabled:opacity-50"
                  title={t('integrations.clear_visits')}
                >
                  {t('integrations.clear_visits')}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    backfillAppts.mutate(undefined, {
                      onSuccess: ({ scanned, patched }) =>
                        toast.success(t('integrations.toast_backfill_done', { patched, scanned })),
                      onError: (err) =>
                        toast.error(err instanceof Error ? err.message : String(err)),
                    })
                  }}
                  disabled={backfillAppts.isPending}
                  className="text-muted-foreground hover:text-foreground text-xs underline disabled:opacity-50"
                  title={t('integrations.backfill_appt_uids_hint')}
                >
                  {backfillAppts.isPending
                    ? t('common.loading')
                    : t('integrations.backfill_appt_uids')}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (!confirm(t('integrations.confirm_force_history_resync'))) return
                    forceHistoryResync.mutate(undefined, {
                      onSuccess: (stats) => {
                        const processed = stats.clients_processed ?? 0
                        const total = stats.clients_total ?? 0
                        const visits = stats.history_visits_synced ?? 0
                        if (stats.finished) {
                          toast.success(
                            t('integrations.toast_force_history_done', {
                              processed,
                              total,
                              visits,
                            }),
                          )
                        } else {
                          toast.info(
                            t('integrations.toast_force_history_partial', {
                              processed,
                              total,
                              visits,
                            }),
                            { duration: 8000 },
                          )
                        }
                      },
                      onError: (err) =>
                        toast.error(err instanceof Error ? err.message : String(err)),
                    })
                  }}
                  disabled={forceHistoryResync.isPending}
                  className="text-muted-foreground hover:text-foreground text-xs underline disabled:opacity-50"
                  title={t('integrations.force_history_resync_hint')}
                >
                  {forceHistoryResync.isPending
                    ? t('common.loading')
                    : t('integrations.force_history_resync')}
                </button>
              </>
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

function MessengerConnectorsSection({ salonId }: { salonId: string }) {
  const { t } = useTranslation()
  const { data: integrations = [] } = useMessengerIntegrations(salonId)
  const disconnect = useDisconnectMessenger(salonId)
  const [openChannel, setOpenChannel] = useState<'whatsapp' | 'instagram' | 'facebook' | null>(null)
  const [tgUserbotOpen, setTgUserbotOpen] = useState(false)
  // T175 — обработка ?messenger=<channel> из prompt-handler выше.
  const [params, setParams] = useSearchParams()
  const messengerParam = params.get('messenger')
  useEffect(() => {
    if (!messengerParam) return
    if (
      messengerParam === 'whatsapp' ||
      messengerParam === 'instagram' ||
      messengerParam === 'facebook'
    ) {
      setOpenChannel(messengerParam)
      const next = new URLSearchParams(params)
      next.delete('messenger')
      setParams(next, { replace: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messengerParam])
  const { data: tgSessions = [] } = useTgSessions(salonId)
  const tgLogout = useTgLogout(salonId)
  const activeTgSession = tgSessions.find((s) => s.status === 'active') ?? null

  // Telegram-бот (Bot API) убран — заменён userbot-карточкой ниже.
  // Bot API не даёт доступ к личной переписке владельца.
  const channels = [
    { id: 'whatsapp', name: 'WhatsApp Business', icon: Phone, color: '#25D366' },
    { id: 'instagram', name: 'Instagram Direct', icon: Instagram, color: '#E4405F' },
    { id: 'facebook', name: 'Facebook Messenger', icon: Facebook, color: '#1877F2' },
  ] as const
  const [emailOpen, setEmailOpen] = useState(false)
  const emailInteg = integrations.find((i) => i.channel === 'email')
  const emailConnected = !!emailInteg && emailInteg.status !== 'disconnected'

  return (
    <>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {channels.map((ch) => {
          const Icon = ch.icon
          const integ = integrations.find((i) => i.channel === ch.id)
          const isConnected = !!integ && integ.status !== 'disconnected'
          return (
            <div
              key={ch.id}
              className={[
                'border-border bg-card shadow-finsm flex flex-col gap-3 rounded-lg border p-5',
                isConnected && integ?.status === 'connected' ? 'border-brand-sage/40' : '',
              ].join(' ')}
            >
              <div className="flex items-start gap-3">
                <span
                  className="grid size-10 shrink-0 place-items-center rounded-md"
                  style={{ background: ch.color, color: 'white' }}
                >
                  <Icon className="size-5" strokeWidth={1.8} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-foreground text-base font-bold">{ch.name}</h3>
                    {integ?.status === 'connected' ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-700">
                        <Check className="size-3" strokeWidth={2.5} />
                        {t('integrations.status.connected')}
                      </span>
                    ) : integ?.status === 'pending' ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-800">
                        {t('integrations.status.pending')}
                      </span>
                    ) : null}
                  </div>
                  <p className="text-muted-foreground mt-1 text-xs leading-snug">
                    {integ?.display_name
                      ? integ.display_name
                      : t(`integrations.messengers.${ch.id}_subtitle`, {
                          defaultValue: t('integrations.messengers.generic_subtitle'),
                        })}
                  </p>
                  {integ?.last_error ? (
                    <p className="text-destructive mt-1 line-clamp-2 text-xs">
                      ⚠ {integ.last_error}
                    </p>
                  ) : null}
                </div>
              </div>
              <div className="mt-auto flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => setOpenChannel(ch.id)}
                  className="text-secondary inline-flex items-center gap-1 text-sm font-semibold hover:underline"
                >
                  {isConnected
                    ? t('integrations.messengers.reconnect')
                    : t('integrations.messengers.connect')}
                </button>
                {isConnected ? (
                  <button
                    type="button"
                    onClick={() => {
                      if (!confirm(t('integrations.messengers.confirm_disconnect'))) return
                      disconnect.mutate(ch.id, {
                        onSuccess: () => toast.success(t('integrations.toast_disconnected')),
                        onError: (err) =>
                          toast.error(err instanceof Error ? err.message : String(err)),
                      })
                    }}
                    className="text-muted-foreground hover:text-destructive grid size-7 place-items-center rounded-md"
                    aria-label={t('integrations.disconnect')}
                    title={t('integrations.disconnect')}
                  >
                    <Trash2 className="size-3.5" strokeWidth={1.7} />
                  </button>
                ) : null}
              </div>
            </div>
          )
        })}

        {/* ADR-015: личный TG-аккаунт через MTProto userbot (отдельный от бота). */}
        <div
          className={[
            'border-border bg-card shadow-finsm flex flex-col gap-3 rounded-lg border p-5',
            activeTgSession ? 'border-brand-sage/40' : '',
          ].join(' ')}
        >
          <div className="flex items-start gap-3">
            <span
              className="grid size-10 shrink-0 place-items-center rounded-md"
              style={{ background: '#229ED9', color: 'white' }}
            >
              <Send className="size-5" strokeWidth={1.8} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-foreground text-base font-bold">
                  {t('integrations.telegram_userbot.card_title')}
                </h3>
                {activeTgSession ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-700">
                    <Check className="size-3" strokeWidth={2.5} />
                    {t('integrations.status.connected')}
                  </span>
                ) : null}
              </div>
              <p className="text-muted-foreground mt-1 text-xs leading-snug">
                {activeTgSession
                  ? activeTgSession.tg_username
                    ? `@${activeTgSession.tg_username} · ${activeTgSession.phone}`
                    : `${activeTgSession.tg_first_name ?? ''} · ${activeTgSession.phone}`
                  : t('integrations.telegram_userbot.card_subtitle')}
              </p>
              {activeTgSession?.last_error ? (
                <p className="text-destructive mt-1 line-clamp-2 text-xs">
                  ⚠ {activeTgSession.last_error}
                </p>
              ) : null}
            </div>
          </div>
          <div className="mt-auto flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => setTgUserbotOpen(true)}
              className="text-secondary inline-flex items-center gap-1 text-sm font-semibold hover:underline"
            >
              {activeTgSession
                ? t('integrations.messengers.reconnect')
                : t('integrations.messengers.connect')}
            </button>
            {activeTgSession ? (
              <button
                type="button"
                onClick={() => {
                  if (!confirm(t('integrations.telegram_userbot.confirm_disconnect'))) return
                  tgLogout.mutate(activeTgSession.id, {
                    onSuccess: () => toast.success(t('integrations.toast_disconnected')),
                    onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
                  })
                }}
                className="text-muted-foreground hover:text-destructive grid size-7 place-items-center rounded-md"
                aria-label={t('integrations.disconnect')}
                title={t('integrations.disconnect')}
              >
                <Trash2 className="size-3.5" strokeWidth={1.7} />
              </button>
            ) : null}
          </div>
        </div>

        {/* Email — SMTP + IMAP. Подключение через EmailConnectDialog. */}
        <div
          className={[
            'border-border bg-card shadow-finsm flex flex-col gap-3 rounded-lg border p-5',
            emailConnected ? 'border-brand-sage/40' : '',
          ].join(' ')}
        >
          <div className="flex items-start gap-3">
            <span
              className="grid size-10 shrink-0 place-items-center rounded-md"
              style={{ background: '#0F4C5C', color: 'white' }}
            >
              <Mail className="size-5" strokeWidth={1.8} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-foreground text-base font-bold">
                  {t('integrations.email.card_title', { defaultValue: 'Email' })}
                </h3>
                {emailConnected ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-700">
                    <Check className="size-3" strokeWidth={2.5} />
                    {t('integrations.status.connected')}
                  </span>
                ) : null}
              </div>
              <p className="text-muted-foreground mt-1 text-xs leading-snug">
                {emailInteg?.display_name ??
                  t('integrations.email.card_subtitle', {
                    defaultValue:
                      'Подключи SMTP + IMAP — письма от клиентов попадут в общий мессенджер.',
                  })}
              </p>
            </div>
          </div>
          <div className="mt-auto flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => setEmailOpen(true)}
              className="text-secondary inline-flex items-center gap-1 text-sm font-semibold hover:underline"
            >
              {emailConnected
                ? t('integrations.messengers.reconnect')
                : t('integrations.messengers.connect')}
            </button>
          </div>
        </div>
      </div>

      <MessengerConnectDialog
        open={!!openChannel}
        channel={openChannel}
        salonId={salonId}
        onClose={() => setOpenChannel(null)}
      />
      <TelegramUserbotConnectDialog
        open={tgUserbotOpen}
        salonId={salonId}
        onClose={() => setTgUserbotOpen(false)}
      />
      <EmailConnectDialog open={emailOpen} salonId={salonId} onClose={() => setEmailOpen(false)} />
    </>
  )
}

function OtherIntegrationsSection() {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col gap-3">
      <section className="border-border bg-card shadow-finsm rounded-lg border p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-foreground text-base font-bold">{t('settings.install.title')}</h3>
            <p className="text-muted-foreground mt-1 text-sm">{t('settings.install.subtitle')}</p>
          </div>
          <InstallAppButton />
        </div>
      </section>
    </div>
  )
}
