import { Gift, Loader2, Mail, MessageSquare, Percent, UserPlus } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useClients, useUpdateClient, type ClientRow } from '@/hooks/useClients'
import { useSendBroadcast } from '@/hooks/useMarketing'
import { useNextVisitsByClient } from '@/hooks/useNextVisits'
import { formatCurrency } from '@/lib/utils/format-currency'
import { rfmSegmentForClient, type RfmKey } from './dashboard-aggregates'

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' })
}

type ActionKind = 'gift' | 'discount' | 'referral'

/**
 * Список клиентов одного RFM-сегмента (открывается по клику на плитку
 * дашборда) + действия по каждому: 🎁 подарок (SMS/email), % скидка
 * (персональная скидка клиента), + рефералка (SMS/email о бонусе за подругу).
 */
export function SegmentClientsModal({
  salonId,
  currency,
  segmentKey,
  segmentName,
  onClose,
}: {
  salonId: string
  currency: string
  segmentKey: RfmKey | null
  segmentName: string
  onClose: () => void
}) {
  const { t } = useTranslation()
  const { data: clients = [], isLoading } = useClients(salonId)
  const { data: nextVisits } = useNextVisitsByClient(salonId)
  const [action, setAction] = useState<{ kind: ActionKind; client: ClientRow } | null>(null)

  const segmentClients = useMemo(() => {
    if (!segmentKey) return []
    return clients
      .filter((c) => rfmSegmentForClient(c) === segmentKey)
      .sort((a, b) => b.total_revenue_cents - a.total_revenue_cents)
  }, [clients, segmentKey])

  return (
    <>
      <Dialog open={!!segmentKey} onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="flex max-h-[88vh] w-[min(1100px,calc(100vw-2rem))] flex-col gap-0 overflow-hidden p-0 sm:!max-w-[1100px]">
          <div className="border-border border-b px-5 py-4">
            <DialogHeader>
              <DialogTitle>
                {segmentName}
                <span className="text-muted-foreground ml-2 text-sm font-normal">
                  {t('dashboard.segments.count', {
                    count: segmentClients.length,
                    defaultValue: '{{count}} клиентов',
                  })}
                </span>
              </DialogTitle>
              <DialogDescription>
                {t('dashboard.segments.subtitle', {
                  defaultValue:
                    'Подарок, скидка или приглашение привести подругу — по каждому клиенту.',
                })}
              </DialogDescription>
            </DialogHeader>
          </div>

          <div className="min-h-0 flex-1 overflow-auto">
            {isLoading ? (
              <p className="text-muted-foreground p-5 text-sm">{t('common.loading')}</p>
            ) : segmentClients.length === 0 ? (
              <p className="text-muted-foreground p-5 text-sm">
                {t('dashboard.segments.empty', {
                  defaultValue: 'В этом сегменте пока нет клиентов.',
                })}
              </p>
            ) : (
              <table className="w-full min-w-[760px] text-sm">
                <thead className="bg-muted/40 text-muted-foreground sticky top-0 border-b text-[11px] uppercase tracking-wider">
                  <tr>
                    <th className="px-4 py-2.5 text-left font-semibold">
                      {t('dashboard.segments.col_name', { defaultValue: 'Имя и фамилия' })}
                    </th>
                    <th className="px-3 py-2.5 text-right font-semibold">
                      {t('dashboard.segments.col_visits', { defaultValue: 'Визитов' })}
                    </th>
                    <th className="px-3 py-2.5 text-right font-semibold">LTV</th>
                    <th className="px-3 py-2.5 text-right font-semibold">
                      {t('dashboard.segments.col_since', { defaultValue: 'С нами с' })}
                    </th>
                    <th className="px-3 py-2.5 text-right font-semibold">
                      {t('dashboard.segments.col_last', { defaultValue: 'Последний визит' })}
                    </th>
                    <th className="px-3 py-2.5 text-right font-semibold">
                      {t('dashboard.segments.col_next', { defaultValue: 'След. визит' })}
                    </th>
                    <th className="px-3 py-2.5 text-center font-semibold">
                      {t('dashboard.segments.col_actions', { defaultValue: 'Действия' })}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {segmentClients.map((c) => (
                    <tr key={c.id} className="border-border/60 hover:bg-muted/20 border-t">
                      <td className="px-4 py-2.5">
                        <div className="text-foreground font-semibold">{c.name}</div>
                        {c.phone || c.email ? (
                          <div className="text-muted-foreground text-[11px]">
                            {c.phone ?? c.email}
                          </div>
                        ) : null}
                        {c.discount_percent ? (
                          <span className="bg-brand-sage-soft text-brand-sage-deep mt-0.5 inline-block rounded px-1.5 py-0.5 text-[10px] font-bold">
                            {t('dashboard.segments.discount_badge', {
                              percent: c.discount_percent,
                              defaultValue: 'скидка {{percent}}%',
                            })}
                          </span>
                        ) : null}
                      </td>
                      <td className="num text-foreground px-3 py-2.5 text-right font-semibold">
                        {c.visit_count}
                      </td>
                      <td className="num text-brand-sage-deep px-3 py-2.5 text-right font-bold">
                        {formatCurrency(c.total_revenue_cents, currency)}
                      </td>
                      <td className="num text-muted-foreground px-3 py-2.5 text-right text-xs">
                        {fmtDate(c.created_at)}
                      </td>
                      <td className="num text-muted-foreground px-3 py-2.5 text-right text-xs">
                        {fmtDate(c.last_visit_at)}
                      </td>
                      <td className="num text-muted-foreground px-3 py-2.5 text-right text-xs">
                        {fmtDate(nextVisits?.get(c.id))}
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center justify-center gap-1.5">
                          <IconAction
                            title={t('dashboard.segments.action_gift', { defaultValue: 'Подарок' })}
                            onClick={() => setAction({ kind: 'gift', client: c })}
                            className="bg-brand-gold-soft text-brand-gold-deep hover:brightness-95"
                          >
                            <Gift className="size-4" strokeWidth={2} />
                          </IconAction>
                          <IconAction
                            title={t('dashboard.segments.action_discount', {
                              defaultValue: 'Скидка',
                            })}
                            onClick={() => setAction({ kind: 'discount', client: c })}
                            className="bg-brand-teal-soft text-brand-teal-deep hover:brightness-95"
                          >
                            <Percent className="size-4" strokeWidth={2} />
                          </IconAction>
                          <IconAction
                            title={t('dashboard.segments.action_referral', {
                              defaultValue: 'Рефералка',
                            })}
                            onClick={() => setAction({ kind: 'referral', client: c })}
                            className="bg-brand-navy/10 text-brand-navy hover:brightness-95"
                          >
                            <UserPlus className="size-4" strokeWidth={2} />
                          </IconAction>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {action ? (
        action.kind === 'discount' ? (
          <DiscountDialog
            salonId={salonId}
            client={action.client}
            onClose={() => setAction(null)}
          />
        ) : (
          <MessageDialog
            salonId={salonId}
            client={action.client}
            kind={action.kind}
            onClose={() => setAction(null)}
          />
        )
      ) : null}
    </>
  )
}

function IconAction({
  title,
  onClick,
  className,
  children,
}: {
  title: string
  onClick: () => void
  className?: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      className={`inline-grid size-8 place-items-center rounded-md transition ${className ?? ''}`}
    >
      {children}
    </button>
  )
}

/** Персональная скидка клиента (clients.discount_percent). */
function DiscountDialog({
  salonId,
  client,
  onClose,
}: {
  salonId: string
  client: ClientRow
  onClose: () => void
}) {
  const { t } = useTranslation()
  const update = useUpdateClient(salonId)
  const [value, setValue] = useState<string>(String(client.discount_percent ?? ''))

  function save() {
    const num = value.trim() === '' ? null : Math.max(0, Math.min(100, Math.round(Number(value))))
    if (num !== null && Number.isNaN(num)) {
      toast.error(t('dashboard.segments.discount_invalid', { defaultValue: 'Введите число 0–100' }))
      return
    }
    update.mutate(
      { id: client.id, discount_percent: num },
      {
        onSuccess: () => {
          toast.success(
            t('dashboard.segments.discount_saved', { defaultValue: 'Скидка сохранена' }),
          )
          onClose()
        },
        onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
      },
    )
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="w-[min(440px,calc(100vw-2rem))] sm:!max-w-[440px]">
        <DialogHeader>
          <DialogTitle>
            {t('dashboard.segments.discount_title', { defaultValue: 'Постоянная скидка' })} ·{' '}
            {client.name}
          </DialogTitle>
          <DialogDescription>
            {t('dashboard.segments.discount_hint', {
              defaultValue: 'Скидка автоматически подставится в форму визита этого клиента.',
            })}
          </DialogDescription>
        </DialogHeader>
        <div className="py-2">
          <Label htmlFor="disc">
            {t('dashboard.segments.discount_label', { defaultValue: 'Скидка, %' })}
          </Label>
          <Input
            id="disc"
            type="number"
            min={0}
            max={100}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="0"
            className="num mt-1 h-10"
          />
        </div>
        <DialogFooter>
          <Button variant="outline" type="button" onClick={onClose} disabled={update.isPending}>
            {t('common.cancel')}
          </Button>
          <Button type="button" onClick={save} disabled={update.isPending}>
            {update.isPending ? <Loader2 className="size-4 animate-spin" strokeWidth={2} /> : null}
            {t('common.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Подарок / Рефералка — отправка SMS или email клиенту через рассылку. */
function MessageDialog({
  salonId,
  client,
  kind,
  onClose,
}: {
  salonId: string
  client: ClientRow
  kind: 'gift' | 'referral'
  onClose: () => void
}) {
  const { t } = useTranslation()
  const send = useSendBroadcast(salonId)

  const defaults =
    kind === 'gift'
      ? {
          title: t('dashboard.segments.gift_title', { defaultValue: 'Подарок клиенту' }),
          sms: t('dashboard.segments.gift_sms_default', {
            defaultValue: 'Дарим вам скидку 15% на следующий визит! Будем рады видеть вас снова 💛',
          }),
          subject: t('dashboard.segments.gift_subject_default', {
            defaultValue: 'Подарок для вас 🎁',
          }),
        }
      : {
          title: t('dashboard.segments.referral_title', {
            defaultValue: 'Пригласить привести подругу',
          }),
          sms: t('dashboard.segments.referral_sms_default', {
            defaultValue:
              'Приведите подругу — и получите приятный бонус на следующий визит! Спасибо, что вы с нами 💛',
          }),
          subject: t('dashboard.segments.referral_subject_default', {
            defaultValue: 'Бонус за приведённую подругу',
          }),
        }

  const canSms = !!client.phone
  const canEmail = !!client.email
  const [channel, setChannel] = useState<'sms' | 'email'>(canSms ? 'sms' : 'email')
  const [text, setText] = useState(defaults.sms)
  const [subject, setSubject] = useState(defaults.subject)

  function submit() {
    if (channel === 'sms' && !canSms) {
      toast.error(t('dashboard.segments.no_phone', { defaultValue: 'У клиента не указан телефон' }))
      return
    }
    if (channel === 'email' && !canEmail) {
      toast.error(t('dashboard.segments.no_email', { defaultValue: 'У клиента не указан email' }))
      return
    }
    send.mutate(
      {
        segment: { client_ids: [client.id] },
        channels: { sms: channel === 'sms', email: channel === 'email' },
        sms_text: channel === 'sms' ? text : undefined,
        email_subject: channel === 'email' ? subject : undefined,
        email_body: channel === 'email' ? text : undefined,
      },
      {
        onSuccess: (r) => {
          const sent = r.sent_sms + r.sent_email
          if (sent > 0) {
            toast.success(t('dashboard.segments.sent', { defaultValue: 'Сообщение отправлено' }))
            onClose()
          } else if (r.skipped_no_balance > 0) {
            toast.error(
              t('dashboard.segments.no_balance', {
                defaultValue: 'Не хватает SMS-баланса. Пополни в Маркетинге.',
              }),
            )
          } else {
            toast.error(
              t('dashboard.segments.not_sent', { defaultValue: 'Не удалось отправить сообщение' }),
            )
          }
        },
        onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
      },
    )
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="w-[min(520px,calc(100vw-2rem))] sm:!max-w-[520px]">
        <DialogHeader>
          <DialogTitle>
            {defaults.title} · {client.name}
          </DialogTitle>
          <DialogDescription>
            {t('dashboard.segments.message_hint', {
              defaultValue: 'Выбери канал и проверь текст. Можно отредактировать перед отправкой.',
            })}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-1">
          {/* Канал */}
          <div className="flex gap-2">
            <ChannelButton
              active={channel === 'sms'}
              disabled={!canSms}
              onClick={() => setChannel('sms')}
              icon={<MessageSquare className="size-4" strokeWidth={2} />}
              label="SMS"
            />
            <ChannelButton
              active={channel === 'email'}
              disabled={!canEmail}
              onClick={() => setChannel('email')}
              icon={<Mail className="size-4" strokeWidth={2} />}
              label="Email"
            />
          </div>

          {channel === 'email' ? (
            <div>
              <Label htmlFor="subj">
                {t('dashboard.segments.email_subject', { defaultValue: 'Тема письма' })}
              </Label>
              <Input
                id="subj"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                className="mt-1 h-10"
              />
            </div>
          ) : null}

          <div>
            <Label htmlFor="msg">
              {t('dashboard.segments.message_text', { defaultValue: 'Текст сообщения' })}
            </Label>
            <textarea
              id="msg"
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={4}
              className="border-border bg-card mt-1 w-full rounded-md border p-2 text-sm"
            />
            {channel === 'sms' ? (
              <p className="text-muted-foreground mt-1 text-[11px]">
                {t('dashboard.segments.sms_cost', {
                  defaultValue: '1 SMS списывается с баланса салона.',
                })}
              </p>
            ) : null}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" type="button" onClick={onClose} disabled={send.isPending}>
            {t('common.cancel')}
          </Button>
          <Button type="button" onClick={submit} disabled={send.isPending || !text.trim()}>
            {send.isPending ? <Loader2 className="size-4 animate-spin" strokeWidth={2} /> : null}
            {t('dashboard.segments.send', { defaultValue: 'Отправить' })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ChannelButton({
  active,
  disabled,
  onClick,
  icon,
  label,
}: {
  active: boolean
  disabled: boolean
  onClick: () => void
  icon: React.ReactNode
  label: string
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-md border text-sm font-semibold transition ${
        active
          ? 'border-primary bg-primary/10 text-primary'
          : 'border-border text-muted-foreground hover:bg-muted/40'
      } disabled:cursor-not-allowed disabled:opacity-40`}
    >
      {icon}
      {label}
    </button>
  )
}
