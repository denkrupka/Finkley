import { Bell, ChevronDown, ChevronRight, Mail, ToggleLeft } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { PageTabsNav, type PageTab } from '@/components/ui/PageTabsNav'
import { useMyProfile } from '@/hooks/useMyProfile'
import { usePersistedCollapse } from '@/routes/dashboard/useCollapsedState'
import {
  useUpdateNotificationPref,
  type DigestChannel,
  type NotificationTypeKey,
  type SalonRow,
} from '@/hooks/useSalons'
import type {
  SendDigestResponse,
  useSendDailyDigest,
  useSendWeeklyDigest,
  useUpdateDigestChannels,
} from '@/hooks/useWeeklyDigest'

import { PushNotificationsCard } from './PushNotificationsCard'

type SubTab = 'channels' | 'types'

const SUB_TABS: PageTab<SubTab>[] = [
  { id: 'channels', labelKey: 'settings.notifications.tab_channels', icon: Bell },
  { id: 'types', labelKey: 'settings.notifications.tab_types', icon: ToggleLeft },
]

/**
 * Каналы: PUSH (браузер/PWA), email и Telegram для дайджестов.
 * Типы: чек-лист всех событий, на которые портал может отправить уведомление.
 *
 * Channels отвечают «КУДА». Types отвечают «О ЧЁМ». Разделены чтобы
 * юзер не путал «отключить вечерний дайджест» с «отключить email вообще».
 */
const TYPE_GROUPS: Array<{
  group: string // i18n key
  items: Array<{ key: NotificationTypeKey; label: string; hint?: string }>
}> = [
  {
    group: 'settings.notifications.group.summary',
    items: [
      { key: 'weekly_digest', label: 'settings.notifications.type.weekly_digest' },
      { key: 'daily_digest', label: 'settings.notifications.type.daily_digest' },
      { key: 'ai_insights', label: 'settings.notifications.type.ai_insights' },
    ],
  },
  {
    group: 'settings.notifications.group.payments',
    items: [
      { key: 'payment_due_2d', label: 'settings.notifications.type.payment_due_2d' },
      { key: 'payment_due_1d', label: 'settings.notifications.type.payment_due_1d' },
      { key: 'payment_due_today', label: 'settings.notifications.type.payment_due_today' },
      { key: 'payment_overdue', label: 'settings.notifications.type.payment_overdue' },
    ],
  },
  {
    group: 'settings.notifications.group.business',
    items: [
      { key: 'booksy_new_visits', label: 'settings.notifications.type.booksy_new_visits' },
      { key: 'calendar_conflicts', label: 'settings.notifications.type.calendar_conflicts' },
    ],
  },
  {
    // T23 — отдельная группа «Склад» с типом low_inventory.
    group: 'settings.notifications.group.inventory',
    items: [{ key: 'low_inventory', label: 'settings.notifications.type.low_inventory' }],
  },
  {
    group: 'settings.notifications.group.messaging',
    items: [
      { key: 'messenger_new_message', label: 'settings.notifications.type.messenger_new_message' },
    ],
  },
]

type Channel = 'email' | 'telegram' | 'sms'
const CHANNELS: Channel[] = ['email', 'telegram', 'sms']
const CHANNEL_LABEL: Record<Channel, string> = {
  email: 'Email',
  telegram: 'Telegram',
  sms: 'SMS',
}

export function NotificationsTabContent({
  salon,
  sendDigest,
  sendDailyDigest,
  updateWeeklyChannels,
  updateDailyChannels,
}: {
  salon: SalonRow
  sendDigest: ReturnType<typeof useSendWeeklyDigest>
  sendDailyDigest: ReturnType<typeof useSendDailyDigest>
  updateWeeklyChannels: ReturnType<typeof useUpdateDigestChannels>
  updateDailyChannels: ReturnType<typeof useUpdateDigestChannels>
}) {
  const { t } = useTranslation()
  const [params, setParams] = useSearchParams()
  const sub = (params.get('subtab') === 'types' ? 'types' : 'channels') as SubTab
  function setSub(v: SubTab) {
    const next = new URLSearchParams(params)
    if (v === 'channels') next.delete('subtab')
    else next.set('subtab', v)
    setParams(next, { replace: true })
  }
  const updatePref = useUpdateNotificationPref(salon.id)
  const { data: profile } = useMyProfile()
  const prefs = salon.notification_prefs ?? {}
  const telegramLinked = !!profile?.telegram_id
  const phoneLinked = !!profile?.phone

  /** Включен ли канал для конкретного типа. Поддерживает legacy формат:
   *  - prefs[type] === false → всё выключено
   *  - prefs[`${type}.${channel}`] === true/false → точный канал
   *  - иначе дефолт: email=true, telegram=true (если привязан), sms=false. */
  function isChannelEnabled(key: NotificationTypeKey, ch: Channel): boolean {
    if (prefs[key] === false) return false
    const channelKey = `${key}.${ch}`
    if (channelKey in prefs) return prefs[channelKey] === true
    // Дефолты по каналу:
    if (ch === 'email') return true
    if (ch === 'telegram') return telegramLinked
    return false // sms по умолчанию выключен
  }
  function toggleChannel(key: NotificationTypeKey, ch: Channel, next: boolean) {
    updatePref.mutate(
      { [`${key}.${ch}`]: next },
      {
        onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
      },
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <PageTabsNav tabs={SUB_TABS} active={sub} onChange={setSub} t={t} size="sm" />

      {sub === 'channels' ? (
        <>
          {/* PUSH */}
          <div>
            <PushNotificationsCard />
          </div>

          {/* Еженедельный дайджест — channels */}
          <DigestSection
            title={t('settings.digest.title')}
            subtitle={t('settings.digest.subtitle')}
            channels={
              salon.weekly_digest_channels ?? (salon.weekly_digest_enabled ? ['email'] : [])
            }
            onChannelsChange={(next) =>
              updateWeeklyChannels.mutate(next, {
                onSuccess: () =>
                  toast.success(
                    next.length > 0
                      ? t('settings.digest.toast_enabled')
                      : t('settings.digest.toast_disabled'),
                  ),
                onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
              })
            }
            buttonLabel={sendDigest.isPending ? t('common.loading') : t('settings.digest.button')}
            buttonDisabled={sendDigest.isPending || !salon.weekly_digest_enabled}
            onSend={() =>
              sendDigest.mutate(undefined, {
                onSuccess: (data) => toast.success(digestSentToastText(t, salon, data, 'weekly')),
                onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
              })
            }
          />

          {/* Ежедневная сводка — channels */}
          <DigestSection
            title={t('settings.daily_digest.title')}
            subtitle={t('settings.daily_digest.subtitle')}
            channels={salon.daily_digest_channels ?? (salon.daily_digest_enabled ? ['email'] : [])}
            onChannelsChange={(next) =>
              updateDailyChannels.mutate(next, {
                onSuccess: () =>
                  toast.success(
                    next.length > 0
                      ? t('settings.daily_digest.toast_enabled')
                      : t('settings.daily_digest.toast_disabled'),
                  ),
                onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
              })
            }
            buttonLabel={
              sendDailyDigest.isPending ? t('common.loading') : t('settings.daily_digest.button')
            }
            buttonDisabled={sendDailyDigest.isPending || !salon.daily_digest_enabled}
            onSend={() =>
              sendDailyDigest.mutate(undefined, {
                onSuccess: (data) => toast.success(digestSentToastText(t, salon, data, 'daily')),
                onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
              })
            }
          />
        </>
      ) : (
        // ТИПЫ — чек-лист
        <section className="border-border bg-card shadow-finsm rounded-lg border p-5 sm:p-6">
          <h2 className="text-brand-navy text-base font-bold tracking-tight">
            {t('settings.notifications.types_title', {
              defaultValue: 'Какие уведомления получать',
            })}
          </h2>
          <p className="text-muted-foreground mt-1 text-sm">
            {t('settings.notifications.types_subtitle', {
              defaultValue:
                'Выбери события которые портал может присылать. Каналы (push/email/Telegram) — на вкладке «Каналы».',
            })}
          </p>
          {/* T23 — сворачиваемые группы (по умолчанию все свёрнуты), матрица
              каналов справа. Telegram disabled если профиль не привязан;
              SMS disabled если у пользователя нет номера в profile.phone. */}
          <div className="mt-5 flex flex-col gap-3">
            {TYPE_GROUPS.map((group) => (
              <CollapsibleNotificationGroup
                key={group.group}
                groupKey={group.group}
                title={t(group.group)}
              >
                <div className="border-border bg-muted/10 hidden border-b px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider sm:grid sm:grid-cols-[1fr_repeat(3,80px)]">
                  <span className="text-muted-foreground">
                    {t('settings.notifications.col_type', { defaultValue: 'Тип' })}
                  </span>
                  {CHANNELS.map((ch) => (
                    <span key={ch} className="text-muted-foreground text-center">
                      {CHANNEL_LABEL[ch]}
                    </span>
                  ))}
                </div>
                <div className="divide-border/40 divide-y">
                  {group.items.map((item) => {
                    const label = t(item.label, { defaultValue: DEFAULT_TYPE_LABELS[item.key] })
                    return (
                      <div
                        key={item.key}
                        className="grid grid-cols-[1fr_repeat(3,80px)] items-center gap-2 px-3 py-2"
                      >
                        <span className="text-foreground text-sm font-medium">{label}</span>
                        {CHANNELS.map((ch) => {
                          const disabled =
                            (ch === 'telegram' && !telegramLinked) || (ch === 'sms' && !phoneLinked)
                          const checked = !disabled && isChannelEnabled(item.key, ch)
                          const title =
                            ch === 'telegram' && !telegramLinked
                              ? t('settings.notifications.telegram_unlinked_hint', {
                                  defaultValue:
                                    'Чтобы получать в Telegram — привяжи аккаунт в /settings → Telegram',
                                })
                              : ch === 'sms' && !phoneLinked
                                ? t('settings.notifications.sms_no_phone_hint', {
                                    defaultValue:
                                      'Чтобы получать SMS — укажи телефон в Профиле пользователя',
                                  })
                                : undefined
                          return (
                            <label
                              key={ch}
                              title={title}
                              className={`flex items-center justify-center ${disabled ? 'cursor-not-allowed opacity-40' : 'cursor-pointer'}`}
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                disabled={disabled}
                                onChange={(e) => toggleChannel(item.key, ch, e.target.checked)}
                                className="accent-brand-navy size-4 cursor-pointer disabled:cursor-not-allowed"
                              />
                            </label>
                          )
                        })}
                      </div>
                    )
                  })}
                </div>
              </CollapsibleNotificationGroup>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

function CollapsibleNotificationGroup({
  groupKey,
  title,
  children,
}: {
  groupKey: string
  title: string
  children: React.ReactNode
}) {
  const { open, toggle } = usePersistedCollapse(`notif.${groupKey}`, false)
  return (
    <section className="border-border overflow-hidden rounded-md border">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="bg-muted/30 hover:bg-muted/50 flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-bold uppercase tracking-wider"
      >
        {open ? (
          <ChevronDown className="text-muted-foreground size-3.5" strokeWidth={2.2} />
        ) : (
          <ChevronRight className="text-muted-foreground size-3.5" strokeWidth={2.2} />
        )}
        <span className="text-muted-foreground">{title}</span>
      </button>
      <div className={open ? '' : 'hidden'}>{children}</div>
    </section>
  )
}

const DEFAULT_TYPE_LABELS: Record<NotificationTypeKey, string> = {
  weekly_digest: 'Еженедельный дайджест (понедельник утром)',
  daily_digest: 'Ежедневная сводка по кассам и продажам',
  ai_insights: 'AI-инсайты («прибыль упала на 12%»)',
  payment_due_2d: 'Платёж по фактуре через 2 дня',
  payment_due_1d: 'Платёж по фактуре завтра',
  payment_due_today: 'Платёж по фактуре сегодня',
  payment_overdue: 'Просроченный платёж — каждый день пока не оплачен',
  low_inventory: 'Низкие остатки на складе',
  booksy_new_visits: 'Новые визиты импортированные из Booksy',
  calendar_conflicts: 'Конфликты в календаре (двойная бронь)',
  messenger_new_message:
    'Новое сообщение в мессенджере (WhatsApp / Instagram / Facebook / Telegram)',
}

function DigestSection({
  title,
  subtitle,
  channels,
  onChannelsChange,
  buttonLabel,
  buttonDisabled,
  onSend,
}: {
  title: string
  subtitle: string
  channels: DigestChannel[]
  onChannelsChange: (next: DigestChannel[]) => void
  buttonLabel: string
  buttonDisabled: boolean
  onSend: () => void
}) {
  const { t } = useTranslation()
  function toggle(ch: DigestChannel) {
    const next = channels.includes(ch) ? channels.filter((c) => c !== ch) : [...channels, ch]
    onChannelsChange(next)
  }
  return (
    <section className="border-border bg-card shadow-finsm rounded-lg border p-5 sm:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex-1">
          <h2 className="text-brand-navy text-base font-bold tracking-tight">{title}</h2>
          <p className="text-muted-foreground mt-1 text-sm">{subtitle}</p>
          <div className="mt-4">
            <p className="text-muted-foreground text-xs font-bold uppercase tracking-wider">
              {t('settings.digest.channels.title')}
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <label className="border-border bg-card hover:bg-muted/40 inline-flex cursor-pointer items-center gap-2 rounded-md border px-3 py-1.5 text-sm">
                <input
                  type="checkbox"
                  checked={channels.includes('email')}
                  onChange={() => toggle('email')}
                  className="accent-brand-navy size-4 cursor-pointer"
                />
                <span>{t('settings.digest.channels.email')}</span>
              </label>
              <label className="border-border bg-card hover:bg-muted/40 inline-flex cursor-pointer items-center gap-2 rounded-md border px-3 py-1.5 text-sm">
                <input
                  type="checkbox"
                  checked={channels.includes('telegram')}
                  onChange={() => toggle('telegram')}
                  className="accent-brand-navy size-4 cursor-pointer"
                />
                <span>{t('settings.digest.channels.telegram')}</span>
              </label>
            </div>
            {channels.length === 0 && (
              <p className="text-muted-foreground mt-2 text-xs">
                {t('settings.digest.channels.all_off')}
              </p>
            )}
          </div>
        </div>
        <Button variant="outline" size="md" onClick={onSend} disabled={buttonDisabled}>
          <Mail className="size-4" strokeWidth={1.7} />
          {buttonLabel}
        </Button>
      </div>
    </section>
  )
}

function digestSentToastText(
  t: (k: string, opts?: Record<string, unknown>) => string,
  salon: { weekly_digest_channels?: DigestChannel[]; daily_digest_channels?: DigestChannel[] },
  data: SendDigestResponse | undefined,
  kind: 'weekly' | 'daily',
): string {
  const via = data?.via ?? []
  const selectedRaw = kind === 'weekly' ? salon.weekly_digest_channels : salon.daily_digest_channels
  const selected: DigestChannel[] = selectedRaw ?? ['email']
  const parts: string[] = []
  if (via.includes('email')) {
    parts.push(t('settings.digest.toast_sent_email', { email: data?.sent_to ?? '' }))
  }
  if (via.includes('telegram')) {
    parts.push(t('settings.digest.toast_sent_telegram'))
  }
  if (selected.includes('telegram') && !via.includes('telegram')) {
    parts.push(t('settings.digest.toast_telegram_skipped'))
  }
  return parts.length > 0 ? parts.join('. ') : t('settings.digest.toast_no_channel')
}
