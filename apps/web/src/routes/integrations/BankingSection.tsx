import { format } from 'date-fns'
import {
  AlertTriangle,
  Banknote,
  CheckCircle2,
  Loader2,
  Plus,
  RefreshCw,
  Trash2,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { getDateLocale } from '@/lib/utils/format-date'
import {
  useBankAccountsForConnections,
  useBankConnections,
  useBankDisconnect,
  useBankSyncNow,
  useLinkBankAccountToRegister,
  useUpdateBankSyncInterval,
  type BankConnectionRow,
} from '@/hooks/useBanking'
import { useFinancialSettings } from '@/hooks/useFinancialSettings'

import { BankingConnectDialog } from './BankingConnectDialog'

// Варианты частоты авто-синка. Range constraint в БД: 60..1440 минут.
// Выбор небольшой — owner не должен думать что значит «42 минуты», а
// чаще часа просто упрётся в Enable Banking rate-limit.
const SYNC_INTERVAL_OPTIONS: ReadonlyArray<{ value: number; labelKey: string }> = [
  { value: 60, labelKey: 'banking.sync_interval.1h' },
  { value: 180, labelKey: 'banking.sync_interval.3h' },
  { value: 360, labelKey: 'banking.sync_interval.6h' },
  { value: 720, labelKey: 'banking.sync_interval.12h' },
  { value: 1440, labelKey: 'banking.sync_interval.24h' },
]

type Props = { salonId: string }

/**
 * Секция «Банковские транзакции» на странице интеграций. Показывает
 * подключённые банки (можно несколько), каждый со списком привязанных
 * аккаунтов. Кнопка «+ Добавить банк» открывает BankingConnectDialog,
 * который ведёт юзера через bank-picker → SCA.
 *
 * При подключении PSD2-consent истекает обычно через 90-180 дней; если
 * остался <14 дней, подсвечиваем строку и показываем кнопку «Обновить».
 */
export function BankingSection({ salonId }: Props) {
  const { t } = useTranslation()
  const { data: connections = [], isLoading } = useBankConnections(salonId)
  const connectionIds = useMemo(() => connections.map((c) => c.id), [connections])
  const { data: accounts = [] } = useBankAccountsForConnections(connectionIds)
  const sync = useBankSyncNow(salonId)
  const disconnect = useBankDisconnect(salonId)
  const updateInterval = useUpdateBankSyncInterval(salonId)
  const linkRegister = useLinkBankAccountToRegister(salonId)
  const { data: financialSettings } = useFinancialSettings(salonId)
  // T73 — фильтр касс по cash_kind='non_cash' (только безналичные могут
  // быть связаны с банк-счётом).
  const nonCashRegisters = (financialSettings?.cash_registers.items ?? []).filter(
    (r) => !r.archived && r.cash_kind === 'non_cash',
  )
  const [connectOpen, setConnectOpen] = useState(false)
  const [reconnectFor, setReconnectFor] = useState<BankConnectionRow | null>(null)
  const autoSyncedRef = useRef<Set<string>>(new Set())

  // Auto-sync свежеподключённых connections. Когда юзер вернулся из OAuth
  // callback, server-side trigger мог не сработать (FUNCTION_INTERNAL_SECRET
  // не задан / banking-sync упал). UI сам дёрнет sync если есть connection
  // с status='connected' но без last_synced_at. One-shot per session per id.
  useEffect(() => {
    for (const c of connections) {
      if (c.status !== 'connected') continue
      if (c.last_synced_at) continue
      if (autoSyncedRef.current.has(c.id)) continue
      autoSyncedRef.current.add(c.id)
      sync.mutate(c.id, {
        onError: (e) => console.warn('bank auto-sync failed:', c.id, e),
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connections])

  function accountsFor(connectionId: string) {
    return accounts.filter((a) => a.connection_id === connectionId)
  }

  function handleSync(connectionId: string) {
    sync.mutate(connectionId, {
      onSuccess: (res) => {
        if (res.error) {
          toast.error(t('banking.toast_sync_failed'), { description: res.error })
        } else {
          toast.success(t('banking.toast_synced'), {
            description: t('banking.toast_synced_detail', {
              tx: res.tx_new,
              expenses: res.expenses_created,
            }),
          })
        }
      },
      onError: (err) => {
        toast.error(t('banking.toast_sync_failed'), {
          description: err instanceof Error ? err.message : String(err),
        })
      },
    })
  }

  function handleIntervalChange(connectionId: string, value: string) {
    const minutes = Number(value)
    if (!Number.isFinite(minutes) || minutes < 60 || minutes > 1440) return
    updateInterval.mutate(
      { connectionId, intervalMinutes: minutes },
      {
        onSuccess: () => toast.success(t('banking.toast_interval_saved')),
        onError: (err) =>
          toast.error(t('banking.toast_interval_failed'), {
            description: err instanceof Error ? err.message : String(err),
          }),
      },
    )
  }

  function handleDisconnect(connection: BankConnectionRow) {
    if (!confirm(t('banking.confirm_disconnect', { bank: connection.bank_name ?? '?' }))) return
    disconnect.mutate(connection.id, {
      onSuccess: () => toast.success(t('banking.toast_disconnected')),
      onError: (err) =>
        toast.error(t('banking.toast_disconnect_failed'), {
          description: err instanceof Error ? err.message : String(err),
        }),
    })
  }

  return (
    <section className="border-border bg-card shadow-finsm rounded-lg border p-5 sm:p-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="bg-brand-teal-soft text-brand-teal-deep grid size-10 place-items-center rounded-lg">
            <Banknote className="size-5" strokeWidth={1.8} />
          </div>
          <p className="text-foreground/80 text-sm">{t('banking.section_subtitle')}</p>
        </div>
        <Button size="sm" onClick={() => setConnectOpen(true)} data-testid="banking-add">
          <Plus className="size-4" strokeWidth={2} />
          {t('banking.add_bank')}
        </Button>
      </div>

      {isLoading ? (
        <div className="bg-muted/40 h-20 animate-pulse rounded-md" />
      ) : connections.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t('banking.empty')}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {connections.map((c) => {
            const conAccounts = accountsFor(c.id)
            const isExpiringSoon =
              c.valid_until &&
              new Date(c.valid_until).getTime() - Date.now() < 14 * 24 * 60 * 60 * 1000
            const isError = c.status === 'error'
            const isExpired = c.status === 'expired'
            const isPending = c.status === 'pending'
            const showReconnect = isExpired || isExpiringSoon
            return (
              <li
                key={c.id}
                className="border-border bg-muted/20 flex flex-col gap-2 rounded-md border p-3.5 sm:flex-row sm:items-start sm:justify-between"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-foreground text-sm font-semibold">
                      {c.bank_name ?? c.bank_aspsp_name}
                    </span>
                    {c.bank_country ? (
                      <span className="text-muted-foreground text-xs">· {c.bank_country}</span>
                    ) : null}
                    {c.status === 'connected' && !isExpiringSoon ? (
                      <span className="bg-brand-sage-soft text-brand-sage inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-bold">
                        <CheckCircle2 className="size-3" strokeWidth={2.4} />
                        {t('banking.status_connected')}
                      </span>
                    ) : null}
                    {isPending ? (
                      <span className="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-[10.5px] font-bold">
                        {t('banking.status_pending')}
                      </span>
                    ) : null}
                    {isExpired ? (
                      <span className="bg-destructive/10 text-destructive inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-bold">
                        <AlertTriangle className="size-3" strokeWidth={2.4} />
                        {t('banking.status_expired')}
                      </span>
                    ) : null}
                    {isExpiringSoon && !isExpired ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10.5px] font-bold text-amber-800">
                        <AlertTriangle className="size-3" strokeWidth={2.4} />
                        {t('banking.status_expiring')}
                      </span>
                    ) : null}
                    {isError ? (
                      <span className="bg-destructive/10 text-destructive rounded-full px-2 py-0.5 text-[10.5px] font-bold">
                        {t('banking.status_error')}
                      </span>
                    ) : null}
                  </div>

                  {conAccounts.length > 0 ? (
                    <ul className="mt-1.5 flex flex-col gap-1.5">
                      {conAccounts.map((a) => (
                        <li
                          key={a.id}
                          className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3"
                        >
                          <span className="text-muted-foreground num text-xs">
                            {a.iban ?? a.name ?? a.external_id}
                            {a.currency ? ` · ${a.currency}` : ''}
                          </span>
                          <div className="flex items-center gap-1.5 text-xs">
                            <span className="text-muted-foreground">
                              {t('banking.link_register.label', {
                                defaultValue: 'Связать с кассой:',
                              })}
                            </span>
                            <Select
                              value={a.cash_register_id ?? '__none__'}
                              onValueChange={(v) =>
                                linkRegister.mutate(
                                  {
                                    accountId: a.id,
                                    cashRegisterId: v === '__none__' ? null : v,
                                  },
                                  {
                                    onSuccess: () =>
                                      toast.success(
                                        t('banking.link_register.toast_saved', {
                                          defaultValue: 'Связь обновлена',
                                        }),
                                      ),
                                    onError: (err) =>
                                      toast.error(err instanceof Error ? err.message : String(err)),
                                  },
                                )
                              }
                              disabled={linkRegister.isPending}
                            >
                              <SelectTrigger className="h-7 w-[200px] text-xs">
                                <SelectValue
                                  placeholder={t('banking.link_register.placeholder', {
                                    defaultValue: 'Не связан',
                                  })}
                                />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="__none__">
                                  {t('banking.link_register.none', { defaultValue: '— Не связан' })}
                                </SelectItem>
                                {nonCashRegisters.length === 0 ? (
                                  <SelectItem value="__empty__" disabled>
                                    {t('banking.link_register.empty', {
                                      defaultValue:
                                        'Нет безналичных касс — заведи в Настройках → Справочники',
                                    })}
                                  </SelectItem>
                                ) : (
                                  nonCashRegisters.map((r) => (
                                    <SelectItem key={r.id} value={r.id}>
                                      {r.label}
                                    </SelectItem>
                                  ))
                                )}
                              </SelectContent>
                            </Select>
                          </div>
                        </li>
                      ))}
                    </ul>
                  ) : null}

                  <div className="text-muted-foreground mt-1.5 flex flex-wrap gap-x-3 text-xs">
                    {c.last_synced_at ? (
                      <span>
                        {t('banking.last_synced')}:{' '}
                        {format(new Date(c.last_synced_at), 'd MMM, HH:mm', {
                          locale: getDateLocale(),
                        })}
                      </span>
                    ) : (
                      <span>{t('banking.never_synced')}</span>
                    )}
                    {c.valid_until ? (
                      <span>
                        {t('banking.valid_until')}:{' '}
                        {format(new Date(c.valid_until), 'd MMM yyyy', { locale: getDateLocale() })}
                      </span>
                    ) : null}
                    {c.last_error ? (
                      <span className="text-destructive max-w-md truncate">
                        {t('banking.last_error')}: {c.last_error}
                      </span>
                    ) : null}
                  </div>

                  {c.status === 'connected' ? (
                    <div className="mt-2 flex items-center gap-2 text-xs">
                      <span className="text-muted-foreground">
                        {t('banking.sync_interval.label')}
                      </span>
                      <Select
                        value={String(c.sync_interval_minutes)}
                        onValueChange={(v) => handleIntervalChange(c.id, v)}
                        disabled={updateInterval.isPending}
                      >
                        <SelectTrigger className="h-7 w-[120px] text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {SYNC_INTERVAL_OPTIONS.map((opt) => (
                            <SelectItem key={opt.value} value={String(opt.value)}>
                              {t(opt.labelKey)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  ) : null}
                </div>

                <div className="flex shrink-0 items-center gap-1.5">
                  {showReconnect ? (
                    <Button size="sm" variant="outline" onClick={() => setReconnectFor(c)}>
                      {t('banking.reconnect')}
                    </Button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => handleSync(c.id)}
                    disabled={sync.isPending || c.status !== 'connected'}
                    className="text-muted-foreground hover:text-secondary grid size-9 place-items-center rounded-md transition-colors disabled:opacity-40"
                    title={t('banking.sync_now')}
                    aria-label={t('banking.sync_now')}
                  >
                    {sync.isPending ? (
                      <Loader2 className="size-4 animate-spin" strokeWidth={1.8} />
                    ) : (
                      <RefreshCw className="size-4" strokeWidth={1.8} />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDisconnect(c)}
                    disabled={disconnect.isPending}
                    className="text-muted-foreground hover:text-destructive grid size-9 place-items-center rounded-md transition-colors disabled:opacity-40"
                    title={t('banking.disconnect')}
                    aria-label={t('banking.disconnect')}
                  >
                    <Trash2 className="size-4" strokeWidth={1.8} />
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      <p className="text-muted-foreground mt-4 text-xs">{t('banking.privacy_note')}</p>

      <BankingConnectDialog
        salonId={salonId}
        open={connectOpen || reconnectFor !== null}
        prefillBank={
          reconnectFor
            ? { name: reconnectFor.bank_aspsp_name ?? '', country: reconnectFor.bank_country ?? '' }
            : null
        }
        onClose={() => {
          setConnectOpen(false)
          setReconnectFor(null)
        }}
      />
    </section>
  )
}
