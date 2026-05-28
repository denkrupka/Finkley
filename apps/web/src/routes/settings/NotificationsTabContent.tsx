import { ChevronDown, ChevronRight, Mail } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
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
} from '@/hooks/useWeeklyDigest'

import { PushNotificationsCard } from './PushNotificationsCard'

/**
 * Settings → Уведомления. Одна страница без sub-tabs:
 *   1) Карточка PushNotificationsCard — как включить push-уведомления
 *      в браузере (запрос permission + service worker subscription).
 *   2) Матрица «Какие уведомления получать» — для каждого типа галочки
 *      по 4 каналам: PUSH / EMAIL / TELEGRAM / SMS.
 *   3) Дайджест-блоки внизу — кнопки «Прислать сейчас» weekly/daily.
 *
 * PUSH = web-push в браузере (нужно подписаться один раз в (1)).
 * EMAIL = всегда доступен (есть auth.user.email).
 * TELEGRAM = доступен если профиль привязан (profile.telegram_id).
 * SMS = доступен если указан телефон (profile.phone) — биллится отдельно.
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

type Channel = 'push' | 'email' | 'telegram' | 'sms'
const CHANNELS: Channel[] = ['push', 'email', 'telegram', 'sms']
const CHANNEL_LABEL: Record<Channel, string> = {
  push: 'Push',
  email: 'Email',
  telegram: 'Telegram',
  sms: 'SMS',
}

export function NotificationsTabContent({
  salon,
  sendDigest,
  sendDailyDigest,
}: {
  salon: SalonRow
  sendDigest: ReturnType<typeof useSendWeeklyDigest>
  sendDailyDigest: ReturnType<typeof useSendDailyDigest>
}) {
  const { t } = useTranslation()
  const updatePref = useUpdateNotificationPref(salon.id)
  const { data: profile } = useMyProfile()
  const prefs = salon.notification_prefs ?? {}
  const telegramLinked = !!profile?.telegram_id
  const phoneLinked = !!profile?.phone

  /** Включен ли канал для конкретного типа. Дефолты:
   *  - email = true
   *  - telegram = true если привязан
   *  - push = true (если юзер подписался — service worker сам решит)
   *  - sms = false (биллится — opt-in осознанный) */
  function isChannelEnabled(key: NotificationTypeKey, ch: Channel): boolean {
    if (prefs[key] === false) return false
    const channelKey = `${key}.${ch}`
    if (channelKey in prefs) return prefs[channelKey] === true
    if (ch === 'email') return true
    if (ch === 'telegram') return telegramLinked
    if (ch === 'push') return true
    return false
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
      {/* Push subscription — bootstrap веб-push в браузере */}
      <PushNotificationsCard />

      {/* Матрица типов × каналов */}
      <section className="border-border bg-card shadow-finsm rounded-lg border p-5 sm:p-6">
        <h2 className="text-brand-navy text-base font-bold tracking-tight">
          {t('settings.notifications.types_title', {
            defaultValue: 'Какие уведомления получать',
          })}
        </h2>
        <p className="text-muted-foreground mt-1 text-sm">
          {t('settings.notifications.types_subtitle_v2', {
            defaultValue:
              'Для каждого события — выбери каналы. Push приходит в браузер/PWA, Email на твою почту, Telegram (если привязан), SMS (биллится).',
          })}
        </p>
        <div className="mt-5 flex flex-col gap-3">
          {TYPE_GROUPS.map((group) => (
            <CollapsibleNotificationGroup
              key={group.group}
              groupKey={group.group}
              title={t(group.group)}
            >
              <div className="border-border bg-muted/10 hidden border-b px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider sm:grid sm:grid-cols-[1fr_repeat(4,64px)]">
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
                      className="grid grid-cols-[1fr_repeat(4,64px)] items-center gap-2 px-3 py-2"
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
                              : ch === 'push'
                                ? t('settings.notifications.push_hint', {
                                    defaultValue:
                                      'Чтобы получать push — разреши уведомления в карточке выше',
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

      {/* «Отправить сейчас» — две компактные строки внизу. Каналы дайджестов
          управляются только из матрицы выше — здесь только кнопка и
          описание что попадёт в письмо/сообщение. */}
      <SendNowCard
        title={t('settings.digest.title')}
        subtitle={t('settings.digest.subtitle')}
        anyChannelOn={
          isChannelEnabled('weekly_digest', 'push') ||
          isChannelEnabled('weekly_digest', 'email') ||
          isChannelEnabled('weekly_digest', 'telegram') ||
          isChannelEnabled('weekly_digest', 'sms')
        }
        buttonLabel={sendDigest.isPending ? t('common.loading') : t('settings.digest.button')}
        pending={sendDigest.isPending}
        onSend={() =>
          sendDigest.mutate(undefined, {
            onSuccess: (data) => toast.success(digestSentToastText(t, salon, data, 'weekly')),
            onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
          })
        }
      />
      <SendNowCard
        title={t('settings.daily_digest.title')}
        subtitle={t('settings.daily_digest.subtitle')}
        anyChannelOn={
          isChannelEnabled('daily_digest', 'push') ||
          isChannelEnabled('daily_digest', 'email') ||
          isChannelEnabled('daily_digest', 'telegram') ||
          isChannelEnabled('daily_digest', 'sms')
        }
        buttonLabel={
          sendDailyDigest.isPending ? t('common.loading') : t('settings.daily_digest.button')
        }
        pending={sendDailyDigest.isPending}
        onSend={() =>
          sendDailyDigest.mutate(undefined, {
            onSuccess: (data) => toast.success(digestSentToastText(t, salon, data, 'daily')),
            onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
          })
        }
      />
    </div>
  )
}

/** Компактная карточка «Отправить сейчас» для дайджеста.
 *  Каналы не выбираются здесь — они в матрице наверху. Если все каналы
 *  для этого дайджеста выключены — кнопка disabled с подсказкой. */
function SendNowCard({
  title,
  subtitle,
  anyChannelOn,
  buttonLabel,
  pending,
  onSend,
}: {
  title: string
  subtitle: string
  anyChannelOn: boolean
  buttonLabel: string
  pending: boolean
  onSend: () => void
}) {
  const { t } = useTranslation()
  return (
    <section className="border-border bg-card shadow-finsm rounded-lg border p-4 sm:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 flex-1">
          <h2 className="text-brand-navy text-base font-bold tracking-tight">{title}</h2>
          <p className="text-muted-foreground mt-0.5 text-sm">{subtitle}</p>
          {!anyChannelOn ? (
            <p className="text-muted-foreground mt-1.5 text-xs">
              {t('settings.digest.no_channels_hint', {
                defaultValue:
                  'Сейчас не выбран ни один канал в матрице выше — поэтому отправлять некуда.',
              })}
            </p>
          ) : null}
        </div>
        <Button
          variant="outline"
          size="md"
          onClick={onSend}
          disabled={pending || !anyChannelOn}
          className="shrink-0"
        >
          <Mail className="size-4" strokeWidth={1.7} />
          {buttonLabel}
        </Button>
      </div>
    </section>
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
